// State → engine commands (src/audio/mirror.ts): what the audio bridge sends, and when.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coalesceKey, isDiscrete, mirrorDeck, mirrorMaster, scratchReport, type DeckMirror, type EngineCommand } from '../src/audio/mirror.ts';
import type { EngineAction } from '../src/engine/actions.ts';
import { initialState } from '../src/engine/initialState.ts';
import { reduce } from '../src/engine/reducer.ts';
import type { EngineState } from '../src/engine/types.ts';

const run = (s: EngineState, ...actions: EngineAction[]) => actions.reduce(reduce, s);
const ready = () => run(initialState(), { type: 'deck/load', deck: 0, trackId: 'demo-1' }, { type: 'deck/engine', deck: 0, ready: true });
const kinds = (cmds: EngineCommand[]) => cmds.map((c) => c[0]);
/** Mirror after the full first send. */
const settled = (s: EngineState): DeckMirror => mirrorDeck(null, s, 0).next;

describe('mirrorDeck', () => {
  it('sends everything when the engine has just taken the track, seek before play', () => {
    const s = run(ready(), { type: 'deck/playPause', deck: 0 });
    const { cmds } = mirrorDeck(null, s, 0);
    assert.deepEqual(kinds(cmds), ['seek', 'loop', 'scratch', 'rate', 'channel', 'play']);
    const seek = cmds.find((c) => c[0] === 'seek')!;
    assert.equal(seek[2], s.decks[0].positionSec);
    assert.deepEqual(cmds[cmds.length - 1], ['play', 0, 1]);
    assert.deepEqual(cmds.find((c) => c[0] === 'scratch'), ['scratch', 0, 0, 0], 'not under the hand: scratch off');
  });

  it('sends nothing when nothing changed', () => {
    const s = ready();
    const m = settled(s);
    assert.deepEqual(mirrorDeck(m, s, 0).cmds, []);
  });

  it('CUE while playing: pause first, then the seek — the engine must not run past the cue', () => {
    let s = run(ready(), { type: 'deck/playPause', deck: 0 }, { type: 'transport/sync', positions: [12, null], playing: [true, true] });
    const m = settled(s);
    s = run(s, { type: 'deck/cue', deck: 0, pressed: true });
    const { cmds } = mirrorDeck(m, s, 0);
    assert.deepEqual(cmds, [
      ['play', 0, 0],
      ['seek', 0, s.decks[0].cueSec],
    ]);
  });

  it('a knob move is one channel command; the crossfader is one master command', () => {
    const s0 = ready();
    const m = settled(s0);
    const s = run(s0, { type: 'mixer/set', ch: 0, param: 'eqLow', value: 0.2 });
    const { cmds } = mirrorDeck(m, s, 0);
    assert.deepEqual(cmds, [['channel', 0, 0.5, 0.5, 0.5, 0.2, 0.5, 0, 0]]);
    const master = mirrorMaster(mirrorMaster(null, s0).next, run(s0, { type: 'mixer/crossfader', value: 0.25 }));
    assert.deepEqual(master.cmd, ['master', 0.25, 0.8, 0.6, 0.5, 0]);
    assert.equal(mirrorMaster(master.next, run(s0, { type: 'mixer/crossfader', value: 0.25 })).cmd, null);
  });

  it('tempo and bend both land in one rate command, never below zero', () => {
    const s0 = ready();
    const m = settled(s0);
    let s = run(s0, { type: 'deck/tempo', deck: 0, value01: 1 });
    assert.deepEqual(mirrorDeck(m, s, 0).cmds, [['rate', 0, 1.1]]);
    s = run(s, { type: 'deck/playPause', deck: 0 }, { type: 'deck/jog', deck: 0, mode: 'bend', ticks: -80 });
    const rate = mirrorDeck(m, s, 0).cmds.find((c) => c[0] === 'rate')!;
    assert.ok((rate[2] as number) >= 0);
  });

  it('a loop is sent once with its bounds and cleared once', () => {
    const s0 = ready();
    const m = settled(s0);
    let s = run(s0, { type: 'deck/beatLoop', deck: 0, beats: 4 });
    const on = mirrorDeck(m, s, 0);
    const loop = on.cmds.find((c) => c[0] === 'loop')!;
    assert.equal(loop[1], 0);
    assert.equal(loop[4], 1);
    assert.ok((loop[3] as number) > (loop[2] as number));
    s = run(s, { type: 'deck/loopExit', deck: 0 });
    assert.deepEqual(mirrorDeck(on.next, s, 0).cmds, [['loop', 0, 0, 0, 0]]);
  });

  it('touching the platter in vinyl mode starts scratch-follow at the playhead, releasing ends it', () => {
    const s0 = run(ready(), { type: 'deck/playPause', deck: 0 });
    const m = settled(s0);
    let s = run(s0, { type: 'deck/jogTouch', deck: 0, touched: true });
    assert.deepEqual(mirrorDeck(m, s, 0).cmds, [['scratch', 0, 1, s.decks[0].positionSec]]);
    const held = mirrorDeck(m, s, 0).next;
    s = run(s, { type: 'deck/jog', deck: 0, mode: 'scratch', ticks: 12 });
    assert.deepEqual(mirrorDeck(held, s, 0).cmds, [], 'moving the hand is reported per frame, not per tick');
    assert.deepEqual(scratchReport(s, 0), ['scratch', 0, 1, s.decks[0].positionSec]);
    s = run(s, { type: 'deck/jogTouch', deck: 0, touched: false });
    assert.deepEqual(mirrorDeck(held, s, 0).cmds, [['scratch', 0, 0, 0]]);
    assert.equal(scratchReport(s, 0), null);
  });

  it('a jog seek while paused (vinyl off) is a plain seek', () => {
    const s0 = run(ready(), { type: 'deck/jogTouch', deck: 0, touched: true });
    const m = settled({ ...s0, decks: [{ ...s0.decks[0], vinyl: false }, s0.decks[1]] });
    const s = run({ ...s0, decks: [{ ...s0.decks[0], vinyl: false }, s0.decks[1]] }, { type: 'deck/jog', deck: 0, mode: 'bend', ticks: 5 });
    assert.deepEqual(kinds(mirrorDeck(m, s, 0).cmds), ['seek']);
  });
});

describe('batching rules', () => {
  it('transport commands are discrete; parameters coalesce per deck', () => {
    assert.equal(isDiscrete(['play', 0, 1]), true);
    assert.equal(isDiscrete(['seek', 1, 3]), true);
    assert.equal(isDiscrete(['loop', 0, 1, 2, 1]), true);
    assert.equal(isDiscrete(['rate', 0, 1]), false);
    assert.equal(isDiscrete(['channel', 1, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 0]), false);
    assert.equal(coalesceKey(['rate', 1, 1]), 'rate1');
    assert.equal(coalesceKey(['scratch', 0, 1, 2]), 'scratch0');
    assert.equal(coalesceKey(['master', 0.5, 0.8, 0.6, 0.5, 0]), 'master');
  });
});
