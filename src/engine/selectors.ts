/** Pure derived values. Shared by the reducer, the UI and the LED writer. */
import type { DeckIndex, DeckState, EngineState, Track } from './types.ts';

export const JOG_TICKS_PER_REV = 720; // FLX-family jog resolution
export const PLATTER_RPM = 100 / 3; // 33⅓
export const SECONDS_PER_REV = 60 / PLATTER_RPM; // 1.8 s of audio per platter revolution
export const SCRATCH_SEC_PER_TICK = SECONDS_PER_REV / JOG_TICKS_PER_REV;
export const FINE_SEEK_SEC_PER_TICK = SCRATCH_SEC_PER_TICK;
export const SEARCH_SEC_PER_TICK = 0.1;
export const BEND_PER_TICK = 0.012;
export const BEND_DECAY_SEC = 0.12;
export const BEATLOOP_SIZES = [1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32] as const;
export const BEATJUMP_SIZES = [1, 2, 4, 8, 16, 32] as const;
export const TEMPO_RANGES = [6, 10, 16] as const;

/** BPM used for grid features (quantize, loops, beat jump): the analysed value, or 120 until analysed. */
export const UNANALYSED_BPM = 120;

export function gridBpm(track: Track): number {
  return track.bpm > 0 ? track.bpm : UNANALYSED_BPM;
}

export function beatLen(track: Track): number {
  return 60 / gridBpm(track);
}

export function tempoPct(d: DeckState): number {
  return d.tempoPos * d.tempoRange;
}

export function masterDeckIndex(s: EngineState): DeckIndex | null {
  if (s.decks[0].master && s.decks[0].track) return 0;
  if (s.decks[1].master && s.decks[1].track) return 1;
  return null;
}

/** BPM the deck plays at from its own tempo slider. */
export function ownBpm(d: DeckState): number {
  return d.track ? d.track.bpm * (1 + tempoPct(d) / 100) : 0;
}

/** Octave-aware match: 87 BPM follows 174, 128 follows 64. */
export function syncMultiplier(trackBpm: number, masterBpm: number): number {
  let best = 1;
  let err = Infinity;
  for (const k of [0.5, 1, 2]) {
    const e = Math.abs(masterBpm - trackBpm * k);
    if (e < err) {
      err = e;
      best = k;
    }
  }
  return best;
}

/** Playback rate without the transient jog bend. */
export function baseRate(s: EngineState, deck: DeckIndex): number {
  const d = s.decks[deck];
  if (!d.track) return 1;
  if (d.sync && !d.master && d.track.bpm > 0) {
    const m = masterDeckIndex(s);
    if (m !== null && m !== deck) {
      const mb = ownBpm(s.decks[m]);
      if (mb > 0) return mb / (d.track.bpm * syncMultiplier(d.track.bpm, mb));
    }
  }
  return 1 + tempoPct(d) / 100;
}

export function effectiveBpm(s: EngineState, deck: DeckIndex): number {
  const d = s.decks[deck];
  return d.track ? d.track.bpm * baseRate(s, deck) : 0;
}

/** Tempo change relative to the track's analysed BPM, in percent (what the deck displays). */
export function effectivePct(s: EngineState, deck: DeckIndex): number {
  return (baseRate(s, deck) - 1) * 100;
}

export function quantizeTime(d: DeckState, t: number): number {
  if (!d.quantize || !d.track) return t;
  const bl = beatLen(d.track);
  const q = d.track.firstBeatSec + Math.round((t - d.track.firstBeatSec) / bl) * bl;
  return Math.max(0, Math.min(d.track.durationSec, q));
}

export function beatPhase(track: Track, t: number): number {
  const x = (t - track.firstBeatSec) / beatLen(track);
  return x - Math.floor(x);
}

/** Beats until the next memory/hot cue — shown in the deck header like the hardware display. */
export function atCue(d: DeckState): boolean {
  return Math.abs(d.positionSec - d.cueSec) < 0.02;
}

export function remainingSec(d: DeckState): number {
  return d.track ? Math.max(0, d.track.durationSec - d.positionSec) : 0;
}

/** Camelot key → hue for colour-coding (neighbouring keys get neighbouring colours). */
export function camelotHue(key: string): number {
  const n = parseInt(key, 10);
  return Number.isFinite(n) ? ((n - 1) * 30 + 200) % 360 : 0;
}
