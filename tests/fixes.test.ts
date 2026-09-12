// Regression tests for the slice-1 audit findings (docs/AUDIT.md).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EngineAction } from '../src/engine/actions.ts';
import { initialState } from '../src/engine/initialState.ts';
import { reduce } from '../src/engine/reducer.ts';
import { baseRate, beatLen, effectiveBpm } from '../src/engine/selectors.ts';
import type { EngineState } from '../src/engine/types.ts';
import { createStore } from '../src/lib/store.ts';
import { ADOPT_WINDOW_MS, Bindings } from '../src/midi/bindings.ts';
import { Flx2Decoder } from '../src/midi/decoder.ts';
import { Flx2Midi } from '../src/midi/Flx2Midi.ts';

const run = (s: EngineState, ...a: EngineAction[]) => a.reduce(reduce, s);
const loaded = () => run(initialState(), { type: 'deck/load', deck: 0, trackId: 'demo-1' }, { type: 'deck/load', deck: 1, trackId: 'demo-2' });
const tick = (sec: number): EngineAction => ({ type: 'transport/tick', dt: sec });

describe('H1 — fader start only acts when asked for', () => {
  it('ignores 9n 52 (CUE) while Smart Fader is off (default "smart" mode)', () => {
    const s = run(loaded(), { type: 'deck/playPause', deck: 0 }, { type: 'deck/faderStart', deck: 0, action: 'cue' });
    assert.equal(s.decks[0].playing, true);
  });
  it('acts with Smart Fader on', () => {
    const s = run(loaded(), { type: 'mixer/smartFader' }, { type: 'deck/playPause', deck: 0 }, { type: 'deck/faderStart', deck: 0, action: 'cue' });
    assert.equal(s.decks[0].playing, false);
  });
  it('"always" acts without Smart Fader; "off" never acts', () => {
    let s = run(loaded(), { type: 'prefs/set', patch: { faderStart: 'always' } }, { type: 'deck/faderStart', deck: 1, action: 'play' });
    assert.equal(s.decks[1].playing, true);
    s = run(loaded(), { type: 'prefs/set', patch: { faderStart: 'off' } }, { type: 'mixer/smartFader' }, { type: 'deck/faderStart', deck: 1, action: 'play' });
    assert.equal(s.decks[1].playing, false);
  });
});

describe('H2 — master hands over to the playing deck without a tempo jump', () => {
  it('loading onto the stopped master leaves the playing follower at its tempo', () => {
    let s = run(loaded(), { type: 'deck/syncToggle', deck: 1 }, { type: 'deck/playPause', deck: 1 });
    const before = effectiveBpm(s, 1);
    assert.equal(s.decks[1].master, true, 'playing deck took master');
    s = run(s, { type: 'deck/load', deck: 0, trackId: 'demo-6' });
    assert.ok(Math.abs(effectiveBpm(s, 1) - before) < 1e-9);
  });
  it('setting master on a follower keeps its current tempo', () => {
    let s = run(loaded(), { type: 'deck/tempo', deck: 0, value01: 0.8 }, { type: 'deck/playPause', deck: 0 }, { type: 'deck/syncToggle', deck: 1 });
    const bpm = effectiveBpm(s, 1);
    s = run(s, { type: 'deck/setMaster', deck: 1 });
    assert.ok(Math.abs(effectiveBpm(s, 1) - bpm) < 1e-9);
  });
});

describe('H3 — first touch only adopts when it is safe', () => {
  const setup = () => {
    let now = 0;
    const store = createStore<EngineState, EngineAction>(loaded(), reduce);
    const b = new Bindings(store, () => now);
    return { store, b, at: (ms: number) => (now = ms) };
  };
  it('does not jump a playing deck on the first tempo touch after the adopt window', () => {
    const { store, b, at } = setup();
    b.markConnected();
    store.dispatch({ type: 'deck/playPause', deck: 0 });
    at(ADOPT_WINDOW_MS + 10_000);
    b.handle({ kind: 'deckAbs', deck: 0, id: 'tempo', value: 0.85, raw14: 13926 });
    assert.equal(baseRate(store.getState(), 0), 1);
  });
  it('still adopts on a stopped deck, and anything inside the connect window', () => {
    const { store, b, at } = setup();
    b.markConnected();
    at(ADOPT_WINDOW_MS + 5_000);
    b.handle({ kind: 'deckAbs', deck: 1, id: 'tempo', value: 0.75, raw14: 12287 });
    assert.ok(Math.abs(baseRate(store.getState(), 1) - 1.05) < 1e-3, 'stopped deck adopts');
    store.dispatch({ type: 'deck/playPause', deck: 0 });
    b.markConnected();
    at(ADOPT_WINDOW_MS + 5_500);
    b.handle({ kind: 'deckAbs', deck: 0, id: 'chFader', value: 0.9, raw14: 14745 });
    assert.ok(Math.abs(store.getState().mixer.ch[0].fader - 0.9) < 1e-3, 'within the window after (re)connect');
  });
  it('a playing deck picks the control up once the hardware reaches the software value', () => {
    const { store, b, at } = setup();
    store.dispatch({ type: 'deck/playPause', deck: 0 });
    at(60_000);
    b.handle({ kind: 'deckAbs', deck: 0, id: 'tempo', value: 0.9, raw14: 0 });
    b.handle({ kind: 'deckAbs', deck: 0, id: 'tempo', value: 0.51, raw14: 0 });
    b.handle({ kind: 'deckAbs', deck: 0, id: 'tempo', value: 0.6, raw14: 0 });
    assert.ok(Math.abs(baseRate(store.getState(), 0) - 1.02) < 1e-3);
  });
});

describe('M1 — sub-beat loops stay on their own grid', () => {
  it('a ¼-beat loop started 0.6 beats after a beat does not jump back', () => {
    let s = run(initialState(), { type: 'deck/load', deck: 0, trackId: 'demo-1' });
    const t = s.decks[0].track!;
    const bl = beatLen(t);
    const pos = t.firstBeatSec + 40 * bl + 0.6 * bl;
    s = run(s, { type: 'deck/seek', deck: 0, positionSec: pos }, { type: 'deck/playPause', deck: 0 }, { type: 'deck/beatLoop', deck: 0, beats: 0.25 });
    const loopIn = (s.decks[0].loop.inSec! - t.firstBeatSec) / bl;
    assert.ok(Math.abs(loopIn - 40.5) < 1e-6, `loop starts on the ¼ grid (got ${loopIn})`);
    assert.ok(Math.abs(s.decks[0].positionSec - pos) < 1e-9, 'playhead unchanged');
  });
});

describe('M6 — driver edge cases', () => {
  it('drops an LSB that arrives before any MSB', () => {
    const dec = new Flx2Decoder();
    assert.deepEqual(dec.decode([0xb0, 0x33, 0x40], 0), []);
    const [e] = [...dec.decode([0xb0, 0x13, 0x7f], 1), ...dec.decode([0xb0, 0x33, 0x7f], 1)];
    assert.equal(e.kind === 'deckAbs' && e.value, 1);
  });
  it('overlapping start() calls share one MIDI session', async () => {
    let calls = 0;
    const access = { inputs: new Map(), outputs: new Map(), onstatechange: null };
    (globalThis.navigator as unknown as { requestMIDIAccess: unknown }).requestMIDIAccess = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return access;
    };
    const drv = new Flx2Midi();
    await Promise.all([drv.start(), drv.start()]);
    drv.dispose();
    assert.equal(calls, 1);
  });
});

describe('L1 — SHIFT + pad in Pad FX lights the same pad', () => {
  it('maps to the pad index', () => {
    const store = createStore<EngineState, EngineAction>(initialState(), reduce);
    new Bindings(store).handle({ kind: 'pad', deck: 0, mode: 'padfx', pad: 2, shift: true, pressed: true });
    assert.equal(store.getState().decks[0].padFxHeld, 2);
  });
});

describe('Slip mode', () => {
  const playing = () => run(loaded(), { type: 'deck/slip', deck: 0 }, { type: 'deck/playPause', deck: 0 }, tick(0.2), tick(0.2));
  it('scratch release returns to where the track would have been', () => {
    let s = run(playing(), { type: 'deck/jogTouch', deck: 0, touched: true });
    const start = s.decks[0].positionSec;
    s = run(s, { type: 'deck/jog', deck: 0, mode: 'scratch', ticks: -200 }, tick(0.25), tick(0.25));
    s = run(s, { type: 'deck/jogTouch', deck: 0, touched: false });
    assert.ok(Math.abs(s.decks[0].positionSec - (start + 0.5)) < 1e-6);
    assert.equal(s.decks[0].slipPos, null);
  });
  it('loop exit returns to the shadow playhead', () => {
    let s = run(playing(), { type: 'deck/beatLoop', deck: 0, beats: 1 });
    const shadow0 = s.decks[0].slipPos!;
    for (let i = 0; i < 12; i++) s = run(s, tick(0.25));
    s = run(s, { type: 'deck/loopExit', deck: 0 });
    assert.ok(Math.abs(s.decks[0].positionSec - (shadow0 + 3)) < 1e-6);
  });
  it('a hot cue is momentary while playing with slip on', () => {
    let s = playing();
    const at = s.decks[0].positionSec;
    s = run(s, { type: 'deck/hotCue', deck: 0, index: 1, pressed: true }, tick(0.25), { type: 'deck/hotCue', deck: 0, index: 1, pressed: false });
    assert.ok(Math.abs(s.decks[0].positionSec - (at + 0.25)) < 1e-6);
  });
  it('without slip nothing changes', () => {
    let s = run(loaded(), { type: 'deck/playPause', deck: 0 }, { type: 'deck/jogTouch', deck: 0, touched: true });
    s = run(s, { type: 'deck/jog', deck: 0, mode: 'scratch', ticks: 100 }, { type: 'deck/jogTouch', deck: 0, touched: false });
    assert.equal(s.decks[0].slipPos, null);
  });
});
