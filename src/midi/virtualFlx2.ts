/**
 * Virtual DDJ-FLX2: produces exactly the bytes the unit sends (via encoder.ts) and renders the
 * LED messages it receives. Lets the whole MIDI path — decode, bindings, soft takeover, LED
 * echo — run without hardware, in the app and in tests.
 */
import {
  encodeDeckAbs,
  encodeDeckButton,
  encodeGlobalAbs,
  encodeGlobalButton,
  encodeJog,
  encodeJogTouch,
  encodePad,
} from './encoder.ts';
import { DECK_CH, ILLUMINATION_CH, NOTE_ON, PAD_MODES } from './flx2Map.ts';
import { ledKey } from './leds.ts';
import type { DeckAbsId, DeckIndex, GlobalAbsId, PadMode } from './types.ts';

export type VirtualButton = 'play' | 'cue' | 'sync' | 'shift' | 'chCue';
export const SYNC_LONG_PRESS_MS = 700;

export class VirtualFlx2 {
  readonly name = 'Virtual FLX2';
  readonly leds = new Map<number, number>();
  readonly vinyl: [boolean, boolean] = [false, false];
  readonly loadFlash: [number, number] = [0, 0];
  readonly padMode: [PadMode, PadMode] = ['hotcue', 'hotcue'];
  readonly padSelect: [boolean, boolean] = [false, false];
  readonly shift: [boolean, boolean] = [false, false];
  /** Physical positions of the absolute controls (0..1), for drawing. */
  readonly abs = new Map<string, number>();
  private sink: ((bytes: number[]) => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private syncTimers: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null] = [null, null];
  private version = 0;

  /** The driver calls this: bytes the "unit" sends go to `sink`. */
  connect(sink: (bytes: number[]) => void): void {
    this.sink = sink;
  }

  disconnect(): void {
    this.sink = null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getVersion(): number {
    return this.version;
  }

  private changed(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  private emit(bytes: number[]): void {
    this.sink?.(bytes);
  }

  /** Software -> unit. */
  receive(bytes: number[]): void {
    const [status, d1, d2] = bytes;
    if (status === (NOTE_ON | ILLUMINATION_CH) && (d1 === 0 || d1 === 1)) {
      this.loadFlash[d1] = performance.now();
    } else if ((status === (NOTE_ON | DECK_CH[0]) || status === (NOTE_ON | DECK_CH[1])) && d1 === 0x17) {
      this.vinyl[status & 0x0f] = d2 > 0;
    } else if ((status & 0xf0) === NOTE_ON) {
      this.leds.set(ledKey(status, d1), d2);
    }
    this.changed();
  }

  led(status: number, data1: number): boolean {
    return (this.leds.get(ledKey(status, data1)) ?? 0) > 0;
  }

  button(deck: DeckIndex, id: VirtualButton, down: boolean): void {
    const shift = this.shift[deck];
    switch (id) {
      case 'shift':
        this.shift[deck] = down;
        this.emit(encodeDeckButton(deck, 'shift', down));
        break;
      case 'play':
        this.emit(encodeDeckButton(deck, shift ? 'playShift' : 'play', down));
        break;
      case 'cue':
        this.emit(encodeDeckButton(deck, shift ? 'cueShift' : 'cue', down));
        break;
      case 'chCue':
        this.emit(encodeDeckButton(deck, shift ? 'chCueShift' : 'chCue', down));
        break;
      case 'sync':
        if (shift) {
          this.emit(encodeDeckButton(deck, 'syncShift', down));
          if (down) this.padSelect[deck] = true; // firmware pad-mode selection
          break;
        }
        this.emit(encodeDeckButton(deck, 'sync', down));
        if (down) {
          this.syncTimers[deck] = setTimeout(() => {
            this.emit(encodeDeckButton(deck, 'syncLong', true));
            this.emit(encodeDeckButton(deck, 'syncLong', false));
          }, SYNC_LONG_PRESS_MS);
        } else if (this.syncTimers[deck]) {
          clearTimeout(this.syncTimers[deck]!);
          this.syncTimers[deck] = null;
        }
        break;
    }
    this.changed();
  }

  masterCue(down: boolean): void {
    this.emit(encodeGlobalButton(this.shift[0] || this.shift[1] ? 'masterCueShift' : 'masterCue', down));
  }

  smartFader(down: boolean): void {
    this.emit(encodeGlobalButton(this.shift[0] || this.shift[1] ? 'smartFaderShift' : 'smartFader', down));
  }

  jogTouch(deck: DeckIndex, touched: boolean): void {
    this.emit(encodeJogTouch(deck, touched, this.shift[deck]));
  }

  /** `onTop` = platter surface (touch-sensitive), otherwise the side ring. */
  jogTurn(deck: DeckIndex, ticks: number, onTop: boolean): void {
    const surface = this.shift[deck] && onTop ? 'search' : onTop ? (this.vinyl[deck] ? 'vinyl' : 'bend') : 'side';
    for (const m of encodeJog(deck, surface, ticks)) this.emit(m);
  }

  deckAbs(deck: DeckIndex, id: DeckAbsId, value01: number): void {
    this.abs.set(`${deck}.${id}`, value01);
    for (const m of encodeDeckAbs(deck, id, value01)) this.emit(m);
    this.changed();
  }

  globalAbs(id: GlobalAbsId, value01: number, channel?: number, msb?: number, lsb?: number): void {
    this.abs.set(id, value01);
    for (const m of encodeGlobalAbs(id, value01, channel, msb, lsb)) this.emit(m);
    this.changed();
  }

  pad(deck: DeckIndex, pad: number, down: boolean): void {
    if (this.padSelect[deck]) {
      // SHIFT + BEAT SYNC then pad 1..4: the firmware changes mode and sends nothing.
      if (down && pad < 4) {
        this.padMode[deck] = PAD_MODES[pad];
        this.padSelect[deck] = false;
        this.changed();
      }
      return;
    }
    this.emit(encodePad(deck, this.padMode[deck], pad, this.shift[deck], down));
  }

  /** Put the controls where the software expects them (e.g. faders down) — like a real unit at power-on. */
  sendAllPositions(): void {
    for (const [k, v] of this.abs) {
      if (k.includes('.')) {
        const [deck, id] = k.split('.');
        for (const m of encodeDeckAbs(Number(deck) as DeckIndex, id as DeckAbsId, v)) this.emit(m);
      } else {
        for (const m of encodeGlobalAbs(k as GlobalAbsId, v)) this.emit(m);
      }
    }
  }
}
