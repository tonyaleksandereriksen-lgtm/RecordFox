/**
 * Pure decoder: raw MIDI bytes -> Flx2Event[]. Holds only the state MIDI itself requires
 * (14-bit MSB latches and SHIFT). No engine knowledge, no Web MIDI — fully unit-testable.
 */
import {
  CC,
  DECK_CC14,
  DECK_CH,
  DECK_JOG,
  DECK_NOTES,
  GLOBAL_CC14,
  GLOBAL_CH,
  GLOBAL_NOTES,
  ILLUMINATION_CH,
  NOTE_OFF,
  NOTE_ON,
  PAD_CH,
  padModeFromData1,
  type Cc14Row,
  type JogRow,
  type NoteRow,
} from './flx2Map.ts';
import type {
  Confidence,
  DeckAbsId,
  DeckButtonId,
  DeckIndex,
  Flx2Event,
  GlobalAbsId,
  GlobalButtonId,
  PadMode,
} from './types.ts';

export const MAX14 = 0x3fff;
/** A lone MSB with no LSB after this long is emitted on its own (device sent MSB only). */
export const MSB_FLUSH_MS = 4;

export interface LearnedBinding {
  channel: number; // zero-based MIDI channel
  msb: number;
  lsb: number;
  id: GlobalAbsId;
}

type DeckNoteRow = NoteRow<DeckButtonId | 'jogTouch' | 'jogTouchShift'>;
type Cc14Target =
  | { scope: 'deck'; row: Cc14Row<DeckAbsId>; part: 'msb' | 'lsb' }
  | { scope: 'global'; row: Cc14Row<GlobalAbsId>; part: 'msb' | 'lsb'; learned?: boolean };

interface Latch {
  msb: number;
  lsb: number;
  /** false until an MSB has been seen — an LSB before that is mid-gesture noise and is dropped. */
  msbSeen: boolean;
  pending: boolean;
  t: number;
  deck: DeckIndex | null;
  target: Cc14Target;
}

export interface Description {
  label: string;
  detail?: string;
  confidence: Confidence | 'unmapped' | 'system';
}

const PAD_MODE_LABEL: Record<PadMode | 'unknown', string> = {
  hotcue: 'HOT CUE',
  padfx: 'PAD FX',
  beatloop: 'BEAT LOOP',
  sampler: 'SAMPLER',
  unknown: 'PAD (unknown mode)',
};

export class Flx2Decoder {
  private readonly deckNotes = new Map<number, DeckNoteRow>();
  private readonly globalNotes = new Map<number, NoteRow<GlobalButtonId>>();
  private readonly deckJog = new Map<number, JogRow>();
  private readonly deckCc = new Map<number, Cc14Target>();
  /** key: channel << 8 | data1 */
  private readonly globalCc = new Map<number, Cc14Target>();
  private readonly latches = new Map<number, Latch>();
  private readonly shift: [boolean, boolean] = [false, false];

  constructor(learned: readonly LearnedBinding[] = []) {
    for (const r of DECK_NOTES) this.deckNotes.set(r.data1, r);
    for (const r of GLOBAL_NOTES) this.globalNotes.set(r.data1, r);
    for (const r of DECK_JOG) this.deckJog.set(r.data1, r);
    for (const row of DECK_CC14) {
      this.deckCc.set(row.msb, { scope: 'deck', row, part: 'msb' });
      this.deckCc.set(row.lsb, { scope: 'deck', row, part: 'lsb' });
    }
    for (const row of GLOBAL_CC14) {
      this.globalCc.set((GLOBAL_CH << 8) | row.msb, { scope: 'global', row, part: 'msb' });
      this.globalCc.set((GLOBAL_CH << 8) | row.lsb, { scope: 'global', row, part: 'lsb' });
    }
    this.setLearned(learned);
  }

  /** Replace runtime-learned global bindings (MASTER LEVEL, HEADPHONES LEVEL). */
  setLearned(bindings: readonly LearnedBinding[]): void {
    for (const [k, v] of this.globalCc) if (v.scope === 'global' && v.learned) this.globalCc.delete(k);
    for (const b of bindings) {
      const row: Cc14Row<GlobalAbsId> = { msb: b.msb, lsb: b.lsb, id: b.id, label: `${b.id} (learned)`, confidence: 'unverified' };
      const msbKey = (b.channel << 8) | b.msb;
      const lsbKey = (b.channel << 8) | b.lsb;
      if (!this.globalCc.has(msbKey)) this.globalCc.set(msbKey, { scope: 'global', row, part: 'msb', learned: true });
      if (!this.globalCc.has(lsbKey)) this.globalCc.set(lsbKey, { scope: 'global', row, part: 'lsb', learned: true });
    }
  }

  isShift(deck: DeckIndex): boolean {
    return this.shift[deck];
  }

  reset(): void {
    this.latches.clear();
    this.shift[0] = this.shift[1] = false;
  }

  decode(bytes: ArrayLike<number>, t: number): Flx2Event[] {
    const status = bytes[0] ?? 0;
    if (status === 0xf0) return [{ kind: 'sysex', bytes: Array.from(bytes) }];
    const type = status & 0xf0;
    const ch = status & 0x0f;
    const d1 = bytes[1] ?? 0;
    const d2 = bytes[2] ?? 0;

    if (type === NOTE_ON || type === NOTE_OFF) {
      const pressed = type === NOTE_ON && d2 > 0;
      return this.decodeNote(ch, d1, pressed);
    }
    if (type === CC) return this.decodeCc(ch, d1, d2, t);
    return [];
  }

  /** Emit latched MSBs that never got an LSB. Call from a timer (driver does every 5 ms). */
  flush(now: number): Flx2Event[] {
    const out: Flx2Event[] = [];
    for (const latch of this.latches.values()) {
      if (latch.pending && now - latch.t >= MSB_FLUSH_MS) {
        latch.pending = false;
        out.push(this.emit14(latch));
      }
    }
    return out;
  }

  private decodeNote(ch: number, d1: number, pressed: boolean): Flx2Event[] {
    if (ch === DECK_CH[0] || ch === DECK_CH[1]) {
      const deck = (ch === DECK_CH[0] ? 0 : 1) as DeckIndex;
      const row = this.deckNotes.get(d1);
      if (!row) return [];
      if (row.id === 'jogTouch' || row.id === 'jogTouchShift') {
        return [{ kind: 'jogTouch', deck, touched: pressed, shift: row.id === 'jogTouchShift' }];
      }
      if (row.id === 'shift') this.shift[deck] = pressed;
      return [{ kind: 'deckButton', deck, id: row.id, pressed }];
    }
    if (ch === GLOBAL_CH) {
      const row = this.globalNotes.get(d1);
      return row ? [{ kind: 'globalButton', id: row.id, pressed }] : [];
    }
    for (const deck of [0, 1] as DeckIndex[]) {
      const pc = PAD_CH[deck];
      if (ch === pc.normal || ch === pc.shift) {
        const { mode, pad } = padModeFromData1(d1);
        return [{ kind: 'pad', deck, mode, pad, shift: ch === pc.shift, pressed }];
      }
    }
    return [];
  }

  private decodeCc(ch: number, d1: number, d2: number, t: number): Flx2Event[] {
    if (ch === DECK_CH[0] || ch === DECK_CH[1]) {
      const deck = (ch === DECK_CH[0] ? 0 : 1) as DeckIndex;
      const jog = this.deckJog.get(d1);
      if (jog) return [{ kind: 'jog', deck, surface: jog.surface, ticks: d2 - 0x40 }];
      const target = this.deckCc.get(d1);
      if (target) return this.latch(ch, deck, target, d2, t);
      return [];
    }
    const target = this.globalCc.get((ch << 8) | d1);
    if (target) return this.latch(ch, null, target, d2, t);
    return [];
  }

  private latch(ch: number, deck: DeckIndex | null, target: Cc14Target, value: number, t: number): Flx2Event[] {
    const key = (ch << 8) | target.row.msb;
    let latch = this.latches.get(key);
    if (!latch) {
      latch = { msb: 0, lsb: 0, msbSeen: false, pending: false, t, deck, target };
      this.latches.set(key, latch);
    }
    latch.target = target;
    if (target.part === 'msb') {
      const out: Flx2Event[] = [];
      if (latch.pending) out.push(this.emit14(latch)); // two MSBs in a row: release the first
      latch.msb = value;
      latch.msbSeen = true;
      latch.pending = true;
      latch.t = t;
      return out;
    }
    latch.lsb = value;
    if (!latch.msbSeen) return []; // no MSB yet (connected mid-gesture): wait for a full pair
    latch.pending = false;
    return [this.emit14(latch)];
  }

  private emit14(latch: Latch): Flx2Event {
    const raw14 = (latch.msb << 7) | latch.lsb;
    const value = raw14 / MAX14;
    const target = latch.target;
    if (target.scope === 'deck') {
      return { kind: 'deckAbs', deck: latch.deck as DeckIndex, id: target.row.id, value, raw14 };
    }
    return { kind: 'globalAbs', id: target.row.id, value, raw14 };
  }

  /** Stateless label for the MIDI monitor (both directions). */
  describe(bytes: ArrayLike<number>, dir: 'in' | 'out' = 'in'): Description {
    const status = bytes[0] ?? 0;
    if (status === 0xf0) return { label: `SysEx (${bytes.length} bytes)`, confidence: 'system' };
    const type = status & 0xf0;
    const ch = status & 0x0f;
    const d1 = bytes[1] ?? 0;
    const d2 = bytes[2] ?? 0;
    const onOff = d2 > 0 && type === NOTE_ON ? 'ON' : 'OFF';

    if (type === NOTE_ON || type === NOTE_OFF) {
      if (ch === DECK_CH[0] || ch === DECK_CH[1]) {
        const deckLabel = `deck ${ch + 1}`;
        if (dir === 'out' && d1 === 0x17) return { label: `Vinyl mode · ${deckLabel}`, detail: onOff, confidence: 'pdf' };
        const row = this.deckNotes.get(d1);
        if (row) {
          const verb = dir === 'out' ? `LED ${onOff}` : type === NOTE_ON && d2 > 0 ? 'press' : 'release';
          return { label: `${row.label} · ${deckLabel}`, detail: verb, confidence: row.confidence };
        }
      } else if (ch === GLOBAL_CH) {
        const row = this.globalNotes.get(d1);
        if (row) {
          const verb = dir === 'out' ? `LED ${onOff}` : type === NOTE_ON && d2 > 0 ? 'press' : 'release';
          return { label: row.label, detail: verb, confidence: row.confidence };
        }
      } else if (ch === ILLUMINATION_CH && dir === 'out' && (d1 === 0 || d1 === 1)) {
        return { label: `Track load illumination · deck ${d1 + 1}`, detail: onOff, confidence: 'pdf' };
      } else {
        for (const deck of [0, 1] as DeckIndex[]) {
          const pc = PAD_CH[deck];
          if (ch === pc.normal || ch === pc.shift) {
            const { mode, pad } = padModeFromData1(d1);
            const shift = ch === pc.shift ? ' + SHIFT' : '';
            const verb = dir === 'out' ? `LED ${onOff}` : type === NOTE_ON && d2 > 0 ? 'press' : 'release';
            return {
              label: `PAD ${pad + 1}${shift} · ${PAD_MODE_LABEL[mode]} · deck ${deck + 1}`,
              detail: verb,
              confidence: mode === 'unknown' ? 'unmapped' : 'pdf',
            };
          }
        }
      }
      return { label: `Note ch${ch + 1} 0x${hex(d1)}`, detail: onOff, confidence: 'unmapped' };
    }

    if (type === CC) {
      if (ch === DECK_CH[0] || ch === DECK_CH[1]) {
        const jog = this.deckJog.get(d1);
        if (jog) {
          const ticks = d2 - 0x40;
          return { label: `${jog.label} · deck ${ch + 1}`, detail: `${ticks > 0 ? '+' : ''}${ticks}`, confidence: jog.confidence };
        }
        const target = this.deckCc.get(d1);
        if (target) return { label: `${target.row.label} · deck ${ch + 1}`, detail: `${target.part.toUpperCase()} ${d2}`, confidence: target.row.confidence };
      } else {
        const target = this.globalCc.get((ch << 8) | d1);
        if (target) return { label: target.row.label, detail: `${target.part.toUpperCase()} ${d2}`, confidence: target.row.confidence };
      }
      return { label: `CC ch${ch + 1} 0x${hex(d1)}`, detail: String(d2), confidence: 'unmapped' };
    }
    return { label: `Status 0x${hex(status)}`, confidence: 'unmapped' };
  }
}

export function hex(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0');
}

export function bytesToHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, hex).join(' ');
}
