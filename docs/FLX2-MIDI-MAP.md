# DDJ-FLX2 MIDI map (generated)

Generated from `src/midi/flx2Map.ts` — edit the table there, then run `node scripts/gen-midi-doc.ts`.

Source of truth: AlphaTheta *DDJ-FLX2 MIDI Message List* (E1). **PDF** = value read from the FLX2 list. **family** = the FLX2 list has the row; the value follows the DDJ-FLX4/DDJ-400 layout that the FLX2 matches everywhere it could be checked. **verify** = best reading, confirm with the MIDI monitor on the unit.

Channels are written 1-based here (MIDI ch 1 = status nibble 0).

## Deck buttons — status 9n (n = 0 deck 1, 1 deck 2), MIDI ch 1/2

| Control | Data1 | LED out | Source |
|---|---|---|---|
| PLAY/PAUSE | `0B` | `9n 0B 7F/00` | PDF |
| SHIFT + PLAY/PAUSE | `47` | `9n 47 7F/00` | PDF |
| CUE | `0C` | `9n 0C 7F/00` | PDF |
| SHIFT + CUE | `48` | `9n 48 7F/00` | PDF |
| BEAT SYNC | `58` | `9n 58 7F/00` | PDF |
| BEAT SYNC (long press) | `2A` | — | **verify** |
| SHIFT + BEAT SYNC (pad-mode select) | `5C` | — | **verify** |
| JOG touch | `36` | — | PDF |
| SHIFT + JOG touch | `67` | — | PDF |
| SHIFT | `3F` | — | PDF |
| HEADPHONE CUE (CH) | `54` | `9n 54 7F/00` | PDF |
| SHIFT + HEADPHONE CUE (CH) | `08` | — | **verify** |
| Fader start → PLAY | `66` | — | PDF |
| Fader start → SYNC | `5D` | — | PDF |
| Fader start → CUE | `52` | — | PDF |

## Deck 14-bit controls — status Bn, MSB then LSB

| Control | MSB | LSB | Range | Source |
|---|---|---|---|---|
| TEMPO | `00` | `20` | 0000 = "−" end … 3FFF = "+" end | PDF |
| EQ HI | `07` | `27` | 0000 … 3FFF | PDF |
| EQ MID | `0B` | `2B` | 0000 … 3FFF | PDF |
| EQ LOW | `0F` | `2F` | 0000 … 3FFF | PDF |
| CH FADER | `13` | `33` | 0000 … 3FFF | PDF |

## Jog wheels — status Bn, relative (40 = rest, 41+ clockwise, 3F− counter-clockwise)

| Surface | Data1 | Source |
|---|---|---|
| JOG platter (vinyl ON) | `22` | PDF |
| JOG platter (vinyl OFF) | `23` | PDF |
| SHIFT + JOG platter | `29` | PDF |
| JOG side ring | `21` | PDF |

## Global — MIDI ch 7 (status 96 / B6)

| Control | Message | LED out | Source |
|---|---|---|---|
| HEADPHONE CUE (MASTER) | `96 63` | `96 63 7F/00` | PDF |
| SHIFT + HEADPHONE CUE (MASTER) → Smart CFX | `96 00` | `96 00 7F/00` | **verify** |
| SMART FADER | `96 01` | `96 01 7F/00` | hardware |
| SHIFT + SMART FADER | `96 09` | `96 09 7F/00` | **verify** |
| CFX (CH 1) | `B6 17` / `B6 37` (14-bit) | — | PDF |
| CFX (CH 2) | `B6 18` / `B6 38` (14-bit) | — | PDF |
| CROSSFADER | `B6 1F` / `B6 3F` (14-bit) | — | family |
| MASTER LEVEL | ch 7 14-bit CC — number bound with MIDI Learn | — | **verify** |
| HEADPHONES LEVEL | ch 7 14-bit CC — number bound with MIDI Learn | — | **verify** |

## Performance pads

Deck 1: MIDI ch 8 (status `97`), SHIFT ch 9 (`98`). Deck 2: ch 10 (`99`), SHIFT ch 11 (`9A`). LEDs echo the same status/data1.

| Firmware pad mode (SHIFT + BEAT SYNC, then pad) | Pads 1–8 data1 |
|---|---|
| 1 · hotcue | `00`–`07` |
| 2 · padfx | `10`–`17` |
| 3 · beatloop | `60`–`67` |
| 4 · sampler | `30`–`37` |

## Software → unit (MIDI-OUT)

| Purpose | Bytes |
|---|---|
| Vinyl mode ON, deck 1 / deck 2 (sent at init; can't be set on the unit) | `90 17 7F` / `91 17 7F` |
| Track load illumination, deck 1 / deck 2 | `9F 00 7F` / `9F 01 7F` |
| Optional status-dump request (may be ignored) | `F0 00 20 7F 03 01 F7` |
| Button/pad LEDs | same status + data1 as the input, data2 `7F` on / `00` off |

## Where this differs from the original project brief

The brief asked for the PDF to win. These brief values did not match the FLX2 list and were corrected:

- PLAY/PAUSE is `9n 0B` (SHIFT `47`); CUE is `9n 0C` (SHIFT `48`). The brief had PLAY `47` / SHIFT `0C`, i.e. the SHIFT layer.
- BEAT SYNC press is `9n 58` (LED `58`). `2A` is the long-press row and `5C` the SHIFT row.
- Jog platter is `22` with vinyl ON, `23` with vinyl OFF; `29` is SHIFT + platter (search), not the normal platter.
- Tempo is 14-bit `Bn 00` / `Bn 20` (MSB 0 / LSB 32 decimal) — the "CC 32" in the brief is the LSB.
- MIDI ch 16 is only used for the track-load illumination (`9F 00/01 7F`); every other LED echoes on its input channel.

Rows still marked **verify**: order of SYNC long-press vs SHIFT (`2A`/`5C`), SHIFT + CH CUE (`08`), `96 00/01/09` (Smart CFX / Smart Fader layer), MASTER LEVEL and HEADPHONES LEVEL numbers. Turn each one on the unit with the MIDI monitor open — unmapped messages show in red.
