/**
 * DDJ-FLX2 MIDI map — the single source of truth for every byte this app reads or writes.
 *
 * Source: AlphaTheta "DDJ-FLX2 MIDI Message List" (E1). Values were read from the official
 * table and cross-checked against the DDJ-FLX4/DDJ-400 family layout, which the FLX2 matches
 * in every row that was legible. Rows marked 'unverified' must be confirmed with the MIDI
 * monitor on real hardware; nothing here is invented HID.
 *
 * Channel numbering in code is zero-based: deck n = 0|1 (MIDI ch 1|2), global = 6 (MIDI ch 7),
 * pads = 7..10 (MIDI ch 8..11), illumination = 15 (MIDI ch 16).
 */
import type {
  Confidence,
  DeckAbsId,
  DeckButtonId,
  DeckIndex,
  GlobalAbsId,
  GlobalButtonId,
  JogSurface,
  PadMode,
} from './types.ts';

export const NOTE_ON = 0x90;
export const NOTE_OFF = 0x80;
export const CC = 0xb0;
export const ON = 0x7f;
export const OFF = 0x00;

export const DECK_CH: readonly [number, number] = [0, 1];
export const GLOBAL_CH = 6;
export const ILLUMINATION_CH = 15;

export interface NoteRow<Id extends string> {
  data1: number;
  id: Id;
  label: string;
  /** true when the unit has an LED addressed by the same status/data1 (MIDI-OUT column). */
  led: boolean;
  confidence: Confidence;
}

export interface Cc14Row<Id extends string> {
  msb: number;
  lsb: number;
  id: Id;
  label: string;
  confidence: Confidence;
}

export interface JogRow {
  data1: number;
  surface: JogSurface;
  label: string;
  confidence: Confidence;
}

/** Deck notes, status 0x9n with n = deck channel. */
export const DECK_NOTES: readonly NoteRow<DeckButtonId | 'jogTouch' | 'jogTouchShift'>[] = [
  { data1: 0x0b, id: 'play', label: 'PLAY/PAUSE', led: true, confidence: 'pdf' },
  { data1: 0x47, id: 'playShift', label: 'SHIFT + PLAY/PAUSE', led: true, confidence: 'pdf' },
  { data1: 0x0c, id: 'cue', label: 'CUE', led: true, confidence: 'pdf' },
  { data1: 0x48, id: 'cueShift', label: 'SHIFT + CUE', led: true, confidence: 'pdf' },
  { data1: 0x58, id: 'sync', label: 'BEAT SYNC', led: true, confidence: 'pdf' },
  { data1: 0x2a, id: 'syncLong', label: 'BEAT SYNC (long press)', led: false, confidence: 'unverified' },
  { data1: 0x5c, id: 'syncShift', label: 'SHIFT + BEAT SYNC (pad-mode select)', led: false, confidence: 'unverified' },
  { data1: 0x36, id: 'jogTouch', label: 'JOG touch', led: false, confidence: 'pdf' },
  { data1: 0x67, id: 'jogTouchShift', label: 'SHIFT + JOG touch', led: false, confidence: 'pdf' },
  { data1: 0x3f, id: 'shift', label: 'SHIFT', led: false, confidence: 'pdf' },
  { data1: 0x54, id: 'chCue', label: 'HEADPHONE CUE (CH)', led: true, confidence: 'pdf' },
  { data1: 0x08, id: 'chCueShift', label: 'SHIFT + HEADPHONE CUE (CH)', led: false, confidence: 'unverified' },
  // Fader-start messages: sent by the unit for channel-fader start and crossfader start.
  { data1: 0x66, id: 'faderStartPlay', label: 'Fader start → PLAY', led: false, confidence: 'pdf' },
  { data1: 0x5d, id: 'faderStartSync', label: 'Fader start → SYNC', led: false, confidence: 'pdf' },
  { data1: 0x52, id: 'faderStartCue', label: 'Fader start → CUE', led: false, confidence: 'pdf' },
];

/** Deck 14-bit CCs, status 0xBn. Pioneer sends MSB then LSB. */
export const DECK_CC14: readonly Cc14Row<DeckAbsId>[] = [
  { msb: 0x00, lsb: 0x20, id: 'tempo', label: 'TEMPO', confidence: 'pdf' },
  { msb: 0x07, lsb: 0x27, id: 'eqHi', label: 'EQ HI', confidence: 'pdf' },
  { msb: 0x0b, lsb: 0x2b, id: 'eqMid', label: 'EQ MID', confidence: 'pdf' },
  { msb: 0x0f, lsb: 0x2f, id: 'eqLow', label: 'EQ LOW', confidence: 'pdf' },
  { msb: 0x13, lsb: 0x33, id: 'chFader', label: 'CH FADER', confidence: 'pdf' },
];

/** Deck relative jog CCs, status 0xBn. 0x40 = rest, 0x41.. clockwise, ..0x3F counter-clockwise. */
export const DECK_JOG: readonly JogRow[] = [
  { data1: 0x22, surface: 'vinyl', label: 'JOG platter (vinyl ON)', confidence: 'pdf' },
  { data1: 0x23, surface: 'bend', label: 'JOG platter (vinyl OFF)', confidence: 'pdf' },
  { data1: 0x29, surface: 'search', label: 'SHIFT + JOG platter', confidence: 'pdf' },
  { data1: 0x21, surface: 'side', label: 'JOG side ring', confidence: 'pdf' },
];

/** Global 14-bit CCs, status 0xB6. */
export const GLOBAL_CC14: readonly Cc14Row<GlobalAbsId>[] = [
  { msb: 0x17, lsb: 0x37, id: 'cfx1', label: 'CFX (CH 1)', confidence: 'pdf' },
  { msb: 0x18, lsb: 0x38, id: 'cfx2', label: 'CFX (CH 2)', confidence: 'pdf' },
  { msb: 0x1f, lsb: 0x3f, id: 'crossfader', label: 'CROSSFADER', confidence: 'family' },
  // MASTER LEVEL and HEADPHONES LEVEL exist on ch 7 in the PDF, but their CC numbers were not
  // legible in the extraction. They are bound at runtime with MIDI Learn (see learn.ts).
];

/** Global notes, status 0x96. */
export const GLOBAL_NOTES: readonly NoteRow<GlobalButtonId>[] = [
  { data1: 0x63, id: 'masterCue', label: 'HEADPHONE CUE (MASTER)', led: true, confidence: 'pdf' },
  { data1: 0x00, id: 'masterCueShift', label: 'SHIFT + HEADPHONE CUE (MASTER) → Smart CFX', led: true, confidence: 'unverified' },
  { data1: 0x01, id: 'smartFader', label: 'SMART FADER', led: true, confidence: 'unverified' },
  { data1: 0x09, id: 'smartFaderShift', label: 'SHIFT + SMART FADER', led: true, confidence: 'unverified' },
];

/** Pads: MIDI ch 8/9 = deck 1 normal/shift, ch 10/11 = deck 2 normal/shift (zero-based 7..10). */
export const PAD_CH: Readonly<Record<DeckIndex, { normal: number; shift: number }>> = {
  0: { normal: 7, shift: 8 },
  1: { normal: 9, shift: 10 },
};

/** Firmware pad modes (SHIFT + BEAT SYNC, then pad 1..4 selects). Pads 1..8 = base + 0..7. */
export const PAD_MODE_BASE: Readonly<Record<PadMode, number>> = {
  hotcue: 0x00, // pad mode 1
  padfx: 0x10, // pad mode 2
  beatloop: 0x60, // pad mode 3
  sampler: 0x30, // pad mode 4
};
export const PAD_MODES: readonly PadMode[] = ['hotcue', 'padfx', 'beatloop', 'sampler'];
export const PAD_COUNT = 8;

export function padModeFromData1(data1: number): { mode: PadMode | 'unknown'; pad: number } {
  for (const mode of PAD_MODES) {
    const base = PAD_MODE_BASE[mode];
    if (data1 >= base && data1 < base + PAD_COUNT) return { mode, pad: data1 - base };
  }
  return { mode: 'unknown', pad: data1 & 0x07 };
}

/** MIDI-OUT rows (software → unit). */
export const OUT = {
  /** Track load illumination (jog ring animation). 9F 00 7F = deck 1, 9F 01 7F = deck 2. */
  loaded: (deck: DeckIndex): number[] => [NOTE_ON | ILLUMINATION_CH, deck, ON],
  /** Vinyl mode can't be toggled on the unit; the app must send 9n 17 7F/00. */
  vinyl: (deck: DeckIndex, on: boolean): number[] => [NOTE_ON | DECK_CH[deck], 0x17, on ? ON : OFF],
  /** Optional Serato-style status dump request. The FLX2 may ignore it; that's fine. */
  statusDumpSysex: [0xf0, 0x00, 0x20, 0x7f, 0x03, 0x01, 0xf7] as number[],
} as const;

/** Port names the driver accepts. Windows may show the generic class-compliant name first. */
export const PORT_NAME_PATTERNS: readonly RegExp[] = [/DDJ[-_ ]?FLX2/i];
export const GENERIC_PORT_PATTERNS: readonly RegExp[] = [/^USB MIDI Device/i];
export const AUDIO_DEVICE_PATTERN = /DDJ[-_ ]?FLX2/i;
