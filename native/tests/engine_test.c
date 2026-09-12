/*
 * Engine checks with no sound card involved: load real files, render blocks by hand and measure
 * what came out. Run from the native/ folder after generating the fixtures (see tests/README).
 */
#include "rfx_engine.h"
#include "rfx_file.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RATE 48000u
#define CH   4u
#define BLK  480u          /* 10 ms blocks, like a real callback */

static int failures = 0;
static void check(int ok, const char* what)
{
    printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) failures += 1;
}


/* --- fixtures ----------------------------------------------------------- */
/* A tiny WAV writer so the tests carry their own audio and need no Python or sample files. */
static void put_u32(unsigned char* p, unsigned int v)
{
    p[0] = (unsigned char)(v & 0xff);
    p[1] = (unsigned char)((v >> 8) & 0xff);
    p[2] = (unsigned char)((v >> 16) & 0xff);
    p[3] = (unsigned char)((v >> 24) & 0xff);
}

static int write_sine_wav(const char* path, double freqLeft, double freqRight, double seconds, unsigned int rate)
{
    unsigned int frames = (unsigned int)(seconds * rate);
    unsigned int dataBytes = frames * 4;      /* stereo, 16-bit */
    unsigned char header[44];
    FILE* f = rfx_fopen_utf8(path, "wb");
    unsigned int i;
    if (f == NULL) return 1;

    memcpy(header, "RIFF", 4);
    put_u32(header + 4, 36 + dataBytes);
    memcpy(header + 8, "WAVEfmt ", 8);
    put_u32(header + 16, 16);                 /* fmt chunk size */
    header[20] = 1; header[21] = 0;           /* PCM */
    header[22] = 2; header[23] = 0;           /* channels */
    put_u32(header + 24, rate);
    put_u32(header + 28, rate * 4);           /* byte rate */
    header[32] = 4; header[33] = 0;           /* block align */
    header[34] = 16; header[35] = 0;          /* bits */
    memcpy(header + 36, "data", 4);
    put_u32(header + 40, dataBytes);
    fwrite(header, 1, sizeof(header), f);

    for (i = 0; i < frames; i += 1) {
        double t = (double)i / (double)rate;
        short l = (short)(0.5 * 32767.0 * sin(2.0 * 3.14159265358979323846 * freqLeft * t));
        short r = (short)(0.5 * 32767.0 * sin(2.0 * 3.14159265358979323846 * freqRight * t));
        unsigned char frame[4];
        frame[0] = (unsigned char)(l & 0xff);
        frame[1] = (unsigned char)((l >> 8) & 0xff);
        frame[2] = (unsigned char)(r & 0xff);
        frame[3] = (unsigned char)((r >> 8) & 0xff);
        fwrite(frame, 1, 4, f);
    }
    fclose(f);
    return 0;
}

static float buf[BLK * CH];

/* Render `seconds` worth of audio in blocks; returns the peak on one output channel. */
static double render_peak(double seconds, unsigned int channel, unsigned int channels)
{
    unsigned int blocks = (unsigned int)(seconds * RATE / BLK);
    unsigned int b, i;
    double peak = 0.0;
    for (b = 0; b < blocks; b += 1) {
        rfx_engine_render(buf, BLK, channels, RATE);
        for (i = 0; i < BLK; i += 1) {
            double v = fabs((double)buf[i * channels + channel]);
            if (v > peak) peak = v;
        }
    }
    return peak;
}

/* Frequency of the signal on a channel, from zero crossings over `seconds`. */
static double render_freq(double seconds, unsigned int channel)
{
    unsigned int blocks = (unsigned int)(seconds * RATE / BLK);
    unsigned int b, i, crossings = 0;
    double prev = 0.0;
    int started = 0;
    for (b = 0; b < blocks; b += 1) {
        rfx_engine_render(buf, BLK, CH, RATE);
        for (i = 0; i < BLK; i += 1) {
            double v = (double)buf[i * CH + channel];
            if (started && ((prev <= 0.0 && v > 0.0) || (prev >= 0.0 && v < 0.0))) crossings += 1;
            prev = v;
            started = 1;
        }
    }
    return (double)crossings / 2.0 / seconds;
}

static void silence_all(void)
{
    int d;
    for (d = 0; d < RFX_DECKS; d += 1) {
        rfx_deck_play(d, 0);
        rfx_deck_set_channel(d, 0.5, 0.5, 0.5, 0.5, 0.5, 0.0, 0);
        rfx_deck_set_scratch(d, 0, 0.0);
        rfx_deck_set_rate(d, 1.0);
        rfx_deck_set_loop(d, 0.0, 0.0, 0);
    }
    rfx_engine_set_master(0.5, 0.5, 0.5, 0.0, 0);
}

int rfx_engine_test_main(const char* dir)
{
    char sine1k[512], sine100[512], sine44[512], stereo[512];

    failures = 0;
    if (dir == NULL || dir[0] == 0) dir = ".";
    snprintf(sine1k, sizeof(sine1k), "%s/rfx-test-1k.wav", dir);
    snprintf(sine100, sizeof(sine100), "%s/rfx-test-100.wav", dir);
    snprintf(sine44, sizeof(sine44), "%s/rfx-test-1k-44k.wav", dir);
    snprintf(stereo, sizeof(stereo), "%s/rfx-test-stereo.wav", dir);

    if (write_sine_wav(sine1k, 1000.0, 1000.0, 5.0, 48000) != 0 ||
        write_sine_wav(sine100, 100.0, 100.0, 3.0, 48000) != 0 ||
        write_sine_wav(sine44, 1000.0, 1000.0, 2.0, 44100) != 0 ||
        write_sine_wav(stereo, 500.0, 2000.0, 2.0, 48000) != 0) {
        printf("FAIL could not write the test fixtures into %s\n", dir);
        return 1;
    }
    printf("     fixtures written to %s\n", dir);

    check(rfx_engine_init(RATE) == 0, "engine starts");
    check(rfx_engine_sample_rate() == RATE, "engine runs at the rate it was given");

    /* --- loading -------------------------------------------------------- */
    check(rfx_deck_has_track(0) == 0, "a fresh deck is empty");
    check(rfx_deck_load(0, "/no/such/file.wav") != 0, "a missing file is refused");
    printf("     error text: %s\n", rfx_engine_last_error());
    check(rfx_deck_load(0, sine1k) == 0, "loads a wav");
    printf("     deck A length: %.3f s\n", rfx_deck_length_seconds(0));
    check(fabs(rfx_deck_length_seconds(0) - 5.0) < 0.01, "length is right");
    check(rfx_deck_has_track(0) == 1, "deck reports a track");
    check(rfx_deck_load(1, sine44) == 0, "loads a 44.1 kHz file");
    printf("     deck B length after resampling: %.3f s\n", rfx_deck_length_seconds(1));
    check(fabs(rfx_deck_length_seconds(1) - 2.0) < 0.02, "a 44.1 kHz file keeps its duration at 48 kHz");
    rfx_deck_eject(1);
    check(rfx_deck_has_track(1) == 0, "eject empties the deck");

    /* --- transport ------------------------------------------------------ */
    silence_all();
    rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0);
    rfx_engine_set_master(0.0, 0.5, 0.5, 0.0, 0);   /* crossfader hard to deck A */
    rfx_deck_seek(0, 0.0);

    check(render_peak(0.1, 0, CH) < 1e-9, "a paused deck is silent");
    check(rfx_deck_position(0) < 1e-9, "a paused deck does not move");

    rfx_deck_play(0, 1);
    check(render_peak(0.2, 0, CH) > 0.2, "a playing deck makes sound");
    printf("     position after 0.2 s of playing: %.3f s\n", rfx_deck_position(0));
    check(fabs(rfx_deck_position(0) - 0.2) < 0.02, "the playhead tracks the frames rendered");

    /* --- pitch ---------------------------------------------------------- */
    rfx_deck_seek(0, 0.5);
    {
        double f = render_freq(0.5, 0);
        printf("     1 kHz at rate 1.0 measures %.1f Hz\n", f);
        check(fabs(f - 1000.0) < 5.0, "plays at the recorded pitch");
    }
    rfx_deck_set_rate(0, 1.06);
    rfx_deck_seek(0, 1.0);
    {
        double before = rfx_deck_position(0);
        double f = render_freq(0.5, 0);
        double moved = rfx_deck_position(0) - before;
        printf("     +6%% gives %.1f Hz and moves %.3f s of audio in 0.5 s\n", f, moved);
        check(fabs(f - 1060.0) < 8.0, "+6% tempo lifts the pitch by 6%");
        check(fabs(moved - 0.53) < 0.02, "+6% tempo eats the track 6% faster");
    }
    rfx_deck_set_rate(0, 1.0);

    /* --- scratching ----------------------------------------------------- */
    rfx_deck_seek(0, 2.0);
    rfx_deck_set_scratch(0, 1, -1.0);
    {
        double peak = render_peak(0.2, 0, CH);
        printf("     backwards: position %.3f s, peak %.3f\n", rfx_deck_position(0), peak);
        check(rfx_deck_position(0) < 1.9, "a negative jog rate plays backwards");
        check(peak > 0.2, "backwards playback still makes sound");
    }
    rfx_deck_set_scratch(0, 1, 0.0);
    {
        double held = rfx_deck_position(0);
        render_peak(0.1, 0, CH);
        check(fabs(rfx_deck_position(0) - held) < 1e-9, "holding the platter still stops the playhead");
    }
    rfx_deck_set_scratch(0, 0, 0.0);

    /* --- scratch follow: the jog path the app uses ---------------------- */
    /* The UI reports where the hand has put the playhead once per frame; the engine has to turn
       those steps into a motion that sounds continuous. Here a "frame" is two 10 ms blocks. */
    rfx_deck_play(0, 0);
    rfx_deck_seek(0, 2.0);
    rfx_deck_scratch_to(0, 1, 2.0);   /* touch: the hand is where the playhead is */
    {
        const double speed = 0.75;
        const double want = speed * (double)BLK / (double)RATE;   /* seconds per block */
        double hand = 2.0;
        double minStep = 1e9, maxStep = -1e9;
        int b;
        for (b = 0; b < 120; b += 1) {                  /* 1.2 s */
            double before;
            if (b % 2 == 0) {
                hand += speed * 2.0 * (double)BLK / (double)RATE;
                rfx_deck_scratch_to(0, 1, hand);
            }
            before = rfx_deck_position(0);
            rfx_engine_render(buf, BLK, CH, RATE);
            if (b >= 40) {                              /* after the speed estimate has settled */
                double moved = rfx_deck_position(0) - before;
                if (moved < minStep) minStep = moved;
                if (moved > maxStep) maxStep = moved;
            }
        }
        printf("     steady hand at 0.75x: playhead moves %.5f..%.5f s per block (want %.5f)\n", minStep, maxStep, want);
        check(maxStep - minStep < want * 0.02, "a steady hand gives a steady speed (ripple under 2%)");
        check(fabs((minStep + maxStep) * 0.5 - want) < want * 0.02, "the playhead moves at the hand's speed");
        /* The last report is two blocks old, so the hand is expected to have moved on by two blocks. */
        printf("     playhead %.4f s, hand %.4f s (+%.4f s since its last report)\n", rfx_deck_position(0), hand, 2.0 * want);
        check(fabs(rfx_deck_position(0) - (hand + 2.0 * want)) < 0.005, "the playhead stays with the hand (no drift)");

        /* The hand stops: the same target keeps arriving. */
        for (b = 0; b < 30; b += 1) {                   /* 0.3 s */
            if (b % 2 == 0) rfx_deck_scratch_to(0, 1, hand);
            rfx_engine_render(buf, BLK, CH, RATE);
        }
        {
            double before = rfx_deck_position(0);
            rfx_deck_scratch_to(0, 1, hand);
            rfx_engine_render(buf, BLK, CH, RATE);
            printf("     hand stopped: playhead %.4f s, hand %.4f s, %.6f s per block\n", rfx_deck_position(0), hand, rfx_deck_position(0) - before);
            check(fabs(rfx_deck_position(0) - before) < 0.0002, "a still hand stops the playhead within 0.3 s");
            check(fabs(rfx_deck_position(0) - hand) < 0.01, "and it comes to rest at the hand's position");
        }

        /* Pulling back plays backwards, audibly. */
        {
            double start = rfx_deck_position(0);
            double peak = 0.0;
            unsigned int i;
            for (b = 0; b < 40; b += 1) {               /* 0.4 s at -0.5x */
                if (b % 2 == 0) {
                    hand -= 0.5 * 2.0 * (double)BLK / (double)RATE;
                    rfx_deck_scratch_to(0, 1, hand);
                }
                rfx_engine_render(buf, BLK, CH, RATE);
                for (i = 0; i < BLK; i += 1) if (fabs((double)buf[i * CH]) > peak) peak = fabs((double)buf[i * CH]);
            }
            printf("     pulled back 0.2 s: playhead %.4f -> %.4f s, peak %.3f\n", start, rfx_deck_position(0), peak);
            check(rfx_deck_position(0) < start - 0.15, "a hand pulling back plays backwards");
            check(peak > 0.2, "and it still makes sound");
        }

        /* A hot cue jump while the hand is down must not read as a fast scratch. */
        {
            double moved;
            rfx_deck_seek(0, 1.0);
            hand = 1.0;
            rfx_deck_scratch_to(0, 1, hand);
            rfx_engine_render(buf, BLK, CH, RATE);
            moved = rfx_deck_position(0) - 1.0;
            printf("     jump to 1.0 s under the hand: playhead %.4f s\n", rfx_deck_position(0));
            check(fabs(moved) < 0.002, "a seek under a still hand does not lurch");
        }

        /* Targets stop arriving mid-motion (a stalled UI): coast to rest, never run away. */
        for (b = 0; b < 20; b += 1) {
            if (b % 2 == 0) {
                hand += 1.0 * 2.0 * (double)BLK / (double)RATE;
                rfx_deck_scratch_to(0, 1, hand);
            }
            rfx_engine_render(buf, BLK, CH, RATE);
        }
        render_peak(0.6, 0, CH);
        {
            double before = rfx_deck_position(0);
            rfx_engine_render(buf, BLK, CH, RATE);
            printf("     no targets for 0.6 s: playhead %.4f s, last hand %.4f s\n", rfx_deck_position(0), hand);
            check(fabs(rfx_deck_position(0) - before) < 0.0002, "without targets the playhead coasts to rest");
            check(rfx_deck_position(0) < hand + 0.25, "and it does not run away");
        }
    }
    rfx_deck_scratch_to(0, 0, 0.0);
    {
        double held = rfx_deck_position(0);
        render_peak(0.1, 0, CH);
        check(fabs(rfx_deck_position(0) - held) < 1e-9, "letting go of a paused deck leaves it where the hand left it");
    }

    /* --- probing files without loading them ------------------------------- */
    {
        double len = 0.0;
        int sr = 0, ch = 0;
        check(rfx_probe_file(sine44, &len, &sr, &ch) == 0, "probes a file without loading it");
        printf("     probe: %.3f s, %d Hz, %d ch\n", len, sr, ch);
        check(fabs(len - 2.0) < 0.01 && sr == 44100 && ch == 2, "the probe reports the file's own duration, rate and channels");
        check(rfx_probe_file("/no/such/file.wav", &len, &sr, &ch) != 0, "probing a missing file fails cleanly");
    }

    /* --- a UTF-8 path outside the ANSI code page ("prøve" — ø is C3 B8) ------ */
    {
        char utf8[512];
        double len = 0.0;
        int sr = 0, ch = 0;
        snprintf(utf8, sizeof(utf8), "%s/rfx-test-pr\xC3\xB8ve.wav", dir);
        if (write_sine_wav(utf8, 1000.0, 1000.0, 1.0, 48000) != 0) {
            check(0, "could not write the UTF-8 named fixture");
        } else {
            check(rfx_probe_file(utf8, &len, &sr, &ch) == 0 && fabs(len - 1.0) < 0.01, "probes a file whose name has a non-ASCII character");
            check(rfx_deck_load(1, utf8) == 0, "loads a file whose name has a non-ASCII character");
            rfx_deck_eject(1);
            rfx_remove_utf8(utf8);
        }
    }

    /* --- looping -------------------------------------------------------- */
    rfx_deck_set_loop(0, 1.0, 1.5, 1);
    rfx_deck_seek(0, 1.4);
    rfx_deck_play(0, 1);
    render_peak(1.0, 0, CH);
    printf("     after 1 s inside a 0.5 s loop: %.3f s\n", rfx_deck_position(0));
    check(rfx_deck_position(0) >= 1.0 && rfx_deck_position(0) < 1.5, "the playhead stays inside the loop");
    rfx_deck_set_loop(0, 0.0, 0.0, 0);

    /* --- end of track --------------------------------------------------- */
    rfx_deck_seek(0, 4.98);
    rfx_deck_play(0, 1);
    render_peak(0.2, 0, CH);
    printf("     at the end: position %.3f s, playing %d\n", rfx_deck_position(0), rfx_deck_playing(0));
    check(rfx_deck_playing(0) == 0, "the deck stops at the end of the track");
    check(rfx_deck_position(0) <= 5.001, "the playhead does not run past the end");

    /* --- mixer ---------------------------------------------------------- */
    silence_all();
    check(rfx_deck_load(1, stereo) == 0, "loads a second track on deck B");
    rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0);
    rfx_deck_set_channel(1, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0);
    rfx_deck_seek(0, 1.0);
    rfx_deck_seek(1, 0.5);
    rfx_deck_play(0, 1);
    rfx_deck_play(1, 1);

    rfx_engine_set_master(0.0, 0.5, 0.5, 0.0, 0);
    {
        double f = render_freq(0.4, 0);
        printf("     crossfader hard left: %.0f Hz (deck A is the 1 kHz tone)\n", f);
        check(fabs(f - 1000.0) < 15.0, "hard left is deck A alone");
    }
    rfx_engine_set_master(1.0, 0.5, 0.5, 0.0, 0);
    {
        double f = render_freq(0.4, 0);
        printf("     crossfader hard right: %.0f Hz (deck B's left channel is 500 Hz)\n", f);
        check(fabs(f - 500.0) < 15.0, "hard right is deck B alone");
    }

    /* --- headphone cue -------------------------------------------------- */
    silence_all();
    rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.0, 1);   /* fader down, CUE on */
    rfx_deck_seek(0, 1.0);
    rfx_deck_play(0, 1);
    rfx_engine_set_master(0.5, 0.5, 0.5, 0.0, 0);
    {
        double master = render_peak(0.2, 0, CH);
        double phones = render_peak(0.2, 2, CH);
        printf("     fader down with CUE on: master %.4f, phones %.4f\n", master, phones);
        check(master < 1e-6, "a closed fader keeps the deck out of the master");
        check(phones > 0.1, "CUE still sends it to the headphones (pre-fader)");
    }
    rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0);
    rfx_engine_set_master(0.0, 0.5, 0.5, 1.0, 1);               /* MASTER CUE, mix fully to master */
    {
        double phones = render_peak(0.2, 2, CH);
        printf("     master cue: phones %.3f\n", phones);
        check(phones > 0.1, "MASTER CUE puts the mix in the headphones");
    }

    /* --- EQ in the strip ------------------------------------------------ */
    silence_all();
    check(rfx_deck_load(0, sine100) == 0, "loads a 100 Hz track");
    rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0);
    rfx_engine_set_master(0.0, 0.5, 0.5, 0.0, 0);
    rfx_deck_seek(0, 0.5);
    rfx_deck_play(0, 1);
    {
        double flat = render_peak(0.3, 0, CH);
        rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.0, 0.5, 1.0, 0);   /* low kill */
        {
            double killed = render_peak(0.3, 0, CH);
            printf("     100 Hz tone: flat %.3f, low killed %.4f (%.1f dB)\n", flat, killed, 20.0 * log10((killed + 1e-9) / (flat + 1e-9)));
            check(flat > 0.2, "the 100 Hz tone comes through");
            check(killed < flat * 0.1, "killing the low band drops it by more than 20 dB");
        }
    }

    /* --- a 2-channel device --------------------------------------------- */
    silence_all();
    rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 1);
    rfx_deck_seek(0, 0.5);
    rfx_deck_play(0, 1);
    rfx_engine_set_master(0.0, 0.5, 0.5, 0.0, 0);
    check(render_peak(0.1, 0, 2) > 0.1, "a 2-channel device still gets the master");

    /* --- meters and counters -------------------------------------------- */
    {
        double peak = rfx_deck_peak(0);
        printf("     deck peak %.3f, master peak %.3f, frames rendered %llu, underruns %u\n",
               peak, rfx_engine_master_peak(), (unsigned long long)rfx_engine_frames_rendered(), rfx_engine_underruns());
        check(peak > 0.1, "the deck meter reads the signal");
        check(rfx_deck_peak(0) < peak, "reading the meter resets it");
        check(rfx_engine_underruns() == 0, "no underruns");
    }

    /* --- reloading while playing ---------------------------------------- */
    silence_all();
    rfx_deck_set_channel(0, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0);
    rfx_engine_set_master(0.0, 0.5, 0.5, 0.0, 0);
    rfx_deck_play(0, 1);
    render_peak(0.05, 0, CH);
    check(rfx_deck_load(0, sine1k) == 0, "loads a new track over a playing deck");
    rfx_deck_play(0, 1);
    check(render_peak(0.2, 0, CH) > 0.2, "the new track plays");
    check(fabs(rfx_deck_length_seconds(0) - 5.0) < 0.01, "the new track's length is reported");

    /* --- wrong sample rate --------------------------------------------- */
    {
        unsigned int before = rfx_engine_underruns();
        rfx_engine_render(buf, BLK, CH, 44100);
        check(rfx_engine_underruns() == before + 1, "a device rate change is reported, not played at the wrong pitch");
    }

    rfx_engine_shutdown();
    remove(sine1k);
    remove(sine100);
    remove(sine44);
    remove(stereo);
    printf("\n%s\n", failures == 0 ? "all engine checks passed" : "ENGINE CHECKS FAILED");
    return failures;
}
