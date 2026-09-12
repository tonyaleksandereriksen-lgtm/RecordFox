import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Flx2Decoder, MSB_FLUSH_MS } from '../src/midi/decoder.ts';
import {
  encodeDeckAbs,
  encodeDeckButton,
  encodeGlobalAbs,
  encodeGlobalButton,
  encodeJog,
  encodeJogTouch,
  encodePad,
} from '../src/midi/encoder.ts';
import { DECK_CC14, DECK_JOG, DECK_NOTES, GLOBAL_CC14, GLOBAL_NOTES, PAD_MODES } from '../src/midi/flx2Map.ts';
import type { DeckButtonId, DeckIndex, Flx2Event } from '../src/midi/types.ts';

const decodeAll = (dec: Flx2Decoder, msgs: number[][], t = 0): Flx2Event[] => msgs.flatMap((m) => dec.decode(m, t));

describe('FLX2 map — official values', () => {
  it('uses the PDF numbers for the transport', () => {
    const d = (id: string) => DECK_NOTES.find((r) => r.id === id)!.data1;
    assert.equal(d('play'), 0x0b);
    assert.equal(d('playShift'), 0x47);
    assert.equal(d('cue'), 0x0c);
    assert.equal(d('cueShift'), 0x48);
    assert.equal(d('sync'), 0x58);
    assert.equal(d('jogTouch'), 0x36);
    assert.equal(d('jogTouchShift'), 0x67);
  });
  it('uses the PDF numbers for jog, tempo and mixer', () => {
    assert.deepEqual(DECK_JOG.map((r) => r.data1), [0x22, 0x23, 0x29, 0x21]);
    const tempo = DECK_CC14.find((r) => r.id === 'tempo')!;
    assert.deepEqual([tempo.msb, tempo.lsb], [0x00, 0x20]);
    assert.deepEqual(DECK_CC14.filter((r) => r.id.startsWith('eq')).map((r) => [r.msb, r.lsb]), [[0x07, 0x27], [0x0b, 0x2b], [0x0f, 0x2f]]);
    assert.deepEqual(GLOBAL_CC14.filter((r) => r.id.startsWith('cfx')).map((r) => [r.msb, r.lsb]), [[0x17, 0x37], [0x18, 0x38]]);
  });
  it('has no duplicate data1 within a channel group', () => {
    const uniq = (xs: number[]) => new Set(xs).size === xs.length;
    assert.ok(uniq(DECK_NOTES.map((r) => r.data1)));
    assert.ok(uniq(GLOBAL_NOTES.map((r) => r.data1)));
    assert.ok(uniq([...DECK_CC14.flatMap((r) => [r.msb, r.lsb]), ...DECK_JOG.map((r) => r.data1)]));
  });
});

describe('Flx2Decoder', () => {
  it('round-trips every deck button on both decks', () => {
    const dec = new Flx2Decoder();
    for (const deck of [0, 1] as DeckIndex[]) {
      for (const row of DECK_NOTES) {
        if (row.id === 'jogTouch' || row.id === 'jogTouchShift') continue;
        const [e] = dec.decode(encodeDeckButton(deck, row.id as DeckButtonId, true), 0);
        assert.deepEqual(e, { kind: 'deckButton', deck, id: row.id, pressed: true });
        const [r] = dec.decode(encodeDeckButton(deck, row.id as DeckButtonId, false), 0);
        assert.equal(r.kind === 'deckButton' && r.pressed, false);
      }
    }
  });

  it('treats Note Off (0x8n) as release', () => {
    const dec = new Flx2Decoder();
    const [e] = dec.decode([0x81, 0x0b, 0x40], 0);
    assert.deepEqual(e, { kind: 'deckButton', deck: 1, id: 'play', pressed: false });
  });

  it('round-trips global buttons', () => {
    const dec = new Flx2Decoder();
    for (const row of GLOBAL_NOTES) {
      const [e] = dec.decode(encodeGlobalButton(row.id, true), 0);
      assert.deepEqual(e, { kind: 'globalButton', id: row.id, pressed: true });
    }
  });

  it('decodes jog touch with and without SHIFT', () => {
    const dec = new Flx2Decoder();
    assert.deepEqual(dec.decode(encodeJogTouch(0, true), 0)[0], { kind: 'jogTouch', deck: 0, touched: true, shift: false });
    assert.deepEqual(dec.decode(encodeJogTouch(1, true, true), 0)[0], { kind: 'jogTouch', deck: 1, touched: true, shift: true });
  });

  it('decodes relative jog ticks around 0x40', () => {
    const dec = new Flx2Decoder();
    assert.deepEqual(dec.decode([0xb0, 0x22, 0x41], 0)[0], { kind: 'jog', deck: 0, surface: 'vinyl', ticks: 1 });
    assert.deepEqual(dec.decode([0xb1, 0x23, 0x3f], 0)[0], { kind: 'jog', deck: 1, surface: 'bend', ticks: -1 });
    assert.deepEqual(dec.decode([0xb0, 0x29, 0x45], 0)[0], { kind: 'jog', deck: 0, surface: 'search', ticks: 5 });
    assert.deepEqual(dec.decode([0xb0, 0x21, 0x30], 0)[0], { kind: 'jog', deck: 0, surface: 'side', ticks: -16 });
    const total = decodeAll(dec, encodeJog(0, 'vinyl', 150)).reduce((a, e) => a + (e.kind === 'jog' ? e.ticks : 0), 0);
    assert.equal(total, 150);
  });

  it('assembles 14-bit values from MSB then LSB', () => {
    const dec = new Flx2Decoder();
    for (const row of DECK_CC14) {
      for (const v of [0, 0.25, 0.5, 1]) {
        const evs = decodeAll(dec, encodeDeckAbs(1, row.id, v));
        assert.equal(evs.length, 1, `${row.id} should emit once per MSB/LSB pair`);
        const e = evs[0];
        assert.equal(e.kind, 'deckAbs');
        if (e.kind === 'deckAbs') {
          assert.equal(e.id, row.id);
          assert.equal(e.deck, 1);
          assert.ok(Math.abs(e.value - v) < 1 / 16383 + 1e-9);
        }
      }
    }
  });

  it('keeps full 14-bit resolution (MSB/LSB carry)', () => {
    const dec = new Flx2Decoder();
    const [e] = decodeAll(dec, [[0xb0, 0x00, 0x40], [0xb0, 0x20, 0x00]]);
    assert.equal(e.kind === 'deckAbs' && e.raw14, 8192);
    const [f] = decodeAll(dec, [[0xb0, 0x00, 0x3f], [0xb0, 0x20, 0x7f]]);
    assert.equal(f.kind === 'deckAbs' && f.raw14, 8191);
  });

  it('flushes a lone MSB after the timeout', () => {
    const dec = new Flx2Decoder();
    assert.equal(dec.decode([0xb6, 0x1f, 0x7f], 100).length, 0);
    assert.equal(dec.flush(100 + MSB_FLUSH_MS - 1).length, 0);
    const [e] = dec.flush(100 + MSB_FLUSH_MS);
    assert.equal(e.kind === 'globalAbs' && e.id, 'crossfader');
    assert.equal(dec.flush(1000).length, 0);
  });

  it('round-trips global 14-bit controls', () => {
    const dec = new Flx2Decoder();
    for (const row of GLOBAL_CC14) {
      const [e] = decodeAll(dec, encodeGlobalAbs(row.id, 0.75));
      assert.equal(e.kind === 'globalAbs' && e.id, row.id);
    }
  });

  it('decodes pads per deck, mode and SHIFT channel', () => {
    const dec = new Flx2Decoder();
    for (const deck of [0, 1] as DeckIndex[]) {
      for (const mode of PAD_MODES) {
        for (let pad = 0; pad < 8; pad++) {
          for (const shift of [false, true]) {
            const [e] = dec.decode(encodePad(deck, mode, pad, shift, true), 0);
            assert.deepEqual(e, { kind: 'pad', deck, mode, pad, shift, pressed: true });
          }
        }
      }
    }
    // Deck 1 pads live on MIDI ch 8 (0x97), SHIFT on ch 9 (0x98); deck 2 on ch 10/11.
    assert.deepEqual(encodePad(0, 'hotcue', 0, false, true), [0x97, 0x00, 0x7f]);
    assert.deepEqual(encodePad(0, 'hotcue', 0, true, true), [0x98, 0x00, 0x7f]);
    assert.deepEqual(encodePad(1, 'beatloop', 7, false, true), [0x99, 0x67, 0x7f]);
    assert.deepEqual(encodePad(1, 'sampler', 3, true, true), [0x9a, 0x33, 0x7f]);
  });

  it('ignores unmapped messages but labels them for the monitor', () => {
    const dec = new Flx2Decoder();
    assert.deepEqual(dec.decode([0xb6, 0x55, 0x10], 0), []);
    assert.equal(dec.describe([0xb6, 0x55, 0x10]).confidence, 'unmapped');
    assert.equal(dec.describe([0x90, 0x0b, 0x7f]).label, 'PLAY/PAUSE · deck 1');
    assert.equal(dec.describe([0x9f, 0x00, 0x7f], 'out').label, 'Track load illumination · deck 1');
    assert.equal(dec.describe([0x91, 0x17, 0x7f], 'out').label, 'Vinyl mode · deck 2');
  });

  it('binds learned global knobs', () => {
    const dec = new Flx2Decoder([{ channel: 6, msb: 0x08, lsb: 0x28, id: 'masterLevel' }]);
    const [e] = decodeAll(dec, [[0xb6, 0x08, 0x7f], [0xb6, 0x28, 0x7f]]);
    assert.deepEqual(e, { kind: 'globalAbs', id: 'masterLevel', value: 1, raw14: 16383 });
  });

  it('tracks SHIFT per deck', () => {
    const dec = new Flx2Decoder();
    dec.decode(encodeDeckButton(1, 'shift', true), 0);
    assert.equal(dec.isShift(1), true);
    assert.equal(dec.isShift(0), false);
    dec.decode(encodeDeckButton(1, 'shift', false), 0);
    assert.equal(dec.isShift(1), false);
  });
});
