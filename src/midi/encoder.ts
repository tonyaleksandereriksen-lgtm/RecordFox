/**
 * Encoder: the inverse of the decoder, built from the same map table. Used by the virtual
 * FLX2 and by tests (every row must survive encode -> decode unchanged).
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
  NOTE_ON,
  OFF,
  ON,
  PAD_CH,
  PAD_MODE_BASE,
} from './flx2Map.ts';
import { MAX14 } from './decoder.ts';
import type { DeckAbsId, DeckButtonId, DeckIndex, GlobalAbsId, GlobalButtonId, JogSurface, PadMode } from './types.ts';

export function encodeDeckButton(deck: DeckIndex, id: DeckButtonId, pressed: boolean): number[] {
  const row = DECK_NOTES.find((r) => r.id === id);
  if (!row) throw new Error(`No deck note for ${id}`);
  return [NOTE_ON | DECK_CH[deck], row.data1, pressed ? ON : OFF];
}

export function encodeGlobalButton(id: GlobalButtonId, pressed: boolean): number[] {
  const row = GLOBAL_NOTES.find((r) => r.id === id);
  if (!row) throw new Error(`No global note for ${id}`);
  return [NOTE_ON | GLOBAL_CH, row.data1, pressed ? ON : OFF];
}

export function encodeJogTouch(deck: DeckIndex, touched: boolean, shift = false): number[] {
  const row = DECK_NOTES.find((r) => r.id === (shift ? 'jogTouchShift' : 'jogTouch'))!;
  return [NOTE_ON | DECK_CH[deck], row.data1, touched ? ON : OFF];
}

/** Large movements are split into several messages, as the hardware does. */
export function encodeJog(deck: DeckIndex, surface: JogSurface, ticks: number): number[][] {
  const row = DECK_JOG.find((r) => r.surface === surface)!;
  const out: number[][] = [];
  let left = Math.round(ticks);
  while (left !== 0) {
    const step = Math.max(-63, Math.min(63, left));
    out.push([CC | DECK_CH[deck], row.data1, 0x40 + step]);
    left -= step;
  }
  return out;
}

export function to14(value01: number): number {
  return Math.max(0, Math.min(MAX14, Math.round(value01 * MAX14)));
}

export function encodeDeckAbs(deck: DeckIndex, id: DeckAbsId, value01: number): number[][] {
  const row = DECK_CC14.find((r) => r.id === id)!;
  const v = to14(value01);
  return [
    [CC | DECK_CH[deck], row.msb, v >> 7],
    [CC | DECK_CH[deck], row.lsb, v & 0x7f],
  ];
}

export function encodeGlobalAbs(id: GlobalAbsId, value01: number, channel = GLOBAL_CH, msb?: number, lsb?: number): number[][] {
  const row = GLOBAL_CC14.find((r) => r.id === id);
  const m = msb ?? row?.msb;
  const l = lsb ?? row?.lsb;
  if (m === undefined || l === undefined) return [];
  const v = to14(value01);
  return [
    [CC | channel, m, v >> 7],
    [CC | channel, l, v & 0x7f],
  ];
}

export function encodePad(deck: DeckIndex, mode: PadMode, pad: number, shift: boolean, pressed: boolean): number[] {
  const pc = PAD_CH[deck];
  return [NOTE_ON | (shift ? pc.shift : pc.normal), PAD_MODE_BASE[mode] + pad, pressed ? ON : OFF];
}
