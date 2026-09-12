# RekordFox — two-deck performance DJ app for the DDJ-FLX2

A rekordbox-style Performance layout (2 decks, mixer, waveforms, library) driven by an AlphaTheta **DDJ-FLX2** over
plain USB **MIDI** — no WebHID, no CDJ/Pro DJ Link handshake, no official certification. *Dig. Cue. Mix.*

**Status: 0.3.0** — the desktop app plays audio: a native engine (miniaudio, WASAPI exclusive on the DDJ-FLX2 at
48 kHz / 4 channels, 4 ms) drives both decks, the mixer, cue and the jog, with the audio thread as the clock. Plus the
FLX2 MIDI driver, the rekordbox-style Performance / Library / Export / Settings screens, beat-grid editing, MIDI
monitor, virtual controller, export to a folder, saved preferences and track edits. Add your own wav / flac / mp3
files in the Library; the demo entries stay (generated waveforms, no sound) so everything is alive without them.
Folder import, tags and automatic analysis (BPM, key, real waveforms) are next.

## Run it

You need **Node.js 22.18+** and **Chrome or Edge** (they have Web MIDI). Close rekordbox / Serato / Mixxx first —
on Windows a MIDI port can only be open in one app.

**After updating from 0.1:** run `npm install` once — it removes the stray `run` package and picks up the new name.

| What | How |
|---|---|
| Browser | double-click **`start.bat`** — rebuilds (when the dev tools are installed), serves `dist/` and opens Chrome/Edge as an app window. Click **Connect FLX2** and allow MIDI. If port 5199 is busy it reuses a running RekordFox or picks the next port. |
| Desktop app (Electron) | double-click **`start-desktop.bat`** — installs once, builds the audio engine once (needs Rust + the MSVC build tools, see `native/README.md`), rebuilds, opens the desktop window. MIDI connects automatically (SysEx allowed); audio opens the FLX2 in exclusive mode, so close rekordbox / Serato first. **Audio is desktop-only** — the browser build has no engine. |
| Develop | **`dev.bat`** or `npm run dev` (Vite, hot reload); `npm run app:dev` (Electron + Vite). |
| Tests | `npm run check` — type-check, 124 node tests (decoder, Web MIDI port handling, soft takeover, engine, engine clock, bridge, LED echo, library, persistence, export) and 126 native checks (DSP, device shim, engine, analysis). |
| Hardware check | `node scripts/m1-check.mjs --seconds 600` — drives the built desktop app on the FLX2 for ten minutes and reports drift, transport following, meters and underruns. |

## Screens

- **Performance** — Deck A | mixer | Deck B, with the Library, MIDI Monitor and Virtual FLX2 underneath. Fits a
  1280×680 laptop window; larger windows get bigger waveforms and jogs.
- **Library** — full-height browser (collection, playlists, smart lists Favorites / Recently Added), ratings,
  comments, playlist membership, hot cues. Drag a row onto a deck, use the **A / B** buttons, double-click, or press Enter.
- **Export** — pick a list and a folder (any drive, including a USB stick): writes an `.m3u8` playlist and a
  `.rekordfox.json` cue sheet (BPM, key, rating, comments, hot cues A–H). Existing files are never replaced —
  a number is added instead. Audio files are copied once real tracks can be added.
- **Settings** — Controller (connection, init sequence, MIDI learn), **Audio** (the engine: output device, mode,
  latency, underruns; plus the browser-side check from the audit), Preferences, About.

## First hardware session

1. Plug the FLX2 in over USB-C, start the app, open **Settings › Controller**.
2. **Init sequence** should tick: MIDI in/out → vinyl ON sent → LEDs lit → soft takeover armed.
3. Load two demo tracks. Both jog rings should flash (load illumination).
4. Press **PLAY**, **CUE**, **BEAT SYNC** on the unit: screen and unit LEDs must agree (PLAY blinks when paused,
   CUE lights on the cue point and blinks elsewhere, SYNC lights when on).
5. Move faders, EQ, CFX, crossfader and tempo — the screen follows. Move a control with the mouse, then on the unit:
   the unit is ignored until it reaches the on-screen value (amber dashed ghost = hardware position).
6. Jog: touch and spin (scratch), side ring (bend), SHIFT + jog (search).
7. SHIFT + BEAT SYNC, then pad 1–4 changes the pad mode on the unit; the deck's pad label follows on the next pad press.
8. Open the **MIDI Monitor** tab. Anything **unmapped** (red) or **verify** (amber): note the bytes; the table lives in
   `src/midi/flx2Map.ts`. Bind MASTER LEVEL and HEADPHONES LEVEL with **Learn** in Settings › Controller.
9. **Settings › Audio check** — pick *DDJ-FLX2 Audio Out*, run the four steps, **Copy result** and send it back.
   This decides whether the audio engine can stay in the browser engine or must go native.

No hardware? The **Virtual FLX2** tab sends the same bytes the unit sends and shows the LEDs the app writes back.

## Layout

```
src/
  brand.ts              name, tagline, version
  theme/tokens.ts       design tokens → CSS variables + canvas colours (the only place colours live)
  theme/global.css      layout and components (design vision: docs/design/vision-mockup.png)
  assets/brand/         RekordFox mark + wordmark (SVG); build/icon.* for the desktop app
  midi/                 FLX2 map, decoder/encoder, driver, bindings, soft takeover, LEDs, virtual unit
  engine/               pure reducer: decks, mixer, sync, cues, loops, slip, beat jump, sampler, library, prefs
  audio/                the engine bridge (state → engine commands, engine clock → state), meters, local files, status
  lib/                  store, persistence (localStorage), exporter (m3u8 + cue sheet)
  runtime.ts            wires store ↔ driver ↔ bindings ↔ LED writer ↔ clock ↔ persistence
  ui/                   React: performance/, deck/, mixer/, library/, export/, settings/, monitor/, virtual/
electron/               desktop shell (app:// secure context, CSP, single instance, MIDI + SysEx permissions) + audio.cjs (the engine in the main process)
native/                 the audio engine in C over miniaudio, its Rust tools, the analyser, and node/ — the Node-API addon
scripts/                build-native, native-smoke, m1-check, make-test-wav, app-dev, gen-midi-doc
docs/                   FLX2 MIDI map, audit, streaming options, design vision
tests/                  node:test suites
```

## Roadmap

- **Done — audio engine (0.3.0):** 2 decks → gain/EQ/CFX/fader/crossfader → master + cue on the DDJ-FLX2 (master
  1/2, phones 3/4), laptop fallback, real meters, local files.
- **Next — real tracks:** folder import, tags, the analyser (BPM / key / beat grid / waveform, already written in
  `native/`) called from the app and cached; then key lock, Pad FX, slip and Smart Fader in the engine; export copies
  audio files.
- **Then — streaming:** Spotify is out (its terms forbid mixing; DJ access is partner-only). Candidates and limits:
  `docs/STREAMING-OPTIONS.md`.
