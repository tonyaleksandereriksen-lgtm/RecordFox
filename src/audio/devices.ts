/**
 * Audio device discovery. Slice 1 only reports whether "DDJ-FLX2 Audio Out" is visible;
 * slice 2 routes deck/master/phones to it (fallback: the laptop output).
 */
import { AUDIO_DEVICE_PATTERN } from '../midi/flx2Map.ts';

export type AudioProbe =
  | { state: 'unknown' }
  | { state: 'unsupported' }
  | { state: 'hidden'; outputs: number }
  | { state: 'absent'; outputs: number }
  | { state: 'found'; label: string; deviceId: string };

export async function probeFlx2Audio(): Promise<AudioProbe> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return { state: 'unsupported' };
  const list = await navigator.mediaDevices.enumerateDevices();
  const outs = list.filter((d) => d.kind === 'audiooutput');
  const hit = outs.find((d) => AUDIO_DEVICE_PATTERN.test(d.label));
  if (hit) return { state: 'found', label: hit.label, deviceId: hit.deviceId };
  if (outs.length > 0 && outs.every((d) => !d.label)) return { state: 'hidden', outputs: outs.length };
  return { state: 'absent', outputs: outs.length };
}
