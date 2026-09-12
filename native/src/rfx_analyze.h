/*
 * Offline track analysis: the numbers rekordbox works out on import — BPM, the downbeat that anchors
 * the beat grid, the musical key in Camelot notation, and the 3-band waveform the decks draw.
 *
 * Runs on a worker thread, never in the audio callback. One call decodes the file, analyses it and
 * fills the struct; free it afterwards with rfx_analysis_free().
 */
#ifndef RFX_ANALYZE_H
#define RFX_ANALYZE_H

#ifdef __cplusplus
extern "C" {
#endif

/** Waveform resolution the UI already expects (src/engine/waveform.ts). */
#define RFX_WAVE_BINS_PER_SEC 100

typedef struct {
    int          ok;
    double       durationSec;
    unsigned int sourceRate;      /* the file's own sample rate */
    unsigned int sourceChannels;

    double       bpm;             /* folded into 70..190 */
    double       bpmConfidence;   /* peak-to-average of the tempo score, 0..1-ish */
    double       firstBeatSec;    /* downbeat, inside the first bar */

    int          keyPitchClass;   /* 0 = C, 1 = C#, … 11 = B */
    int          keyMinor;        /* 0 = major, 1 = minor */
    double       keyConfidence;   /* how well the chroma matched the winning profile, 0..1 */
    double       keyMargin;       /* how far ahead of the runner-up it was; small = ambiguous */
    char         camelot[8];      /* "8A", "12B", … */
    char         keyName[16];     /* "A minor", "C major" */

    /* 3-band waveform at RFX_WAVE_BINS_PER_SEC, 0..255 each. Freed by rfx_analysis_free(). */
    unsigned char* low;
    unsigned char* mid;
    unsigned char* high;
    int            bins;

    char         error[256];
} rfx_analysis;

/** 0 on success; on failure `error` says why and nothing needs freeing. */
int  rfx_analyze_file(const char* path, rfx_analysis* out);
void rfx_analysis_free(rfx_analysis* a);

/* Exposed for tests: analyse mono float samples that are already in memory. */
int  rfx_analyze_samples(const float* mono, unsigned int frames, unsigned int rate, rfx_analysis* out);

/** Camelot code for a pitch class and mode, e.g. (9, minor) -> "8A". */
void rfx_camelot(int pitchClass, int minor, char* out, int cap);

/* --- flat accessors -----------------------------------------------------
 * The Rust and Node sides never mirror the struct, the same rule the device shim follows.
 * One analysis is held at a time; rfx_analysis_run() replaces whatever was there. */

int         rfx_analysis_run(const char* path);   /* 0 = ok; on failure see rfx_analysis_error() */
const char* rfx_analysis_error(void);
/* Keys: 0 duration s, 1 bpm, 2 bpm confidence, 3 first beat s, 4 key fit, 5 key margin */
double      rfx_analysis_double(int key);
/* Keys: 0 ok, 1 source rate, 2 source channels, 3 key pitch class, 4 key minor, 5 waveform bins */
int         rfx_analysis_int(int key);
/* Keys: 0 camelot, 1 key name */
const char* rfx_analysis_text(int key);
/** Copies the waveform out as low, mid, high per bin (3 bytes each). Returns bins written. */
int         rfx_analysis_wave(unsigned char* dst, int capBytes);
void        rfx_analysis_release(void);

#ifdef __cplusplus
}
#endif
#endif /* RFX_ANALYZE_H */
