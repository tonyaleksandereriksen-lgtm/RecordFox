// Writes a test track: 48 kHz stereo 16-bit WAV, 120 BPM clicks (a thump on the downbeat) over a
// soft tone that steps up 5 Hz every bar. Used by the M1 check and handy for listening tests.
//   node scripts/make-test-wav.mjs [out.wav] [seconds]
import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'rekordfox-test-120bpm.wav';
const seconds = Number(process.argv[3] ?? 120);
const rate = 48000;
const frames = Math.floor(seconds * rate);
const bpm = 120;
const beat = 60 / bpm;
const data = Buffer.alloc(frames * 4);

for (let i = 0; i < frames; i += 1) {
  const t = i / rate;
  const beatIndex = Math.floor(t / beat);
  const inBeat = t - beatIndex * beat;
  const bar = Math.floor(beatIndex / 4);
  const downbeat = beatIndex % 4 === 0;
  // click: 8 ms burst, 1.5 kHz (or 90 Hz thump on the downbeat)
  const click = inBeat < 0.008 ? Math.sin(2 * Math.PI * (downbeat ? 90 : 1500) * inBeat) * (1 - inBeat / 0.008) * (downbeat ? 0.6 : 0.35) : 0;
  const tone = Math.sin(2 * Math.PI * (220 + 5 * bar) * t) * 0.12;
  const fade = Math.min(1, t / 0.02, (seconds - t) / 0.5);
  const v = Math.max(-1, Math.min(1, (click + tone) * fade));
  const s = Math.round(v * 32767);
  data.writeInt16LE(s, i * 4);
  data.writeInt16LE(s, i * 4 + 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
writeFileSync(out, Buffer.concat([header, data]));
console.log(`${out}: ${seconds} s, ${bpm} BPM, ${rate} Hz stereo`);
