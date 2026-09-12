/*
 * Opening files by UTF-8 path. The app hands paths over as UTF-8 (JavaScript strings through the
 * addon); on Windows the narrow C runtime interprets a char* path in the ANSI code page, so a name
 * with ø, æ, å or anything else outside it would fail to open. Widen first there.
 */
#ifndef RFX_FILE_H
#define RFX_FILE_H

#include "miniaudio.h"

#include <stdio.h>
#include <stdlib.h>

#ifdef _WIN32
#include <windows.h>

/* UTF-8 to UTF-16, malloc'd; NULL when it cannot be converted. */
static wchar_t* rfx_widen(const char* utf8)
{
    int n = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
    wchar_t* wide;
    if (n <= 0) return NULL;
    wide = (wchar_t*)malloc((size_t)n * sizeof(wchar_t));
    if (wide != NULL) MultiByteToWideChar(CP_UTF8, 0, utf8, -1, wide, n);
    return wide;
}
#endif

/* fopen / remove for UTF-8 paths (the tests write fixtures with them). */
static FILE* rfx_fopen_utf8(const char* path, const char* mode)
{
#ifdef _WIN32
    wchar_t* wide = rfx_widen(path);
    wchar_t  wmode[8];
    if (wide != NULL) {
        FILE* f;
        int i;
        for (i = 0; i < 7 && mode[i]; i += 1) wmode[i] = (wchar_t)mode[i];
        wmode[i] = 0;
        f = _wfopen(wide, wmode);
        free(wide);
        return f;
    }
#endif
    return fopen(path, mode);
}

static int rfx_remove_utf8(const char* path)
{
#ifdef _WIN32
    wchar_t* wide = rfx_widen(path);
    if (wide != NULL) {
        int r = _wremove(wide);
        free(wide);
        return r;
    }
#endif
    return remove(path);
}

static ma_result rfx_decoder_init_utf8(const char* path, const ma_decoder_config* cfg, ma_decoder* dec)
{
#ifdef _WIN32
    wchar_t* wide = rfx_widen(path);
    if (wide != NULL) {
        ma_result r = ma_decoder_init_file_w(wide, cfg, dec);
        free(wide);
        return r;
    }
#endif
    return ma_decoder_init_file(path, cfg, dec);
}

#endif /* RFX_FILE_H */
