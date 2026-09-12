/**
 * State → engine commands. The bridge keeps a mirror of what the native engine has last been told
 * and, after every state change, emits only what differs. Pure, so it is tested without Electron.
 */
import { baseRate } from '../engine/selectors.ts';
import type { DeckIndex, EngineState } from '../engine/types.ts';

/** One instruction for the native engine. A batch is applied in order, then a snapshot is taken. */
export type EngineCommand =
  | ['play', DeckIndex, 0 | 1]
  | ['seek', DeckIndex, number]
  | ['rate', DeckIndex, number]
  /** on, target position (seconds) — the follow-the-hand scratch of rfx_deck_scratch_to. */
  | ['scratch', DeckIndex, 0 | 1, number]
  | ['loop', DeckIndex, number, number, 0 | 1]
  | ['channel', DeckIndex, number, number, number, number, number, number, 0 | 1]
  | ['master', number, number, number, number, 0 | 1];

/** What the engine has last been told about one deck. */
export interface DeckMirror {
  playing: boolean;
  seekSeq: number;
  rate: number;
  scratching: boolean;
  loop: string;
  channel: string;
}

/** Transport commands leave at once; the rest ride with the next frame, latest value wins. */
export function isDiscrete(c: EngineCommand): boolean {
  return c[0] === 'play' || c[0] === 'seek' || c[0] === 'loop';
}

/** Key under which a continuous command coalesces (one per deck and parameter, one master). */
export function coalesceKey(c: EngineCommand): string {
  return c[0] === 'master' ? 'master' : `${c[0]}${c[1]}`;
}

/** The rate the engine should run a deck at: tempo (or sync) plus the transient jog bend, never backwards. */
export function deckRate(s: EngineState, deck: DeckIndex): number {
  return Math.max(0, baseRate(s, deck) + s.decks[deck].bend);
}

export function isScratching(s: EngineState, deck: DeckIndex): boolean {
  const d = s.decks[deck];
  return d.jogTouched && d.vinyl;
}

/**
 * Commands that bring the engine's copy of a deck in line with the state. `prev` null means the
 * engine just took the track: everything is sent. Order matters within the result: a pause goes
 * out before a seek (so the engine cannot advance past the target), a play after it.
 */
export function mirrorDeck(prev: DeckMirror | null, s: EngineState, deck: DeckIndex): { cmds: EngineCommand[]; next: DeckMirror } {
  const d = s.decks[deck];
  const scratching = isScratching(s, deck);
  const rate = deckRate(s, deck);
  const loopOn = d.loop.active && d.loop.inSec !== null && d.loop.outSec !== null && d.loop.outSec > d.loop.inSec;
  const loop = loopOn ? `${d.loop.inSec}|${d.loop.outSec}` : 'off';
  const ch = s.mixer.ch[deck];
  const channel = `${ch.trim}|${ch.eqHi}|${ch.eqMid}|${ch.eqLow}|${ch.cfx}|${ch.fader}|${ch.pfl ? 1 : 0}`;
  const cmds: EngineCommand[] = [];

  if (!d.playing && (prev === null || prev.playing)) cmds.push(['play', deck, 0]);
  if (prev === null || prev.seekSeq !== d.seekSeq) cmds.push(['seek', deck, d.positionSec]);
  if (prev === null || prev.loop !== loop) cmds.push(['loop', deck, loopOn ? d.loop.inSec! : 0, loopOn ? d.loop.outSec! : 0, loopOn ? 1 : 0]);
  if (scratching && (prev === null || !prev.scratching)) cmds.push(['scratch', deck, 1, d.positionSec]);
  if (!scratching && (prev === null || prev.scratching)) cmds.push(['scratch', deck, 0, 0]);
  if (prev === null || prev.rate !== rate) cmds.push(['rate', deck, rate]);
  if (prev === null || prev.channel !== channel) cmds.push(['channel', deck, ch.trim, ch.eqHi, ch.eqMid, ch.eqLow, ch.cfx, ch.fader, ch.pfl ? 1 : 0]);
  if (d.playing && (prev === null || !prev.playing)) cmds.push(['play', deck, 1]);

  return { cmds, next: { playing: d.playing, seekSeq: d.seekSeq, rate, scratching, loop, channel } };
}

/** The master section: crossfader, levels, MASTER CUE. `prev` is the last key sent (null = never). */
export function mirrorMaster(prev: string | null, s: EngineState): { cmd: EngineCommand | null; next: string } {
  const m = s.mixer;
  const key = `${m.crossfader}|${m.masterLevel}|${m.phonesLevel}|${m.phonesMix}|${m.masterCue ? 1 : 0}`;
  if (prev === key) return { cmd: null, next: key };
  return { cmd: ['master', m.crossfader, m.masterLevel, m.phonesLevel, m.phonesMix, m.masterCue ? 1 : 0], next: key };
}

/** The per-frame report while the hand is on the platter: where the reducer's playhead is now. */
export function scratchReport(s: EngineState, deck: DeckIndex): EngineCommand | null {
  const d = s.decks[deck];
  return d.engine && isScratching(s, deck) ? ['scratch', deck, 1, d.positionSec] : null;
}
