import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EngineAction } from '../src/engine/actions.ts';
import { initialState } from '../src/engine/initialState.ts';
import { reduce } from '../src/engine/reducer.ts';
import { SCRATCH_SEC_PER_TICK, baseRate, effectiveBpm, syncMultiplier } from '../src/engine/selectors.ts';
import type { EngineState } from '../src/engine/types.ts';

const run = (s: EngineState, ...actions: EngineAction[]) => actions.reduce(reduce, s);
const loaded = () => run(initialState(), { type: 'deck/load', deck: 0, trackId: 'demo-1' }, { type: 'deck/load', deck: 1, trackId: 'demo-2' });
const tick = (sec: number): EngineAction => ({ type: 'transport/tick', dt: sec });

describe('transport', () => {
  it('loads a track parked on its first beat with cue there and preset hot cues', () => {
    const s = loaded();
    const d = s.decks[0];
    assert.equal(d.track?.id, 'demo-1');
    assert.equal(d.positionSec, d.track!.firstBeatSec);
    assert.equal(d.cueSec, d.track!.firstBeatSec);
    assert.ok(d.hotCues[0] !== null && d.hotCues[1] !== null);
    assert.equal(d.loadSeq, 1);
    assert.equal(s.decks[0].master, true, 'first loaded deck becomes master');
  });

  it('play/pause toggles and the clock advances position at the deck rate', () => {
    let s = run(loaded(), { type: 'deck/playPause', deck: 0 });
    assert.equal(s.decks[0].playing, true);
    const p0 = s.decks[0].positionSec;
    s = run(s, tick(0.1), tick(0.1));
    assert.ok(Math.abs(s.decks[0].positionSec - (p0 + 0.2)) < 1e-9);
    s = run(s, { type: 'deck/playPause', deck: 0 });
    assert.equal(s.decks[0].playing, false);
  });

  it('CUE while playing returns to the cue point and pauses', () => {
    let s = run(loaded(), { type: 'deck/playPause', deck: 0 }, tick(0.2));
    s = run(s, { type: 'deck/cue', deck: 0, pressed: true });
    assert.equal(s.decks[0].playing, false);
    assert.equal(s.decks[0].positionSec, s.decks[0].cueSec);
  });

  it('CUE while paused away from the cue sets a new (quantized) cue point', () => {
    let s = run(loaded(), { type: 'deck/seek', deck: 0, positionSec: 30.01 });
    s = run(s, { type: 'deck/cue', deck: 0, pressed: true }, { type: 'deck/cue', deck: 0, pressed: false });
    const d = s.decks[0];
    const beat = 60 / d.track!.bpm;
    const k = (d.cueSec - d.track!.firstBeatSec) / beat;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-9, 'cue is on the beat grid');
    assert.equal(d.positionSec, d.cueSec);
  });

  it('holding CUE on the cue point previews, release returns', () => {
    let s = run(loaded(), { type: 'deck/cue', deck: 0, pressed: true });
    assert.equal(s.decks[0].playing, true);
    assert.equal(s.decks[0].cuePreview, true);
    s = run(s, tick(0.5), { type: 'deck/cue', deck: 0, pressed: false });
    assert.equal(s.decks[0].playing, false);
    assert.equal(s.decks[0].positionSec, s.decks[0].cueSec);
  });

  it('PLAY during CUE preview keeps playing after release', () => {
    let s = run(loaded(), { type: 'deck/cue', deck: 0, pressed: true }, { type: 'deck/playPause', deck: 0 });
    s = run(s, { type: 'deck/cue', deck: 0, pressed: false });
    assert.equal(s.decks[0].playing, true);
  });

  it('stops at the end of the track', () => {
    let s = run(loaded(), { type: 'deck/seek', deck: 0, positionSec: 10_000 }, { type: 'deck/playPause', deck: 0 });
    assert.equal(s.decks[0].playing, false, 'cannot start at the end');
    s = run(s, { type: 'deck/seek', deck: 0, positionSec: s.decks[0].track!.durationSec - 0.05 }, { type: 'deck/playPause', deck: 0 }, tick(0.1));
    assert.equal(s.decks[0].playing, false);
    assert.equal(s.decks[0].positionSec, s.decks[0].track!.durationSec);
  });
});

describe('tempo and sync', () => {
  it('maps the 14-bit slider: min = "−" end, max = "+" end, scaled by range', () => {
    let s = run(loaded(), { type: 'deck/tempo', deck: 0, value01: 1 });
    assert.ok(Math.abs(baseRate(s, 0) - 1.1) < 1e-9, '+10% at max with ±10 range');
    s = run(s, { type: 'deck/tempo', deck: 0, value01: 0 });
    assert.ok(Math.abs(baseRate(s, 0) - 0.9) < 1e-9);
    s = run(s, { type: 'deck/tempo', deck: 0, value01: 0.5 });
    assert.ok(Math.abs(baseRate(s, 0) - 1) < 1e-9);
  });

  it('cycles tempo range 6 → 10 → 16 keeping the percentage when it fits', () => {
    let s = run(loaded(), { type: 'deck/tempo', deck: 0, value01: 0.75 }); // +5% at ±10
    s = run(s, { type: 'deck/tempoRange', deck: 0 });
    assert.equal(s.decks[0].tempoRange, 16);
    assert.ok(Math.abs(baseRate(s, 0) - 1.05) < 1e-9);
    s = run(s, { type: 'deck/tempoRange', deck: 0 });
    assert.equal(s.decks[0].tempoRange, 6);
  });

  it('sync matches the master BPM and aligns beat phase', () => {
    let s = run(loaded(), { type: 'deck/playPause', deck: 0 });
    for (let i = 0; i < 33; i++) s = run(s, tick(0.1));
    s = run(s, { type: 'deck/syncToggle', deck: 1 });
    assert.equal(s.decks[1].sync, true);
    assert.ok(Math.abs(effectiveBpm(s, 1) - effectiveBpm(s, 0)) < 1e-9);
    const phase = (deck: 0 | 1) => {
      const d = s.decks[deck];
      const x = (d.positionSec - d.track!.firstBeatSec) / (60 / d.track!.bpm);
      return x - Math.floor(x);
    };
    const diff = Math.abs(phase(0) - phase(1));
    assert.ok(Math.min(diff, 1 - diff) < 1e-6, `phases aligned (diff ${diff})`);
  });

  it('octave-matches half/double time', () => {
    assert.equal(syncMultiplier(87, 174), 2);
    assert.equal(syncMultiplier(140, 70), 0.5);
    assert.equal(syncMultiplier(124, 128), 1);
  });

  it('aligns even when the follower sits at the very start of its track', () => {
    let s = run(loaded(), { type: 'deck/playPause', deck: 0 }, tick(0.25), { type: 'deck/syncToggle', deck: 1 });
    const ph = (deck: 0 | 1) => {
      const d = s.decks[deck];
      const x = (d.positionSec - d.track!.firstBeatSec) / (60 / d.track!.bpm);
      return x - Math.floor(x);
    };
    const diff = Math.abs(ph(0) - ph(1));
    assert.ok(Math.min(diff, 1 - diff) < 1e-6);
    assert.ok(s.decks[1].positionSec >= 0);
  });

  it('a synced follower ignores its tempo slider; leaving sync keeps the tempo', () => {
    let s = run(loaded(), { type: 'deck/playPause', deck: 0 }, { type: 'deck/syncToggle', deck: 1 });
    const synced = effectiveBpm(s, 1);
    s = run(s, { type: 'deck/tempo', deck: 1, value01: 1 });
    assert.equal(effectiveBpm(s, 1), synced);
    s = run(s, { type: 'deck/syncToggle', deck: 1 });
    assert.equal(s.decks[1].sync, false);
    assert.ok(Math.abs(effectiveBpm(s, 1) - synced) < 1e-9);
  });

  it('long-press sets tempo master', () => {
    const s = run(loaded(), { type: 'deck/setMaster', deck: 1 });
    assert.equal(s.decks[1].master, true);
    assert.equal(s.decks[0].master, false);
  });
});

describe('jog', () => {
  it('scratches by position while touched in vinyl mode; the clock does not move the deck', () => {
    let s = run(loaded(), { type: 'deck/playPause', deck: 0 }, { type: 'deck/jogTouch', deck: 0, touched: true });
    const p = s.decks[0].positionSec;
    s = run(s, tick(0.5));
    assert.equal(s.decks[0].positionSec, p);
    s = run(s, { type: 'deck/jog', deck: 0, mode: 'scratch', ticks: 720 });
    assert.ok(Math.abs(s.decks[0].positionSec - (p + 720 * SCRATCH_SEC_PER_TICK)) < 1e-9, 'one revolution = 1.8 s');
    s = run(s, { type: 'deck/jogTouch', deck: 0, touched: false }, tick(0.1));
    assert.ok(s.decks[0].positionSec > p + 1.8, 'playback resumes after release');
  });

  it('bends pitch while playing and the bend decays', () => {
    let s = run(loaded(), { type: 'deck/playPause', deck: 0 }, { type: 'deck/jog', deck: 0, mode: 'bend', ticks: 5 });
    assert.ok(s.decks[0].bend > 0);
    for (let i = 0; i < 60; i++) s = run(s, tick(1 / 60));
    assert.equal(s.decks[0].bend, 0);
  });

  it('SHIFT + jog searches fast', () => {
    const s0 = loaded();
    const s = run(s0, { type: 'deck/jog', deck: 0, mode: 'search', ticks: 100 });
    assert.ok(Math.abs(s.decks[0].positionSec - s0.decks[0].positionSec - 10) < 1e-9);
  });
});

describe('hot cues, loops, beat jump', () => {
  it('sets an empty hot cue, jumps to a set one, deletes with SHIFT', () => {
    let s = run(loaded(), { type: 'deck/seek', deck: 0, positionSec: 100 });
    s = run(s, { type: 'deck/hotCue', deck: 0, index: 6, pressed: true }, { type: 'deck/hotCue', deck: 0, index: 6, pressed: false });
    assert.ok(s.decks[0].hotCues[6] !== null);
    const at = s.decks[0].hotCues[6]!.posSec;
    s = run(s, { type: 'deck/playPause', deck: 0 }, tick(2), { type: 'deck/hotCue', deck: 0, index: 6, pressed: true });
    assert.equal(s.decks[0].positionSec, at);
    assert.equal(s.decks[0].playing, true);
    s = run(s, { type: 'deck/hotCueDelete', deck: 0, index: 6 });
    assert.equal(s.decks[0].hotCues[6], null);
  });

  it('paused hot cue press previews while held', () => {
    let s = run(loaded(), { type: 'deck/hotCue', deck: 0, index: 1, pressed: true });
    assert.equal(s.decks[0].playing, true);
    s = run(s, tick(0.3), { type: 'deck/hotCue', deck: 0, index: 1, pressed: false });
    assert.equal(s.decks[0].playing, false);
    assert.equal(s.decks[0].positionSec, s.decks[0].hotCues[1]!.posSec);
  });

  it('beat loop wraps playback and toggles off on the same size', () => {
    let s = run(loaded(), { type: 'deck/seek', deck: 0, positionSec: 60 }, { type: 'deck/playPause', deck: 0 });
    s = run(s, { type: 'deck/beatLoop', deck: 0, beats: 4 });
    const { inSec, outSec } = s.decks[0].loop;
    assert.ok(inSec !== null && outSec !== null);
    assert.ok(Math.abs(outSec! - inSec! - 4 * (60 / 124)) < 1e-9);
    for (let i = 0; i < 300; i++) s = run(s, tick(1 / 60));
    assert.ok(s.decks[0].positionSec >= inSec! && s.decks[0].positionSec < outSec!);
    s = run(s, { type: 'deck/beatLoop', deck: 0, beats: 4 });
    assert.equal(s.decks[0].loop.active, false);
  });

  it('beat jump moves by the jump size in beats', () => {
    const s0 = run(loaded(), { type: 'deck/seek', deck: 0, positionSec: 50 });
    const s = run(s0, { type: 'deck/beatJump', deck: 0, dir: 1 });
    assert.ok(Math.abs(s.decks[0].positionSec - 50 - 4 * (60 / 124)) < 1e-9);
  });
});

describe('mixer', () => {
  it('clamps values and toggles PFL / master cue / smart buttons', () => {
    let s = run(initialState(), { type: 'mixer/set', ch: 0, param: 'fader', value: 1.4 }, { type: 'mixer/pfl', ch: 1 }, { type: 'mixer/masterCue' }, { type: 'mixer/smartFader' });
    assert.equal(s.mixer.ch[0].fader, 1);
    assert.equal(s.mixer.ch[1].pfl, true);
    assert.equal(s.mixer.masterCue, true);
    assert.equal(s.mixer.smartFader, true);
    s = run(s, { type: 'mixer/crossfader', value: -3 });
    assert.equal(s.mixer.crossfader, 0);
  });

  it('refuses to load onto a playing deck', () => {
    const s = run(loaded(), { type: 'deck/playPause', deck: 0 }, { type: 'deck/load', deck: 0, trackId: 'demo-3' });
    assert.equal(s.decks[0].track?.id, 'demo-1');
    assert.ok(s.ui.toast?.text.includes('playing'));
  });
});
