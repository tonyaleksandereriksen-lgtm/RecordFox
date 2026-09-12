/*
 * RekordFox native audio shim — a flat C ABI over miniaudio so the Rust side never has to
 * mirror miniaudio's structs. Everything here takes and returns primitives.
 * Not thread-safe by design: one device at a time, driven from one thread.
 */
#ifndef RFX_AUDIO_H
#define RFX_AUDIO_H

#ifdef __cplusplus
extern "C" {
#endif

/* --- context ------------------------------------------------------------ */
int         rfx_init(void);            /* 0 = ok. Initialises the audio context and enumerates outputs. */
void        rfx_uninit(void);
const char* rfx_last_error(void);
const char* rfx_backend_name(void);
const char* rfx_version(void);         /* miniaudio version */

/* --- device list -------------------------------------------------------- */
int         rfx_device_count(void);
const char* rfx_device_name(int index);
int         rfx_device_is_default(int index);
int         rfx_device_max_channels(int index);  /* 0 = the backend did not say */
int         rfx_device_native_rate(int index);   /* 0 = the backend did not say */

/* --- open / close ------------------------------------------------------- */
/* exclusive: 1 = WASAPI exclusive / CoreAudio hog-free low latency, 0 = shared.
   sampleRate/channels/periodFrames may be 0 to let the backend choose. */
int         rfx_open(int deviceIndex, int exclusive, unsigned int sampleRate, unsigned int channels, unsigned int periodFrames);
int         rfx_close(void);
const char* rfx_open_device_name(void);

/* Keys for rfx_get_int:
   0 internal sample rate, 1 internal channels, 2 internal period frames, 3 internal periods,
   4 exclusive actually granted, 5 internal format (ma_format), 6 requested channels */
int         rfx_get_int(int key);
/* Keys for rfx_get_double:
   0 output buffer latency ms, 1 callbacks so far, 2 frames written so far, 3 longest callback gap in frames */
double      rfx_get_double(int key);

/* --- renderer ----------------------------------------------------------- */
/* The engine installs itself here; without one, the device plays the test tone (or silence).
   Called from the audio thread: it must fill every frame and must not allocate or block. */
typedef void (*rfx_render_proc)(float* out, unsigned int frames, unsigned int channels, unsigned int sampleRate);
void        rfx_set_renderer(rfx_render_proc proc);

/* --- test tone ---------------------------------------------------------- */
/* pair 0 = channels 1/2 (master), 1 = channels 3/4 (headphones). Returns 0 when the tone started. */
int         rfx_play_tone(int pair, double seconds, double freq, double amplitude);
int         rfx_tone_busy(void);
void        rfx_stop_tone(void);

/* --- test hooks (no device needed) -------------------------------------- */
void rfx_test_set_tone(int pair, double frames, double freq, double amplitude);
void rfx_test_render(float* out, unsigned int frames, unsigned int channels, unsigned int sampleRate);

#ifdef __cplusplus
}
#endif
#endif /* RFX_AUDIO_H */


