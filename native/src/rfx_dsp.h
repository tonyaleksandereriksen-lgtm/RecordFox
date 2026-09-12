/*
 * RekordFox DSP building blocks: the isolator EQ, the Sound Color FX filter, the fader laws and
 * the interpolator the decks read through. Pure maths, no allocation, no platform calls — every
 * function here is unit-tested in tests/dsp_test.c.
 */
#ifndef RFX_DSP_H
#define RFX_DSP_H

/* --- one biquad section (Robert Bristow-Johnson's cookbook forms) -------- */
typedef struct {
    double b0, b1, b2, a1, a2;   /* normalised coefficients */
    double x1, x2, y1, y2;       /* state */
} rfx_biquad;

void   rfx_biquad_lowpass(rfx_biquad* f, double freq, double q, double rate);
void   rfx_biquad_highpass(rfx_biquad* f, double freq, double q, double rate);
void   rfx_biquad_reset(rfx_biquad* f);
double rfx_biquad_process(rfx_biquad* f, double x);

/* --- 3-band isolator EQ -------------------------------------------------- */
/*
 * Linkwitz-Riley 4th-order crossovers (two identical Butterworth sections each), split twice:
 * 2.5 kHz gives low+mid vs high, then 300 Hz splits low from mid. An LR pair sums to an allpass
 * rather than to unity, so the high band is run through the same 300 Hz pair and summed — that
 * matches its phase to the other two, and the three bands add back to flat when all knobs are
 * centred (tests/dsp_test.c measures this rather than assuming it).
 * Knobs are 0..1: 0 kills the band, 0.5 is unity, 1.0 is +6 dB — the FLX2's EQ range.
 */
#define RFX_EQ_LOW_HZ   300.0
#define RFX_EQ_HIGH_HZ  2500.0

/* One 4th-order Linkwitz-Riley section pair. */
typedef struct {
    rfx_biquad a, b;
} rfx_lr4;

typedef struct {
    rfx_lr4 lowOfHigh;    /* 2.5 kHz split: low+mid path */
    rfx_lr4 highOfHigh;   /* 2.5 kHz split: high path */
    rfx_lr4 lowOfLow;     /* 300 Hz split of low+mid: low band */
    rfx_lr4 highOfLow;    /* 300 Hz split of low+mid: mid band */
    rfx_lr4 compLow;      /* 300 Hz pair applied to the high band, summed = allpass */
    rfx_lr4 compHigh;
} rfx_eq3_channel;

typedef struct {
    rfx_eq3_channel ch[2];   /* left, right */
    double rate;
} rfx_eq3;

void   rfx_eq3_init(rfx_eq3* eq, double rate);
double rfx_eq3_process(rfx_eq3* eq, int channel, double x, double gLow, double gMid, double gHigh);
/* Knob position (0..1) to a band gain (0 = kill, 0.5 = unity, 1 = +6 dB). */
double rfx_eq_gain(double knob);

/* --- Sound Color FX: one knob, low-pass to the left, high-pass to the right */
/* State-variable filter (Andy Simper's topology): stable while the cutoff is swept. */
typedef struct {
    double ic1eq[2], ic2eq[2];   /* per channel state */
    double g, k, a1, a2, a3;
    int    mode;                 /* 0 = bypass, 1 = low-pass, 2 = high-pass */
    double rate;
} rfx_cfx;

void   rfx_cfx_init(rfx_cfx* f, double rate);
/* knob 0..1: 0.5 (±0.04 dead zone) = off, below = LPF sweeping down, above = HPF sweeping up. */
void   rfx_cfx_set(rfx_cfx* f, double knob);
double rfx_cfx_process(rfx_cfx* f, int channel, double x);

/* --- fader and crossfader laws ------------------------------------------ */
/* Channel fader: square law, so half way down is about -12 dB like a club mixer. */
double rfx_fader_gain(double pos);
/* Trim / master / phones knob: 0 = silence, 0.5 = unity, 1 = +6 dB. */
double rfx_knob_gain(double knob);
/* Constant-power crossfader; deck 0 is full at pos 0, deck 1 full at pos 1, -3 dB each at centre. */
double rfx_crossfader_gain(double pos, int deck);

/* --- interpolation ------------------------------------------------------ */
/* Catmull-Rom over four 16-bit samples, returning -1..1 floats. `frac` is 0..1 between s1 and s2. */
double rfx_interp_cubic(double s0, double s1, double s2, double s3, double frac);

#endif /* RFX_DSP_H */
