/**
 * Local files in the library (M1: pick files; M2 adds folders, tags and analysis). A file becomes
 * a `Track` with what its headers say — duration — and a title from its name. BPM stays 0 and the
 * key "" until analysed.
 */
import type { EngineAction } from '../engine/actions.ts';
import type { Track } from '../engine/types.ts';
import { hostErrorMessage, type AudioHost, type ProbeInfo } from './host.ts';

/** FNV-1a over the path: a stable id that survives restarts without storing a counter. */
export function localTrackId(path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `local:${h.toString(16).padStart(8, '0')}`;
}

/** "Artist - Title.mp3" → artist + title; anything else is the file name as the title. */
export function titleFromPath(path: string): { title: string; artist: string } {
  const base = path.split(/[\\/]/).pop() ?? path;
  const stem = base.replace(/\.[^.]+$/, '');
  const m = /^(.+?)\s+-\s+(.+)$/.exec(stem);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: stem, artist: '' };
}

export function localTrack(path: string, probe: ProbeInfo, now = Date.now()): Track {
  const id = localTrackId(path);
  const seed = parseInt(id.slice(6), 16) || 1;
  return {
    id,
    ...titleFromPath(path),
    genre: '',
    bpm: 0,
    key: '',
    durationSec: Math.max(0, probe.lengthSeconds),
    firstBeatSec: 0,
    hue: seed % 360,
    seed,
    source: 'local',
    path,
    rating: 0,
    comment: '',
    playlists: [],
    addedAt: now,
  };
}

export interface AddResult {
  tracks: Track[];
  failed: { path: string; error: string }[];
}

/** Lets the user pick files, probes each through the engine, and returns the tracks to add. */
export async function pickLocalFiles(host: AudioHost): Promise<AddResult> {
  const paths = await host.pickFiles();
  const out: AddResult = { tracks: [], failed: [] };
  for (const path of paths) {
    try {
      out.tracks.push(localTrack(path, await host.probe(path)));
    } catch (e) {
      out.failed.push({ path, error: hostErrorMessage(e) });
    }
  }
  return out;
}

/** The actions that put a pick into the library, with a toast that says what happened. */
export function addActions(r: AddResult): EngineAction[] {
  const actions: EngineAction[] = [];
  if (r.tracks.length) actions.push({ type: 'library/add', tracks: r.tracks });
  if (r.failed.length) {
    const first = r.failed[0];
    actions.push({ type: 'ui/toast', text: `${r.failed.length} file${r.failed.length === 1 ? '' : 's'} could not be read — ${first.path.split(/[\\/]/).pop()}: ${first.error}`, tone: 'warn' });
  } else if (r.tracks.length) {
    actions.push({ type: 'ui/toast', text: `Added ${r.tracks.length} track${r.tracks.length === 1 ? '' : 's'}`, tone: 'ok' });
  }
  return actions;
}
