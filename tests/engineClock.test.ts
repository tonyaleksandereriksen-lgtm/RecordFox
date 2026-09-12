// The engine clock: seek sequencing, engine-driven decks and 'transport/sync' (M1).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EngineAction } from '../src/engine/actions.ts';
import { initialState } from '../src/engine/initialState.ts';
import { reduce } from '../src/engine/reducer.ts';
import { UNANALYSED_BPM, baseRate, beatLen, gridBpm } from '../src/engine/selectors.ts';
import type { EngineState, Track } from '../src/engine/types.ts';

const run = (s: EngineState, ...actions: EngineAction[]) => actions.reduce(reduce, s);
const loaded = () => run(initialState(), { type: 'deck/load', deck: 0, trackId: 'demo-1' }, { type: 'deck/load', deck: 1, trackId: 'demo-2' });
const tick = (sec: number): EngineAction => ({ type: 'transport/tick', dt: sec });
const sync = (a: number | null, b: number | null, playing: [boolean, boolean] = [true, true]): EngineAction => ({ type: 'transport/sync', positions: [a, b], playing });
const engineDeck = () => run(loaded(), { type: 'deck/engine', deck: 0, ready: true });

const localTrack = (id: string, path: string): Track => ({
  id,
  title: id,
  artist: '',
  genre: '',
  bpm: 0,
  key: '',
  durationSec: 300,
  firstBeatSec: 0,
  hue: 0,
  seed: 1,
  source: 'local',
  path,
  rating: 0,
  comment: '',
  playlists: [],
  addedAt: 0,
});

describe('seekSeq counts playhead jumps, not motion', () => {
  it('bumps on load (parked on the first beat), cue, hot cue, beat jump and needle search', () => {
    let s = loaded();
    assert.equal(s.decks[0].seekSeq, 1, 'load parks the playhead on the first beat');
    const seq = () => s.decks[0].seekSeq;
    s = run(s, { type: 'deck/playPause', deck: 0 }, tick(1));
    assert.equal(seq(), 1, 'the clock moving the playhead is not a jump');
    s = run(s, { type: 'deck/cue', deck: 0, pressed: true });
    assert.equal(seq(), 2, 'CUE while playing jumps back to the cue point');
    s = run(s, { type: 'deck/cue', deck: 0, pressed: false }, { type: 'deck/hotCue', deck: 0, index: 1, pressed: true });
    assert.equal(seq(), 3, 'a hot cue jumps');
    s = run(s, { type: 'deck/hotCue', deck: 0, index: 1, pressed: false }, { type: 'deck/beatJump', deck: 0, dir: 1 });
    assert.equal(seq(), 4, 'a beat jump jumps');
    s = run(s, { type: 'deck/seek', deck: 0, positionSec: 100 });
    assert.equal(seq(), 5, 'needle search jumps');
    s = run(s, { type: 'deck/jog', deck: 0, mode: 'search', ticks: 3 });
    assert.equal(seq(), 6, 'SHIFT + platter search jumps');
  });

  it('does not bump while the hand drags the playhead (scratch), nor for the other deck', () => {
    let s = run(loaded(), { type: 'deck/jogTouch', deck: 0, touched: true });
    const before = s.decks[0].seekSeq;
    s = run(s, { type: 'deck/jog', deck: 0, mode: 'scratch', ticks: 10 }, { type: 'deck/jog', deck: 0, mode: 'scratch', ticks: -4 });
    assert.notEqual(s.decks[0].positionSec, loaded().decks[0].positionSec, 'scratch still moves the target position');
    assert.equal(s.decks[0].seekSeq, before, 'scratching is not a seek');
    assert.equal(s.decks[1].seekSeq, 1, 'deck B untouched');
  });

  it('a jump in a synced sync-toggle phase alignment counts once', () => {
    let s = run(loaded(), { type: 'deck/playPause', deck: 0 }, tick(0.37));
    const before = s.decks[1].seekSeq;
    s = run(s, { type: 'deck/syncToggle', deck: 1 });
    assert.ok(s.decks[1].seekSeq === before || s.decks[1].seekSeq === before + 1, 'phase alignment is at most one jump');
  });
});

describe('engine-driven decks', () => {
  it('deck/engine needs a loaded track and is cleared by load and eject', () => {
    let s = run(initialState(), { type: 'deck/engine', deck: 0, ready: true });
    assert.equal(s.decks[0].engine, false, 'no track: nothing for the engine to hold');
    s = engineDeck();
    assert.equal(s.decks[0].engine, true);
    s = run(s, { type: 'deck/load', deck: 0, trackId: 'demo-3' });
    assert.equal(s.decks[0].engine, false, 'a new track is not in the engine until the bridge says so');
    s = run(s, { type: 'deck/engine', deck: 0, ready: true }, { type: 'deck/eject', deck: 0 });
    assert.equal(s.decks[0].engine, false);
  });

  it('the clock no longer moves an engine deck; sync does', () => {
    let s = run(engineDeck(), { type: 'deck/playPause', deck: 0 }, { type: 'deck/playPause', deck: 1 });
    const p0 = s.decks[0].positionSec;
    const p1 = s.decks[1].positionSec;
    s = run(s, tick(0.25), tick(0.25));
    assert.equal(s.decks[0].positionSec, p0, 'engine deck waits for the engine');
    assert.ok(Math.abs(s.decks[1].positionSec - (p1 + 0.5)) < 1e-9, 'the internal-clock deck still runs');
    s = run(s, sync(12.34, 99));
    assert.equal(s.decks[0].positionSec, 12.34, 'sync sets the engine deck');
    assert.ok(Math.abs(s.decks[1].positionSec - (p1 + 0.5)) < 1e-9, 'sync ignores a deck the engine does not hold');
    assert.equal(s.decks[0].seekSeq, 1, 'sync is not a jump');
  });

  it('a null position leaves the deck alone; positions are clamped to the track', () => {
    let s = run(engineDeck(), sync(20, null));
    s = run(s, sync(null, null));
    assert.equal(s.decks[0].positionSec, 20);
    s = run(s, sync(1e9, null));
    assert.equal(s.decks[0].positionSec, s.decks[0].track!.durationSec);
  });

  it('the engine stopping a playing deck (end of track) stops it here and hands master over', () => {
    let s = run(engineDeck(), { type: 'deck/playPause', deck: 0 }, { type: 'deck/playPause', deck: 1 });
    assert.equal(s.decks[0].master, true);
    s = run(s, sync(300, null, [false, true]));
    assert.equal(s.decks[0].playing, false);
    assert.equal(s.decks[1].master, true, 'the playing deck becomes master');
    s = run(s, sync(300, null, [true, true]));
    assert.equal(s.decks[0].playing, false, 'the engine cannot start a deck; only stop it');
  });

  it('under the hand (vinyl scratch) the reducer keeps its own position — it is the target', () => {
    let s = run(engineDeck(), { type: 'deck/playPause', deck: 0 }, { type: 'deck/jogTouch', deck: 0, touched: true });
    s = run(s, { type: 'deck/jog', deck: 0, mode: 'scratch', ticks: 40 });
    const target = s.decks[0].positionSec;
    s = run(s, sync(target - 0.02, null));
    assert.equal(s.decks[0].positionSec, target, 'the engine lags the hand slightly; the hand wins');
    s = run(s, { type: 'deck/jogTouch', deck: 0, touched: false }, sync(target - 0.01, null));
    assert.equal(s.decks[0].positionSec, target - 0.01, 'after release the engine is the clock again');
  });

  it('bend still decays on an engine deck', () => {
    let s = run(engineDeck(), { type: 'deck/playPause', deck: 0 }, { type: 'deck/jog', deck: 0, mode: 'bend', ticks: 10 });
    const b = s.decks[0].bend;
    assert.ok(b > 0);
    s = run(s, tick(0.1));
    assert.ok(s.decks[0].bend < b && s.decks[0].bend > 0);
  });
});

describe('local tracks', () => {
  it('library/add appends new tracks once and selects the first', () => {
    const a = localTrack('local:1', 'C:/a.wav');
    const b = localTrack('local:2', 'C:/b.wav');
    let s = run(initialState(), { type: 'library/add', tracks: [a, b, a] });
    const n = initialState().library.tracks.length;
    assert.equal(s.library.tracks.length, n + 2);
    assert.equal(s.library.selectedId, 'local:1');
    const again = run(s, { type: 'library/add', tracks: [b] });
    assert.equal(again, s, 'nothing new: same state');
  });

  it('library/remove drops local tracks, never demo tracks, and not one that is on a deck', () => {
    const a = localTrack('local:1', 'C:/a.wav');
    const b = localTrack('local:2', 'C:/b.wav');
    let s = run(initialState(), { type: 'library/add', tracks: [a, b] }, { type: 'deck/load', deck: 0, trackId: 'local:1' });
    const n = s.library.tracks.length;
    s = run(s, { type: 'library/remove', trackIds: ['local:2', 'demo-1'] });
    assert.equal(s.library.tracks.length, n - 1, 'local:2 removed, demo-1 kept');
    assert.ok(s.library.tracks.some((t) => t.id === 'demo-1'));
    const before = s;
    s = run(s, { type: 'library/remove', trackIds: ['local:1'] });
    assert.equal(s.library.tracks.length, before.library.tracks.length, 'a track on a deck stays');
    assert.ok(s.ui.toast, 'and the DJ is told why');
    s = run(s, { type: 'deck/eject', deck: 0 }, { type: 'library/remove', trackIds: ['local:1'] });
    assert.ok(!s.library.tracks.some((t) => t.id === 'local:1'));
  });

  it('an unanalysed track (bpm 0) uses a 120 BPM grid and never follows sync', () => {
    const t = localTrack('local:1', 'C:/a.wav');
    assert.equal(gridBpm(t), UNANALYSED_BPM);
    assert.equal(beatLen(t), 0.5);
    let s = run(initialState(), { type: 'library/add', tracks: [t] }, { type: 'deck/load', deck: 0, trackId: 'local:1' }, { type: 'deck/load', deck: 1, trackId: 'demo-2' });
    s = run(s, { type: 'deck/tempo', deck: 0, value01: 1 }, { type: 'deck/playPause', deck: 1 }, { type: 'deck/syncToggle', deck: 0 });
    assert.equal(s.decks[0].sync, true);
    assert.ok(Number.isFinite(baseRate(s, 0)));
    assert.ok(Math.abs(baseRate(s, 0) - 1.1) < 1e-9, 'sync on, but with no BPM to follow the deck keeps its own tempo');
    s = run(s, { type: 'deck/beatLoop', deck: 0, beats: 4 });
    assert.equal(s.decks[0].loop.active, true);
    assert.ok(Math.abs(s.decks[0].loop.outSec! - s.decks[0].loop.inSec! - 2) < 1e-9, '4 beats at 120 BPM = 2 s');
  });
});
