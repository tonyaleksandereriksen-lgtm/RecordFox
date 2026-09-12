# Audit — slice 1 (2026-09-11)

Published report: "RecordFox Slice 1 Audit" (claude.ai artifact). This file is the agent-readable copy.
Method: full source read; 8 scratch probes (source unchanged) that reproduce each suspected bug; layout + frame-rate
measurements in headless Chromium; UI type-check against the React 19.3 types in node_modules (clean, except L2).

## Critical
- **C1 No audio.** Deliverable 3 (2 decks → mixer → FLX2 outputs) not started; mixer/FX are state only.
- **C2 Library/monitor unreachable on laptop screens.** Bottom dock starts at y=648 px at 1366×657 and 1280×680; body overflow hidden; 1600×900 clips 13 px. Cause: fixed grid minimums (~838 px). Fix: flexible rows, resizable/collapsible dock, compact deck below ~760 px height.
- **C3 Spotify mixing can't be built.** Spotify Developer Policy §III forbids mixing/overlapping Spotify content; the Sept 2025 DJ integration is partner-only (rekordbox/Serato/djay); Web Playback SDK audio is DRM'd; audio-features/analysis closed to new apps since Nov 2024. Re-scope slice 3.
- **C4 No hardware test yet.** Verify rows 2A/5C, 08, 96 00/01/09, master/phones CCs; assumptions: pads ch 8–11, 720 ticks/rev, fader-start semantics.

## High
- **H1 Fader-start CUE (9n 52 7F) always stops a playing deck** (probe P2, Smart Fader off). Gate behind Smart Fader / a setting until verified.
- **H2 Loading onto a stopped master retargets a playing synced deck** (P8: 124.00 → 132.00 BPM). Hand master to the playing deck and bake its tempo.
- **H3 First-touch adopt jumps a playing deck** (P3: rate 1.000 → 1.070). Adopt only when stopped/silent or right after connect; else pickup; use status dump if the unit answers.
- **H4 MIDI monitor starves the main thread.** Library tab 59 fps / 1146 msg/s vs Monitor 42 fps / 294 msg/s; at 4× CPU throttle 36/266 vs 12/96. Engine path is 5.1 µs/msg → React rendering. Fix: ~10 fps log, virtualized rows, pause when hidden, coalesce jog per frame.
- **H5 Browser audio path latency / 4-ch output unproven** (WASAPI shared only, no exclusive/ASIO). Spike: measure baseLatency+outputLatency and destination.maxChannelCount on the FLX2; go native if needed before slice 2.
- **H6 No git.** git init + commit.
- **H7 start.bat serves a stale Bun-built dist/; stray dependency `run` 2.1.4** (vercel-labs QuickJS runtime) in package.json. `npm uninstall run`; build before serve or drop dist/.
- **H8 No persistence** (only MIDI learn). Storage layer in slice 2.

## Medium
- **M1** Sub-beat loops quantize to whole beats → ¼-beat loop jumps back 0.5 beat (P1). Quantize to the loop-length grid.
- **M2** SYNC long-press also toggles sync (P4). Decide after hardware check.
- **M3** Electron: never launched; no single-instance lock; no CSP; `media` permission too broad; app:// guard accepts sibling dirs (dist-x).
- **M4** No keyboard shortcuts/focus-visible/slider roles; muted labels 3.6–4.0:1 (<4.5); 20 rules at 9–10 px.
- **M5** Overview click seeks a playing track (no needle lock).
- **M6** Driver: overlapping start() → 2 MIDIAccess (P6); orphan LSB decodes as MSB 0 (P5: 0.0039); output loss undetected.
- **M7** UI far from the design vision (docs/design/vision-mockup.png) — see below.
- **M8** No settings screen.
- **M9** No UI/e2e tests or CI in repo.

## Low
L1 SHIFT+pad Pad FX → index 8–15 never lit (P7) · L2 TS6 rejects `import './theme/global.css'` — add src/vite-env.d.ts · L3 canvases don't re-scale on DPR change · L4 idle clock notifies 60×/s · L5 no pointercancel in drags · L6 status-dump SysEx untested — keep opt-in · L7 serve.mjs crashes if port 5199 is taken.

## Design vision (supersedes the brief's colour/radius rules)
Mockup: `docs/design/vision-mockup.png` (branded "VARRI — Sound Beyond").
Sampled palette: ground #03080E · panel #07111B · selected #0B243B · deck A #2FA6E3 · deck B #E39A4E · text #D2F1FE · secondary #95AEC1 · label #708B9E (5.6:1 on ground).
Changes: two deck colours only; 4–6 px corners + hairlines (circles only for transport/jog); light weights, wide-tracked uppercase labels; waveforms inside each deck (drop the top strip); library ≈ half height as tree | tracks | detail panel; top tabs (Performance/Library/Export/Settings); status footer; deck = 8 numbered cue squares, CUE/PLAY/SYNC, thin jog progress ring, SLIP, MT.
Keep for the FLX2: channel faders, CFX knobs, 4 pad modes (cue row relabels), PFL, Smart Fader/CFX states.
Open: brand (Fennec vs VARRI); Export tab scope (no USB export); "Link" = Ableton Link only (no Pro DJ Link).

## Order
1 Stabilise (git, remove `run`, C2, H4, H1, H2, H3, M1, M3 lock, L2, start.bat build) → 2 FLX2 hardware session + audio spike → 3 choose audio engine → 4 redesign to vision → 5 slice 2 audio + library + persistence + settings → 6 re-scope slice 3.

## Status — 0.2.0 (2026-09-11)
Fixed: **C2** (layout scales with window height; fits 1280×680 and 1366×657 with no scrolling, checked in headless Chromium) ·
**C3** re-scoped (Spotify dropped, see STREAMING-OPTIONS.md) · **H1** (fader start gated by a preference, default: only with Smart Fader) ·
**H2** (master hands over to the playing deck and bakes tempo) · **H3** (adopt only within 3 s of connect and only for stopped decks) ·
**H4** (monitor refreshes at 10 fps, virtualised rows; 720 msg/s stress → 60 fps, 20 DOM rows) · **H7** (start.bat builds first; `run` removed — run `npm install`) ·
**H8** partial (prefs + ratings/comments/playlists/hot cues saved in localStorage) · **M1** · **M3** (single instance, CSP header, audio-only media, strict app:// path check) ·
**M4** partial (focus-visible, slider roles + arrow keys on knobs/faders, keyboard on pads/CUE/library) · **M5** (needle lock, Shift overrides) ·
**M6** · **M7** (redesign to the vision) · **M8** (Settings: Controller, Audio check, Preferences, About) · **L1** · **L2** · **L5** · **L7**.
Open: C1 audio engine · C4 hardware session · H5 audio spike (tool built: Settings › Audio check — needs a run on the FLX2) · H6 git ·
M2 SYNC long-press · M4 small labels (9–10 px remain for uppercase labels) · M9 UI tests in repo · L3 DPR change · L4 idle clock · L6 status dump on hardware.

## Status — 0.3.0 (2026-09-12)
Fixed: **C1** (the native engine plays both decks through the FLX2 — WASAPI exclusive, 48 kHz, 4 ch, 4.00 ms; the audio
thread is the clock; `docs/m1-check-2026-09-13-600s.json` has the measurements) · **H6** (git, pushed to
github.com/tonyaleksandereriksen-lgtm/RecordFox) · **H5** (answered: 52 ms in the browser, 4 ms native — went native) ·
M6's "output loss undetected" now also covers audio: a frozen device callback is detected within 1.5 s and the output reopened once.
Open: C4 hardware session (M3) · M2 SYNC long-press · M4 small labels · M9 UI tests in repo (the M1 check script drives the real app; the
three-viewport layout check is still a manual script) · L3 DPR change · L4 idle clock · L6 status dump on hardware.
