/*
 * Analysis checks against signals whose BPM, downbeat and key we know by construction: a kick
 * pattern at a chosen tempo and offset, and chord progressions in a chosen key.
 */
#include "rfx_analyze.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef T_PI
#define T_PI 3.14159265358979323846
#endif

#define RATE 22050u

static int failures = 0;
static void check(int ok, const char* what)
{
    printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) failures += 1;
}

static void add_tone(float* buf, unsigned int frames, double startSec, double lenSec, double freq, double amp, double decay)
{
    unsigned int i;
    unsigned int s = (unsigned int)(startSec * RATE);
    unsigned int n = (unsigned int)(lenSec * RATE);
    for (i = 0; i < n && s + i < frames; i += 1) {
        double t = (double)i / RATE;
        double env = decay > 0.0 ? exp(-t / decay) : 1.0;
        buf[s + i] += (float)(amp * env * sin(2.0 * T_PI * freq * t));
    }
}

/** A four-on-the-floor pattern: loud kick on beat one, quieter kicks after, hats on the off-beats. */
static float* make_beat(double bpm, double offsetSec, double seconds, unsigned int* framesOut)
{
    unsigned int frames = (unsigned int)(seconds * RATE);
    float* buf = (float*)calloc(frames, sizeof(float));
    double beat = 60.0 / bpm;
    int k;
    if (buf == NULL) return NULL;
    for (k = 0; k < (int)(seconds / beat); k += 1) {
        double t = offsetSec + (double)k * beat;
        int downbeat = (k % 4) == 0;
        if (t + 0.2 > seconds) break;
        add_tone(buf, frames, t, 0.12, 55.0, downbeat ? 0.95 : 0.55, 0.05);   /* kick */
        add_tone(buf, frames, t + beat * 0.5, 0.04, 6500.0, 0.18, 0.012);      /* hat */
    }
    *framesOut = frames;
    return buf;
}

/**
 * A chord progression, three sine partials per note, one chord per quarter of the fixture.
 * Each chord carries its own quality, so the progression is actually in the key it claims: a
 * run of parallel minor triads would not be.
 */
static float* make_chords(const int* roots, const int* minors, int chordCount, double seconds, unsigned int* framesOut)
{
    unsigned int frames = (unsigned int)(seconds * RATE);
    float* buf = (float*)calloc(frames, sizeof(float));
    double per = seconds / (double)chordCount;
    int c;
    if (buf == NULL) return NULL;
    for (c = 0; c < chordCount; c += 1) {
        int root = roots[c];
        int third = root + (minors[c] ? 3 : 4);
        int fifth = root + 7;
        double start = (double)c * per;
        int notes[3];
        int i;
        notes[0] = root;
        notes[1] = third;
        notes[2] = fifth;
        for (i = 0; i < 3; i += 1) {
            double hz = 220.0 * pow(2.0, (double)(notes[i] - 9) / 12.0);   /* MIDI-ish: 9 = A */
            add_tone(buf, frames, start, per, hz, 0.25, 0.0);
            add_tone(buf, frames, start, per, hz * 2.0, 0.12, 0.0);
            add_tone(buf, frames, start, per, hz * 3.0, 0.06, 0.0);
        }
    }
    *framesOut = frames;
    return buf;
}

static double bar_offset(double firstBeatSec, double bpm, double expected)
{
    /* Both values live inside one bar; compare them the short way round. */
    double bar = 60.0 / bpm * 4.0;
    double d = fmod(fabs(firstBeatSec - expected), bar);
    return d > bar / 2.0 ? bar - d : d;
}

int rfx_analyze_test_main(void)
{
    rfx_analysis a;
    unsigned int frames;
    float* buf;

    failures = 0;

    /* --- tempo and downbeat -------------------------------------------- */
    buf = make_beat(124.0, 0.37, 30.0, &frames);
    check(buf != NULL, "built a 124 BPM fixture");
    if (buf != NULL) {
        check(rfx_analyze_samples(buf, frames, RATE, &a) == 0, "analyses it");
        printf("     124 BPM @ 0.370 s -> %.2f BPM (confidence %.2f), downbeat %.3f s\n", a.bpm, a.bpmConfidence, a.firstBeatSec);
        check(fabs(a.bpm - 124.0) < 0.6, "finds the tempo within 0.6 BPM");
        check(bar_offset(a.firstBeatSec, a.bpm, 0.37) < 0.03, "finds the downbeat within 30 ms");
        check(a.bpmConfidence > 0.2, "reports a usable confidence");
        printf("     waveform: %d bins over %.2f s\n", a.bins, a.durationSec);
        check(a.bins > 2900 && a.bins < 3010, "fills 100 waveform bins a second");
        {
            int b, loud = 0;
            for (b = 0; b < a.bins; b += 1) if (a.low[b] > 150) loud += 1;
            printf("     %d bins with a strong low band (the kicks)\n", loud);
            check(loud > 20 && loud < a.bins / 2, "the low band tracks the kick pattern");
        }
        rfx_analysis_free(&a);
        free(buf);
    }

    /* a slower, off-grid tempo */
    buf = make_beat(92.5, 1.234, 30.0, &frames);
    if (buf != NULL) {
        check(rfx_analyze_samples(buf, frames, RATE, &a) == 0, "analyses a 92.5 BPM fixture");
        printf("     92.5 BPM @ 1.234 s -> %.2f BPM, downbeat %.3f s\n", a.bpm, a.firstBeatSec);
        check(fabs(a.bpm - 92.5) < 0.6, "finds 92.5 BPM");
        check(bar_offset(a.firstBeatSec, a.bpm, 1.234) < 0.03, "finds its downbeat");
        rfx_analysis_free(&a);
        free(buf);
    }

    /* a fast one, to be sure the octave folding does not run away */
    buf = make_beat(174.0, 0.05, 24.0, &frames);
    if (buf != NULL) {
        check(rfx_analyze_samples(buf, frames, RATE, &a) == 0, "analyses a 174 BPM fixture");
        printf("     174 BPM -> %.2f BPM\n", a.bpm);
        check(fabs(a.bpm - 174.0) < 0.8 || fabs(a.bpm - 87.0) < 0.5, "reports 174 or its half, not something unrelated");
        rfx_analysis_free(&a);
        free(buf);
    }

    /* --- key ------------------------------------------------------------ */
    {
        /* A minor: Am - Dm - E - Am (i - iv - V - i). The major dominant is what separates a minor
         * key from its relative major: E carries G#, which C major never does. */
        const int amRoots[4] = { 9, 2, 4, 9 };
        const int amMinors[4] = { 1, 1, 0, 1 };
        buf = make_chords(amRoots, amMinors, 4, 24.0, &frames);
        if (buf != NULL) {
            check(rfx_analyze_samples(buf, frames, RATE, &a) == 0, "analyses an A minor progression");
            printf("     A minor progression -> %s (%s), fit %.2f, margin %.3f\n", a.keyName, a.camelot, a.keyConfidence, a.keyMargin);
            check(a.keyPitchClass == 9, "hears A as the root");
            check(a.keyMinor == 1, "hears it as minor");
            check(strcmp(a.camelot, "8A") == 0, "A minor is 8A");
            rfx_analysis_free(&a);
            free(buf);
        }
    }
    {
        /* C major: C - F - G - C (I - IV - V - I) */
        const int cRoots[4] = { 0, 5, 7, 0 };
        const int cMinors[4] = { 0, 0, 0, 0 };
        buf = make_chords(cRoots, cMinors, 4, 24.0, &frames);
        if (buf != NULL) {
            check(rfx_analyze_samples(buf, frames, RATE, &a) == 0, "analyses a C major progression");
            printf("     C major progression -> %s (%s), fit %.2f, margin %.3f\n", a.keyName, a.camelot, a.keyConfidence, a.keyMargin);
            check(a.keyPitchClass == 0, "hears C as the root");
            check(a.keyMinor == 0, "hears it as major");
            check(strcmp(a.camelot, "8B") == 0, "C major is 8B");
            rfx_analysis_free(&a);
            free(buf);
        }
    }

    /* --- Camelot table -------------------------------------------------- */
    {
        char c[8];
        rfx_camelot(9, 1, c, sizeof(c));
        check(strcmp(c, "8A") == 0, "A minor is 8A");
        rfx_camelot(0, 0, c, sizeof(c));
        check(strcmp(c, "8B") == 0, "C major is 8B");
        rfx_camelot(11, 0, c, sizeof(c));
        check(strcmp(c, "1B") == 0, "B major is 1B");
        rfx_camelot(8, 1, c, sizeof(c));
        check(strcmp(c, "1A") == 0, "G# minor is 1A");
        rfx_camelot(4, 0, c, sizeof(c));
        check(strcmp(c, "12B") == 0, "E major is 12B");
        rfx_camelot(2, 1, c, sizeof(c));
        check(strcmp(c, "7A") == 0, "D minor is 7A");
    }

    /* --- refusals ------------------------------------------------------- */
    {
        float tiny[100] = { 0 };
        check(rfx_analyze_samples(tiny, 100, RATE, &a) != 0, "refuses a fragment too short to analyse");
        printf("     %s\n", a.error);
        check(rfx_analyze_file("/no/such/file.wav", &a) != 0, "refuses a missing file");
        printf("     %s\n", a.error);
    }

    printf("\n%s\n", failures == 0 ? "all analysis checks passed" : "ANALYSIS CHECKS FAILED");
    return failures;
}
