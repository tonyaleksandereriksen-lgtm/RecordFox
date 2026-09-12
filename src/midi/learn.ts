/**
 * MIDI Learn for the two ch-7 knobs whose CC numbers weren't legible in the PDF extraction
 * (MASTER LEVEL, HEADPHONES LEVEL). Bindings persist per browser/Electron profile.
 */
import type { LearnedBinding } from './decoder.ts';
import type { GlobalAbsId } from './types.ts';

export const LEARNABLE: readonly { id: GlobalAbsId; label: string }[] = [
  { id: 'masterLevel', label: 'MASTER LEVEL' },
  { id: 'phonesLevel', label: 'HEADPHONES LEVEL' },
];

const KEY = 'rekordfox.midi.learned.v1';
const OLD_KEY = 'fennec.midi.learned.v1'; // before the rename

export function loadLearned(): LearnedBinding[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY) ?? globalThis.localStorage?.getItem(OLD_KEY);
    const parsed = raw ? (JSON.parse(raw) as LearnedBinding[]) : [];
    return Array.isArray(parsed) ? parsed.filter((b) => typeof b.msb === 'number' && typeof b.channel === 'number') : [];
  } catch {
    return [];
  }
}

export function saveLearned(bindings: readonly LearnedBinding[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(bindings));
  } catch {
    /* storage unavailable: binding still works for this session */
  }
}

/** Pioneer pairs are always MSB n / LSB n+0x20. Accept whichever half the user moved first. */
export function bindingFromCc(channel: number, data1: number, id: GlobalAbsId): LearnedBinding {
  const msb = data1 >= 0x20 && data1 < 0x40 ? data1 - 0x20 : data1;
  return { channel, msb, lsb: msb + 0x20, id };
}
