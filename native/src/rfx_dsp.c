#include "rfx_dsp.h"

#include <math.h>
#include <string.h>

#ifndef RFX_PI
#define RFX_PI 3.14159265358979323846
#endif

/* --- biquads ------------------------------------------------------------ */

void rfx_biquad_reset(rfx_biquad* f)
{
    f->x1 = f->x2 = f->y1 = f->y2 = 0.0;
}

static void biquad_set(rfx_biquad* f, double b0, double b1, double b2, double a0, double a1, double a2)
{
    f->b0 = b0 / a0;
    f->b1 = b1 / a0;
    f->b2 = b2 / a0;
    f->a1 = a1 / a0;
    f->a2 = a2 / a0;
}

void rfx_biquad_lowpass(rfx_biquad* f, double freq, double q, double rate)
{
    double w0, cs, sn, alpha;
    if (rate <= 0.0) rate = 48000.0;
    if (freq > rate * 0.45) freq = rate * 0.45;
    if (freq < 1.0) freq = 1.0;
    w0 = 2.0 * RFX_PI * freq / rate;
    cs = cos(w0);
    sn = sin(w0);
    alpha = sn / (2.0 * q);
    biquad_set(f, (1.0 - cs) / 2.0, 1.0 - cs, (1.0 - cs) / 2.0, 1.0 + alpha, -2.0 * cs, 1.0 - alpha);
    rfx_biquad_reset(f);
}

void rfx_biquad_highpass(rfx_biquad* f, double freq, double q, double rate)
{
    double w0, cs, sn, alpha;
    if (rate <= 0.0) rate = 48000.0;
    if (freq > rate * 0.45) freq = rate * 0.45;
    if (freq < 1.0) freq = 1.0;
    w0 = 2.0 * RFX_PI * freq / rate;
    cs = cos(w0);
    sn = sin(w0);
    alpha = sn / (2.0 * q);
    biquad_set(f, (1.0 + cs) / 2.0, -(1.0 + cs), (1.0 + cs) / 2.0, 1.0 + alpha, -2.0 * cs, 1.0 - alpha);
    rfx_biquad_reset(f);
}

double rfx_biquad_process(rfx_biquad* f, double x)
{
    double y = f->b0 * x + f->b1 * f->x1 + f->b2 * f->x2 - f->a1 * f->y1 - f->a2 * f->y2;
    f->x2 = f->x1;
    f->x1 = x;
    f->y2 = f->y1;
    f->y1 = y;
    return y;
}

/* --- 3-band isolator ---------------------------------------------------- */

/* Linkwitz-Riley 4th order = two identical Butterworth (Q = 1/sqrt2) sections. */
#define RFX_LR_Q 0.70710678118654752

static void lr4_lowpass(rfx_lr4* f, double freq, double rate)
{
    rfx_biquad_lowpass(&f->a, freq, RFX_LR_Q, rate);
    rfx_biquad_lowpass(&f->b, freq, RFX_LR_Q, rate);
}

static void lr4_highpass(rfx_lr4* f, double freq, double rate)
{
    rfx_biquad_highpass(&f->a, freq, RFX_LR_Q, rate);
    rfx_biquad_highpass(&f->b, freq, RFX_LR_Q, rate);
}

static double lr4_process(rfx_lr4* f, double x)
{
    return rfx_biquad_process(&f->b, rfx_biquad_process(&f->a, x));
}

void rfx_eq3_init(rfx_eq3* eq, double rate)
{
    int c;
    memset(eq, 0, sizeof(*eq));
    eq->rate = rate > 0.0 ? rate : 48000.0;
    for (c = 0; c < 2; c += 1) {
        rfx_eq3_channel* ch = &eq->ch[c];
        lr4_lowpass(&ch->lowOfHigh,   RFX_EQ_HIGH_HZ, eq->rate);
        lr4_highpass(&ch->highOfHigh, RFX_EQ_HIGH_HZ, eq->rate);
        lr4_lowpass(&ch->lowOfLow,    RFX_EQ_LOW_HZ,  eq->rate);
        lr4_highpass(&ch->highOfLow,  RFX_EQ_LOW_HZ,  eq->rate);
        lr4_lowpass(&ch->compLow,     RFX_EQ_LOW_HZ,  eq->rate);
        lr4_highpass(&ch->compHigh,   RFX_EQ_LOW_HZ,  eq->rate);
    }
}

double rfx_eq3_process(rfx_eq3* eq, int channel, double x, double gLow, double gMid, double gHigh)
{
    rfx_eq3_channel* c = &eq->ch[channel & 1];

    /* First crossover: everything below 2.5 kHz, and everything above. */
    double lowmid = lr4_process(&c->lowOfHigh, x);
    double high   = lr4_process(&c->highOfHigh, x);

    /* Second crossover splits low from mid. */
    double low = lr4_process(&c->lowOfLow, lowmid);
    double mid = lr4_process(&c->highOfLow, lowmid);

    /* Same pair on the high band: its two halves sum to an allpass, matching the phase above. */
    double highComp = lr4_process(&c->compLow, high) + lr4_process(&c->compHigh, high);

    return low * gLow + mid * gMid + highComp * gHigh;
}

double rfx_eq_gain(double knob)
{
    if (knob <= 0.0) return 0.0;
    if (knob >= 1.0) return 2.0;
    return (knob <= 0.5) ? knob * 2.0 : 1.0 + (knob - 0.5) * 2.0;
}

/* --- Sound Color FX ----------------------------------------------------- */

void rfx_cfx_init(rfx_cfx* f, double rate)
{
    memset(f, 0, sizeof(*f));
    f->rate = rate > 0.0 ? rate : 48000.0;
    rfx_cfx_set(f, 0.5);
}

void rfx_cfx_set(rfx_cfx* f, double knob)
{
    double cutoff;
    double q = 0.72;   /* a touch of resonance, like a DJ filter */

    if (knob < 0.0) knob = 0.0;
    if (knob > 1.0) knob = 1.0;

    if (knob > 0.46 && knob < 0.54) {
        f->mode = 0;
        return;
    }

    if (knob <= 0.46) {
        /* Low-pass: fully open at the dead zone, down to 130 Hz at the end of the travel. */
        double t = knob / 0.46;                       /* 0 = hard left, 1 = centre */
        cutoff = 130.0 * pow(20000.0 / 130.0, t);
        f->mode = 1;
    } else {
        /* High-pass: silent-ish bass removal from 20 Hz up to 4 kHz. */
        double t = (knob - 0.54) / 0.46;              /* 0 = centre, 1 = hard right */
        cutoff = 20.0 * pow(4000.0 / 20.0, t);
        f->mode = 2;
    }

    if (cutoff > f->rate * 0.45) cutoff = f->rate * 0.45;
    f->g  = tan(RFX_PI * cutoff / f->rate);
    f->k  = 1.0 / q;
    f->a1 = 1.0 / (1.0 + f->g * (f->g + f->k));
    f->a2 = f->g * f->a1;
    f->a3 = f->g * f->a2;
}

double rfx_cfx_process(rfx_cfx* f, int channel, double x)
{
    int    c = channel & 1;
    double v0, v1, v2, v3;

    if (f->mode == 0) return x;

    v3 = x - f->ic2eq[c];
    v1 = f->a1 * f->ic1eq[c] + f->a2 * v3;
    v2 = f->ic2eq[c] + f->a2 * f->ic1eq[c] + f->a3 * v3;
    f->ic1eq[c] = 2.0 * v1 - f->ic1eq[c];
    f->ic2eq[c] = 2.0 * v2 - f->ic2eq[c];
    v0 = x;

    if (f->mode == 1) return v2;                          /* low-pass */
    return v0 - f->k * v1 - v2;                           /* high-pass */
}

/* --- laws --------------------------------------------------------------- */

double rfx_fader_gain(double pos)
{
    if (pos <= 0.0) return 0.0;
    if (pos >= 1.0) return 1.0;
    return pos * pos;
}

double rfx_knob_gain(double knob)
{
    if (knob <= 0.0) return 0.0;
    if (knob >= 1.0) return 2.0;
    return knob * 2.0;
}

double rfx_crossfader_gain(double pos, int deck)
{
    if (pos < 0.0) pos = 0.0;
    if (pos > 1.0) pos = 1.0;
    return (deck == 0) ? cos(pos * RFX_PI * 0.5) : sin(pos * RFX_PI * 0.5);
}

/* --- interpolation ------------------------------------------------------ */

double rfx_interp_cubic(double s0, double s1, double s2, double s3, double frac)
{
    double a = 0.5 * (-s0 + 3.0 * s1 - 3.0 * s2 + s3);
    double b = 0.5 * (2.0 * s0 - 5.0 * s1 + 4.0 * s2 - s3);
    double c = 0.5 * (-s0 + s2);
    return ((a * frac + b) * frac + c) * frac + s1;
}
