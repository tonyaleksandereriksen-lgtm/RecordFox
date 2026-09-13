// M2: files → tracks, analysis results into the library, the waveform registry.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { localTrackId } from '../src/audio/localFiles.ts';
import type { EngineAction } from '../src/engine/actions.ts';
import { initialState } from '../src/engine/initialState.ts';
import { reduce } from '../src/engine/reducer.ts';
import type { EngineState, Track } from '../src/engine/types.ts';
import { forgetWaveform, hasWaveform, onWaveformMissing, setWaveform, waveformFor, waveformFromBytes } from '../src/engine/waveform.ts';
import type { AnalysisMeta, FileDescription } from '../src/library/host.ts';
import { keyLabel, needsAnalysis, trackFromDescription } from '../src/library/tracks.ts';
import { savedFolders, snapshot } from '../src/lib/persist.ts';

const run = (s: EngineState, ...actions: EngineAction[]) => actions.reduce(reduce, s);

const meta = (over: Partial<AnalysisMeta> = {}): AnalysisMeta => ({
  version: 2,
  size: 100,
  mtimeMs: 5,
  analysedAt: 1_700_000_000_000,
  durationSec: 300.5,
  bpm: 127.9987,
  bpmConfidence: 0.9,
  firstBeatSec: 0.412,
  key: '8A',
  keyName: 'A minor',
  keyFit: 0.7,
  keyMargin: 0.2,
  bins: 30050,
  ...over,
});

const described = (over: Partial<FileDescription> = {}): FileDescription => ({
  path: 'D:\\Music\\Artist Name - Song Title.mp3',
  size: 100,
  mtimeMs: 5,
  tags: { title: 'Real Title', artist: 'Real Artist', album: 'The Album', genre: 'House', year: 2021, durationSeconds: 301.2, sampleRate: 44100, channels: 2, bitrateKbps: 320, hasArtwork: true },
  probe: null,
  analysis: null,
  ...over,
});

describe('trackFromDescription', () => {
  it('prefers tags over the file name and keeps the file identity', () => {
    const t = trackFromDescription(described(), 123);
    assert.equal(t.id, localTrackId('D:\\Music\\Artist Name - Song Title.mp3'));
    assert.equal(t.title, 'Real Title');
    assert.equal(t.artist, 'Real Artist');
    assert.equal(t.album, 'The Album');
    assert.equal(t.year, 2021);
    assert.equal(t.genre, 'House');
    assert.equal(t.durationSec, 301.2);
    assert.equal(t.bitrateKbps, 320);
    assert.equal(t.fileSize, 100);
    assert.equal(t.bpm, 0, 'no analysis yet');
    assert.equal(needsAnalysis(t), true);
  });

  it('falls back to "Artist - Title" from the name and the probe for the duration', () => {
    const t = trackFromDescription(described({ tags: null, probe: { lengthSeconds: 210, sampleRate: 48000, channels: 2 } }));
    assert.equal(t.title, 'Song Title');
    assert.equal(t.artist, 'Artist Name');
    assert.equal(t.durationSec, 210);
    assert.equal(t.sampleRate, 48000);
  });

  it('a cached analysis makes the record complete on the spot', () => {
    const t = trackFromDescription(described({ analysis: meta() }));
    assert.equal(t.bpm, 128);
    assert.equal(t.firstBeatSec, 0.412);
    assert.equal(t.key, '8A');
    assert.equal(t.keyName, 'A minor');
    assert.equal(t.durationSec, 300.5, 'the analyser measured the whole file');
    assert.equal(needsAnalysis(t), false);
  });

  it('a re-scan keeps the DJ’s edits and a corrected grid', () => {
    const prev: Track = { ...trackFromDescription(described({ analysis: meta() })), rating: 4, comment: 'banger', playlists: ['pl-peak'], cues: [1, null, 2], bpm: 128.5, bpmOriginal: 128, firstBeatSec: 0.5, firstBeatSecOriginal: 0.412 };
    const t = trackFromDescription(described({ analysis: meta({ bpm: 127.5 }) }), 999, prev);
    assert.equal(t.rating, 4);
    assert.equal(t.comment, 'banger');
    assert.deepEqual(t.playlists, ['pl-peak']);
    assert.deepEqual(t.cues, [1, null, 2]);
    assert.equal(t.bpm, 128.5, 'the hand-corrected grid stays');
    assert.equal(t.bpmOriginal, 127.5, 'what RESET restores follows the analysis');
    assert.equal(t.addedAt, prev.addedAt);
  });

  it('labels an ambiguous key', () => {
    assert.equal(keyLabel({ key: '8A', keyMargin: 0.2 }), '8A');
    assert.equal(keyLabel({ key: '8A', keyMargin: 0.01 }), '8A?');
    assert.equal(keyLabel({ key: '' }), '—');
  });
});

describe('library/analysis and friends', () => {
  const local = trackFromDescription(described());
  const withLocal = () => run(initialState(), { type: 'library/add', tracks: [local] });
  const result = { bpm: 127.9987, firstBeatSec: 0.412, key: '8A', keyName: 'A minor', keyMargin: 0.2, bpmConfidence: 0.9, durationSec: 300.5, analysedAt: 1 };

  it('writes the analysis into the track and into a deck holding it', () => {
    let s = run(withLocal(), { type: 'deck/load', deck: 0, trackId: local.id });
    s = run(s, { type: 'library/analysis', trackId: local.id, result });
    const t = s.library.tracks.find((x) => x.id === local.id)!;
    assert.equal(t.bpm, 128);
    assert.equal(t.firstBeatSec, 0.412);
    assert.equal(t.key, '8A');
    assert.equal(t.durationSec, 300.5);
    assert.equal(s.decks[0].track!.bpm, 128, 'the deck copy follows');
    assert.equal(needsAnalysis(t), false);
  });

  it('a hand-corrected grid outranks a fresh analysis', () => {
    let s = run(withLocal(), { type: 'library/analysis', trackId: local.id, result });
    s = run(s, { type: 'deck/load', deck: 0, trackId: local.id }, { type: 'grid/bpm', deck: 0, bpm: 130 });
    assert.equal(s.library.tracks.find((x) => x.id === local.id)!.bpmOriginal, 128);
    s = run(s, { type: 'library/analysis', trackId: local.id, result: { ...result, bpm: 126 } });
    const t = s.library.tracks.find((x) => x.id === local.id)!;
    assert.equal(t.bpm, 130, 'the DJ’s value stays');
    assert.equal(t.bpmOriginal, 126, 'RESET now goes to the new analysis');
  });

  it('ignores demo tracks and records failures', () => {
    let s = run(withLocal(), { type: 'library/analysis', trackId: 'demo-1', result });
    assert.equal(s.library.tracks.find((x) => x.id === 'demo-1')!.bpm, 124);
    s = run(s, { type: 'library/analysisFailed', trackId: local.id, error: 'could not decode' });
    const t = s.library.tracks.find((x) => x.id === local.id)!;
    assert.equal(t.analysisError, 'could not decode');
    assert.equal(needsAnalysis(t), false, 'not retried every launch');
  });

  it('upsert replaces by id, appends the rest, refreshes a deck copy', () => {
    let s = run(withLocal(), { type: 'deck/load', deck: 1, trackId: local.id });
    const n = s.library.tracks.length;
    const other = trackFromDescription(described({ path: 'D:\\Music\\other.wav', tags: null, probe: { lengthSeconds: 10, sampleRate: 48000, channels: 2 } }));
    s = run(s, { type: 'library/upsert', tracks: [{ ...local, title: 'Renamed' }, other] });
    assert.equal(s.library.tracks.length, n + 1);
    assert.equal(s.library.tracks.find((x) => x.id === local.id)!.title, 'Renamed');
    assert.equal(s.decks[1].track!.title, 'Renamed');
    assert.equal(run(s, { type: 'library/upsert', tracks: [] }), s);
  });

  it('folders are remembered, deduplicated and saved', () => {
    let s = run(initialState(), { type: 'library/folders', folders: ['D:\\Music', 'D:\\Music', 'E:\\Sets'] });
    assert.deepEqual(s.library.folders, ['D:\\Music', 'E:\\Sets']);
    assert.equal(run(s, { type: 'library/folders', folders: ['D:\\Music', 'E:\\Sets'] }), s, 'same list: same state');
    const saved = snapshot(s);
    assert.deepEqual(savedFolders(saved), ['D:\\Music', 'E:\\Sets']);
    assert.deepEqual(savedFolders({}), []);
    s = run(s, { type: 'library/add', tracks: [local] }, { type: 'library/analysis', trackId: local.id, result });
    const back = snapshot(s).local!.find((t) => t.id === local.id)!;
    assert.equal(back.bpm, 128, 'analysis travels with the saved record');
    assert.equal(back.album, 'The Album');
  });
});

describe('waveform registry', () => {
  const t = trackFromDescription(described({ analysis: meta() }));

  it('decodes low/mid/high byte triples', () => {
    const w = waveformFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
    assert.ok(w);
    assert.equal(w.length, 2);
    assert.deepEqual([...w.low], [1, 4]);
    assert.deepEqual([...w.mid], [2, 5]);
    assert.deepEqual([...w.high], [3, 6]);
    assert.equal(w.binsPerSec, 100);
    assert.equal(waveformFromBytes(new Uint8Array(2)), null);
  });

  it('serves the placeholder until the real one is set, asking the loader once per draw', () => {
    forgetWaveform(t.id);
    const asked: string[] = [];
    onWaveformMissing((track) => asked.push(track.id));
    const placeholder = waveformFor(t);
    assert.equal(placeholder.low[0], 70);
    assert.deepEqual(asked, [t.id]);
    setWaveform(t.id, waveformFromBytes(new Uint8Array([9, 9, 9]))!);
    assert.equal(hasWaveform(t.id), true);
    assert.equal(waveformFor(t).low[0], 9);
    assert.equal(asked.length, 1, 'no more asking once it is here');
    onWaveformMissing(null);
    forgetWaveform(t.id);
    assert.equal(hasWaveform(t.id), false);
  });
});

describe('export copies', () => {
  it('names local files "Artist - Title.ext", unique against the folder and each other; demo tracks are not copied', async () => {
    const { planCopies } = await import('../src/lib/exporter.ts');
    const a = trackFromDescription(described({ path: 'D:\Music\a.flac', tags: { title: 'Same', artist: 'Kit', durationSeconds: 10, sampleRate: 44100, channels: 2, bitrateKbps: 0, hasArtwork: false } }));
    const b = trackFromDescription(described({ path: 'D:\Music\b.mp3', tags: { title: 'Same', artist: 'Kit', durationSeconds: 10, sampleRate: 44100, channels: 2, bitrateKbps: 0, hasArtwork: false } }));
    const demo = initialState().library.tracks[0];
    const plan = planCopies([a, demo, b], ['Kit - Same.flac']);
    assert.equal(plan.pathFor(a), 'Kit - Same (2).flac', 'the folder already had one');
    assert.equal(plan.pathFor(b), 'Kit - Same.mp3', 'a different extension is a different file');
    assert.equal(plan.pathFor(demo), 'Kit Ferro - Neon Harbor.mp3');
    assert.deepEqual(plan.copies, [
      { from: 'D:\Music\a.flac', to: 'Kit - Same (2).flac' },
      { from: 'D:\Music\b.mp3', to: 'Kit - Same.mp3' },
    ]);
  });
});
