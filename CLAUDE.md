# CLAUDE.md — RekordFox

Two-deck rekordbox-style Performance app for the AlphaTheta DDJ-FLX2. Owner: Tony. Windows is the primary dev machine
(`F:\RekordFox`). Version 0.2.0. Tagline: *Dig. Cue. Mix.*

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
→ UI (React, `useEngine` selectors; canvases read `store.getState()` in rAF) and → `computeLeds()` → diff → `Flx2Midi.send()`.
`runtime.ts` owns the singletons and the debounced save. The clock is `transport/tick` from rAF; the audio engine becomes
the clock in the audio slice.

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
`npm test` (104 tests) · `npm run typecheck` · `npm run dev` · `npm run build` · `npm run app` · `npm run app:dev` · `npm run docs:midi`
Windows: `start.bat` (browser, builds first), `start-desktop.bat` (Electron), `dev.bat` (Vite dev).

## Beat grid (from 0.2.2)
`Track.bpm` + `Track.firstBeatSec` is the whole grid. `bpmOriginal` / `firstBeatSecOriginal` hold what analysis
said, are set on the first hand edit and are what `grid/reset` restores (they persist, so RESET survives a
restart). `firstBeatSec` is always folded into the first bar. GRID on a waveform lane opens `GridPanel`; bar
lines draw in `state.danger` while `ui.gridDeck` is that deck.

## Native audio (from 0.2.1)
`native/` holds the audio engine's foundation: miniaudio vendored in `native/vendor/`, a flat C shim
(`native/src/rfx_audio.c` — plain functions only, no structs across FFI) and a Rust probe that opens the FLX2 in
WASAPI exclusive mode and reports the real buffer size. Build with `cargo run --release` (needs rustup + the MSVC
"Desktop development with C++" workload). `native/tests/shim_test.c` checks the shim without a sound card; miniaudio's
null backend can be forced anywhere with `RFX_BACKEND=null`.
Offline analysis lives beside it (`rfx_analyze.c` + `rfx_fft.c`): one call gives BPM, downbeat, Camelot key and
the 3-band waveform, read back through flat getters (`rfx_analysis_run` then `rfx_analysis_double/int/text/wave`)
so no struct crosses the FFI. `run-analyze.bat` / `cargo run --release --bin rfx-analyze -- <folder>` runs it on
real files; `run-tests.bat` covers it against fixtures of known tempo, offset and key.
Why: the browser stack measured ~52 ms on the hardware (`docs/audio-check-2026-09-12.json`) — fine for mixing,
useless for scratching, and Chromium cannot reach WASAPI exclusive from any process it owns.

## Open issues
`docs/NEXT.md` is the working backlog (milestones with acceptance criteria, written for a Claude Code session
running in this folder). `docs/AUDIT.md` — see the "Status — 0.2.0" section at the end for what's fixed and what's left.
Next: the Node addon + engine wiring (M1), then the library reading the analyser that already works (M2), then Audius.

## Open items to verify on hardware
SYNC long-press vs SHIFT+SYNC (`2A`/`5C`), SHIFT + CH CUE (`08`), ch-7 notes `96 00/01/09` (Smart CFX / Smart Fader),
MASTER LEVEL and HEADPHONES LEVEL CC numbers (bound via MIDI Learn), pad channels 8–11 on the actual unit,
jog resolution (720 ticks/rev assumed), the optional status-dump SysEx.
