/**
 * LED model: engine state -> the exact MIDI-OUT frame the unit should show.
 * Pure function + diffing so only changed LEDs are written (Off=0x00, On=0x7F).
 */
import { BEATLOOP_SIZES, atCue } from '../engine/selectors.ts';
import type { DeckState, EngineState } from '../engine/types.ts';
import { DECK_CH, GLOBAL_CH, NOTE_ON, OFF, ON, PAD_CH, PAD_COUNT, PAD_MODES, PAD_MODE_BASE } from './flx2Map.ts';
import type { DeckIndex } from './types.ts';

export type LedFrame = Map<number, number>;
export const BLINK_MS = 250;

export const ledKey = (status: number, data1: number) => (status << 8) | data1;

export function blinkOn(now: number): boolean {
  return Math.floor(now / BLINK_MS) % 2 === 0;
}

export type LedLook = 'on' | 'blink' | 'off';

/** PLAY: lit while playing, blinking while paused with a track loaded. */
export function playLook(d: DeckState): LedLook {
  if (!d.track) return 'off';
  return d.playing ? 'on' : 'blink';
}

/** CUE: lit when parked on the cue point or previewing; blinking when paused elsewhere; dark while playing. */
export function cueLook(d: DeckState): LedLook {
  if (!d.track) return 'off';
  if (d.cueHeld || d.cuePreview) return 'on';
  if (d.playing) return 'off';
  return atCue(d) ? 'on' : 'blink';
}

const lit = (look: LedLook, blink: boolean) => look === 'on' || (look === 'blink' && blink);

export function computeLeds(s: EngineState, now: number): LedFrame {
  const f: LedFrame = new Map();
  const blink = blinkOn(now);
  const put = (status: number, data1: number, on: boolean) => f.set(ledKey(status, data1), on ? ON : OFF);

  for (const deck of [0, 1] as DeckIndex[]) {
    const d = s.decks[deck];
    const st = NOTE_ON | DECK_CH[deck];
    const play = lit(playLook(d), blink);
    put(st, 0x0b, play);
    put(st, 0x47, play);
    const cue = lit(cueLook(d), blink);
    put(st, 0x0c, cue);
    put(st, 0x48, cue);

    put(st, 0x58, d.sync);
    put(st, 0x54, s.mixer.ch[deck].pfl);

    // Pads — every firmware mode is written so the unit shows the right LEDs whichever mode it is in.
    for (const mode of PAD_MODES) {
      for (let i = 0; i < PAD_COUNT; i++) {
        let on = false;
        if (mode === 'hotcue') on = d.hotCues[i] !== null;
        else if (mode === 'padfx') on = d.padFxHeld === i;
        else if (mode === 'beatloop') on = d.loop.active && d.loop.beats === BEATLOOP_SIZES[i];
        else if (mode === 'sampler') {
          const slot = deck * PAD_COUNT + i;
          on = s.sampler.slots[slot] ? (s.sampler.playing[slot] ? blink : true) : false;
        }
        put(NOTE_ON | PAD_CH[deck].normal, PAD_MODE_BASE[mode] + i, on);
        put(NOTE_ON | PAD_CH[deck].shift, PAD_MODE_BASE[mode] + i, on);
      }
    }
  }

  const g = NOTE_ON | GLOBAL_CH;
  put(g, 0x63, s.mixer.masterCue);
  put(g, 0x00, s.mixer.smartCfx);
  put(g, 0x01, s.mixer.smartFader);
  put(g, 0x09, s.mixer.smartFader);
  return f;
}

/** Messages that turn `prev` into `next`. An empty `prev` means "write everything". */
export function diffLeds(prev: LedFrame, next: LedFrame): number[][] {
  const out: number[][] = [];
  for (const [k, v] of next) {
    if (prev.get(k) !== v) out.push([k >> 8, k & 0xff, v]);
  }
  return out;
}
