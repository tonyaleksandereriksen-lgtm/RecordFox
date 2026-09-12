import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EngineAction } from '../src/engine/actions.ts';
import { DEFAULT_PREFS, initialState } from '../src/engine/initialState.ts';
import { reduce } from '../src/engine/reducer.ts';
import type { EngineState } from '../src/engine/types.ts';
import { DEMO_PLAYLISTS, buildDemoTracks } from '../src/engine/demoLibrary.ts';
import { COLLECTION, searchTracks, tracksInView, viewName } from '../src/engine/library.ts';
import { buildCueSheet, buildExportFiles, buildM3u8, safeFileName, uniqueBase } from '../src/lib/exporter.ts';
import { loadSaved, mergePrefs, save, snapshot } from '../src/lib/persist.ts';

const run = (s: EngineState, ...a: EngineAction[]) => a.reduce(reduce, s);

class MemStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('library edits', () => {
  it('rates, comments and toggles playlist membership (not smart lists)', () => {
    let s = run(initialState(), { type: 'library/rate', trackId: 'demo-3', rating: 7 }, { type: 'library/comment', trackId: 'demo-3', comment: 'Peak' });
    const t = s.library.tracks.find((x) => x.id === 'demo-3')!;
    assert.equal(t.rating, 5);
    assert.equal(t.comment, 'Peak');
    const had = t.playlists.includes('pl-after');
    s = run(s, { type: 'library/togglePlaylist', trackId: 'demo-3', playlistId: 'pl-after' });
    assert.equal(s.library.tracks.find((x) => x.id === 'demo-3')!.playlists.includes('pl-after'), !had);
    const s2 = run(s, { type: 'library/togglePlaylist', trackId: 'demo-3', playlistId: 'smart-favorites' });
    assert.equal(s2, s);
  });

  it('hot cues set on a deck are stored on the track and come back on the next load', () => {
    let s = run(initialState(), { type: 'deck/load', deck: 0, trackId: 'demo-5' }, { type: 'deck/seek', deck: 0, positionSec: 100 });
    s = run(s, { type: 'deck/hotCue', deck: 0, index: 7, pressed: true }, { type: 'deck/hotCue', deck: 0, index: 7, pressed: false });
    const cue = s.library.tracks.find((t) => t.id === 'demo-5')!.cues![7];
    assert.ok(typeof cue === 'number');
    s = run(s, { type: 'deck/load', deck: 1, trackId: 'demo-5' });
    assert.equal(s.decks[1].hotCues[7]?.posSec, cue);
  });
});

describe('persistence', () => {
  it('round-trips prefs and track edits', () => {
    const mem = new MemStorage();
    let s = run(initialState(), { type: 'library/rate', trackId: 'demo-2', rating: 1 }, { type: 'prefs/set', patch: { waveStyle: 'rgb', needleLock: false } });
    assert.equal(save(s, mem), true);
    const saved = loadSaved(mem);
    const prefs = mergePrefs(DEFAULT_PREFS, saved.prefs);
    assert.equal(prefs.waveStyle, 'rgb');
    assert.equal(prefs.needleLock, false);
    s = run(initialState(prefs), { type: 'library/hydrate', edits: saved.tracks! });
    assert.equal(s.library.tracks.find((t) => t.id === 'demo-2')!.rating, 1);
  });

  it('ignores junk in saved data', () => {
    const prefs = mergePrefs(DEFAULT_PREFS, { waveStyle: 'neon' as never, defaultTempoRange: 7 as never, faderStart: 'yes' as never });
    assert.deepEqual(prefs, DEFAULT_PREFS);
    const s = run(initialState(), { type: 'library/hydrate', edits: { 'demo-1': { rating: 99, playlists: ['nope', 'pl-peak'], cues: ['x' as never, 12] }, ghost: { rating: 3 } } });
    const t = s.library.tracks.find((x) => x.id === 'demo-1')!;
    assert.equal(t.rating, 5);
    assert.deepEqual(t.playlists, ['pl-peak']);
    assert.deepEqual(t.cues, [null, 12]);
    const mem = new MemStorage();
    mem.setItem('rekordfox.state.v1', '{broken');
    assert.deepEqual(loadSaved(mem), {});
    assert.ok(snapshot(s).tracks!['demo-1']);
  });
});

describe('export builders', () => {
  const tracks = initialState().library.tracks.slice(0, 3);
  it('writes an extended M3U8 with durations and titles', () => {
    const m3u = buildM3u8(tracks, { name: 'Warm-up' });
    const lines = m3u.trim().split('\r\n');
    assert.equal(lines[0], '#EXTM3U');
    assert.equal(lines[1], '#PLAYLIST:Warm-up');
    assert.match(lines[2], /^#EXTINF:372,Kit Ferro - Neon Harbor$/);
    assert.equal(lines[3], 'Kit Ferro - Neon Harbor.mp3');
    assert.equal(lines.length, 2 + tracks.length * 2);
  });
  it('writes a cue sheet with lettered hot cues', () => {
    const sheet = buildCueSheet(tracks, { name: 'Warm-up', app: 'RekordFox 0.2.0', exportedAt: '2026-09-11T00:00:00Z' });
    assert.equal(sheet.tracks.length, 3);
    assert.equal(sheet.tracks[0].hotCues[0].slot, 'A');
    assert.equal(sheet.tracks[0].key, '8A');
  });
  it('makes file names safe on Windows and macOS', () => {
    assert.equal(safeFileName('AC/DC: Live? <1991>'), 'AC DC Live 1991');
    assert.equal(safeFileName('   '), 'Playlist');
  });
});

describe('library views', () => {
  const lib = { tracks: buildDemoTracks(Date.UTC(2026, 8, 11)), playlists: DEMO_PLAYLISTS };
  const now = Date.UTC(2026, 8, 11);
  it('collection returns every track', () => {
    assert.equal(tracksInView(lib, COLLECTION, now).length, lib.tracks.length);
  });
  it('playlists filter by membership', () => {
    const rows = tracksInView(lib, 'pl-peak', now);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((t) => t.playlists.includes('pl-peak')));
  });
  it('favorites = rating 4 and up', () => {
    const rows = tracksInView(lib, 'smart-favorites', now);
    assert.deepEqual(rows.map((t) => t.rating).every((r) => r >= 4), true);
    assert.equal(rows.length, lib.tracks.filter((t) => t.rating >= 4).length);
  });
  it('recently added = last 30 days, newest first', () => {
    const rows = tracksInView(lib, 'smart-recent', now);
    assert.ok(rows.length > 0);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].addedAt >= rows[i].addedAt);
    const old = { ...lib, tracks: lib.tracks.map((t) => ({ ...t, addedAt: now - 90 * 86_400_000 })) };
    assert.equal(tracksInView(old, 'smart-recent', now).length, 0);
  });
  it('search matches every word across fields', () => {
    const t = lib.tracks[0];
    assert.deepEqual(searchTracks(lib.tracks, `${t.artist.split(' ')[0]} ${t.key}`).map((x) => x.id).includes(t.id), true);
    assert.equal(searchTracks(lib.tracks, 'zzzz-no-match').length, 0);
    assert.equal(searchTracks(lib.tracks, '   ').length, lib.tracks.length);
  });
  it('view names', () => {
    assert.equal(viewName(lib, COLLECTION), 'Collection');
    assert.equal(viewName(lib, 'pl-after'), 'Afterhours');
  });
});

describe('export naming', () => {
  it('keeps the name when the folder is free', () => {
    assert.equal(uniqueBase('Warm-up', ['.m3u8', '.rekordfox.json'], []), 'Warm-up');
  });
  it('never reuses a taken name, case-insensitively, for either file', () => {
    assert.equal(uniqueBase('Warm-up', ['.m3u8', '.rekordfox.json'], ['warm-up.M3U8']), 'Warm-up (2)');
    assert.equal(uniqueBase('Warm-up', ['.m3u8', '.rekordfox.json'], ['Warm-up.rekordfox.json', 'Warm-up (2).m3u8']), 'Warm-up (3)');
  });
  it('builds only the files asked for', () => {
    const tracks = buildDemoTracks().slice(0, 2);
    const both = buildExportFiles(tracks, { name: 'Set', app: 'RekordFox', base: 'Set', playlist: true, cueSheet: true, exportedAt: 'x' });
    assert.deepEqual(both.map((f) => f.name), ['Set.m3u8', 'Set.rekordfox.json']);
    assert.ok(both[0].text.startsWith('#EXTM3U'));
    assert.equal(JSON.parse(both[1].text).tracks.length, 2);
    assert.deepEqual(buildExportFiles(tracks, { name: 'Set', app: 'RekordFox', base: 'Set', playlist: false, cueSheet: true }).map((f) => f.name), ['Set.rekordfox.json']);
  });
});

describe('deck defaults from preferences', () => {
  it('apply at once to empty decks, not to loaded ones', () => {
    let s = run(initialState(), { type: 'deck/load', deck: 0, trackId: 'demo-1' });
    s = run(s, { type: 'prefs/set', patch: { defaultTempoRange: 16, defaultQuantize: false } });
    assert.equal(s.prefs.defaultTempoRange, 16);
    assert.equal(s.decks[0].tempoRange, 10);
    assert.equal(s.decks[0].quantize, true);
    assert.equal(s.decks[1].tempoRange, 16);
    assert.equal(s.decks[1].quantize, false);
  });
  it('other preference changes leave the decks alone', () => {
    const s0 = initialState();
    const s = run(s0, { type: 'prefs/set', patch: { waveStyle: 'blue' } });
    assert.equal(s.decks[1].tempoRange, s0.decks[1].tempoRange);
  });
});
