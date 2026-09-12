#include "rfx_analyze.h"
#include "rfx_fft.h"

#include "miniaudio.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Everything is analysed at this rate: enough for onsets and for chroma up to ~4 kHz. */
#define AN_RATE 22050u
#define AN_FFT  1024u
#define AN_HOP  256u
#define AN_BINS (AN_FFT / 2)

/* Chroma needs far finer frequency resolution than onsets do. At 1024 points a bin is 21.5 Hz,
 * while a semitone at C3 is 7.8 Hz — every note below ~400 Hz would land in the same bin as its
 * neighbours. A second, longer transform gives 2.7 Hz bins, about three per semitone down there. */
#define CH_FFT  8192u
#define CH_HOP  4096u
#define CH_BINS (CH_FFT / 2)

/* The grid is refined on a plain RMS envelope at 64 samples a block — 2.9 ms, fine enough to
 * place a downbeat, where the 256-sample STFT hop is not. */
#define FINE_HOP 64u

#define BPM_MIN 70.0
#define BPM_MAX 190.0

#ifndef AN_PI
#define AN_PI 3.14159265358979323846
#endif

static const char* NOTE_NAMES[12] = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };

/* Krumhansl-Kessler key profiles, rotated to match a chroma vector. */
static const double MAJOR_PROFILE[12] = { 6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88 };
static const double MINOR_PROFILE[12] = { 6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17 };

static void fail(rfx_analysis* out, const char* what)
{
    memset(out, 0, sizeof(*out));
    snprintf(out->error, sizeof(out->error), "%s", what);
}

void rfx_analysis_free(rfx_analysis* a)
{
    if (a == NULL) return;
    free(a->low);
    free(a->mid);
    free(a->high);
    a->low = a->mid = a->high = NULL;
    a->bins = 0;
}

void rfx_camelot(int pitchClass, int minor, char* out, int cap)
{
    /* The wheel moves in fifths: C major is 8B, A minor is 8A. */
    int pc = ((pitchClass % 12) + 12) % 12;
    int num = ((pc * 7 + (minor ? 4 : 7)) % 12) + 1;
    snprintf(out, (size_t)cap, "%d%c", num, minor ? 'A' : 'B');
}

/* Correlation of a chroma vector with a profile rotated to `root`. */
static double profile_score(const double* chroma, const double* profile, int root)
{
    double sx = 0.0, sy = 0.0, sxy = 0.0, sxx = 0.0, syy = 0.0;
    int i;
    for (i = 0; i < 12; i += 1) {
        double x = chroma[i];
        double y = profile[(i - root + 12) % 12];
        sx += x;
        sy += y;
        sxy += x * y;
        sxx += x * x;
        syy += y * y;
    }
    {
        double n = 12.0;
        double num = n * sxy - sx * sy;
        double den = sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
        return den > 1e-12 ? num / den : 0.0;
    }
}

/**
 * Chroma from spectral peaks, not from every bin.
 *
 * Summing whole bins would let the noise floor and the sheer number of high bins outvote the notes;
 * a peak is a note (or one of its partials) and nothing else. Each peak's true frequency comes from
 * a parabolic fit through its neighbours, so a tone between two bins still lands on the right
 * pitch class. Frames are normalised before they are added up, which weights the key by how long
 * each chord sounds rather than by how loud it happens to be.
 */
static int chroma_pass(const float* mono, unsigned int frames, unsigned int rate, double* chroma)
{
    unsigned int nCh, f, k;
    unsigned int kMin = (unsigned int)floor(55.0 * (double)CH_FFT / (double)rate);
    unsigned int kMax = (unsigned int)ceil(2500.0 * (double)CH_FFT / (double)rate);
    float *win = NULL, *re = NULL, *im = NULL, *mag = NULL;
    int rc = 1;

    if (kMin < 1) kMin = 1;
    if (kMax > CH_BINS - 2) kMax = CH_BINS - 2;
    if (kMin + 2 >= kMax) return 1;

    nCh = (frames > CH_FFT) ? (frames - CH_FFT) / CH_HOP + 1 : 1;
    win = (float*)malloc(CH_FFT * sizeof(float));
    re = (float*)malloc(CH_FFT * sizeof(float));
    im = (float*)malloc(CH_FFT * sizeof(float));
    mag = (float*)malloc(CH_BINS * sizeof(float));
    if (!win || !re || !im || !mag) goto done;
    rfx_hann(win, CH_FFT);

    for (f = 0; f < nCh; f += 1) {
        unsigned int start = f * CH_HOP;
        double frameChroma[12] = { 0 };
        double frameSum = 0.0, peak = 0.0, floorMag;

        for (k = 0; k < CH_FFT; k += 1) {
            unsigned int idx = start + k;
            re[k] = (idx < frames) ? mono[idx] * win[k] : 0.0f;
            im[k] = 0.0f;
        }
        rfx_fft(re, im, CH_FFT);
        for (k = kMin - 1; k <= kMax + 1 && k < CH_BINS; k += 1) {
            mag[k] = sqrtf(re[k] * re[k] + im[k] * im[k]);
            if (mag[k] > peak) peak = mag[k];
        }
        if (peak <= 0.0) continue;
        floorMag = peak * 0.02;           /* anything quieter than this is spill, not a note */

        for (k = kMin; k <= kMax; k += 1) {
            double a, b, c, den, shift, hz, midi;
            int pc;
            if (!(mag[k] > mag[k - 1] && mag[k] >= mag[k + 1])) continue;
            if (mag[k] < floorMag) continue;
            a = log((double)mag[k - 1] + 1e-12);
            b = log((double)mag[k] + 1e-12);
            c = log((double)mag[k + 1] + 1e-12);
            den = a - 2.0 * b + c;
            shift = (fabs(den) > 1e-12) ? 0.5 * (a - c) / den : 0.0;
            if (shift < -0.5) shift = -0.5;
            if (shift > 0.5) shift = 0.5;
            hz = ((double)k + shift) * (double)rate / (double)CH_FFT;
            if (hz < 55.0 || hz > 2500.0) continue;
            midi = 69.0 + 12.0 * log2(hz / 440.0);
            pc = (int)floor(fmod(midi + 0.5, 12.0));
            pc = ((pc % 12) + 12) % 12;
            frameChroma[pc] += (double)mag[k];
            frameSum += (double)mag[k];
        }
        if (frameSum > 0.0) {
            int i;
            for (i = 0; i < 12; i += 1) chroma[i] += frameChroma[i] / frameSum;
        }
    }
    rc = 0;

done:
    free(win);
    free(re);
    free(im);
    free(mag);
    return rc;
}

/** Block RMS of the signal and of its low band, one value every FINE_HOP samples. */
static int fine_pass(const float* mono, unsigned int frames, unsigned int rate,
                     double** fullOut, double** lowOut, unsigned int* nOut)
{
    unsigned int nFine = frames / FINE_HOP;
    double *full = NULL, *low = NULL;
    double g, lp1 = 0.0, lp2 = 0.0;
    unsigned int j, i;

    *fullOut = *lowOut = NULL;
    *nOut = 0;
    if (nFine < 8) return 1;

    full = (double*)calloc(nFine, sizeof(double));
    low = (double*)calloc(nFine, sizeof(double));
    if (!full || !low) {
        free(full);
        free(low);
        return 1;
    }

    /* Two one-pole sections at 200 Hz: all the kick, none of the hats. */
    g = 1.0 - exp(-2.0 * AN_PI * 200.0 / (double)rate);
    for (j = 0; j < nFine; j += 1) {
        unsigned int s = j * FINE_HOP;
        double sumF = 0.0, sumL = 0.0;
        for (i = 0; i < FINE_HOP; i += 1) {
            double x = (double)mono[s + i];
            lp1 += g * (x - lp1);
            lp2 += g * (lp1 - lp2);
            sumF += x * x;
            sumL += lp2 * lp2;
        }
        full[j] = sqrt(sumF / (double)FINE_HOP);
        low[j] = sqrt(sumL / (double)FINE_HOP);
    }

    *fullOut = full;
    *lowOut = low;
    *nOut = nFine;
    return 0;
}

/**
 * Lock the grid to the audio.
 *
 * The comb autocorrelation gets the tempo to within about a BPM, which is already half a beat of
 * drift over a three-minute track, so tempo and phase are refined together: for each candidate
 * tempo, try every phase and keep whichever pair collects the most onset energy. Then the four
 * beats of the bar are scored by low-band energy — the kick decides where bar one is.
 */
static void refine_grid(const double* onsetF, const double* envLow, unsigned int nFine,
                        unsigned int rate, double* bpmInOut, double* firstBeatOut)
{
    double fineFps = (double)rate / (double)FINE_HOP;
    double bpm0 = *bpmInOut;
    double bestScore = -1e30, bestBpm = bpm0, bestPhase = 0.0;
    double* smooth = NULL;
    int step;

    *firstBeatOut = 0.0;
    if (nFine < 32) return;

    /* A symmetric three-tap smear, so a beat a block early or late still counts without pulling
     * the estimate in either direction. */
    smooth = (double*)calloc(nFine, sizeof(double));
    if (smooth == NULL) return;
    for (step = 0; (unsigned int)step < nFine; step += 1) {
        unsigned int j = (unsigned int)step;
        double v = onsetF[j];
        if (j > 0) v += 0.5 * onsetF[j - 1];
        if (j + 1 < nFine) v += 0.5 * onsetF[j + 1];
        smooth[j] = v;
    }

    for (step = -50; step <= 50; step += 1) {
        double bpmC = bpm0 + (double)step * 0.02;
        double beatFine, t;
        unsigned int p, pMax;
        if (bpmC < 20.0) continue;
        beatFine = 60.0 * fineFps / bpmC;
        if (beatFine < 4.0 || beatFine * 4.0 > (double)nFine) continue;
        pMax = (unsigned int)floor(beatFine);
        for (p = 0; p < pMax; p += 1) {
            double acc = 0.0;
            unsigned int n = 0;
            for (t = (double)p; t < (double)nFine - 1.0; t += beatFine) {
                acc += smooth[(unsigned int)floor(t + 0.5)];
                n += 1;
            }
            if (n < 4) continue;
            acc /= (double)n;
            if (acc > bestScore) {
                bestScore = acc;
                bestBpm = bpmC;
                bestPhase = (double)p;
            }
        }
    }
    free(smooth);

    {
        double beatFine = 60.0 * fineFps / bestBpm;
        int bar, bestBar = 0;
        double bestBarScore = -1e30;
        for (bar = 0; bar < 4; bar += 1) {
            double acc = 0.0, t;
            unsigned int n = 0;
            for (t = bestPhase + (double)bar * beatFine; t < (double)nFine - 1.0; t += beatFine * 4.0) {
                unsigned int i0 = (unsigned int)floor(t + 0.5), i;
                /* the body of the kick, not just its first 3 ms */
                for (i = i0; i < i0 + 8 && i < nFine; i += 1) acc += envLow[i];
                n += 1;
            }
            if (n == 0) continue;
            acc /= (double)n;
            if (acc > bestBarScore) {
                bestBarScore = acc;
                bestBar = bar;
            }
        }
        {
            double firstFine = bestPhase + (double)bestBar * beatFine;
            double first = (firstFine * (double)FINE_HOP + (double)FINE_HOP * 0.5) / (double)rate;
            double barSec = 60.0 / bestBpm * 4.0;
            *firstBeatOut = fmod(fmod(first, barSec) + barSec, barSec);
            *bpmInOut = bestBpm;
        }
    }
}

/**
 * The core: one STFT pass over the mono signal produces the onset envelope (spectral flux) the
 * tempo comes from and the 3-band energies the waveform is drawn from. Chroma and the beat grid
 * each get their own pass, at the resolution they actually need.
 */
int rfx_analyze_samples(const float* mono, unsigned int frames, unsigned int rate, rfx_analysis* out)
{
    unsigned int nFrames, f, k;
    float *win = NULL, *re = NULL, *im = NULL, *prevMag = NULL;
    double *onset = NULL, *chroma = NULL;
    double *bandLow = NULL, *bandMid = NULL, *bandHigh = NULL;
    double fps;
    int rc = 1;

    if (out == NULL) return 1;
    memset(out, 0, sizeof(*out));
    if (mono == NULL || frames < rate || rate == 0) {
        fail(out, "not enough audio to analyse");
        return 1;
    }

    fps = (double)rate / (double)AN_HOP;
    nFrames = (frames > AN_FFT) ? (frames - AN_FFT) / AN_HOP + 1 : 1;

    win = (float*)malloc(AN_FFT * sizeof(float));
    re = (float*)malloc(AN_FFT * sizeof(float));
    im = (float*)malloc(AN_FFT * sizeof(float));
    prevMag = (float*)calloc(AN_BINS, sizeof(float));
    onset = (double*)calloc(nFrames, sizeof(double));
    chroma = (double*)calloc(12, sizeof(double));
    bandLow = (double*)calloc(nFrames, sizeof(double));
    bandMid = (double*)calloc(nFrames, sizeof(double));
    bandHigh = (double*)calloc(nFrames, sizeof(double));
    if (!win || !re || !im || !prevMag || !onset || !chroma || !bandLow || !bandMid || !bandHigh) {
        fail(out, "out of memory during analysis");
        goto done;
    }
    rfx_hann(win, AN_FFT);

    for (f = 0; f < nFrames; f += 1) {
        unsigned int start = f * AN_HOP;
        double flux = 0.0;

        for (k = 0; k < AN_FFT; k += 1) {
            unsigned int idx = start + k;
            re[k] = (idx < frames) ? mono[idx] * win[k] : 0.0f;
            im[k] = 0.0f;
        }
        rfx_fft(re, im, AN_FFT);

        for (k = 1; k < AN_BINS; k += 1) {
            double hz = (double)k * (double)rate / (double)AN_FFT;
            float mag = sqrtf(re[k] * re[k] + im[k] * im[k]);
            double d = (double)mag - (double)prevMag[k];
            if (d > 0.0) flux += d;                      /* only rising energy is an onset */
            prevMag[k] = mag;

            if (hz < 200.0) bandLow[f] += mag;
            else if (hz < 2000.0) bandMid[f] += mag;
            else bandHigh[f] += mag;
        }
        onset[f] = flux;
    }

    /* --- tempo: comb-filtered autocorrelation of the onset envelope ------ */
    {
        double mean = 0.0, sd = 0.0;
        unsigned int lagMin = (unsigned int)floor(60.0 / BPM_MAX * fps);
        unsigned int lagMax = (unsigned int)ceil(60.0 / BPM_MIN * fps);
        double best = -1e30, bestLag = 0.0, scoreSum = 0.0;
        unsigned int lag, count = 0;
        double* norm = (double*)calloc(nFrames, sizeof(double));
        if (norm == NULL) {
            fail(out, "out of memory during analysis");
            goto done;
        }
        for (f = 0; f < nFrames; f += 1) mean += onset[f];
        mean /= (double)nFrames;
        for (f = 0; f < nFrames; f += 1) sd += (onset[f] - mean) * (onset[f] - mean);
        sd = sqrt(sd / (double)nFrames);
        if (sd < 1e-12) sd = 1.0;
        for (f = 0; f < nFrames; f += 1) norm[f] = (onset[f] - mean) / sd;

        if (lagMax >= nFrames) lagMax = nFrames > 2 ? nFrames - 2 : 2;
        for (lag = lagMin; lag <= lagMax; lag += 1) {
            /* Sum the autocorrelation at this lag and its first harmonics: a true beat period also
             * lines up at 2 and 4 beats, which keeps subdivisions from winning. */
            static const double weight[4] = { 1.0, 0.6, 0.35, 0.2 };
            double score = 0.0;
            int m;
            for (m = 1; m <= 4; m += 1) {
                unsigned int l = lag * (unsigned int)m;
                double acc = 0.0;
                unsigned int n = (l < nFrames) ? nFrames - l : 0;
                unsigned int i;
                if (n == 0) break;
                for (i = 0; i < n; i += 1) acc += norm[i] * norm[i + l];
                score += weight[m - 1] * (acc / (double)n);
            }
            scoreSum += score;
            count += 1;
            if (score > best) {
                best = score;
                bestLag = (double)lag;
            }
        }

        /* Parabolic refinement around the winning lag, for sub-BPM precision. */
        if (bestLag > (double)lagMin && bestLag < (double)lagMax) {
            unsigned int l = (unsigned int)bestLag;
            double y[3];
            int j;
            for (j = -1; j <= 1; j += 1) {
                unsigned int ll = l + (unsigned int)j;
                double acc = 0.0;
                unsigned int n = (ll < nFrames) ? nFrames - ll : 0;
                unsigned int i;
                for (i = 0; i < n; i += 1) acc += norm[i] * norm[i + ll];
                y[j + 1] = n ? acc / (double)n : 0.0;
            }
            {
                double den = y[0] - 2.0 * y[1] + y[2];
                if (fabs(den) > 1e-12) {
                    double shift = 0.5 * (y[0] - y[2]) / den;
                    if (shift > -1.0 && shift < 1.0) bestLag += shift;
                }
            }
        }

        if (bestLag <= 0.0) {
            free(norm);
            fail(out, "no tempo found");
            goto done;
        }

        out->bpm = 60.0 * fps / bestLag;
        while (out->bpm < BPM_MIN) out->bpm *= 2.0;
        while (out->bpm > BPM_MAX) out->bpm /= 2.0;
        {
            double avg = count ? scoreSum / (double)count : 0.0;
            double conf = (avg != 0.0) ? (best - avg) / (fabs(avg) + 1e-9) : 0.0;
            out->bpmConfidence = conf < 0.0 ? 0.0 : (conf > 1.0 ? 1.0 : conf);
        }
        free(norm);
    }

    /* --- grid: tempo and downbeat refined on a 2.9 ms envelope ----------- */
    {
        double *fineFull = NULL, *fineLow = NULL, *fineOnset = NULL;
        unsigned int nFine = 0;
        if (fine_pass(mono, frames, rate, &fineFull, &fineLow, &nFine) == 0) {
            fineOnset = (double*)calloc(nFine, sizeof(double));
            if (fineOnset != NULL) {
                unsigned int j;
                for (j = 1; j < nFine; j += 1) {
                    double d = fineFull[j] - fineFull[j - 1];
                    fineOnset[j] = d > 0.0 ? d : 0.0;
                }
                refine_grid(fineOnset, fineLow, nFine, rate, &out->bpm, &out->firstBeatSec);
            }
        }
        free(fineFull);
        free(fineLow);
        free(fineOnset);
    }

    /* --- key ------------------------------------------------------------ */
    {
        double total = 0.0, bestScore = -1e30, runnerUp = -1e30;
        int i, bestRoot = 0, bestMinor = 0;
        chroma_pass(mono, frames, rate, chroma);
        for (i = 0; i < 12; i += 1) total += chroma[i];
        if (total > 0.0) for (i = 0; i < 12; i += 1) chroma[i] /= total;
        for (i = 0; i < 12; i += 1) {
            int mode;
            for (mode = 0; mode < 2; mode += 1) {
                double sc = profile_score(chroma, mode ? MINOR_PROFILE : MAJOR_PROFILE, i);
                if (sc > bestScore) {
                    runnerUp = bestScore;
                    bestScore = sc;
                    bestRoot = i;
                    bestMinor = mode;
                } else if (sc > runnerUp) {
                    runnerUp = sc;
                }
            }
        }
        out->keyPitchClass = bestRoot;
        out->keyMinor = bestMinor;
        out->keyConfidence = bestScore < 0.0 ? 0.0 : (bestScore > 1.0 ? 1.0 : bestScore);
        out->keyMargin = (bestScore > runnerUp) ? bestScore - runnerUp : 0.0;
        rfx_camelot(bestRoot, bestMinor, out->camelot, (int)sizeof(out->camelot));
        snprintf(out->keyName, sizeof(out->keyName), "%s %s", NOTE_NAMES[bestRoot], bestMinor ? "minor" : "major");
    }

    /* --- waveform bins -------------------------------------------------- */
    {
        double seconds = (double)frames / (double)rate;
        int bins = (int)ceil(seconds * RFX_WAVE_BINS_PER_SEC);
        double peakLow = 0.0, peakMid = 0.0, peakHigh = 0.0;
        double *binLow = NULL, *binMid = NULL, *binHigh = NULL;
        int b;
        if (bins < 1) bins = 1;
        binLow = (double*)calloc((size_t)bins, sizeof(double));
        binMid = (double*)calloc((size_t)bins, sizeof(double));
        binHigh = (double*)calloc((size_t)bins, sizeof(double));
        if (!binLow || !binMid || !binHigh) {
            free(binLow);
            free(binMid);
            free(binHigh);
            fail(out, "out of memory during analysis");
            goto done;
        }
        out->low = (unsigned char*)calloc((size_t)bins, 1);
        out->mid = (unsigned char*)calloc((size_t)bins, 1);
        out->high = (unsigned char*)calloc((size_t)bins, 1);
        if (!out->low || !out->mid || !out->high) {
            free(binLow);
            free(binMid);
            free(binHigh);
            fail(out, "out of memory during analysis");
            goto done;
        }
        out->bins = bins;

        for (b = 0; b < bins; b += 1) {
            /* Each 10 ms bin takes the loudest STFT frame that falls inside it. */
            double t0 = (double)b / RFX_WAVE_BINS_PER_SEC;
            double t1 = (double)(b + 1) / RFX_WAVE_BINS_PER_SEC;
            unsigned int f0 = (unsigned int)floor(t0 * fps);
            unsigned int f1 = (unsigned int)ceil(t1 * fps);
            double l = 0.0, m = 0.0, h = 0.0;
            unsigned int i;
            if (f1 > nFrames) f1 = nFrames;
            if (f0 >= f1) f0 = (f1 > 0) ? f1 - 1 : 0;
            for (i = f0; i < f1; i += 1) {
                if (bandLow[i] > l) l = bandLow[i];
                if (bandMid[i] > m) m = bandMid[i];
                if (bandHigh[i] > h) h = bandHigh[i];
            }
            binLow[b] = l;
            binMid[b] = m;
            binHigh[b] = h;
            if (l > peakLow) peakLow = l;
            if (m > peakMid) peakMid = m;
            if (h > peakHigh) peakHigh = h;
        }
        {
            /* One shared scale keeps the bands' balance; each band is then eased up a little so a
             * quiet track is still legible. */
            double scale = peakLow;
            if (peakMid > scale) scale = peakMid;
            if (peakHigh > scale) scale = peakHigh;
            if (scale <= 0.0) scale = 1.0;
            for (b = 0; b < bins; b += 1) {
                double l = pow(binLow[b] / scale, 0.7) * 255.0;
                double m = pow(binMid[b] / scale, 0.7) * 255.0;
                double h = pow(binHigh[b] / scale, 0.7) * 255.0;
                out->low[b] = (unsigned char)(l > 255.0 ? 255.0 : l);
                out->mid[b] = (unsigned char)(m > 255.0 ? 255.0 : m);
                out->high[b] = (unsigned char)(h > 255.0 ? 255.0 : h);
            }
            free(binLow);
            free(binMid);
            free(binHigh);
        }
    }

    out->durationSec = (double)frames / (double)rate;
    out->ok = 1;
    rc = 0;

done:
    free(win);
    free(re);
    free(im);
    free(prevMag);
    free(onset);
    free(chroma);
    free(bandLow);
    free(bandMid);
    free(bandHigh);
    if (rc != 0) rfx_analysis_free(out);
    return rc;
}

int rfx_analyze_file(const char* path, rfx_analysis* out)
{
    ma_decoder_config cfg;
    ma_decoder dec;
    ma_result r;
    float* mono = NULL;
    ma_uint64 used = 0, capacity;
    unsigned int srcRate = 0, srcChannels = 0;
    int rc;

    if (out == NULL) return 1;
    if (path == NULL || path[0] == 0) {
        fail(out, "no file given");
        return 1;
    }

    /* A first open with no config reports the file's own rate and channel count; once a
     * conversion config is in place the decoder only ever reports what it converts to. */
    {
        ma_decoder probe;
        if (ma_decoder_init_file(path, NULL, &probe) == MA_SUCCESS) {
            ma_format fmt;
            ma_uint32 ch, sr;
            if (ma_decoder_get_data_format(&probe, &fmt, &ch, &sr, NULL, 0) == MA_SUCCESS) {
                srcRate = sr;
                srcChannels = ch;
            }
            ma_decoder_uninit(&probe);
        }
    }

    /* Mono at the analysis rate: miniaudio does the mixdown and the resampling. */
    cfg = ma_decoder_config_init(ma_format_f32, 1, AN_RATE);
    r = ma_decoder_init_file(path, &cfg, &dec);
    if (r != MA_SUCCESS) {
        fail(out, "could not open the audio file");
        snprintf(out->error, sizeof(out->error), "could not open the audio file: %s", ma_result_description(r));
        return 1;
    }
    {
        ma_uint64 length = 0;
        if (ma_decoder_get_length_in_pcm_frames(&dec, &length) != MA_SUCCESS) length = 0;
        capacity = (length > 0) ? length + 64 : (ma_uint64)AN_RATE * 60;
    }
    mono = (float*)malloc((size_t)capacity * sizeof(float));
    if (mono == NULL) {
        ma_decoder_uninit(&dec);
        fail(out, "out of memory while decoding");
        return 1;
    }
    for (;;) {
        ma_uint64 room = capacity - used;
        ma_uint64 got = 0;
        if (room == 0) {
            float* grown = (float*)realloc(mono, (size_t)(capacity * 2) * sizeof(float));
            if (grown == NULL) break;
            mono = grown;
            capacity *= 2;
            room = capacity - used;
        }
        r = ma_decoder_read_pcm_frames(&dec, mono + used, room, &got);
        used += got;
        if (r != MA_SUCCESS || got == 0) break;
    }
    ma_decoder_uninit(&dec);

    rc = rfx_analyze_samples(mono, (unsigned int)used, AN_RATE, out);
    free(mono);
    if (rc == 0) {
        out->sourceRate = srcRate;
        out->sourceChannels = srcChannels;
    }
    return rc;
}

/* --- flat accessors ------------------------------------------------------ */

static rfx_analysis g_last;
static int g_have = 0;

int rfx_analysis_run(const char* path)
{
    int rc;
    rfx_analysis_release();
    rc = rfx_analyze_file(path, &g_last);
    g_have = 1;                     /* held either way, so the error survives the call */
    return rc;
}

const char* rfx_analysis_error(void)
{
    return g_have ? g_last.error : "";
}

double rfx_analysis_double(int key)
{
    if (!g_have) return 0.0;
    switch (key) {
        case 0: return g_last.durationSec;
        case 1: return g_last.bpm;
        case 2: return g_last.bpmConfidence;
        case 3: return g_last.firstBeatSec;
        case 4: return g_last.keyConfidence;
        case 5: return g_last.keyMargin;
        default: return 0.0;
    }
}

int rfx_analysis_int(int key)
{
    if (!g_have) return 0;
    switch (key) {
        case 0: return g_last.ok;
        case 1: return (int)g_last.sourceRate;
        case 2: return (int)g_last.sourceChannels;
        case 3: return g_last.keyPitchClass;
        case 4: return g_last.keyMinor;
        case 5: return g_last.bins;
        default: return 0;
    }
}

const char* rfx_analysis_text(int key)
{
    if (!g_have) return "";
    switch (key) {
        case 0: return g_last.camelot;
        case 1: return g_last.keyName;
        default: return "";
    }
}

int rfx_analysis_wave(unsigned char* dst, int capBytes)
{
    int b, bins;
    if (!g_have || dst == NULL || g_last.low == NULL) return 0;
    bins = g_last.bins;
    if (bins > capBytes / 3) bins = capBytes / 3;
    if (bins < 0) return 0;
    for (b = 0; b < bins; b += 1) {
        dst[b * 3 + 0] = g_last.low[b];
        dst[b * 3 + 1] = g_last.mid[b];
        dst[b * 3 + 2] = g_last.high[b];
    }
    return bins;
}

void rfx_analysis_release(void)
{
    if (g_have) rfx_analysis_free(&g_last);
    memset(&g_last, 0, sizeof(g_last));
    g_have = 0;
}
