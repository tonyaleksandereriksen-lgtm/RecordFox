import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initialState } from '../src/engine/initialState.ts';
import { reduce } from '../src/engine/reducer.ts';
import { BLINK_MS, computeLeds, diffLeds, ledKey } from '../src/midi/leds.ts';

const ON_PHASE = 0;
const OFF_PHASE = BLINK_MS;

describe('LED frame', () => {
  it('is dark with nothing loaded, except sampler pads that hold a sample', () => {
    const f = computeLeds(initialState(), ON_PHASE);
    for (const [k, v] of f) {
      const status = k >> 8;
      const data1 = k & 0xff;
      const samplerPad = status >= 0x97 && status <= 0x9a && data1 >= 0x30 && data1 < 0x38;
      if (!samplerPad) assert.equal(v, 0, `LED ${status.toString(16)} ${data1.toString(16)} should be off`);
    }
    assert.equal(f.get(ledKey(0x97, 0x30)), 0x7f, 'sampler slot 1 loaded');
  });

  it('PLAY blinks when paused, lights when playing; CUE lights parked on the cue', () => {
    let s = reduce(initialState(), { type: 'deck/load', deck: 0, trackId: 'demo-1' });
    assert.equal(computeLeds(s, ON_PHASE).get(ledKey(0x90, 0x0b)), 0x7f);
    assert.equal(computeLeds(s, OFF_PHASE).get(ledKey(0x90, 0x0b)), 0x00);
    assert.equal(computeLeds(s, OFF_PHASE).get(ledKey(0x90, 0x0c)), 0x7f, 'at cue: steady');
    s = reduce(s, { type: 'deck/playPause', deck: 0 });
    assert.equal(computeLeds(s, OFF_PHASE).get(ledKey(0x90, 0x0b)), 0x7f);
    assert.equal(computeLeds(s, ON_PHASE).get(ledKey(0x90, 0x0c)), 0x00, 'cue dark while playing');
  });

  it('lights SYNC, PFL, hot cue pads (both SHIFT layers) and master cue', () => {
    let s = reduce(initialState(), { type: 'deck/load', deck: 1, trackId: 'demo-2' });
    s = reduce(s, { type: 'deck/syncToggle', deck: 1 });
    s = reduce(s, { type: 'mixer/pfl', ch: 1 });
    s = reduce(s, { type: 'mixer/masterCue' });
    const f = computeLeds(s, ON_PHASE);
    assert.equal(f.get(ledKey(0x91, 0x58)), 0x7f);
    assert.equal(f.get(ledKey(0x91, 0x54)), 0x7f);
    assert.equal(f.get(ledKey(0x99, 0x00)), 0x7f, 'hot cue A set by preset');
    assert.equal(f.get(ledKey(0x9a, 0x00)), 0x7f);
    assert.equal(f.get(ledKey(0x99, 0x07)), 0x00, 'hot cue H empty');
    assert.equal(f.get(ledKey(0x96, 0x63)), 0x7f);
  });

  it('diff writes everything the first time and only changes afterwards', () => {
    const s = reduce(initialState(), { type: 'deck/load', deck: 0, trackId: 'demo-1' });
    const a = computeLeds(s, ON_PHASE);
    const full = diffLeds(new Map(), a);
    assert.equal(full.length, a.size);
    const b = computeLeds(s, OFF_PHASE);
    const changes = diffLeds(a, b);
    assert.ok(changes.length > 0 && changes.length <= 4, 'only blinking LEDs change');
    for (const [st] of changes) assert.equal(st, 0x90);
  });
});
