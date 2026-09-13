// Regenerates docs/FLX2-MIDI-MAP.md from src/midi/flx2Map.ts so the doc can never drift.
//   node scripts/gen-midi-doc.ts
import { writeFileSync } from 'node:fs';
import {
  DECK_CC14,
  DECK_JOG,
  DECK_NOTES,
  GLOBAL_CC14,
  GLOBAL_NOTES,
  OUT,
  PAD_CH,
  PAD_MODE_BASE,
  PAD_MODES,
} from '../src/midi/flx2Map.ts';

const h = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
const badge = (c: string) => (c === 'hardware' ? 'hardware' : c === 'pdf' ? 'PDF' : c === 'family' ? 'family' : '**verify**');
const lines: string[] = [];
const p = (s = '') => lines.push(s);

p('# DDJ-FLX2 MIDI map (generated)');
p();
p('Generated from `src/midi/flx2Map.ts` — edit the table there, then run `node scripts/gen-midi-doc.ts`.');
p();
p('Source of truth: AlphaTheta *DDJ-FLX2 MIDI Message List* (E1). **PDF** = value read from the FLX2 list. **family** = the FLX2 list has the row; the value follows the DDJ-FLX4/DDJ-400 layout that the FLX2 matches everywhere it could be checked. **verify** = best reading, confirm with the MIDI monitor on the unit.');
p();
p('Channels are written 1-based here (MIDI ch 1 = status nibble 0).');
p();
p('## Deck buttons — status 9n (n = 0 deck 1, 1 deck 2), MIDI ch 1/2');
p();
p('| Control | Data1 | LED out | Source |');
p('|---|---|---|---|');
for (const r of DECK_NOTES) p(`| ${r.label} | \`${h(r.data1)}\` | ${r.led ? `\`9n ${h(r.data1)} 7F/00\`` : '—'} | ${badge(r.confidence)} |`);
p();
p('## Deck 14-bit controls — status Bn, MSB then LSB');
p();
p('| Control | MSB | LSB | Range | Source |');
p('|---|---|---|---|---|');
for (const r of DECK_CC14) p(`| ${r.label} | \`${h(r.msb)}\` | \`${h(r.lsb)}\` | ${r.id === 'tempo' ? '0000 = "−" end … 3FFF = "+" end' : '0000 … 3FFF'} | ${badge(r.confidence)} |`);
p();
p('## Jog wheels — status Bn, relative (40 = rest, 41+ clockwise, 3F− counter-clockwise)');
p();
p('| Surface | Data1 | Source |');
p('|---|---|---|');
for (const r of DECK_JOG) p(`| ${r.label} | \`${h(r.data1)}\` | ${badge(r.confidence)} |`);
p();
p('## Global — MIDI ch 7 (status 96 / B6)');
p();
p('| Control | Message | LED out | Source |');
p('|---|---|---|---|');
for (const r of GLOBAL_NOTES) p(`| ${r.label} | \`96 ${h(r.data1)}\` | ${r.led ? `\`96 ${h(r.data1)} 7F/00\`` : '—'} | ${badge(r.confidence)} |`);
for (const r of GLOBAL_CC14) p(`| ${r.label} | \`B6 ${h(r.msb)}\` / \`B6 ${h(r.lsb)}\` (14-bit) | — | ${badge(r.confidence)} |`);
p('| MASTER LEVEL | ch 7 14-bit CC — number bound with MIDI Learn | — | **verify** |');
p('| HEADPHONES LEVEL | ch 7 14-bit CC — number bound with MIDI Learn | — | **verify** |');
p();
p('## Performance pads');
p();
p(`Deck 1: MIDI ch ${PAD_CH[0].normal + 1} (status \`${h(0x90 | PAD_CH[0].normal)}\`), SHIFT ch ${PAD_CH[0].shift + 1} (\`${h(0x90 | PAD_CH[0].shift)}\`). Deck 2: ch ${PAD_CH[1].normal + 1} (\`${h(0x90 | PAD_CH[1].normal)}\`), SHIFT ch ${PAD_CH[1].shift + 1} (\`${h(0x90 | PAD_CH[1].shift)}\`). LEDs echo the same status/data1.`);
p();
p('| Firmware pad mode (SHIFT + BEAT SYNC, then pad) | Pads 1–8 data1 |');
p('|---|---|');
PAD_MODES.forEach((m, i) => p(`| ${i + 1} · ${m} | \`${h(PAD_MODE_BASE[m])}\`–\`${h(PAD_MODE_BASE[m] + 7)}\` |`));
p();
p('## Software → unit (MIDI-OUT)');
p();
p('| Purpose | Bytes |');
p('|---|---|');
p(`| Vinyl mode ON, deck 1 / deck 2 (sent at init; can't be set on the unit) | \`${OUT.vinyl(0, true).map(h).join(' ')}\` / \`${OUT.vinyl(1, true).map(h).join(' ')}\` |`);
p(`| Track load illumination, deck 1 / deck 2 | \`${OUT.loaded(0).map(h).join(' ')}\` / \`${OUT.loaded(1).map(h).join(' ')}\` |`);
p(`| Optional status-dump request (may be ignored) | \`${OUT.statusDumpSysex.map(h).join(' ')}\` |`);
p('| Button/pad LEDs | same status + data1 as the input, data2 `7F` on / `00` off |');
p();
p('## Where this differs from the original project brief');
p();
p('The brief asked for the PDF to win. These brief values did not match the FLX2 list and were corrected:');
p();
p('- PLAY/PAUSE is `9n 0B` (SHIFT `47`); CUE is `9n 0C` (SHIFT `48`). The brief had PLAY `47` / SHIFT `0C`, i.e. the SHIFT layer.');
p('- BEAT SYNC press is `9n 58` (LED `58`). `2A` is the long-press row and `5C` the SHIFT row.');
p('- Jog platter is `22` with vinyl ON, `23` with vinyl OFF; `29` is SHIFT + platter (search), not the normal platter.');
p('- Tempo is 14-bit `Bn 00` / `Bn 20` (MSB 0 / LSB 32 decimal) — the "CC 32" in the brief is the LSB.');
p('- MIDI ch 16 is only used for the track-load illumination (`9F 00/01 7F`); every other LED echoes on its input channel.');
p();
p('Rows still marked **verify**: order of SYNC long-press vs SHIFT (`2A`/`5C`), SHIFT + CH CUE (`08`), `96 00/01/09` (Smart CFX / Smart Fader layer), MASTER LEVEL and HEADPHONES LEVEL numbers. Turn each one on the unit with the MIDI monitor open — unmapped messages show in red.');
writeFileSync(new URL('../docs/FLX2-MIDI-MAP.md', import.meta.url), lines.join('\n') + '\n');
console.log('docs/FLX2-MIDI-MAP.md written');
