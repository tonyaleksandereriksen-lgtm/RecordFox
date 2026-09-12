# RekordFox — native audio

The browser engine measured **~52 ms** of output latency on your DDJ-FLX2 (`docs/audio-check-2026-09-12.json`).
That is fine for mixing and hopeless for scratching, and no browser-side setting can fix it: Chromium only ever
talks to Windows' **shared** audio mixer. So the audio engine goes native — and this folder is its first piece.

**Measured on your FLX2 (2026-09-12):** WASAPI exclusive opened at 48 kHz, 4 channels, 2 x 96 frames —
**4.00 ms** of output buffer with a callback every 2 ms and no jitter, against 20 ms for the same device in
shared mode and 52 ms through the browser. Headphones on channels 3/4 confirmed by ear. Full report:
`audio-native-check.json`.

So the engine lives here now:

| Program | What it does |
|---|---|
| `run-demo.bat` | Plays your own tracks through the FLX2 with the real engine: tempo, EQ kill, filter sweep, crossfade, headphone cue, scratch, loop. Drag one or two audio files onto it. |
| `run-analyze.bat` | Analyses your own tracks the way the library will on import — BPM, downbeat, key, waveform — and writes `analysis.json`. Drag a file or a folder onto it. No sound card needed. |
| `run-tests.bat` | Runs the native checks (DSP, device shim, engine, analysis). No sound card needed. |
| `run-probe.bat` | The latency/channel probe, if you want to re-measure (after a driver change, or on another machine). |

## What you need (one time)

1. **Rust** — https://rustup.rs → run `rustup-init.exe`, accept the defaults.
2. **Visual Studio Build Tools** with the *Desktop development with C++* workload —
   https://visualstudio.microsoft.com/visual-cpp-build-tools/ (Rust's Windows linker and the C part of this
   folder both need it). The rustup installer offers to fetch it for you; say yes if it asks.

Nothing else: no package manager, no SDK. The audio library (miniaudio) is vendored in `vendor/`.

## Run it

Double-click **`run-demo.bat`** and drop in a track (or `cargo run --release --bin rfx-demo -- "C:\Music\a.mp3"`).

Before you do:
- Plug the FLX2 in over USB-C and put your headphones on.
- **Close rekordbox, Serato, Spotify, and any browser tab playing audio.** Exclusive mode means exactly that —
  Windows hands the device to one program, and it will refuse if something else is holding it.

The demo narrates each step so you can hear whether it is right. Anything that clicks, stutters, comes out of the
wrong socket or drifts is a bug worth reporting — it prints the underrun count at the end, which should stay at 0.

`run-probe.bat` does the measuring instead: it lists your outputs, tries exclusive mode at several buffer sizes,
times the callback, plays a tone on master and on headphones, and writes `audio-native-check.json`.

## What the numbers mean

| Buffer latency | What it's good for |
|---|---|
| ≤ 12 ms | Scratching feels right. Build the engine here. |
| 12–25 ms | Mixing is fine, scratching feels rubbery. Worth hunting for an ASIO driver. |
| > 25 ms | The driver is the limit, not the code. |

For comparison, the browser gave 52 ms on the same hardware.

## If it doesn't work

- **"cargo is not recognised"** — Rust isn't installed, or the terminal predates the install. Close it and retry.
- **"rustup could not choose a version of cargo to run"** — a fresh rustup install has no default toolchain.
  `run-probe.bat` now sets one up for you; by hand it is `rustup default stable`.
- **"link.exe not found" / "msvc not installed"** — install the Build Tools workload above.
- **Exclusive mode refuses to open** — Windows → Settings → Sound → the FLX2 → Properties → Advanced →
  tick *Allow applications to take exclusive control of this device*, then close anything else using it.
- **No FLX2 in the list** — it's a USB audio device, so it must show up in Windows' sound settings first.
  You can also pass a device number: `cargo run --release -- 3`.

## What's in here

```
vendor/miniaudio.h   miniaudio 0.11.25, single-header audio library (public domain / MIT-0, David Reid)
src/rfx_audio.c/.h   device shim over miniaudio: a flat C ABI of plain functions, no structs across FFI
src/rfx_dsp.c/.h     the DSP blocks: Linkwitz-Riley isolator EQ, Sound Color FX filter, fader laws, interpolator
src/rfx_engine.c/.h  the engine: two decks reading from RAM, channel strips, crossfader, cue bus, 4-channel out
src/rfx_atomic.h     the few atomics the engine needs, without requiring C11 atomics from MSVC
src/rfx_fft.c/.h     radix-2 FFT, the only transform the analyser needs
src/rfx_analyze.c/.h offline analysis: BPM, downbeat, key in Camelot, 3-band waveform
src/lib.rs           Rust bindings to all of the above
src/main.rs          rfx-probe: device list, open attempts, callback timing, tone test, JSON report
src/bin/demo.rs      rfx-demo: the scripted hardware demo
src/bin/analyze.rs   rfx-analyze: the analysis CLI
src/bin/tests.rs     rfx-tests: runs the C suites
tests/*.c            the checks: DSP response measurements, shim behaviour, engine behaviour
build.rs             compiles the C side; cargo does the rest
```

### How the engine is put together

A track is decoded once, in full, into RAM as 16-bit stereo at the device's rate (about 80 MB for seven
minutes). That is what makes scratching possible: the playhead is a floating-point frame index that can move
backwards, stand still, or run at any rate, and every sample it lands between is interpolated with a
Catmull-Rom curve. Tempo is the same mechanism — a rate of 1.06 is +6%, and the pitch rises with it, exactly
like vinyl. (Key lock needs time-stretching, which comes later.)

Each deck then runs trim → 3-band isolator EQ → Sound Color FX → fader. The EQ uses 4th-order
Linkwitz-Riley crossovers at 300 Hz and 2.5 kHz, with the high band passed through the same filter pair so
the three bands add back to flat when the knobs are centred — measured, not assumed: `tests/dsp_test.c`
reports 0.00 dB flat, -38 dB with the low killed, -63 dB with the high killed. Headphone CUE is taken
pre-fader, like the hardware. The crossfader is constant-power.

Nothing in the audio callback allocates, locks or calls the OS. Loading a track happens on the UI thread and
is published to the audio thread with a slot swap; seeks carry a sequence number; parameters are plain
aligned writes. That is why the demo reports zero underruns at a 96-frame buffer.

The C shim exists so the Rust side never mirrors miniaudio's structs — only ~15 plain functions cross the
boundary, which keeps the binding honest when miniaudio is updated.

### How a track is analysed

`rfx-analyze` (and, later, the library's import worker) decodes the file to mono at 22 050 Hz and makes three
passes over it, each at the resolution its own job needs.

**Tempo** comes from spectral flux — the rising part of the change between one 1024-point spectrum and the
next — autocorrelated with a comb that also weighs the 2-, 3- and 4-beat lags, so a hi-hat pattern cannot win
by being twice as dense as the kick. The winning lag is refined with a parabola through its neighbours and
folded into 70–190 BPM.

**The downbeat** is not taken from that envelope: at a 256-sample hop each frame is 11.6 ms wide and its energy
sits half a window late, which is most of the budget gone before any beat is found. So the grid is locked on a
plain block-RMS envelope at 64 samples — 2.9 ms — and tempo and phase are searched *together*, because an error
of one BPM is already half a beat of drift across a three-minute track. Which of the four beats starts the bar
is then decided by low-band energy, the way a DJ would: the kick marks bar one. Against fixtures built at a
known tempo and offset this lands within 3 ms.

**Key** needs frequency resolution the onset pass cannot give it — a 1024-point bin is 21.5 Hz, while a
semitone at C3 is 7.8 Hz, so every low note would share a bin with its neighbours. A second 8192-point pass
gives 2.7 Hz bins, and only spectral *peaks* are counted, each one's true frequency fitted through its
neighbours, so the noise floor and the sheer number of high bins cannot outvote the notes. The resulting
chroma is matched against the Krumhansl-Kessler profiles for all 24 keys and reported in Camelot notation,
with both how well the winner fit and how far ahead of the runner-up it was — relative major and minor share
every note, so a small margin is the honest way to say "this one is ambiguous".

**The waveform** is the same 3-band split the decks already draw: 100 bins a second of low (<200 Hz),
mid and high, one shared scale so the bands keep their balance, written alongside as `<name>.rfxwave` when
`--wave <dir>` is given — three bytes per bin, nothing else.

## In the app: the Node-API addon (`node/`)

`node/` is a second crate in this workspace that builds the engine as a Node-API addon (napi-rs) —
`npm run native` from the project root puts it at `native/node/rfx.node`, and Electron's main process loads
it (`electron/audio.cjs`) with no electron-rebuild step, because Node-API is ABI-stable. It is a thin, safe
wrapper over `src/lib.rs`: device list, open/close, engine init, every deck and mixer control, and one
`snapshot()` a frame with both playheads, the peaks, the frame counter and the underrun count. `deckLoad` and
`probeFile` decode on the thread pool and return Promises, so a long mp3 never stalls the UI.

Two engine functions exist for the app's sake. `rfx_deck_scratch_to()` is scratching by *following the hand*:
the UI reports where the platter has put the playhead once per animation frame, and the engine measures the
hand's speed between reports on its own clock, smooths it, and pulls toward the extrapolated hand position — so
sixty position steps a second come out as one continuous motion (measured: 0 % speed ripple, a stop lands on
the hand within 0.3 s). `rfx_probe_file()` reads duration, rate and channels without decoding, for the library.

`npm run native:smoke` loads the addon inside Electron and runs the output for half a second;
`node scripts/m1-check.mjs` drives the whole app on the FLX2 and measures it.
