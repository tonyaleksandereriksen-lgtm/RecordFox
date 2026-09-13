/**
 * Local persistence for preferences and library edits (ratings, comments, playlists, hot cues).
 * localStorage for now — the slice-2 library moves this to IndexedDB (browser) / files (desktop).
 * Every access is guarded: storage can be unavailable (private window, blocked site data).
 */
import type { EngineState, Prefs, Track, TrackEdits } from '../engine/types.ts';

const KEY = 'rekordfox.state.v1';

export interface Saved {
  prefs?: Partial<Prefs>;
  tracks?: Record<string, TrackEdits>;
  /** Local files in the library, full records (analysis included). */
  local?: Track[];
  /** Music folders added on this machine. */
  folders?: string[];
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
    const edits: TrackEdits = { rating: t.rating, comment: t.comment, playlists: t.playlists, cues: t.cues ?? [] };
    // Only a grid the DJ corrected is worth saving; an untouched one comes back from analysis.
    if (t.bpmOriginal !== undefined) {
      edits.bpm = t.bpm;
      edits.firstBeatSec = t.firstBeatSec;
    }
    tracks[t.id] = edits;
  }
  const local = s.library.tracks.filter((t) => t.source === 'local' && typeof t.path === 'string');
  const out: Saved = { prefs: s.prefs, tracks };
  if (local.length) out.local = local;
  if (s.library.folders.length) out.folders = s.library.folders;
  return out;
}

export function savedFolders(saved: Saved): string[] {
  return Array.isArray(saved.folders) ? saved.folders.filter((f): f is string => typeof f === 'string' && f.length > 0) : [];
}

/** Local tracks from a saved snapshot, keeping only records that still look like tracks. */
export function savedLocalTracks(saved: Saved): Track[] {
  if (!Array.isArray(saved.local)) return [];
  return saved.local.filter(
    (t): t is Track =>
      !!t && typeof t === 'object' && typeof t.id === 'string' && typeof t.path === 'string' && typeof t.title === 'string' && typeof t.durationSec === 'number' && t.source === 'local',
  );
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
  if (saved.audioDevice === null || typeof saved.audioDevice === 'string') out.audioDevice = saved.audioDevice;
  return out;
}
