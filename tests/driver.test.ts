import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { bindings, leds, midi, store, virtualUnit } from '../src/runtime.ts';
import { ledKey } from '../src/midi/leds.ts';

describe('end-to-end through the virtual FLX2 (no Web MIDI)', () => {
  after(() => midi.attachVirtual(null));

  it('runs the init sequence: vinyl ON to both decks, LEDs written, takeover armed', () => {
    midi.attachVirtual(virtualUnit);
    assert.deepEqual(virtualUnit.vinyl, [true, true]);
    assert.equal(midi.report.vinyl, true);
    assert.equal(midi.report.leds, true);
    assert.equal(midi.report.takeover, true);
    const out = midi.log.entries().filter((e) => e.dir === 'out').map((e) => e.bytes);
    assert.deepEqual(out[0], [0x90, 0x17, 0x7f]);
    assert.deepEqual(out[1], [0x91, 0x17, 0x7f]);
  });

  it('PLAY on the unit starts the deck and the PLAY LED comes back on', () => {
    store.dispatch({ type: 'deck/load', deck: 0, trackId: 'demo-1' });
    leds.tick(0);
    virtualUnit.button(0, 'play', true);
    virtualUnit.button(0, 'play', false);
    assert.equal(store.getState().decks[0].playing, true);
    leds.tick(250); // off-phase of the blink: a playing deck stays lit
    assert.equal(virtualUnit.led(0x90, 0x0b), true);
    const loadFlash = midi.log.entries().some((e) => e.dir === 'out' && e.bytes[0] === 0x9f && e.bytes[1] === 0);
    assert.ok(loadFlash, 'load illumination 9F 00 7F sent');
  });

  it('SHIFT turns PLAY into stutter and CUE into jump-to-start', () => {
    store.dispatch({ type: 'deck/seek', deck: 0, positionSec: 40 });
    virtualUnit.button(0, 'shift', true);
    virtualUnit.button(0, 'cue', true);
    virtualUnit.button(0, 'cue', false);
    virtualUnit.button(0, 'shift', false);
    assert.equal(store.getState().decks[0].positionSec, 0);
  });

  it('faders adopt the first hardware value, then need pickup after a UI change', () => {
    virtualUnit.deckAbs(0, 'chFader', 0.9);
    assert.ok(Math.abs(store.getState().mixer.ch[0].fader - 0.9) < 1e-3);
    store.dispatch({ type: 'mixer/set', ch: 0, param: 'fader', value: 0.2 });
    bindings.uiChanged('ch0.fader');
    virtualUnit.deckAbs(0, 'chFader', 0.6);
    assert.ok(Math.abs(store.getState().mixer.ch[0].fader - 0.2) < 1e-9, 'hardware ignored until pickup');
    virtualUnit.deckAbs(0, 'chFader', 0.21);
    virtualUnit.deckAbs(0, 'chFader', 0.4);
    assert.ok(Math.abs(store.getState().mixer.ch[0].fader - 0.4) < 1e-3, 'picked up and following');
  });

  it('pads follow the firmware pad mode chosen with SHIFT + BEAT SYNC', () => {
    virtualUnit.button(1, 'shift', true);
    virtualUnit.button(1, 'sync', true);
    virtualUnit.button(1, 'sync', false);
    virtualUnit.button(1, 'shift', false);
    virtualUnit.pad(1, 2, true); // pad 3 selects Beat Loop
    assert.equal(virtualUnit.padMode[1], 'beatloop');
    store.dispatch({ type: 'deck/load', deck: 1, trackId: 'demo-2' });
    virtualUnit.pad(1, 4, true); // 4-beat loop
    virtualUnit.pad(1, 4, false);
    const d = store.getState().decks[1];
    assert.equal(d.padMode, 'beatloop');
    assert.equal(d.padModeKnown, true);
    assert.equal(d.loop.active, true);
    assert.equal(d.loop.beats, 4);
    leds.tick(0);
    assert.equal(virtualUnit.led(0x99, 0x64), true, 'beat-loop pad 5 LED lit');
    assert.equal(virtualUnit.led(ledKey(0x99, 0x60) >> 8, 0x60), false);
  });

  it('logs every message with a decoded label', () => {
    const unmapped = midi.log.entries().filter((e) => e.dir === 'in' && e.confidence === 'unmapped');
    assert.equal(unmapped.length, 0);
  });
});
