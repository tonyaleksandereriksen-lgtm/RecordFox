/**
 * Waveform data model (3 bands, 100 bins/s) and the demo generator.
 * The audio slice produces the same WaveformData from real analysis (band-split RMS).
 */
import { mulberry32 } from '../lib/prng.ts';
import { sectionBars } from './demoLibrary.ts';
import type { Track } from './types.ts';

export interface WaveformData {
  binsPerSec: number;
  length: number;
  low: Uint8Array;
  mid: Uint8Array;
  high: Uint8Array;
}

const cache = new Map<string, WaveformData>();
/** Real waveforms from analysis, by track id; the desktop shell fills this from its cache on demand. */
const real = new Map<string, WaveformData>();
let missing: ((track: Track) => void) | null = null;

/**
 * The waveform to draw for a track: the analysed one when it is here, else a generated one (demo
 * tracks) or an even placeholder (a local file whose analysis has not arrived). Asking for a local
 * track's missing waveform notifies the loader once, so the canvases just keep drawing.
 */
export function waveformFor(track: Track): WaveformData {
  const r = real.get(track.id);
  if (r) return r;
  let w = cache.get(track.id);
  if (!w) {
    w = track.source === 'local' ? placeholderWaveform(track) : generateDemoWaveform(track);
    cache.set(track.id, w);
  }
  if (track.source === 'local' && missing) missing(track);
  return w;
}

export function setWaveform(id: string, data: WaveformData): void {
  real.set(id, data);
  cache.delete(id);
}

export function hasWaveform(id: string): boolean {
  return real.has(id);
}

export function forgetWaveform(id: string): void {
  real.delete(id);
  cache.delete(id);
}

/** Registers the loader called for a local track that has no analysed waveform yet (at most once per call site's own dedupe). */
export function onWaveformMissing(fn: ((track: Track) => void) | null): void {
  missing = fn;
}

/** An even, quiet band for a local file whose analysis has not arrived, so the playhead has something to cross. */
export function placeholderWaveform(track: Track, binsPerSec = 100): WaveformData {
  const n = Math.max(1, Math.ceil(track.durationSec * binsPerSec));
  return { binsPerSec, length: n, low: new Uint8Array(n).fill(70), mid: new Uint8Array(n).fill(48), high: new Uint8Array(n).fill(30) };
}

/**
 * Decodes an `.rfxwave` file: low, mid, high bytes per bin, 100 bins a second, nothing else
 * (the analyser's own layout, see native/src/rfx_analyze.h). Returns null for an empty or odd-sized buffer.
 */
export function waveformFromBytes(bytes: Uint8Array, binsPerSec = 100): WaveformData | null {
  const n = Math.floor(bytes.length / 3);
  if (n === 0) return null;
  const low = new Uint8Array(n);
  const mid = new Uint8Array(n);
  const high = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    low[i] = bytes[i * 3];
    mid[i] = bytes[i * 3 + 1];
    high[i] = bytes[i * 3 + 2];
  }
  return { binsPerSec, length: n, low, mid, high };
}

export function generateDemoWaveform(track: Track, binsPerSec = 100): WaveformData {
  const n = Math.ceil(track.durationSec * binsPerSec);
  const low = new Uint8Array(n);
  const mid = new Uint8Array(n);
  const high = new Uint8Array(n);
  const rnd = mulberry32(track.seed);
  const beat = 60 / track.bpm;
  const bar = beat * 4;
  const secs = sectionBars(track);
  const sectionAt = (t: number) => {
    const b = (t - track.firstBeatSec) / bar;
    for (const s of secs) if (b >= s.start && b < s.start + s.bars) return s;
    return secs[secs.length - 1];
  };
  let smooth = 0;
  for (let i = 0; i < n; i++) {
    const t = i / binsPerSec;
    const sec = sectionAt(t);
    const e = sec.energy;
    const beats = (t - track.firstBeatSec) / beat;
    const ph = beats - Math.floor(beats);
    const beatInBar = Math.floor(beats) % 4;
    const barPos = ((t - track.firstBeatSec) / bar) - sec.start;
    const riser = sec.name === 'build' ? Math.min(1, barPos / sec.bars) : 0;
    smooth = smooth * 0.96 + rnd() * 0.04;

    const kick = sec.kick && t >= track.firstBeatSec ? Math.exp(-ph * 13) : 0;
    const bass = e * (ph > 0.45 && ph < 0.92 ? 0.42 : 0.12) * (sec.kick ? 1 : 0.35);
    const clap = beatInBar % 2 === 1 ? Math.exp(-ph * 9) * 0.55 * e : 0;
    const hat = Math.exp(-Math.abs(ph - 0.5) * 22) * (0.35 + 0.45 * e);
    const pad = sec.name === 'break' ? 0.5 + 0.2 * Math.sin((t / bar) * Math.PI) : 0.18;

    let l = kick * 0.92 + bass + smooth * 0.06;
    let m = 0.14 + pad * 0.6 + clap + e * 0.22 * (0.7 + 0.3 * Math.sin(t * 1.7)) + rnd() * 0.06 + riser * 0.25;
    let h = hat * (sec.name === 'intro' && barPos < 4 ? 0.3 : 1) + clap * 0.5 + rnd() * 0.08 + riser * 0.45;

    const fade = Math.min(1, t / 0.4, (track.durationSec - t) / 1.5);
    l *= fade;
    m *= fade;
    h *= fade;
    low[i] = Math.max(0, Math.min(255, Math.round(l * 235)));
    mid[i] = Math.max(0, Math.min(255, Math.round(m * 200)));
    high[i] = Math.max(0, Math.min(255, Math.round(h * 190)));
  }
  return { binsPerSec, length: n, low, mid, high };
}

/** Level 0..1 at a position — drives the demo VU meters until real audio arrives. */
export function levelAt(w: WaveformData, t: number): number {
  const i = Math.max(0, Math.min(w.length - 1, Math.floor(t * w.binsPerSec)));
  return Math.min(1, (w.low[i] * 0.55 + w.mid[i] * 0.3 + w.high[i] * 0.15) / 190);
}
