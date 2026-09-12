#include "rfx_fft.h"

#include <math.h>

#ifndef RFX_TAU
#define RFX_TAU 6.283185307179586476925286766559
#endif

void rfx_hann(float* w, unsigned int n)
{
    unsigned int i;
    if (n == 0) return;
    for (i = 0; i < n; i += 1) w[i] = (float)(0.5 - 0.5 * cos(RFX_TAU * (double)i / (double)n));
}

void rfx_fft(float* re, float* im, unsigned int n)
{
    unsigned int i, j, len;

    if (n < 2) return;

    /* bit-reversal permutation */
    for (i = 1, j = 0; i < n; i += 1) {
        unsigned int bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            float tr = re[i], ti = im[i];
            re[i] = re[j];
            im[i] = im[j];
            re[j] = tr;
            im[j] = ti;
        }
    }

    for (len = 2; len <= n; len <<= 1) {
        double ang = -RFX_TAU / (double)len;
        float wr = (float)cos(ang);
        float wi = (float)sin(ang);
        for (i = 0; i < n; i += len) {
            float cr = 1.0f, ci = 0.0f;
            for (j = 0; j < len / 2; j += 1) {
                float ur = re[i + j], ui = im[i + j];
                float vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
                float vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
                float nr;
                re[i + j] = ur + vr;
                im[i + j] = ui + vi;
                re[i + j + len / 2] = ur - vr;
                im[i + j + len / 2] = ui - vi;
                nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
    }
}
