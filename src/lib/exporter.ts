/**
 * Export to a folder the user picks on disk: an extended M3U8 playlist plus a JSON cue sheet
 * (BPM, key, rating, comment, hot cues), and — in the desktop app — the audio files themselves,
 * copied next to them under the names the playlist uses. Pure builders here; the UI does the
 * folder picking and the main process does the writing.
 */
import type { Track } from '../engine/types.ts';

export interface ExportOptions {
  name: string;
  /** Folder-relative path each track is written as in the playlist. */
  pathFor?: (t: Track) => string;
}

// Characters Windows and macOS refuse in file names, plus ASCII control characters.
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;

export function safeFileName(name: string): string {
  const cleaned = name.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 80) || 'Playlist';
}

export function defaultPath(t: Track): string {
  return `${safeFileName(`${t.artist} - ${t.title}`)}.${fileExt(t)}`;
}

/** The track's own extension for a local file; demo tracks pretend to be mp3s. */
export function fileExt(t: Track): string {
  const m = t.path ? /\.([A-Za-z0-9]+)$/.exec(t.path) : null;
  return m ? m[1].toLowerCase() : 'mp3';
}

export interface CopyPlan {
  /** Folder-relative name each track is written as in the playlist and cue sheet. */
  pathFor: (t: Track) => string;
  /** Local files to copy, in playlist order. Demo tracks have nothing to copy. */
  copies: { from: string; to: string }[];
}

/**
 * Names for the copied audio: "Artist - Title.ext", made unique against what is already in the
 * folder and against each other ("(2)", "(3)"…), so an export never replaces a file.
 */
export function planCopies(tracks: readonly Track[], taken: Iterable<string>): CopyPlan {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const names = new Map<string, string>();
  const copies: { from: string; to: string }[] = [];
  for (const t of tracks) {
    if (names.has(t.id)) continue;
    const base = safeFileName(`${t.artist} - ${t.title}`);
    const ext = `.${fileExt(t)}`;
    let name = `${base}${ext}`;
    for (let n = 2; used.has(name.toLowerCase()) && n < 1000; n += 1) name = `${base} (${n})${ext}`;
    used.add(name.toLowerCase());
    names.set(t.id, name);
    if (t.source === 'local' && t.path) copies.push({ from: t.path, to: name });
  }
  return { pathFor: (t) => names.get(t.id) ?? defaultPath(t), copies };
}

export function buildM3u8(tracks: readonly Track[], opts: ExportOptions): string {
  const pathFor = opts.pathFor ?? defaultPath;
  const lines = ['#EXTM3U', `#PLAYLIST:${opts.name}`];
  for (const t of tracks) {
    lines.push(`#EXTINF:${Math.round(t.durationSec)},${t.artist} - ${t.title}`);
    lines.push(pathFor(t));
  }
  return lines.join('\r\n') + '\r\n';
}

export function buildCueSheet(tracks: readonly Track[], opts: ExportOptions & { exportedAt?: string; app: string }) {
  const pathFor = opts.pathFor ?? defaultPath;
  return {
    format: 'rekordfox.cuesheet',
    version: 1,
    app: opts.app,
    playlist: opts.name,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    tracks: tracks.map((t, i) => ({
      position: i + 1,
      file: pathFor(t),
      title: t.title,
      artist: t.artist,
      genre: t.genre,
      bpm: t.bpm,
      key: t.key,
      durationSec: t.durationSec,
      rating: t.rating,
      comment: t.comment,
      hotCues: (t.cues ?? [])
        .map((c, k) => (c === null || c === undefined ? null : { slot: String.fromCharCode(65 + k), sec: Math.round(c * 1000) / 1000 }))
        .filter((c): c is { slot: string; sec: number } => c !== null),
      source: t.source,
    })),
  };
}

export const PLAYLIST_EXT = '.m3u8';
export const CUESHEET_EXT = '.rekordfox.json';

/**
 * First free base name for a set of extensions: "Warm-up" → "Warm-up (2)" … so an export never
 * replaces files already in the folder. Case-insensitive, like Windows and macOS file systems.
 */
export function uniqueBase(base: string, exts: readonly string[], taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const free = (b: string) => exts.every((e) => !used.has(`${b}${e}`.toLowerCase()));
  if (free(base)) return base;
  for (let n = 2; n < 1000; n++) if (free(`${base} (${n})`)) return `${base} (${n})`;
  return `${base} (${Date.now()})`;
}

export interface ExportFile {
  name: string;
  type: string;
  text: string;
}

export function buildExportFiles(
  tracks: readonly Track[],
  opts: { name: string; app: string; base: string; playlist: boolean; cueSheet: boolean; exportedAt?: string; pathFor?: (t: Track) => string },
): ExportFile[] {
  const files: ExportFile[] = [];
  if (opts.playlist) files.push({ name: `${opts.base}${PLAYLIST_EXT}`, type: 'audio/x-mpegurl', text: buildM3u8(tracks, { name: opts.name, pathFor: opts.pathFor }) });
  if (opts.cueSheet) {
    const sheet = buildCueSheet(tracks, { name: opts.name, app: opts.app, exportedAt: opts.exportedAt, pathFor: opts.pathFor });
    files.push({ name: `${opts.base}${CUESHEET_EXT}`, type: 'application/json', text: JSON.stringify(sheet, null, 2) + '\n' });
  }
  return files;
}
