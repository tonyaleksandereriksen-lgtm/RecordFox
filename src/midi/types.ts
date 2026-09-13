/** Hardware-level vocabulary for the DDJ-FLX2. No engine semantics live here. */

export type DeckIndex = 0 | 1;

/** Where a mapping row came from. See docs/FLX2-MIDI-MAP.md. */
export type Confidence =
  | 'hardware' // seen coming from the unit itself (the hardware session, docs/NEXT.md M3)
  | 'pdf' // read from the official FLX2 MIDI Message List
  | 'family' // FLX2 row exists, value follows the FLX4/DDJ-400 family layout (numbers not legible in extraction)
  | 'unverified'; // best reading of the PDF, needs a hardware check in the MIDI monitor

export type DeckButtonId =
  | 'play'
  | 'playShift'
  | 'cue'
  | 'cueShift'
  | 'sync'
  | 'syncLong'
  | 'syncShift'
  | 'shift'
  | 'chCue'
  | 'chCueShift'
  | 'faderStartPlay'
  | 'faderStartSync'
  | 'faderStartCue';

export type GlobalButtonId = 'masterCue' | 'masterCueShift' | 'smartFader' | 'smartFaderShift';

export type DeckAbsId = 'tempo' | 'eqHi' | 'eqMid' | 'eqLow' | 'chFader';
export type GlobalAbsId = 'cfx1' | 'cfx2' | 'crossfader' | 'masterLevel' | 'phonesLevel';
export type AbsId = DeckAbsId | GlobalAbsId;

/** 0x22 platter with vinyl ON, 0x23 platter with vinyl OFF, 0x29 SHIFT+platter, 0x21 side ring. */
export type JogSurface = 'vinyl' | 'bend' | 'search' | 'side';

export type PadMode = 'hotcue' | 'padfx' | 'beatloop' | 'sampler';

export type Flx2Event =
  | { kind: 'deckButton'; deck: DeckIndex; id: DeckButtonId; pressed: boolean }
  | { kind: 'globalButton'; id: GlobalButtonId; pressed: boolean }
  | { kind: 'jogTouch'; deck: DeckIndex; touched: boolean; shift: boolean }
  | { kind: 'jog'; deck: DeckIndex; surface: JogSurface; ticks: number }
  | { kind: 'deckAbs'; deck: DeckIndex; id: DeckAbsId; value: number; raw14: number }
  | { kind: 'globalAbs'; id: GlobalAbsId; value: number; raw14: number }
  | { kind: 'pad'; deck: DeckIndex; mode: PadMode | 'unknown'; pad: number; shift: boolean; pressed: boolean }
  | { kind: 'sysex'; bytes: number[] };

/** One line of the MIDI monitor. */
export interface MidiLogEntry {
  seq: number;
  t: number; // performance.now()
  dir: 'in' | 'out' | 'sys';
  port: string;
  bytes: number[];
  label: string;
  detail?: string;
  confidence: Confidence | 'unmapped' | 'system';
  /** LED writes caused only by blinking — hidden in the monitor unless asked for. */
  quiet?: boolean;
}
