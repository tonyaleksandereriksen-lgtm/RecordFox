/**
 * Identity and naming for local files. The library controller (src/library/) turns a described
 * file into a Track; these two helpers are the parts that must never change, because the id keys
 * the analysis cache and the saved edits.
 */

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
