/*
 * RekordFox native audio shim. See rfx_audio.h.
 * The data callback is the only real-time code here: it writes a sine into one channel pair and
 * silence everywhere else, and touches nothing but its own atomics.
 */
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_ENCODING
#define MA_NO_GENERATION
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_NODE_GRAPH
#define MA_NO_ENGINE
#include "miniaudio.h"

#include "rfx_audio.h"

#include <math.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

static ma_context      g_ctx;
static int             g_ctxReady = 0;
static ma_device_info* g_playback = NULL;
static ma_uint32       g_playbackCount = 0;
static ma_device       g_dev;
static int             g_devOpen = 0;
static unsigned int    g_wantChannels = 0;
static char            g_err[512] = {0};
static char            g_openName[256] = {0};

/* Tone state — written by the control thread, read by the audio thread. */
static volatile int       g_tonePair = -1;
static volatile double    g_toneFreq = 0.0;
static volatile double    g_toneAmp = 0.0;
static volatile ma_int64  g_toneFrames = 0;     /* frames still to play */
static volatile ma_int64  g_toneTotal = 0;      /* frames in this tone, for the fades */
static double             g_tonePhase = 0.0;    /* audio thread only */

static rfx_render_proc g_renderer = NULL;

/* Counters the Rust side samples to work out the real callback cadence. */
static volatile ma_uint64 g_cbCount = 0;
static volatile ma_uint64 g_cbFrames = 0;
static volatile ma_uint32 g_cbMaxFrames = 0;

static void set_err(const char* what, ma_result r)
{
    if (r == MA_SUCCESS) snprintf(g_err, sizeof(g_err), "%s", what);
    else                 snprintf(g_err, sizeof(g_err), "%s: %s (%d)", what, ma_result_description(r), (int)r);
}

/* The sine writer, shared by the audio callback and the test hook. */
static void render(float* out, ma_uint32 frameCount, ma_uint32 channels, double rate)
{
    int      pair = g_tonePair;
    ma_int64 left = g_toneFrames;

    memset(out, 0, (size_t)frameCount * channels * sizeof(float));
    if (pair < 0 || left <= 0 || rate <= 0.0) return;

    {
        ma_uint32 base  = (ma_uint32)pair * 2;
        double    step  = 2.0 * MA_PI * g_toneFreq / rate;
        double    amp   = g_toneAmp;
        ma_int64  total = g_toneTotal;
        ma_int64  fade  = (ma_int64)(rate * 0.01); /* 10 ms fades so nothing clicks */
        ma_uint32 i;
        if (fade < 1) fade = 1;
        if (base + 1 >= channels) return; /* device has no such pair */

        for (i = 0; i < frameCount && left > 0; i += 1, left -= 1) {
            ma_int64 played = total - left;
            double   env    = 1.0;
            if (played < fade)    env = (double)played / (double)fade;
            else if (left < fade) env = (double)left / (double)fade;

            {
                float s = (float)(sin(g_tonePhase) * amp * env);
                out[(size_t)i * channels + base]     = s;
                out[(size_t)i * channels + base + 1] = s;
            }
            g_tonePhase += step;
            if (g_tonePhase > 2.0 * MA_PI) g_tonePhase -= 2.0 * MA_PI;
        }
        g_toneFrames = left;
        if (left <= 0) g_tonePair = -1;
    }
}

static void data_callback(ma_device* pDevice, void* pOutput, const void* pInput, ma_uint32 frameCount)
{
    rfx_render_proc renderer = g_renderer;
    (void)pInput;
    g_cbCount  += 1;
    g_cbFrames += frameCount;
    if (frameCount > g_cbMaxFrames) g_cbMaxFrames = frameCount;

    if (renderer != NULL) {
        renderer((float*)pOutput, frameCount, pDevice->playback.channels, pDevice->sampleRate);
        return;
    }
    render((float*)pOutput, frameCount, pDevice->playback.channels, (double)pDevice->sampleRate);
}

void rfx_set_renderer(rfx_render_proc proc)
{
    g_renderer = proc;
}

/* Test hooks: let the sine writer be exercised without a sound card (see tests/). */
void rfx_test_set_tone(int pair, double frames, double freq, double amplitude)
{
    g_toneFreq   = freq;
    g_toneAmp    = amplitude;
    g_toneTotal  = (ma_int64)frames;
    g_toneFrames = (ma_int64)frames;
    g_tonePhase  = 0.0;
    g_tonePair   = pair;
}

void rfx_test_render(float* out, unsigned int frames, unsigned int channels, unsigned int sampleRate)
{
    render(out, (ma_uint32)frames, (ma_uint32)channels, (double)sampleRate);
}

int rfx_init(void)
{
    ma_result r;
    ma_uint32 captureCount = 0;
    ma_device_info* capture = NULL;

    if (g_ctxReady) return 0;

    {
        /* RFX_BACKEND=null runs miniaudio's silent device — handy for testing without a sound card. */
        const char*  want = getenv("RFX_BACKEND");
        ma_backend   nullBackend[1];
        nullBackend[0] = ma_backend_null;
        if (want != NULL && strcmp(want, "null") == 0) r = ma_context_init(nullBackend, 1, NULL, &g_ctx);
        else                                           r = ma_context_init(NULL, 0, NULL, &g_ctx);
    }
    if (r != MA_SUCCESS) { set_err("could not start the audio backend", r); return 1; }

    r = ma_context_get_devices(&g_ctx, &g_playback, &g_playbackCount, &capture, &captureCount);
    if (r != MA_SUCCESS) { ma_context_uninit(&g_ctx); set_err("could not list output devices", r); return 2; }

    g_ctxReady = 1;
    return 0;
}

void rfx_uninit(void)
{
    rfx_close();
    if (g_ctxReady) { ma_context_uninit(&g_ctx); g_ctxReady = 0; }
    g_playback = NULL;
    g_playbackCount = 0;
}

const char* rfx_last_error(void) { return g_err; }

const char* rfx_backend_name(void)
{
    if (!g_ctxReady) return "none";
    return ma_get_backend_name(g_ctx.backend);
}

const char* rfx_version(void) { return MA_VERSION_STRING; }

int rfx_device_count(void) { return (int)g_playbackCount; }

static int valid_index(int index) { return g_ctxReady && index >= 0 && (ma_uint32)index < g_playbackCount; }

const char* rfx_device_name(int index) { return valid_index(index) ? g_playback[index].name : ""; }

int rfx_device_is_default(int index) { return valid_index(index) ? (int)g_playback[index].isDefault : 0; }

/* The backend reports one entry per native format; take the widest / first values it gives. */
int rfx_device_max_channels(int index)
{
    ma_uint32 i, best = 0;
    if (!valid_index(index)) return 0;
    for (i = 0; i < g_playback[index].nativeDataFormatCount; i += 1) {
        ma_uint32 ch = g_playback[index].nativeDataFormats[i].channels;
        if (ch > best) best = ch;
    }
    return (int)best;
}

int rfx_device_native_rate(int index)
{
    ma_uint32 i;
    if (!valid_index(index)) return 0;
    for (i = 0; i < g_playback[index].nativeDataFormatCount; i += 1) {
        ma_uint32 sr = g_playback[index].nativeDataFormats[i].sampleRate;
        if (sr != 0) return (int)sr;
    }
    return 0;
}

int rfx_open(int deviceIndex, int exclusive, unsigned int sampleRate, unsigned int channels, unsigned int periodFrames)
{
    ma_device_config cfg;
    ma_result r;

    if (!g_ctxReady) { set_err("audio backend not started", MA_SUCCESS); return 1; }
    if (g_devOpen) rfx_close();
    if (deviceIndex >= 0 && !valid_index(deviceIndex)) { set_err("no such output device", MA_SUCCESS); return 2; }

    cfg = ma_device_config_init(ma_device_type_playback);
    cfg.playback.pDeviceID       = (deviceIndex >= 0) ? &g_playback[deviceIndex].id : NULL;
    cfg.playback.format          = ma_format_f32;
    cfg.playback.channels        = channels;      /* 0 = let the device decide */
    cfg.playback.shareMode       = exclusive ? ma_share_mode_exclusive : ma_share_mode_shared;
    cfg.sampleRate               = sampleRate;    /* 0 = device native */
    cfg.periodSizeInFrames       = periodFrames;  /* 0 = backend default */
    cfg.periods                  = 2;
    cfg.performanceProfile       = ma_performance_profile_low_latency;
    cfg.noPreSilencedOutputBuffer = MA_TRUE;      /* the callback fills every frame itself */
    cfg.dataCallback             = data_callback;

    g_wantChannels = channels;
    g_tonePair = -1;
    g_toneFrames = 0;
    g_cbCount = 0;
    g_cbFrames = 0;
    g_cbMaxFrames = 0;

    r = ma_device_init(&g_ctx, &cfg, &g_dev);
    if (r != MA_SUCCESS) { set_err(exclusive ? "could not open the device in exclusive mode" : "could not open the device", r); return 3; }

    r = ma_device_start(&g_dev);
    if (r != MA_SUCCESS) { ma_device_uninit(&g_dev); set_err("could not start the device", r); return 4; }

    snprintf(g_openName, sizeof(g_openName), "%s", g_dev.playback.name);
    g_devOpen = 1;
    g_err[0] = 0;
    return 0;
}

int rfx_close(void)
{
    if (!g_devOpen) return 0;
    g_tonePair = -1;
    g_toneFrames = 0;
    ma_device_uninit(&g_dev);
    g_devOpen = 0;
    return 0;
}

const char* rfx_open_device_name(void) { return g_devOpen ? g_openName : ""; }

int rfx_get_int(int key)
{
    if (!g_devOpen) return 0;
    switch (key) {
        case 0: return (int)g_dev.playback.internalSampleRate;
        case 1: return (int)g_dev.playback.internalChannels;
        case 2: return (int)g_dev.playback.internalPeriodSizeInFrames;
        case 3: return (int)g_dev.playback.internalPeriods;
        case 4: return g_dev.playback.shareMode == ma_share_mode_exclusive ? 1 : 0;
        case 5: return (int)g_dev.playback.internalFormat;
        case 6: return (int)g_dev.playback.channels;
        default: return 0;
    }
}

double rfx_get_double(int key)
{
    if (!g_devOpen) return 0.0;
    switch (key) {
        case 0: {
            double sr = (double)g_dev.playback.internalSampleRate;
            if (sr <= 0.0) return 0.0;
            return (double)g_dev.playback.internalPeriodSizeInFrames * (double)g_dev.playback.internalPeriods * 1000.0 / sr;
        }
        case 1: return (double)g_cbCount;
        case 2: return (double)g_cbFrames;
        case 3: return (double)g_cbMaxFrames;
        default: return 0.0;
    }
}

int rfx_play_tone(int pair, double seconds, double freq, double amplitude)
{
    ma_int64 frames;
    if (!g_devOpen) { set_err("no device open", MA_SUCCESS); return 1; }
    if (pair < 0 || pair > 3) { set_err("channel pair out of range", MA_SUCCESS); return 2; }
    if ((ma_uint32)(pair * 2 + 1) >= g_dev.playback.channels) { set_err("this device has no such channel pair", MA_SUCCESS); return 3; }

    frames = (ma_int64)(seconds * (double)g_dev.sampleRate);
    if (frames < 1) frames = 1;
    g_toneFreq  = freq;
    g_toneAmp   = amplitude;
    g_toneTotal = frames;
    g_toneFrames = frames;
    g_tonePair  = pair;   /* set last: the callback checks this first */
    return 0;
}

int rfx_tone_busy(void) { return (g_tonePair >= 0 && g_toneFrames > 0) ? 1 : 0; }

void rfx_stop_tone(void) { g_tonePair = -1; g_toneFrames = 0; }
