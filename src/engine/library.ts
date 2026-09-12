/** Pure library queries shared by the browser, the export screen and tests. */
import type { LibraryState, Playlist, Track } from './types.ts';

export const COLLECTION = 'collection';
/** Smart list "Favorites": rated 4 stars or more. */
export const FAVORITE_MIN_RATING = 4;
/** Smart list "Recently Added": added within this many days, newest first. */
export const RECENT_DAYS = 30;

export function playlistById(lib: Pick<LibraryState, 'playlists'>, id: string): Playlist | undefined {
  return lib.playlists.find((p) => p.id === id);
}

/** Tracks in a view ('collection' or a playlist id), before the search filter. */
export function tracksInView(lib: Pick<LibraryState, 'tracks' | 'playlists'>, view: string, now = Date.now()): Track[] {
  if (view === COLLECTION) return lib.tracks;
  const pl = playlistById(lib, view);
  if (!pl) return lib.tracks;
  if (pl.smart === 'favorites') return lib.tracks.filter((t) => t.rating >= FAVORITE_MIN_RATING);
  if (pl.smart === 'recent') {
    const since = now - RECENT_DAYS * 86_400_000;
    return lib.tracks.filter((t) => t.addedAt >= since).sort((a, b) => b.addedAt - a.addedAt);
  }
  return lib.tracks.filter((t) => t.playlists.includes(pl.id));
}

/** Case-insensitive match on title, artist, genre, key, BPM and comment; every word must match. */
export function searchTracks(tracks: readonly Track[], query: string): Track[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return tracks.slice();
  return tracks.filter((t) => {
    const hay = `${t.title} ${t.artist} ${t.genre} ${t.key} ${Math.round(t.bpm)} ${t.comment}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function viewName(lib: Pick<LibraryState, 'playlists'>, view: string): string {
  return view === COLLECTION ? 'Collection' : (playlistById(lib, view)?.name ?? 'Collection');
}
