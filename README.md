# RekordFox — two-deck performance DJ app for the DDJ-FLX2

A rekordbox-style Performance layout (2 decks, mixer, waveforms, library) driven by an AlphaTheta **DDJ-FLX2** over
plain USB **MIDI** — no WebHID, no CDJ/Pro DJ Link handshake, no official certification. *Dig. Cue. Mix.*

**Status: 0.2.0** — FLX2 MIDI driver, redesigned Performance / Library / Export / Settings screens, MIDI monitor,
virtual controller, audio check, export to a folder, saved preferences and track edits. The audio engine is next.
Tracks in the library are demo entries with generated waveforms and artwork, so decks, jog, waveforms and LEDs are
alive before real audio exists.

## Run it

You need **Node.js 22.18+** and **Chrome or Edge** (they have Web MIDI). Close rekordbox / Serato / Mixxx first —
on Windows a MIDI port can only be open in one app.

**After updating from 0.1:** run `npm install` once — it removes the stray `run` package and picks up the new name.

| What | How |
|---|---|
| Browser | double-click **`start.bat`** — rebuilds (when the dev tools are installed), serves `dist/` and opens Chrome/Edge as an app window. Click **Connect FLX2** and allow MIDI. If port 5199 is busy it reuses a running RekordFox or picks the next port. |
| Desktop app (Electron) | double-click **`start-desktop.bat`** — installs once, rebuilds, opens the desktop window. MIDI connects automatically (SysEx allowed). |
| Develop | **`dev.bat`** or `npm run dev` (Vite, hot reload); `npm run app:dev` (Electron + Vite). |
| Tests | `npm test` — 94 tests: decoder, Web MIDI port handling, soft takeover, engine, LED echo, library, persistence, export. |
| Type-check | `npm run typecheck` |

## Screens

- **Performance** — Deck A | mixer | Deck B, with the Library, MIDI Monitor and Virtual FLX2 underneath. Fits a
  1280×680 laptop window; larger windows get bigger waveforms and jogs.
- **Library** — full-height browser (collection, playlists, smart lists Favorites / Recently Added), ratings,
  comments, playlist membership, hot cues. Drag a row onto a deck, use the **A / B** buttons, double-click, or press Enter.
- **Export** — pick a list and a folder (any drive, including a USB stick): writes an `.m3u8` playlist and a
  `.rekordfox.json` cue sheet (BPM, key, rating, comments, hot cues A–H). Existing files are never replaced —
  a number is added instead. Audio files are copied once real tracks can be added.
- **Settings** — Controller (connection, init sequence, MIDI learn), **Audio check**, Preferences, About.

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
  audio/                device probe + audio check (latency, 4-channel test, PLAY-to-sound probe)
  lib/                  store, persistence (localStorage), exporter (m3u8 + cue sheet)
  runtime.ts            wires store ↔ driver ↔ bindings ↔ LED writer ↔ clock ↔ persistence
  ui/                   React: performance/, deck/, mixer/, library/, export/, settings/, monitor/, virtual/
electron/               desktop shell (app:// secure context, CSP, single instance, MIDI + SysEx permissions)
docs/                   FLX2 MIDI map, audit, streaming options, design vision
tests/                  node:test suites
```

## Roadmap

- **Next — audio engine:** decided by the audio-check result. 2 decks → gain/EQ/CFX/fader/crossfader → master +
  cue, output to *DDJ-FLX2 Audio Out* (master 1/2, phones 3/4) with laptop fallback; local files; BPM/key/beatgrid
  analysis and waveform cache; real meters; Smart Fader; Pad FX; export copies audio files.
- **Then — streaming:** Spotify is out (its terms forbid mixing; DJ access is partner-only). Candidates and limits:
  `docs/STREAMING-OPTIONS.md`.
