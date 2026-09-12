# RekordFox — handoff brief for Claude Code

Paste the block below into Claude Code running in `F:\RekordFox`. Everything after it is the detail it
will read. Written 2026-09-12, after the redesign and the native audio engine landed.

---

## The prompt

```
Read CLAUDE.md, docs/NEXT.md and docs/AUDIT.md first, then work through docs/NEXT.md milestone by
milestone, starting at M1. Before you touch anything: run `npm install`, `npm test`, `npm run typecheck`
and `cargo run --release --bin rfx-tests` in native/ so you know the baseline is green.

Rules that are not negotiable: the DDJ-FLX2 is driven by USB MIDI only (never WebHID, never CDJ HID /
libpcon / Pro DJ Link, never Serato HID or OSC); colours, radii and type come only from
src/theme/tokens.ts; the Performance layout must keep fitting a 1280x680 window with no scrolling; the
engine/ and midi/ folders stay free of React and DOM code; TypeScript stays strict with erasable syntax
only and explicit .ts/.tsx import extensions.

Work in small commits. For each milestone: make the change, prove it with a test or a measurement,
then check it off in docs/NEXT.md with what you measured. Stop and ask me when a milestone needs the
FLX2 plugged in, needs a decision that changes behaviour I can hear, or when the acceptance criteria
cannot be met as written.
```

---

## Where the project is now

- **UI**: React + Vite + Electron. Performance, Library, Export and Settings screens, laid out like
  rekordbox's 2-deck horizontal mode (full-width stacked waveforms, deck title strips with overviews,
  `pads | jog | jog | pads`, horizontal mixer strip, browser below). 94 `node:test` tests pass, strict
  type-check clean.
- **MIDI**: full FLX2 driver — port discovery and hot-plug, the official message map with a confidence
  tag per row, 14-bit assembly, relative jog, firmware pad modes, LED diff writer, MIDI learn, soft
  takeover. Not yet verified against the hardware (see M3).
- **Audio**: native engine in `native/` — miniaudio vendored, a flat C shim, the DSP (Linkwitz-Riley
  isolator EQ, Sound Color FX filter, fader laws, cubic interpolation), and the engine itself (two decks
  from RAM, channel strips, crossfader, pre-fader cue, master on ch 1/2 and headphones on ch 3/4).
  Measured on the FLX2: WASAPI **exclusive at 48 kHz, 4 ch, 2 x 96 frames = 4.00 ms**, callback every
  2 ms, zero underruns through the whole demo. `native/audio-native-check.json` has the raw numbers.
- **Not connected yet**: the UI and the engine do not talk to each other. The on-screen decks still run
  on a requestAnimationFrame clock with generated demo waveforms. That is M1.

## M1 — Make the app play audio (the whole point)

Bridge the engine into Electron and hand it the clock.

1. **Node addon.** Add a napi-rs binding over `native/src/rfx_engine.h` + `rfx_audio.h`. Keep the
   existing `rfx-native` crate and add a `cdylib` target (or a second crate `native/node/`) exposing:
   device list / open / close (exclusive first, the shared fallback the probe already implements),
   `engineInit`, `deckLoad`, `deckEject`, `play`, `seek`, `setRate`, `setScratch`, `setLoop`,
   `setChannel`, `setMaster`, and a single `snapshot()` returning both deck positions, the peaks, the
   frame counter and the underrun count in one call. Node-API is ABI-stable, so no electron-rebuild.
2. **Process placement.** The addon loads in the **main process** (or a utility process), never the
   renderer. Commands go over `ipcRenderer.invoke`; the renderer pulls `snapshot()` once per animation
   frame through the existing `rekordfoxHost` preload bridge — do not send an IPC message per parameter
   change while a knob is being dragged, coalesce to the frame.
3. **Clock.** Replace `transport/tick` in `src/runtime.ts` with the engine's positions: the audio thread
   is the truth, the reducer follows. Keep the rAF loop as the *fallback* when no engine is present
   (browser build), and keep the canvases reading `store.getState()` rather than React state.
4. **Wire every control** that already exists in the reducer: load, play/pause, cue, seek, tempo, jog
   scratch and bend, loop in/out/auto/exit, beat jump, trim, 3-band EQ, CFX, channel faders, crossfader,
   PFL, master cue, master and phones level.
5. **Fallbacks.** No FLX2 audio device: open the default output in shared mode and say so in the UI
   (Settings › Audio already has the room for it). Fewer than four channels: disable headphone cue with
   an explanation rather than silently mixing it into the master.

**Done when:** a local file loaded on deck A plays through the FLX2; PLAY on the unit starts it with no
audible lag; the on-screen playhead and waveform track the sound (no drift over ten minutes); the jog
scratches; the crossfader, EQ, CFX and faders all do what the hardware says; headphone CUE comes out of
the headphone socket only; `underruns` stays 0 for a ten-minute set; the browser build still loads and
explains that audio needs the desktop app.

## M2 — Real tracks

1. **Add a music folder** (Electron dialog, recursive scan, remember it). Probe each file through the
   native side: duration, sample rate, channels, and tags (the `lofty` crate reads id3/vorbis/flac).
2. **Analysis on a worker thread** in Rust: 3-band waveform at the existing `WaveformData` shape
   (100 bins/s), BPM, beatgrid (first beat + tempo), and Camelot key. Cache per file on disk; reuse it on
   the next launch; show progress in the library.
3. **Library storage.** Replace the localStorage snapshot with a real store (SQLite through the addon, or
   a single JSON index if that is faster to get right) keeping ratings, comments, playlists, hot cues and
   analysis. Migrate what localStorage already holds.

**Done when:** pointing at a folder fills the library with real durations, tags, waveforms, BPM and key;
a second launch is instant from cache; the demo tracks still load; export copies the audio files next to
the `.m3u8` and `.rekordfox.json` (that last bit finishes M5).

## M3 — Hardware verification session (needs the unit)

Work through the MIDI monitor with every control on the FLX2 and settle the rows still marked
`family`/`unverified` in `src/midi/flx2Map.ts`:

- SYNC long-press vs SHIFT+SYNC (`2A` / `5C`) — and decide whether long-press should also toggle sync
  (audit M2).
- SHIFT + CH CUE (`08`); ch-7 notes `96 00 / 01 / 09` (Smart CFX, Smart Fader).
- MASTER LEVEL and HEADPHONES LEVEL CC numbers — bind them with Learn, then hard-code what you learn.
- Pad channels 8–11 on the real unit; jog resolution (720 ticks/rev is an assumption).
- The optional status-dump SysEx `F0 00 20 7F 03 01 F7`: does the unit answer?

**Done when:** a full pass over every control produces no `unmapped` rows in the monitor, each row's
`confidence` is updated, `npm run docs:midi` is regenerated, and the "Open items to verify on hardware"
list in CLAUDE.md is empty.

## M4 — The audio features still missing

- **Key lock (MT).** The button exists and only sets a flag. Add time-stretching (WSOLA is enough to
  start; keep the interface so a better algorithm can replace it) so pitch holds across ±6/10/16%.
- **Pad FX** as real DSP in the engine: echo, flanger, reverb, roll, echo out, backspin, braker, rollout.
  The pads and LEDs are already wired; they just do nothing to the sound.
- **Slip mode** in the engine: the reducer already tracks `slipPos`; the engine needs the shadow playhead
  so scratches, loops and held hot cues return to where the track would have been.
- **Smart Fader**: fader start is in the reducer behind a preference; the blending (bass swap and tempo
  ride) belongs in the engine.
- **Meters**: replace the demo levels in `src/ui/mixer/levels.ts` with the engine's real peaks.

**Done when:** MT holds pitch within a few cents at ±6%; each pad FX is audible and click-free; slip
returns to the right place after a 4-beat scratch; the meters move with the audio, not with a guess.

## M5 — Housekeeping worth doing early

- `git init`, `.gitignore` is already there, first commit. Nothing is under version control yet.
- Delete three stubs left from the redesign: `src/ui/Dock.tsx`, `src/ui/deck/JogDisplay.tsx`,
  `src/ui/waveform/WaveStack.tsx` (each contains only `export {};` and a note).
- Add `npm run check` = typecheck + tests + `cargo run --release --bin rfx-tests`.
- Playwright UI tests in the repo (audit M9): the three viewport sizes with no scrolling, load a track,
  needle lock, export naming, MIDI-monitor throughput.
- Leftovers from docs/AUDIT.md: M4 (a few 9–10 px labels), L3 (canvases do not re-scale on a DPR change),
  L4 (the idle clock notifies 60x/s even when nothing moves).

## How to work in this repo

- `npm install` once — it prunes a stray `run` dependency from the 0.1 package.json.
- `dev.bat` / `npm run dev` for the Vite dev server; `start.bat` builds then serves the browser build;
  `start-desktop.bat` builds then opens Electron. Vite empties `dist/` on every build.
- `npm test` (94 tests, `node:test` with type stripping — imports need explicit extensions and erasable
  syntax), `npm run typecheck`, `npm run docs:midi` after any change to `flx2Map.ts`.
- `native/run-tests.bat` or `cargo run --release --bin rfx-tests` for the C suites (DSP response
  measurements, device shim against miniaudio's null backend, engine behaviour with generated fixtures).
  `native/run-demo.bat` plays a real track through the engine; `native/run-probe.bat` re-measures latency.
- The engine contract: nothing in the audio callback allocates, locks or calls the OS. Parameters are
  plain aligned writes, a track hand-off is a slot swap, seeks carry a sequence number. If you add a
  control, follow that pattern — do not introduce a mutex.
- `rfx_engine_init(rate)` must be given the rate the *device* opened at; `rfx_engine_underruns()` counts
  the callbacks it refused because the rate changed underneath it.
- Layout heights live in the `--wave-row`, `--deck-info-row`, `--control-row`, `--mixer-row` variables in
  `src/theme/global.css`. Changing a row means re-checking 1280x680, 1366x657 and 1920x1080.
- miniaudio is vendored at `native/vendor/miniaudio.h` (public domain / MIT-0). Do not fetch it again.
- Legal footing: no rekordbox/Pioneer/Serato marks in the app, no claim of certification. The name
  "RekordFox" echoes the rekordbox trademark — fine for Tony's own use, worth revisiting before any
  public release.
