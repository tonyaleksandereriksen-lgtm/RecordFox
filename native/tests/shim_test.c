/* Checks the shim without a sound card: the sine lands on the right channel pair, fades in and
 * out, stops after the right number of frames, and the null backend runs a real device loop. */
#include "rfx_audio.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>

static int failures = 0;
static void check(int ok, const char* what)
{
    printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) failures += 1;
}

static float peak(const float* buf, unsigned frames, unsigned channels, unsigned ch)
{
    float m = 0.0f;
    unsigned i;
    for (i = 0; i < frames; i += 1) {
        float v = buf[(size_t)i * channels + ch];
        if (v < 0) v = -v;
        if (v > m) m = v;
    }
    return m;
}

int rfx_shim_test_main(void)
{
    failures = 0;
    enum { RATE = 48000, CH = 4, N = 4800 };  /* 100 ms */
    static float buf[N * CH];

    /* master pair */
    rfx_test_set_tone(0, N, 1000.0, 0.5);
    rfx_test_render(buf, N, CH, RATE);
    check(peak(buf, N, CH, 0) > 0.45f && peak(buf, N, CH, 1) > 0.45f, "tone on channels 1/2");
    check(peak(buf, N, CH, 2) == 0.0f && peak(buf, N, CH, 3) == 0.0f, "channels 3/4 stay silent");
    check(fabsf(buf[0]) < 0.001f, "starts from silence (fade in)");
    check(peak(buf, N, CH, 0) <= 0.5f, "never exceeds the asked amplitude");
    check(fabsf(buf[(size_t)(N - 1) * CH]) < 0.06f, "ends near silence (fade out)");

    /* headphone pair */
    rfx_test_set_tone(1, N, 1000.0, 0.5);
    rfx_test_render(buf, N, CH, RATE);
    check(peak(buf, N, CH, 2) > 0.45f && peak(buf, N, CH, 3) > 0.45f, "tone on channels 3/4");
    check(peak(buf, N, CH, 0) == 0.0f, "channels 1/2 stay silent");

    /* stops when the tone is done, and a 2-channel device ignores the phones pair */
    rfx_test_set_tone(0, 240, 1000.0, 0.5);
    rfx_test_render(buf, N, CH, RATE);
    check(peak(buf + (size_t)300 * CH, N - 300, CH, 0) == 0.0f, "silent after the tone ends");
    rfx_test_set_tone(1, N, 1000.0, 0.5);
    rfx_test_render(buf, N, 2, RATE);
    check(peak(buf, N, 2, 0) == 0.0f && peak(buf, N, 2, 1) == 0.0f, "no phones pair on a 2-channel device");

    /* frequency: count zero crossings of a 1 kHz tone over 100 ms -> ~200 */
    rfx_test_set_tone(0, N, 1000.0, 0.5);
    rfx_test_render(buf, N, CH, RATE);
    {
        unsigned i, crossings = 0;
        for (i = 1; i < N; i += 1) {
            float a = buf[(size_t)(i - 1) * CH], b = buf[(size_t)i * CH];
            if ((a <= 0.0f && b > 0.0f) || (a >= 0.0f && b < 0.0f)) crossings += 1;
        }
        printf("     zero crossings: %u (expect ~200)\n", crossings);
        check(crossings >= 195 && crossings <= 205, "1 kHz really is 1 kHz");
    }

    /* the whole device path against miniaudio's null backend */
#ifdef _WIN32
    _putenv_s("RFX_BACKEND", "null");
#else
    setenv("RFX_BACKEND", "null", 1);
#endif
    check(rfx_init() == 0, "null backend starts");
    printf("     backend=%s devices=%d\n", rfx_backend_name(), rfx_device_count());
    check(rfx_open(-1, 0, 48000, 4, 256) == 0, "opens a 4-channel device");
    printf("     sr=%d ch=%d period=%d periods=%d latency=%.2f ms\n",
           rfx_get_int(0), rfx_get_int(1), rfx_get_int(2), rfx_get_int(3), rfx_get_double(0));
    check(rfx_get_double(0) > 0.0, "reports an output latency");
    check(rfx_play_tone(0, 0.2, 660.0, 0.2) == 0, "plays a tone on master");
    {
        clock_t deadline = clock() + (clock_t)(CLOCKS_PER_SEC * 3);
        while (rfx_tone_busy() && clock() < deadline) { /* the audio thread is doing the work */ }
        check(!rfx_tone_busy(), "tone finishes on its own");
        check(rfx_get_double(1) > 0.0, "the device callback ran");
        printf("     callbacks=%.0f frames=%.0f\n", rfx_get_double(1), rfx_get_double(2));
    }
    check(rfx_play_tone(3, 0.1, 660.0, 0.2) != 0, "refuses a channel pair the device hasn't got");
    rfx_close();
    rfx_uninit();

    printf("\n%s\n", failures == 0 ? "all shim checks passed" : "SHIM CHECKS FAILED");
    return failures;
}
