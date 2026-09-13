# CLAUDE.md — RekordFox

Two-deck rekordbox-style Performance app for the AlphaTheta DDJ-FLX2. Owner: Tony. Windows is the primary dev machine
(`F:\RekordFox`). Version 0.3.1. Tagline: *Dig. Cue. Mix.* Repo: github.com/tonyaleksandereriksen-lgtm/RecordFox (`main`).

## Hard rules (from the project brief)
- Control path is **MIDI only** (USB class-compliant). Never WebHID, never CDJ HID / libpcon / Pro DJ Link, never Serato HID/OSC.
- Official MIDI list is the source of truth. Every byte lives in `src/midi/flx2Map.ts` with a `confidence` tag
  (`pdf` / `family` / `unverified`). Don't invent messages; if unsure, mark `unverified` and let the monitor confirm.
- Vinyl mode can't be set on the unit: send `9n 17 7F` for both decks at init.
- LEDs: echo the input status/data1, `7F` on, `00` off. Load illumination is `9F 0n 7F`.
- Soft takeover on every absolute control. Original name/branding only — no rekordbox/Pioneer/Serato marks; never claim certification.
- No USB export, recording or stems on streamed audio.

## Decisions (Tony, 2026-09-11)
- **Name: RekordFox** (was Fennec, then VARRI). Mark: fox mask over a record, ears in the two deck colours —
  `src/assets/brand/rekordfox-mark.svg`, wordmark `rekordfox-wordmark.svg`, inline copies in `src/ui/common/Logo.tsx`,
  app icons in `build/`. Note: the name echoes the *rekordbox* trademark — fine for personal use, worth revisiting
  before any public release (not legal advice).
- **Export = write to a folder the user picks on disk** (`.m3u8` + `.rekordfox.json` cue sheet; audio files once real
  tracks exist). No USB/rekordbox device export. Existing files are never overwritten — see `uniqueBase()`.
- **Spotify dropped.** Its terms forbid mixing and DJ access is partner-only. Alternatives and limits:
  `docs/STREAMING-OPTIONS.md` (Audius is the candidate; metadata-only playlist import stays possible).
- **Audio spike built** as Settings › Audio check. Its JSON result decides Web Audio vs a native engine before the
  audio slice starts.
- **Design vision:** `docs/design/vision-mockup.png` supersedes the brief's "rounded 12–24 px / neon" rule and is
  implemented: near-black navy, deck A `#2FA6E3`, deck B `#E39A4E`, hairlines, 3–8 px corners, light wide-tracked
  uppercase labels, top tabs, status footer.
- **Layout (Tony, 2026-09-12): rekordbox "2Deck Horizontal" arrangement**, same design elements rearranged —
  full-width scrolling waveforms stacked at the top (one lane per deck, bar counter on the right), then a title
  strip per deck with its whole-track overview beneath, then one row of `pads A | jog A | jog B | pads B` (pads are
  a 4×2 grid of labelled cells with mode tabs above; each jog cluster holds loop/beat-jump, CUE/PLAY, the platter
  with BPM and pitch in its centre, SLIP/MT/Q and the tempo slider), then the mixer as a horizontal strip
  (knob row + CUE + meter over fader per channel, master/phones/cue toggles and the crossfader in the middle),
  then the browser. Row heights are the `--wave-row` / `--deck-info-row` / `--control-row` / `--mixer-row` vars.

## Architecture
hardware bytes → `Flx2Decoder` → `Flx2Event` → `Bindings` (+ `SoftTakeover`) → `EngineAction` → `reduce()` → `EngineState`
→ UI (React, `useEngine` selectors; canvases read `store.getState()` in rAF) and → `computeLeds()` → diff → `Flx2Midi.send()`
and → `EngineBridge` (`src/audio/`) → IPC → `electron/audio.cjs` → the native engine (`native/node/rfx.node`).
`runtime.ts` owns the singletons and the debounced save. Two clocks: the native engine's playheads arrive once per frame as
`transport/sync` for the decks it holds (`DeckState.engine`); `transport/tick` from rAF drives demo tracks and the browser
build. The bridge diffs state into engine commands (`mirror.ts`, pure and tested): transport commands leave at once,
knob values coalesce per frame, `DeckState.seekSeq` turns every playhead jump into exactly one engine seek, and under
the hand the reducer's position is the target the engine's scratch-follow mode tracks. The addon lives in the main
process only; the renderer never loads native code.

## Conventions
- TypeScript, strict. Imports use explicit `.ts`/`.tsx` extensions; erasable syntax only (no enums/namespaces/param props) —
  tests run on Node's type stripping (`node --test`), no test framework.
- Runtime deps: react + react-dom only. Keep `midi/` and `engine/` free of React and DOM-specific code
  (except `Flx2Midi.ts`, which wraps Web MIDI).
- Reducer stays pure; add a test for every new gesture (`tests/reducer.test.ts`) and every new map row (`tests/decoder.test.ts`).
- After changing `flx2Map.ts`, run `npm run docs:midi`.
- `src/theme/tokens.ts` is the only place colours, radii and type live; `global.css` holds layout. Deck colour comes from
  the `--deck` variable set on each deck/mixer subtree, so components stay deck-agnostic.
- Performance layout scales with viewport height (`--deck-row`, `--deck-lower`, `--jog`, `--knob`): must keep fitting
  1280×680 and 1366×657 without scrolling. Check with a headless screenshot after layout changes.
- Long lists (MIDI monitor) are throttled (~10 fps) and virtualised — never render 600 rows.

## Commands
`npm run check` (typecheck + 138 node tests + 128 native checks) · `npm test` · `npm run typecheck` · `npm run dev` ·
`npm run build` · `npm run native` (builds the addon → `native/node/rfx.node`) · `npm run native:smoke` (loads it in
Electron, opens the output for 0.5 s) · `node scripts/m1-check.mjs [--seconds N]` (drives the built desktop app on the
FLX2 and measures drift, transport following, meters, underruns → `docs/m1-check-<date>.json`) · `npm run app` ·
`npm run app:dev` · `npm run docs:midi` · `node scripts/m2-check.mjs` (imports a generated folder into the built app: tags,
BPM, waveforms, export copies, second-launch cache → `docs/m2-check-<date>.json`).
Windows: `start.bat` (browser, builds first), `start-desktop.bat` (Electron; builds the addon once), `dev.bat` (Vite dev).
Native builds need `cargo`; in a shell opened before Rust was installed, prefix `export PATH="$HOME/.cargo/bin:$PATH"`.

## Library (from 0.3.1)
The desktop app keeps the library in `<userData>/library.json` (the `Saved` shape from `src/lib/persist.ts`:
prefs, folders, local tracks with their analysis, edits for demo tracks), written atomically by
`electron/library.cjs`; the browser build keeps localStorage. Local track ids are `localTrackId(path)` (FNV-1a of
the path) and key the analysis cache (`<userData>/analysis/<id>.json` + `.rfxwave`, checked against size + mtime).
`src/library/controller.ts` owns import (scan → describe in batches → `library/upsert`) and the analysis queue
(`library/analysis` per result); `engine/waveform.ts` holds the registry the canvases read (`setWaveform`,
`onWaveformMissing`) so `engine/` stays DOM-free. A hand-corrected grid outranks a fresh analysis (it updates
`bpmOriginal` instead). `node scripts/m2-check.mjs` drives the whole path in the built app.

## Beat grid (from 0.2.2)
`Track.bpm` + `Track.firstBeatSec` is the whole grid. `bpmOriginal` / `firstBeatSecOriginal` hold what analysis
said, are set on the first hand edit and are what `grid/reset` restores (they persist, so RESET survives a
restart). `firstBeatSec` is always folded into the first bar. GRID on a waveform lane opens `GridPanel`; bar
lines draw in `state.danger` while `ui.gridDeck` is that deck.

## Native audio (from 0.2.1; wired into the app in 0.3.0)
`native/` holds the audio engine: miniaudio vendored in `native/vendor/`, a flat C shim
(`native/src/rfx_audio.c` — plain functions only, no structs across FFI), the DSP and the engine (`rfx_engine.c`), and a
Rust probe that opens the FLX2 in WASAPI exclusive mode and reports the real buffer size. Build with `cargo run --release`
(needs rustup + the MSVC "Desktop development with C++" workload). `native/tests/shim_test.c` checks the shim without a
sound card; miniaudio's null backend can be forced anywhere with `RFX_BACKEND=null`.
`native/node/` is the Node-API addon (napi-rs, a workspace member): a safe wrapper over `rfx::sys` with `deckLoad` and
`probeFile` on the thread pool and a single `snapshot()` per frame. It loads in Electron 37's main process with no
electron-rebuild. Engine rules the bridge relies on: `rfx_deck_scratch_to()` (follow-the-hand scratch, one target per
UI frame, speed estimated on the audio clock), seeks re-anchor the follower, `rfx_engine_frames_rendered()` freezing
means the device callback died (the bridge reopens once).
Offline analysis lives beside it (`rfx_analyze.c` + `rfx_fft.c`): one call gives BPM, downbeat, Camelot key and
the 3-band waveform, read back through flat getters (`rfx_analysis_run` then `rfx_analysis_double/int/text/wave`)
so no struct crosses the FFI. `run-analyze.bat` / `cargo run --release --bin rfx-analyze -- <folder>` runs it on
real files; `run-tests.bat` covers it against fixtures of known tempo, offset and key.
Why: the browser stack measured ~52 ms on the hardware (`docs/audio-check-2026-09-12.json`) — fine for mixing,
useless for scratching, and Chromium cannot reach WASAPI exclusive from any process it owns.

## Open issues
`docs/NEXT.md` is the working backlog (milestones with acceptance criteria, written for a Claude Code session
running in this folder). `docs/AUDIT.md` — see the "Status — 0.2.0" section at the end for what's fixed and what's left.
Done: M1 (the app plays audio through the FLX2 — `docs/m1-check-2026-09-13-600s.json`), M2 (folders, tags, analysis,
waveforms, the JSON library store — `docs/m2-check-2026-09-13.json`). Next: M3 on the hardware, then M4 (key lock,
Pad FX, slip, Smart Fader in the engine), then Audius.

## Open items to verify on hardware
SYNC long-press vs SHIFT+SYNC (`2A`/`5C`), SHIFT + CH CUE (`08`), ch-7 notes `96 00/01/09` (Smart CFX / Smart Fader),
MASTER LEVEL and HEADPHONES LEVEL CC numbers (bound via MIDI Learn), pad channels 8–11 on the actual unit,
jog resolution (720 ticks/rev assumed). Settled: the status-dump SysEx gets no answer from the unit (2026-09-13).
