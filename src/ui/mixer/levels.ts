/** Demo levels (post-fader energy of the demo waveform) until the audio graph supplies real meters. */
import type { DeckIndex, EngineState } from '../../engine/types.ts';
import { levelAt, waveformFor } from '../../engine/waveform.ts';

export function channelLevel(s: EngineState, ch: DeckIndex): number {
  const d = s.decks[ch];
  if (!d.track || !d.playing || (d.jogTouched && d.vinyl)) return 0;
  const m = s.mixer.ch[ch];
  const eq = (m.eqLow * 0.5 + m.eqMid * 0.3 + m.eqHi * 0.2) * 2;
  return levelAt(waveformFor(d.track), d.positionSec) * m.fader * Math.min(1.2, eq) * (m.trim * 2) * 0.85;
}

/** Simple constant-power-ish crossfader curve: full on your side of centre, fading past it. */
export function crossfaderGain(xf: number, ch: DeckIndex): number {
  return ch === 0 ? Math.min(1, (1 - xf) * 2) : Math.min(1, xf * 2);
}

export function masterLevel(s: EngineState): number {
  const a = channelLevel(s, 0) * crossfaderGain(s.mixer.crossfader, 0);
  const b = channelLevel(s, 1) * crossfaderGain(s.mixer.crossfader, 1);
  return Math.min(1.1, Math.max(a, b) * (0.4 + s.mixer.masterLevel * 0.75));
}
