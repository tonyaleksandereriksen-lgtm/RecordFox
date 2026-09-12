/*
 * RekordFox audio engine: two decks reading from RAM, the FLX2's mixer, and the master/headphone
 * split across the device's four output channels.
 *
 * Threading contract
 *   - The control functions (load, transport, mixer) are called from the UI thread. They never
 *     block the audio thread: parameters are plain aligned writes, a track hand-off is published
 *     with a release store, and seeks carry a sequence number so a repeat of the same position
 *     still counts.
 *   - rfx_engine_render() is called from the audio callback only. It allocates nothing and takes
 *     no locks.
 *   - Readback (position, meters) goes back through atomics.
 */
#ifndef RFX_ENGINE_H
#define RFX_ENGINE_H

#define RFX_DECKS 2

#ifdef __cplusplus
extern "C" {
#endif

/* --- lifecycle ---------------------------------------------------------- */
int         rfx_engine_init(unsigned int sampleRate);
void        rfx_engine_shutdown(void);
const char* rfx_engine_last_error(void);
unsigned int rfx_engine_sample_rate(void);
/* Installs rfx_engine_render() as the device renderer (see rfx_audio.h). */
void        rfx_engine_attach(void);

/* --- tracks ------------------------------------------------------------- */
/* Decodes the whole file into memory at the engine's sample rate (wav / flac / mp3).
   Runs on the calling thread and can take a moment; the deck keeps playing what it has. */
int    rfx_deck_load(int deck, const char* path);
void   rfx_deck_eject(int deck);
double rfx_deck_length_seconds(int deck);
int    rfx_deck_has_track(int deck);

/* --- transport ---------------------------------------------------------- */
void   rfx_deck_play(int deck, int playing);
int    rfx_deck_playing(int deck);
void   rfx_deck_seek(int deck, double seconds);
double rfx_deck_position(int deck);
/* 1.0 = as recorded. Negative plays backwards. */
void   rfx_deck_set_rate(int deck, double rate);
/* While on, this rate replaces the tempo rate — that is what a jog touch does. */
void   rfx_deck_set_scratch(int deck, int on, double rate);
/* Scratch by following the hand instead: the control side sends where the platter has put the
   playhead (once per UI frame is enough). The engine measures the hand's speed between targets on
   its own clock, smooths it, and pulls gently toward the target so nothing drifts — so a target
   that only changes 60 times a second still sounds like a continuous motion. `on` = 0 leaves it. */
void   rfx_deck_scratch_to(int deck, int on, double targetSeconds);
void   rfx_deck_set_loop(int deck, double inSeconds, double outSeconds, int active);

/* --- mixer (all positions 0..1, exactly as the UI and the FLX2 send them) */
void   rfx_deck_set_channel(int deck, double trim, double eqHi, double eqMid, double eqLow, double cfx, double fader, int pfl);
void   rfx_engine_set_master(double crossfader, double masterLevel, double phonesLevel, double phonesMix, int masterCue);

/* --- files -------------------------------------------------------------- */
/* Reads a file's headers without decoding it: duration, native rate and channels. 0 = ok.
   Works before the engine is started, so the library can probe files at any time. */
int    rfx_probe_file(const char* path, double* lengthSeconds, int* sampleRate, int* channels);

/* --- meters and health -------------------------------------------------- */
/* Peak since the last call, then cleared. */
double rfx_deck_peak(int deck);
double rfx_engine_master_peak(void);
unsigned long long rfx_engine_frames_rendered(void);
/* Callbacks that could not be filled in time. Should stay at 0. */
unsigned int rfx_engine_underruns(void);

/* --- the audio thread's entry point ------------------------------------- */
void   rfx_engine_render(float* out, unsigned int frames, unsigned int channels, unsigned int sampleRate);

#ifdef __cplusplus
}
#endif
#endif /* RFX_ENGINE_H */
