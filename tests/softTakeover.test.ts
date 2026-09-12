import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SoftTakeover } from '../src/midi/softTakeover.ts';

describe('SoftTakeover', () => {
  it('adopts the first hardware value (hardware is the truth at startup)', () => {
    const st = new SoftTakeover();
    assert.equal(st.accept('f', 0.9, 0), true);
  });

  it('ignores hardware after a software change until it is picked up', () => {
    const st = new SoftTakeover(0.03);
    assert.equal(st.accept('f', 0.2, 0.2), true);
    // software moved to 0.8 (mouse, sync, reset...)
    assert.equal(st.accept('f', 0.25, 0.8), false);
    assert.equal(st.accept('f', 0.5, 0.8), false);
    assert.equal(st.accept('f', 0.78, 0.8), true); // within threshold
    assert.equal(st.accept('f', 0.6, 0.78), true); // engaged now, follows freely
  });

  it('picks up when the hardware crosses the software value between messages', () => {
    const st = new SoftTakeover(0.01);
    st.release('k');
    assert.equal(st.accept('k', 0.1, 0.5), false);
    assert.equal(st.accept('k', 0.9, 0.5), true);
  });

  it('release() cancels adoption for a control nobody touched yet', () => {
    const st = new SoftTakeover(0.02);
    st.release('x');
    assert.equal(st.accept('x', 1, 0), false);
  });

  it('releaseAll() requires every control to be picked up again', () => {
    const st = new SoftTakeover(0.02);
    st.accept('a', 0.5, 0.5);
    st.accept('b', 0.5, 0.5);
    st.releaseAll();
    assert.equal(st.accept('a', 0.9, 0.5), false);
    assert.equal(st.accept('b', 0.51, 0.5), true);
  });
});
