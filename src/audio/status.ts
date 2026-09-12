/** Human-readable audio engine status for the footer and Settings (pure; no DOM). */
import type { AudioStatus } from './host.ts';

export type AudioTone = 'ok' | 'warn' | 'off' | 'wait';

export interface AudioSummary {
  tone: AudioTone;
  /** One short phrase for the footer. */
  short: string;
  /** The full story for Settings. */
  long: string;
}

const ms = (n: number) => `${n.toFixed(n < 10 ? 2 : 1)} ms`;

export function audioSummary(a: AudioStatus): AudioSummary {
  switch (a.state) {
    case 'unavailable':
      return { tone: 'off', short: 'No audio engine', long: a.reason };
    case 'idle':
      return { tone: 'off', short: 'Audio engine stopped', long: 'The audio engine is not running.' };
    case 'starting':
      return { tone: 'wait', short: 'Starting audio…', long: 'Opening the output…' };
    case 'error':
      return { tone: 'warn', short: 'Audio engine error', long: a.message };
    case 'running': {
      const mode = a.exclusive ? 'exclusive' : 'shared';
      const under = a.underruns > 0 ? ` · ${a.underruns} underrun${a.underruns === 1 ? '' : 's'}` : '';
      const where = a.flx2 ? 'FLX2' : a.device;
      const cue = a.channels >= 4 ? '' : ' · no headphone cue';
      const short = `${where} ${mode} ${ms(a.latencyMs)}${cue}${under}`;
      const long = `${a.device} — ${a.backend} ${mode}, ${a.sampleRate / 1000} kHz, ${a.channels} ch, ${a.periods} × ${a.periodFrames} frames = ${ms(a.latencyMs)}${under}${a.note ? `. ${a.note}` : ''}`;
      return { tone: a.flx2 && a.exclusive && a.underruns === 0 ? 'ok' : 'warn', short, long };
    }
  }
}

/** Whether headphone cue (channels 3/4) can reach the output at all. */
export function cueAvailable(a: AudioStatus): boolean {
  return a.state !== 'running' || a.channels >= 4;
}
