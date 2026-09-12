/* Radix-2 in-place complex FFT — the only transform the analyser needs. No dependencies. */
#ifndef RFX_FFT_H
#define RFX_FFT_H

/* n must be a power of two. re/im hold n values and are overwritten with the transform. */
void rfx_fft(float* re, float* im, unsigned int n);
/* Hann window of length n, filled once and reused. */
void rfx_hann(float* w, unsigned int n);

#endif
