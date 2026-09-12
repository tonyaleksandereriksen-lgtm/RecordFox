/* Measures the DSP blocks with sine sweeps instead of trusting the formulas. */
#include "rfx_dsp.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

/* MSVC only defines M_PI behind _USE_MATH_DEFINES; use the same constant rfx_dsp.c does. */
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static int failures = 0;
static void check(int ok, const char* what)
{
    printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) failures += 1;
}

#define RATE 48000.0
#define NFRAMES 24000   /* 0.5 s */

/* RMS of a sine passed through a callback, relative to the input, in dB. */
static double response_db(double freq, double (*proc)(double x, void* user), void* user)
{
    double sumIn = 0.0, sumOut = 0.0;
    int i;
    /* skip the first 2000 frames so the filter state settles */
    for (i = 0; i < NFRAMES; i += 1) {
        double x = sin(2.0 * M_PI * freq * (double)i / RATE);
        double y = proc(x, user);
        if (i > 2000) {
            sumIn += x * x;
            sumOut += y * y;
        }
    }
    if (sumIn <= 0.0) return -999.0;
    if (sumOut <= 1e-20) return -999.0;
    return 20.0 * log10(sqrt(sumOut / sumIn));
}

typedef struct { rfx_eq3 eq; double gl, gm, gh; } eq_user;
static double eq_proc(double x, void* user)
{
    eq_user* u = (eq_user*)user;
    return rfx_eq3_process(&u->eq, 0, x, u->gl, u->gm, u->gh);
}

typedef struct { rfx_biquad f; } bq_user;
static double lp_proc(double x, void* user) { return rfx_biquad_process(&((bq_user*)user)->f, x); }

typedef struct { rfx_cfx f; } cfx_user;
static double cfx_proc(double x, void* user) { return rfx_cfx_process(&((cfx_user*)user)->f, 0, x); }

static void eq_reset(eq_user* u, double gl, double gm, double gh)
{
    rfx_eq3_init(&u->eq, RATE);
    u->gl = gl; u->gm = gm; u->gh = gh;
}

int rfx_dsp_test_main(void)
{
    failures = 0;
    /* --- biquad low-pass ------------------------------------------------ */
    {
        bq_user u;
        double pass, stop;
        rfx_biquad_lowpass(&u.f, 300.0, 0.7071, RATE);
        pass = response_db(100.0, lp_proc, &u);
        rfx_biquad_lowpass(&u.f, 300.0, 0.7071, RATE);
        stop = response_db(5000.0, lp_proc, &u);
        printf("     300 Hz LPF: 100 Hz %.1f dB, 5 kHz %.1f dB\n", pass, stop);
        check(pass > -1.0 && pass < 1.0, "LPF passes below the corner");
        check(stop < -40.0, "LPF stops well above the corner");
    }

    /* --- isolator EQ ---------------------------------------------------- */
    {
        eq_user u;
        double a, b, c;

        eq_reset(&u, 1.0, 1.0, 1.0);
        a = response_db(100.0, eq_proc, &u);
        eq_reset(&u, 1.0, 1.0, 1.0);
        b = response_db(1000.0, eq_proc, &u);
        eq_reset(&u, 1.0, 1.0, 1.0);
        c = response_db(8000.0, eq_proc, &u);
        printf("     all bands unity: 100 Hz %.2f dB, 1 kHz %.2f dB, 8 kHz %.2f dB\n", a, b, c);
        check(fabs(a) < 0.05 && fabs(b) < 0.05 && fabs(c) < 0.05, "flat when every band is at unity");

        eq_reset(&u, 0.0, 1.0, 1.0);
        a = response_db(100.0, eq_proc, &u);
        eq_reset(&u, 0.0, 1.0, 1.0);
        c = response_db(8000.0, eq_proc, &u);
        printf("     low kill: 100 Hz %.1f dB, 8 kHz %.2f dB\n", a, c);
        check(a < -20.0, "low kill removes the bass");
        check(fabs(c) < 0.5, "low kill leaves the highs alone");

        eq_reset(&u, 1.0, 1.0, 0.0);
        a = response_db(100.0, eq_proc, &u);
        eq_reset(&u, 1.0, 1.0, 0.0);
        c = response_db(12000.0, eq_proc, &u);
        printf("     high kill: 100 Hz %.2f dB, 12 kHz %.1f dB\n", a, c);
        check(c < -20.0, "high kill removes the treble");
        check(fabs(a) < 0.5, "high kill leaves the bass alone");

        eq_reset(&u, 1.0, 0.0, 1.0);
        b = response_db(1000.0, eq_proc, &u);
        printf("     mid kill: 1 kHz %.1f dB\n", b);
        check(b < -12.0, "mid kill scoops the middle");

        eq_reset(&u, 2.0, 1.0, 1.0);
        a = response_db(100.0, eq_proc, &u);
        printf("     low boost: 100 Hz %.2f dB\n", a);
        check(a > 5.0 && a < 7.0, "full low knob is about +6 dB");
    }

    /* --- knob mapping --------------------------------------------------- */
    check(rfx_eq_gain(0.0) == 0.0, "EQ knob at 0 kills");
    check(fabs(rfx_eq_gain(0.5) - 1.0) < 1e-12, "EQ knob at centre is unity");
    check(fabs(rfx_eq_gain(1.0) - 2.0) < 1e-12, "EQ knob at max is +6 dB");
    check(fabs(rfx_eq_gain(0.25) - 0.5) < 1e-12, "EQ knob is linear below centre");

    /* --- Sound Color FX ------------------------------------------------- */
    {
        cfx_user u;
        double centre, lpHigh, hpLow, hpHigh;

        rfx_cfx_init(&u.f, RATE);
        rfx_cfx_set(&u.f, 0.5);
        centre = response_db(1000.0, cfx_proc, &u);
        check(fabs(centre) < 1e-9, "CFX centre is a true bypass");

        rfx_cfx_init(&u.f, RATE);
        rfx_cfx_set(&u.f, 0.0);
        lpHigh = response_db(5000.0, cfx_proc, &u);
        printf("     CFX hard left: 5 kHz %.1f dB\n", lpHigh);
        check(lpHigh < -25.0, "CFX left is a low-pass");

        rfx_cfx_init(&u.f, RATE);
        rfx_cfx_set(&u.f, 1.0);
        hpLow = response_db(60.0, cfx_proc, &u);
        rfx_cfx_init(&u.f, RATE);
        rfx_cfx_set(&u.f, 1.0);
        hpHigh = response_db(10000.0, cfx_proc, &u);
        printf("     CFX hard right: 60 Hz %.1f dB, 10 kHz %.2f dB\n", hpLow, hpHigh);
        check(hpLow < -25.0, "CFX right is a high-pass");
        check(hpHigh > -1.5, "CFX right keeps the top end");
    }

    /* --- faders --------------------------------------------------------- */
    check(rfx_fader_gain(0.0) == 0.0 && rfx_fader_gain(1.0) == 1.0, "channel fader spans silence to unity");
    check(fabs(20.0 * log10(rfx_fader_gain(0.5)) + 12.04) < 0.1, "channel fader is -12 dB at half");
    {
        double a = rfx_crossfader_gain(0.5, 0), b = rfx_crossfader_gain(0.5, 1);
        printf("     crossfader centre: A %.3f B %.3f, power %.3f\n", a, b, a * a + b * b);
        check(fabs(a * a + b * b - 1.0) < 1e-9, "crossfader holds constant power");
        check(fabs(20.0 * log10(a) + 3.01) < 0.05, "crossfader centre is -3 dB");
        check(rfx_crossfader_gain(0.0, 0) > 0.999 && rfx_crossfader_gain(0.0, 1) < 1e-9, "hard left is deck A only");
        check(rfx_crossfader_gain(1.0, 1) > 0.999 && rfx_crossfader_gain(1.0, 0) < 1e-9, "hard right is deck B only");
    }

    /* --- interpolation -------------------------------------------------- */
    {
        double err = 0.0;
        int i;
        check(fabs(rfx_interp_cubic(0.0, 0.25, 0.5, 0.75, 0.0) - 0.25) < 1e-12, "cubic passes through the sample");
        check(fabs(rfx_interp_cubic(0.0, 0.25, 0.5, 0.75, 1.0) - 0.5) < 1e-12, "cubic lands on the next sample");
        check(fabs(rfx_interp_cubic(0.0, 0.25, 0.5, 0.75, 0.5) - 0.375) < 1e-12, "cubic is exact on a ramp");
        /* resample a 1 kHz sine at 1.5x and compare with the true sine */
        for (i = 0; i < 2000; i += 1) {
            double t = i * 1.5;
            long   n = (long)t;
            double f = t - (double)n;
            double s[4];
            int k;
            for (k = 0; k < 4; k += 1) s[k] = sin(2.0 * M_PI * 1000.0 * (double)(n - 1 + k) / RATE);
            {
                double got  = rfx_interp_cubic(s[0], s[1], s[2], s[3], f);
                double want = sin(2.0 * M_PI * 1000.0 * t / RATE);
                double d = fabs(got - want);
                if (d > err) err = d;
            }
        }
        printf("     cubic resampling error at 1.5x: %.2e\n", err);
        check(err < 2e-4, "cubic tracks a 1 kHz sine when resampling");
    }

    printf("\n%s\n", failures == 0 ? "all DSP checks passed" : "DSP CHECKS FAILED");
    return failures;
}
