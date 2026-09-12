#include "rfx_engine.h"
#include "rfx_atomic.h"
#include "rfx_audio.h"
#include "rfx_dsp.h"

/* miniaudio's implementation lives in rfx_audio.c; here we only need its declarations, and they
 * must be the same ones that TU compiled — so no MA_NO_* switches in this file. */
#include "miniaudio.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* One decoded track: 16-bit stereo at the engine's rate, whole thing in RAM so a jog can read
 * backwards and a seek is instant (7 minutes is about 80 MB). */
typedef struct {
    short*    samples;   /* interleaved stereo, NULL when the slot is empty */
    rfx_u64   frames;
} rfx_track;

typedef struct {
    /* --- published by the control thread ---------------------------- */
    rfx_track       slot[2];
    volatile rfx_u32 activeSlot;     /* which slot the audio thread should read */
    volatile rfx_u32 playing;
    volatile rfx_u32 seekSeq;        /* bumped per seek request */
    volatile rfx_u64 seekPosBits;    /* seek target in frames, as a double */
    volatile rfx_u32 scratching;
    volatile double  rate;           /* tempo rate */
    volatile double  scratchRate;
    volatile rfx_u32 scratchFollow;  /* 1 = follow scratchTarget, 0 = play at scratchRate */
    volatile rfx_u64 scratchTargetBits;  /* where the hand has put the playhead, frames as a double */
    volatile rfx_u32 scratchSeq;     /* bumped per target update */
    volatile double  trim, eqHi, eqMid, eqLow, cfx, fader;
    volatile rfx_u32 pfl;
    volatile rfx_u64 loopInBits, loopOutBits;   /* frames, as doubles */
    volatile rfx_u32 loopActive;

    /* --- audio thread only ------------------------------------------ */
    double    pos;                   /* playhead in frames */
    rfx_u32   seenSeekSeq;
    rfx_u32   seenSlot;
    rfx_u32   seenScratchSeq;
    int       followAnchored;        /* a target has been seen since scratch-follow began */
    double    followVel;             /* the hand's speed, frames per frame, smoothed */
    double    followAnchor;          /* the last target, frames */
    rfx_u64   followAnchorAt;        /* g_framesRendered when it arrived */
    double    followSince;           /* frames rendered since then (extrapolates the hand) */
    rfx_eq3   eq;
    rfx_cfx   filter;
    double    cfxKnobApplied;

    /* --- readback --------------------------------------------------- */
    volatile rfx_u64 posBits;        /* playhead in seconds */
    volatile rfx_u64 peakBits;
} rfx_deck;

static rfx_deck     g_deck[RFX_DECKS];
static unsigned int g_rate = 0;
static int          g_ready = 0;
static char         g_engineErr[512] = {0};

static volatile double  g_crossfader = 0.5;
static volatile double  g_masterLevel = 0.8;
static volatile double  g_phonesLevel = 0.6;
static volatile double  g_phonesMix = 0.0;      /* 0 = cue only, 1 = master only */
static volatile rfx_u32 g_masterCue = 0;
static volatile rfx_u64 g_masterPeakBits = 0;
static volatile rfx_u64 g_framesRendered = 0;
static volatile rfx_u32 g_underruns = 0;

/* Scratch-follow tuning. SMOOTH is the share of a new speed estimate taken per target update
 * (0.45 = about two UI frames of lag; the jog's tick quantisation comes through at ~4 %). PULL_SEC
 * is the time constant of the pull toward the extrapolated hand position: short enough that the
 * overshoot after a stop (at most one report interval of audio) is back within ~0.1 s, long
 * enough that a noisy speed estimate does not turn into a wobble. HOLD_SEC is how long the
 * playhead keeps its last speed when targets stop arriving (a stalled UI) before coasting to rest. */
#define RFX_SCRATCH_SMOOTH   0.45
#define RFX_SCRATCH_PULL_SEC 0.04
#define RFX_SCRATCH_HOLD_SEC 0.15
#define RFX_SCRATCH_MAX_VEL  8.0

/* ------------------------------------------------------------------ helpers */

static void set_engine_err(const char* what, ma_result r)
{
    if (r == MA_SUCCESS) snprintf(g_engineErr, sizeof(g_engineErr), "%s", what);
    else                 snprintf(g_engineErr, sizeof(g_engineErr), "%s: %s (%d)", what, ma_result_description(r), (int)r);
}

static int valid_deck(int deck) { return g_ready && deck >= 0 && deck < RFX_DECKS; }

static double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* ------------------------------------------------------------- lifecycle */

int rfx_engine_init(unsigned int sampleRate)
{
    int d;
    if (sampleRate == 0) sampleRate = 48000;
    rfx_engine_shutdown();

    memset(g_deck, 0, sizeof(g_deck));
    g_rate = sampleRate;
    for (d = 0; d < RFX_DECKS; d += 1) {
        rfx_deck* k = &g_deck[d];
        k->rate = 1.0;
        k->scratchRate = 0.0;
        k->trim = 0.5;
        k->eqHi = k->eqMid = k->eqLow = 0.5;
        k->cfx = 0.5;
        k->fader = 0.0;
        rfx_eq3_init(&k->eq, (double)sampleRate);
        rfx_cfx_init(&k->filter, (double)sampleRate);
        k->cfxKnobApplied = 0.5;
        rfx_store_f64(&k->loopInBits, 0.0);
        rfx_store_f64(&k->loopOutBits, 0.0);
    }
    g_framesRendered = 0;
    g_underruns = 0;
    g_ready = 1;
    g_engineErr[0] = 0;
    return 0;
}

void rfx_engine_shutdown(void)
{
    int d, s;
    g_ready = 0;
    for (d = 0; d < RFX_DECKS; d += 1) {
        for (s = 0; s < 2; s += 1) {
            free(g_deck[d].slot[s].samples);
            g_deck[d].slot[s].samples = NULL;
            g_deck[d].slot[s].frames = 0;
        }
    }
    g_rate = 0;
}

const char*  rfx_engine_last_error(void) { return g_engineErr; }
unsigned int rfx_engine_sample_rate(void) { return g_rate; }
void         rfx_engine_attach(void) { rfx_set_renderer(rfx_engine_render); }

/* ------------------------------------------------------------ track load */

/* Waits until the audio thread has certainly stopped looking at the slot we are about to reuse.
 * Two whole callbacks is plenty; if audio is not running at all, the check falls through. */
static void wait_for_audio_to_move_on(void)
{
    rfx_u64 start = rfx_load_u64(&g_framesRendered);
    int spins;
    for (spins = 0; spins < 200; spins += 1) {
        if (rfx_load_u64(&g_framesRendered) == start) break;   /* not rendering: nothing to wait for */
        if (rfx_load_u64(&g_framesRendered) > start + 4096) return;
    }
}

int rfx_deck_load(int deck, const char* path)
{
    ma_decoder_config cfg;
    ma_decoder        dec;
    ma_result         r;
    rfx_deck*         k;
    rfx_u64           capacity, used = 0;
    short*            buffer;
    rfx_u32           target;

    if (!valid_deck(deck)) { set_engine_err("engine not started", MA_SUCCESS); return 1; }
    if (path == NULL || path[0] == 0) { set_engine_err("no file given", MA_SUCCESS); return 2; }
    k = &g_deck[deck];

    cfg = ma_decoder_config_init(ma_format_s16, 2, g_rate);
    r = ma_decoder_init_file(path, &cfg, &dec);
    if (r != MA_SUCCESS) { set_engine_err("could not open the audio file", r); return 3; }

    /* Ask how long it is; some formats will not say, so grow as we go. */
    {
        ma_uint64 length = 0;
        if (ma_decoder_get_length_in_pcm_frames(&dec, &length) != MA_SUCCESS) length = 0;
        capacity = (length > 0) ? length + 64 : (rfx_u64)g_rate * 30;
    }
    buffer = (short*)malloc((size_t)capacity * 2 * sizeof(short));
    if (buffer == NULL) { ma_decoder_uninit(&dec); set_engine_err("out of memory for the track", MA_SUCCESS); return 4; }

    for (;;) {
        ma_uint64 room = capacity - used;
        ma_uint64 got = 0;
        if (room == 0) {
            short* grown;
            rfx_u64 bigger = capacity * 2;
            grown = (short*)realloc(buffer, (size_t)bigger * 2 * sizeof(short));
            if (grown == NULL) { free(buffer); ma_decoder_uninit(&dec); set_engine_err("out of memory for the track", MA_SUCCESS); return 4; }
            buffer = grown;
            capacity = bigger;
            room = capacity - used;
        }
        r = ma_decoder_read_pcm_frames(&dec, buffer + used * 2, room, &got);
        used += got;
        if (r != MA_SUCCESS || got == 0) break;   /* MA_AT_END or a read error: we keep what we have */
    }
    ma_decoder_uninit(&dec);

    if (used == 0) { free(buffer); set_engine_err("the file decoded to nothing", MA_SUCCESS); return 5; }

    /* Publish into the slot the audio thread is not using. */
    target = rfx_load_u32(&k->activeSlot) ^ 1u;
    rfx_deck_play(deck, 0);
    wait_for_audio_to_move_on();

    free(k->slot[target].samples);
    k->slot[target].samples = buffer;
    k->slot[target].frames = used;

    rfx_store_f64(&k->seekPosBits, 0.0);
    rfx_store_u32(&k->seekSeq, rfx_load_u32(&k->seekSeq) + 1);
    rfx_store_u32(&k->loopActive, 0);
    rfx_store_u32(&k->activeSlot, target);
    g_engineErr[0] = 0;
    return 0;
}

void rfx_deck_eject(int deck)
{
    rfx_deck* k;
    if (!valid_deck(deck)) return;
    k = &g_deck[deck];
    rfx_deck_play(deck, 0);
    wait_for_audio_to_move_on();
    /* Point at an empty slot rather than freeing what the audio thread may still hold. */
    {
        rfx_u32 target = rfx_load_u32(&k->activeSlot) ^ 1u;
        free(k->slot[target].samples);
        k->slot[target].samples = NULL;
        k->slot[target].frames = 0;
        rfx_store_u32(&k->activeSlot, target);
    }
    rfx_store_f64(&k->posBits, 0.0);
}

double rfx_deck_length_seconds(int deck)
{
    rfx_deck* k;
    rfx_u64 frames;
    if (!valid_deck(deck) || g_rate == 0) return 0.0;
    k = &g_deck[deck];
    frames = k->slot[rfx_load_u32(&k->activeSlot) & 1u].frames;
    return (double)frames / (double)g_rate;
}

int rfx_deck_has_track(int deck)
{
    rfx_deck* k;
    if (!valid_deck(deck)) return 0;
    k = &g_deck[deck];
    return k->slot[rfx_load_u32(&k->activeSlot) & 1u].samples != NULL;
}

/* ------------------------------------------------------------- transport */

void rfx_deck_play(int deck, int playing)
{
    if (!valid_deck(deck)) return;
    rfx_store_u32(&g_deck[deck].playing, playing ? 1u : 0u);
}

int rfx_deck_playing(int deck)
{
    if (!valid_deck(deck)) return 0;
    return (int)rfx_load_u32(&g_deck[deck].playing);
}

void rfx_deck_seek(int deck, double seconds)
{
    rfx_deck* k;
    if (!valid_deck(deck)) return;
    k = &g_deck[deck];
    if (seconds < 0.0) seconds = 0.0;
    rfx_store_f64(&k->seekPosBits, seconds * (double)g_rate);
    rfx_store_u32(&k->seekSeq, rfx_load_u32(&k->seekSeq) + 1);
    rfx_store_f64(&k->posBits, seconds);
}

double rfx_deck_position(int deck)
{
    if (!valid_deck(deck)) return 0.0;
    return rfx_load_f64(&g_deck[deck].posBits);
}

void rfx_deck_set_rate(int deck, double rate)
{
    if (!valid_deck(deck)) return;
    g_deck[deck].rate = clampd(rate, -4.0, 4.0);
}

void rfx_deck_set_scratch(int deck, int on, double rate)
{
    rfx_deck* k;
    if (!valid_deck(deck)) return;
    k = &g_deck[deck];
    k->scratchRate = clampd(rate, -RFX_SCRATCH_MAX_VEL, RFX_SCRATCH_MAX_VEL);
    rfx_store_u32(&k->scratchFollow, 0u);
    rfx_store_u32(&k->scratching, on ? 1u : 0u);
}

void rfx_deck_scratch_to(int deck, int on, double targetSeconds)
{
    rfx_deck* k;
    if (!valid_deck(deck)) return;
    k = &g_deck[deck];
    if (targetSeconds < 0.0) targetSeconds = 0.0;
    rfx_store_f64(&k->scratchTargetBits, targetSeconds * (double)g_rate);
    rfx_store_u32(&k->scratchSeq, rfx_load_u32(&k->scratchSeq) + 1);
    rfx_store_u32(&k->scratchFollow, on ? 1u : 0u);
    rfx_store_u32(&k->scratching, on ? 1u : 0u);
}

void rfx_deck_set_loop(int deck, double inSeconds, double outSeconds, int active)
{
    rfx_deck* k;
    if (!valid_deck(deck)) return;
    k = &g_deck[deck];
    if (outSeconds <= inSeconds) active = 0;
    rfx_store_f64(&k->loopInBits, clampd(inSeconds, 0.0, 1e9) * (double)g_rate);
    rfx_store_f64(&k->loopOutBits, clampd(outSeconds, 0.0, 1e9) * (double)g_rate);
    rfx_store_u32(&k->loopActive, active ? 1u : 0u);
}

/* ----------------------------------------------------------------- mixer */

void rfx_deck_set_channel(int deck, double trim, double eqHi, double eqMid, double eqLow, double cfx, double fader, int pfl)
{
    rfx_deck* k;
    if (!valid_deck(deck)) return;
    k = &g_deck[deck];
    k->trim  = clampd(trim, 0.0, 1.0);
    k->eqHi  = clampd(eqHi, 0.0, 1.0);
    k->eqMid = clampd(eqMid, 0.0, 1.0);
    k->eqLow = clampd(eqLow, 0.0, 1.0);
    k->cfx   = clampd(cfx, 0.0, 1.0);
    k->fader = clampd(fader, 0.0, 1.0);
    rfx_store_u32(&k->pfl, pfl ? 1u : 0u);
}

void rfx_engine_set_master(double crossfader, double masterLevel, double phonesLevel, double phonesMix, int masterCue)
{
    g_crossfader  = clampd(crossfader, 0.0, 1.0);
    g_masterLevel = clampd(masterLevel, 0.0, 1.0);
    g_phonesLevel = clampd(phonesLevel, 0.0, 1.0);
    g_phonesMix   = clampd(phonesMix, 0.0, 1.0);
    rfx_store_u32(&g_masterCue, masterCue ? 1u : 0u);
}

/* ----------------------------------------------------------------- files */

int rfx_probe_file(const char* path, double* lengthSeconds, int* sampleRate, int* channels)
{
    ma_decoder dec;
    ma_result  r;
    ma_uint64  length = 0;

    if (lengthSeconds) *lengthSeconds = 0.0;
    if (sampleRate)    *sampleRate = 0;
    if (channels)      *channels = 0;
    if (path == NULL || path[0] == 0) { set_engine_err("no file given", MA_SUCCESS); return 2; }

    /* No config: keep the file's own format so the numbers describe the file, not the engine. */
    r = ma_decoder_init_file(path, NULL, &dec);
    if (r != MA_SUCCESS) { set_engine_err("could not open the audio file", r); return 3; }
    if (ma_decoder_get_length_in_pcm_frames(&dec, &length) != MA_SUCCESS) length = 0;
    if (sampleRate) *sampleRate = (int)dec.outputSampleRate;
    if (channels)   *channels = (int)dec.outputChannels;
    if (lengthSeconds && dec.outputSampleRate > 0) *lengthSeconds = (double)length / (double)dec.outputSampleRate;
    ma_decoder_uninit(&dec);
    if (length == 0) { set_engine_err("the file has no readable audio", MA_SUCCESS); return 5; }
    g_engineErr[0] = 0;
    return 0;
}

/* ---------------------------------------------------------------- meters */

static double take_peak(volatile rfx_u64* slot)
{
    double v = rfx_load_f64(slot);
    rfx_store_f64(slot, 0.0);
    return v;
}

double rfx_deck_peak(int deck) { return valid_deck(deck) ? take_peak(&g_deck[deck].peakBits) : 0.0; }
double rfx_engine_master_peak(void) { return take_peak(&g_masterPeakBits); }
unsigned long long rfx_engine_frames_rendered(void) { return rfx_load_u64(&g_framesRendered); }
unsigned int rfx_engine_underruns(void) { return rfx_load_u32(&g_underruns); }

/* ---------------------------------------------------------------- render */

/* One sample from the track, cubic over the four neighbouring frames. Out of range reads 0. */
static double read_sample(const short* s, rfx_u64 frames, double pos, int channel)
{
    long long i = (long long)floor(pos);
    double    f = pos - (double)i;
    double    p[4];
    int       k;
    if (frames == 0) return 0.0;
    for (k = 0; k < 4; k += 1) {
        long long n = i - 1 + k;
        if (n < 0 || (rfx_u64)n >= frames) p[k] = 0.0;
        else p[k] = (double)s[(size_t)n * 2 + channel] * (1.0 / 32768.0);
    }
    return rfx_interp_cubic(p[0], p[1], p[2], p[3], f);
}

void rfx_engine_render(float* out, unsigned int frames, unsigned int channels, unsigned int sampleRate)
{
    double xf[RFX_DECKS];
    double masterGain, phonesGain, phonesMix;
    int    masterCue;
    unsigned int i;
    int    d;

    if (out == NULL || frames == 0 || channels == 0) return;
    memset(out, 0, (size_t)frames * channels * sizeof(float));
    if (!g_ready) return;
    if (sampleRate != 0 && sampleRate != g_rate) {
        /* The device changed rate under us: the control side must re-init. Stay silent rather than
         * playing everything at the wrong pitch. */
        rfx_store_u32(&g_underruns, rfx_load_u32(&g_underruns) + 1);
        return;
    }

    masterGain = rfx_knob_gain(g_masterLevel);
    phonesGain = rfx_knob_gain(g_phonesLevel);
    phonesMix  = g_phonesMix;
    masterCue  = (int)rfx_load_u32(&g_masterCue);
    for (d = 0; d < RFX_DECKS; d += 1) xf[d] = rfx_crossfader_gain(g_crossfader, d);

    /* Per-block set-up: pick up slot swaps, seeks and a moved CFX knob. */
    for (d = 0; d < RFX_DECKS; d += 1) {
        rfx_deck* k = &g_deck[d];
        rfx_u32 slot = rfx_load_u32(&k->activeSlot) & 1u;
        rfx_u32 seq  = rfx_load_u32(&k->seekSeq);
        double  knob = k->cfx;

        if (slot != k->seenSlot) {
            k->seenSlot = slot;
            rfx_eq3_init(&k->eq, (double)g_rate);
            rfx_cfx_init(&k->filter, (double)g_rate);
            k->cfxKnobApplied = -1.0;   /* force a re-set below */
        }
        if (seq != k->seenSeekSeq) {
            k->seenSeekSeq = seq;
            k->pos = rfx_load_f64(&k->seekPosBits);
            /* A jump while the hand is on the platter (a hot cue, say) must not read as a fast scratch. */
            k->followAnchor = k->pos;
            k->followAnchorAt = rfx_load_u64(&g_framesRendered);
            k->followSince = 0.0;
            k->followVel = 0.0;
        }
        if (knob != k->cfxKnobApplied) {
            rfx_cfx_set(&k->filter, knob);
            k->cfxKnobApplied = knob;
        }

        /* Scratch-follow: a new target gives a new speed estimate on the audio clock. */
        if (rfx_load_u32(&k->scratching) && rfx_load_u32(&k->scratchFollow)) {
            rfx_u32 sseq = rfx_load_u32(&k->scratchSeq);
            if (sseq != k->seenScratchSeq) {
                double  target = rfx_load_f64(&k->scratchTargetBits);
                rfx_u64 now = rfx_load_u64(&g_framesRendered);
                k->seenScratchSeq = sseq;
                if (k->followAnchored) {
                    double dt = (double)(now - k->followAnchorAt);
                    double v;
                    if (dt < 1.0) dt = 1.0;
                    v = clampd((target - k->followAnchor) / dt, -RFX_SCRATCH_MAX_VEL, RFX_SCRATCH_MAX_VEL);
                    /* No movement at all since the last report is unambiguous (the jog sends whole
                     * ticks): the hand has stopped, so stop now instead of coasting past it. */
                    if (fabs(target - k->followAnchor) < 0.5) k->followVel = 0.0;
                    else k->followVel += (v - k->followVel) * RFX_SCRATCH_SMOOTH;
                } else {
                    /* First target since the touch: start from rest at the hand's position. */
                    k->followAnchored = 1;
                    k->followVel = 0.0;
                }
                k->followAnchor = target;
                k->followAnchorAt = now;
                k->followSince = 0.0;
            } else if (k->followSince > RFX_SCRATCH_HOLD_SEC * (double)g_rate) {
                /* Targets stopped coming (the UI stalled): coast to rest rather than run away. */
                k->followVel *= exp(-(double)frames / (RFX_SCRATCH_PULL_SEC * (double)g_rate));
            }
        } else {
            k->followAnchored = 0;
            k->followVel = 0.0;
        }
    }

    for (i = 0; i < frames; i += 1) {
        double masterL = 0.0, masterR = 0.0, cueL = 0.0, cueR = 0.0;

        for (d = 0; d < RFX_DECKS; d += 1) {
            rfx_deck*    k = &g_deck[d];
            const rfx_track* t = &k->slot[k->seenSlot];
            double gTrim, gFader, gLow, gMid, gHigh, l, r, step;
            double peak;

            if (t->samples == NULL || t->frames == 0) continue;

            /* --- read the two samples under the playhead ------------- */
            l = read_sample(t->samples, t->frames, k->pos, 0);
            r = read_sample(t->samples, t->frames, k->pos, 1);

            /* --- channel strip: trim -> EQ -> Sound Color FX -------- */
            gTrim = rfx_knob_gain(k->trim);
            gLow  = rfx_eq_gain(k->eqLow);
            gMid  = rfx_eq_gain(k->eqMid);
            gHigh = rfx_eq_gain(k->eqHi);
            l *= gTrim;
            r *= gTrim;
            l = rfx_eq3_process(&k->eq, 0, l, gLow, gMid, gHigh);
            r = rfx_eq3_process(&k->eq, 1, r, gLow, gMid, gHigh);
            l = rfx_cfx_process(&k->filter, 0, l);
            r = rfx_cfx_process(&k->filter, 1, r);

            /* Headphone CUE is pre-fader, like the hardware. */
            if (rfx_load_u32(&k->pfl)) {
                cueL += l;
                cueR += r;
            }

            gFader = rfx_fader_gain(k->fader);
            l *= gFader;
            r *= gFader;

            masterL += l * xf[d];
            masterR += r * xf[d];

            peak = fabs(l) > fabs(r) ? fabs(l) : fabs(r);
            if (peak > rfx_load_f64(&k->peakBits)) rfx_store_f64(&k->peakBits, peak);

            /* --- advance the playhead ------------------------------- */
            if (rfx_load_u32(&k->scratching)) {
                if (rfx_load_u32(&k->scratchFollow)) {
                    /* Move at the hand's speed; pull toward where the hand is *now* (the last target
                     * extrapolated by that speed), so the pull corrects drift without adding a
                     * frame-rate sawtooth of its own. */
                    double predicted = k->followAnchor + k->followVel * k->followSince;
                    step = k->followVel + (predicted - k->pos) / (RFX_SCRATCH_PULL_SEC * (double)g_rate);
                    k->followSince += 1.0;
                } else {
                    step = k->scratchRate;
                }
            } else {
                step = rfx_load_u32(&k->playing) ? k->rate : 0.0;
            }
            if (step != 0.0) {
                double newPos = k->pos + step;
                if (rfx_load_u32(&k->loopActive)) {
                    double in = rfx_load_f64(&k->loopInBits);
                    double outEnd = rfx_load_f64(&k->loopOutBits);
                    double len = outEnd - in;
                    if (len > 1.0) {
                        while (newPos >= outEnd) newPos -= len;
                        while (newPos < in)      newPos += len;
                    }
                }
                if (newPos < 0.0) {
                    newPos = 0.0;
                    if (!rfx_load_u32(&k->scratching)) rfx_store_u32(&k->playing, 0u);
                } else if (newPos >= (double)t->frames) {
                    newPos = (double)t->frames;
                    rfx_store_u32(&k->playing, 0u);   /* end of track */
                }
                k->pos = newPos;
            }
        }

        /* --- master and headphones ---------------------------------- */
        {
            double mL = masterL * masterGain;
            double mR = masterR * masterGain;
            double peak = fabs(mL) > fabs(mR) ? fabs(mL) : fabs(mR);
            double hL, hR;

            if (peak > rfx_load_f64(&g_masterPeakBits)) rfx_store_f64(&g_masterPeakBits, peak);

            /* Soft clip so a hot mix distorts instead of wrapping. */
            if (mL > 1.0) mL = 1.0; else if (mL < -1.0) mL = -1.0;
            if (mR > 1.0) mR = 1.0; else if (mR < -1.0) mR = -1.0;

            out[(size_t)i * channels + 0] = (float)mL;
            if (channels > 1) out[(size_t)i * channels + 1] = (float)mR;

            if (channels >= 4) {
                double mixCue = masterCue ? phonesMix : 0.0;   /* only blend in master when MASTER CUE is on */
                hL = (cueL * (1.0 - mixCue) + masterL * mixCue) * phonesGain;
                hR = (cueR * (1.0 - mixCue) + masterR * mixCue) * phonesGain;
                if (masterCue && phonesMix >= 1.0) { hL = masterL * phonesGain; hR = masterR * phonesGain; }
                if (hL > 1.0) hL = 1.0; else if (hL < -1.0) hL = -1.0;
                if (hR > 1.0) hR = 1.0; else if (hR < -1.0) hR = -1.0;
                out[(size_t)i * channels + 2] = (float)hL;
                out[(size_t)i * channels + 3] = (float)hR;
            }
        }
    }

    /* Publish playheads once per block — the UI reads these, 60 times a second at most. */
    for (d = 0; d < RFX_DECKS; d += 1) {
        rfx_deck* k = &g_deck[d];
        rfx_store_f64(&k->posBits, k->pos / (double)g_rate);
    }
    rfx_store_u64(&g_framesRendered, rfx_load_u64(&g_framesRendered) + frames);
}
