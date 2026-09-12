/**
 * Local persistence for preferences and library edits (ratings, comments, playlists, hot cues).
 * localStorage for now — the slice-2 library moves this to IndexedDB (browser) / files (desktop).
 * Every access is guarded: storage can be unavailable (private window, blocked site data).
 */
import type { EngineState, Prefs, TrackEdits } from '../engine/types.ts';

const KEY = 'rekordfox.state.v1';

export interface Saved {
  prefs?: Partial<Prefs>;
  tracks?: Record<string, TrackEdits>;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSaved(storage: StorageLike | undefined = globalThis.localStorage): Saved {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Saved;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function snapshot(s: EngineState): Saved {
  const tracks: Record<string, TrackEdits> = {};
  for (const t of s.library.tracks) {
    tracks[t.id] = { rating: t.rating, comment: t.comment, playlists: t.playlists, cues: t.cues ?? [] };
  }
  return { prefs: s.prefs, tracks };
}

export function save(s: EngineState, storage: StorageLike | undefined = globalThis.localStorage): boolean {
  try {
    storage?.setItem(KEY, JSON.stringify(snapshot(s)));
    return true;
  } catch {
    return false;
  }
}

/** Sanitize saved prefs against the current shape so a stale or edited file can't break boot. */
export function mergePrefs(base: Prefs, saved: Partial<Prefs> | undefined): Prefs {
  if (!saved || typeof saved !== 'object') return base;
  const out = { ...base };
  if (saved.waveStyle && ['deck', 'rgb', '3band', 'blue'].includes(saved.waveStyle)) out.waveStyle = saved.waveStyle;
  if (saved.defaultTempoRange && [6, 10, 16].includes(saved.defaultTempoRange)) out.defaultTempoRange = saved.defaultTempoRange;
  if (typeof saved.defaultQuantize === 'boolean') out.defaultQuantize = saved.defaultQuantize;
  if (typeof saved.needleLock === 'boolean') out.needleLock = saved.needleLock;
  if (saved.faderStart && ['smart', 'always', 'off'].includes(saved.faderStart)) out.faderStart = saved.faderStart;
  if (typeof saved.statusDump === 'boolean') out.statusDump = saved.statusDump;
  return out;
}
