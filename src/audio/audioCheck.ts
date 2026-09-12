/**
 * Audio check (the "spike" from the audit): can the browser engine drive the DDJ-FLX2 fast enough,
 * and can it address master (ch 1/2) and phones (ch 3/4) separately? Measures what Chromium reports;
 * the result JSON goes back to development to decide Web Audio vs a native engine.
 */
import { AUDIO_DEVICE_PATTERN } from '../midi/flx2Map.ts';

export interface OutputDevice {
  deviceId: string;
  label: string;
  isFlx2: boolean;
}

export interface LatencyReading {
  hint: string;
  sampleRate: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
}

export type Heard = 'heard' | 'not heard' | 'skipped';

export interface AudioCheckResult {
  at: string;
  userAgent: string;
  device: { label: string; isFlx2: boolean } | null;
  sinkSupported: boolean;
  maxChannelCount: number | null;
  latency: LatencyReading[];
  channelTest: { master: Heard; phones: Heard };
  midiToSound: { presses: number; avgHandlingMs: number | null; estimatedTotalMs: number | null };
  verdict: string;
}

type SinkCtx = AudioContext & { setSinkId?: (id: string) => Promise<void> };

export function sinkSupported(): boolean {
  return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
}

export async function listOutputs(): Promise<{ devices: OutputDevice[]; labelsHidden: boolean }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { devices: [], labelsHidden: false };
  const all = await navigator.mediaDevices.enumerateDevices();
  const outs = all.filter((d) => d.kind === 'audiooutput');
  const labelsHidden = outs.length > 0 && outs.every((d) => !d.label);
  return {
    labelsHidden,
    devices: outs.map((d) => ({ deviceId: d.deviceId, label: d.label || `Output ${d.deviceId.slice(0, 6) || 'default'}`, isFlx2: AUDIO_DEVICE_PATTERN.test(d.label) })),
  };
}

/** Chrome only reveals device names after a media permission; ask for the mic once and stop it. */
export async function revealLabels(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

export async function openContext(deviceId: string | null, hint: AudioContextLatencyCategory | number): Promise<SinkCtx> {
  const ctx = new AudioContext({ latencyHint: hint }) as SinkCtx;
  if (deviceId && deviceId !== 'default' && ctx.setSinkId) await ctx.setSinkId(deviceId);
  await ctx.resume();
  return ctx;
}

export async function measureLatency(deviceId: string | null, hint: AudioContextLatencyCategory | number): Promise<{ reading: LatencyReading; maxChannels: number }> {
  const ctx = await openContext(deviceId, hint);
  // Keep the graph running briefly so outputLatency settles (it reads 0 until audio flows).
  const src = ctx.createConstantSource();
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(g).connect(ctx.destination);
  src.start();
  await new Promise((r) => setTimeout(r, 600));
  const reading: LatencyReading = {
    hint: String(hint),
    sampleRate: ctx.sampleRate,
    baseLatencyMs: round(ctx.baseLatency * 1000),
    outputLatencyMs: round((ctx.outputLatency ?? 0) * 1000),
  };
  const maxChannels = ctx.destination.maxChannelCount;
  src.stop();
  await ctx.close();
  return { reading, maxChannels };
}

/** Plays a one-second tone on a channel pair of a 4-channel output: pair 0 = ch 1/2 (master), 1 = ch 3/4 (phones). */
export async function playOnPair(deviceId: string | null, pair: 0 | 1): Promise<boolean> {
  const ctx = await openContext(deviceId, 'interactive');
  const channels = Math.min(ctx.destination.maxChannelCount, 4);
  const base = pair * 2;
  if (base + 1 >= channels) {
    await ctx.close();
    return false;
  }
  ctx.destination.channelCount = channels;
  ctx.destination.channelCountMode = 'explicit';
  ctx.destination.channelInterpretation = 'discrete';
  const merger = ctx.createChannelMerger(channels);
  const osc = ctx.createOscillator();
  osc.frequency.value = pair === 0 ? 660 : 880;
  const env = ctx.createGain();
  const t = ctx.currentTime + 0.05;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.25, t + 0.02);
  env.gain.setValueAtTime(0.25, t + 0.9);
  env.gain.linearRampToValueAtTime(0, t + 1);
  osc.connect(env);
  env.connect(merger, 0, base);
  env.connect(merger, 0, base + 1);
  merger.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 1.05);
  await new Promise((r) => setTimeout(r, 1200));
  await ctx.close();
  return true;
}

/** Click player used while the user presses PLAY on the unit: records handling delay per press. */
export class ClickProbe {
  private ctx: SinkCtx | null = null;
  readonly handlingMs: number[] = [];

  async open(deviceId: string | null): Promise<void> {
    this.ctx = await openContext(deviceId, 'interactive');
  }

  /** `eventTime` = MIDIMessageEvent.timeStamp (performance timeline). */
  click(eventTime: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.handlingMs.push(Math.max(0, performance.now() - eventTime));
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = 1500;
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  }

  summary(): { presses: number; avgHandlingMs: number | null; estimatedTotalMs: number | null } {
    const n = this.handlingMs.length;
    if (!n || !this.ctx) return { presses: n, avgHandlingMs: null, estimatedTotalMs: null };
    const avg = this.handlingMs.reduce((a, b) => a + b, 0) / n;
    const total = avg + this.ctx.baseLatency * 1000 + (this.ctx.outputLatency ?? 0) * 1000;
    return { presses: n, avgHandlingMs: round(avg), estimatedTotalMs: round(total) };
  }

  async close(): Promise<void> {
    await this.ctx?.close();
    this.ctx = null;
  }
}

export function verdictFor(r: Pick<AudioCheckResult, 'latency' | 'maxChannelCount' | 'channelTest'>): string {
  const best = r.latency.reduce<number | null>((m, x) => {
    const total = x.baseLatencyMs + x.outputLatencyMs;
    return m === null || total < m ? total : m;
  }, null);
  const parts: string[] = [];
  if (best === null) parts.push('No latency reading yet.');
  else if (best <= 12) parts.push(`Output latency ${best} ms — fine for scratching.`);
  else if (best <= 25) parts.push(`Output latency ${best} ms — fine for mixing, soft for scratching.`);
  else parts.push(`Output latency ${best} ms — too slow for scratching; plan a native audio engine.`);
  if (r.maxChannelCount !== null) {
    parts.push(
      r.maxChannelCount >= 4
        ? `${r.maxChannelCount} output channels — master and phones can be split.`
        : `Only ${r.maxChannelCount} output channels reachable — no separate headphone cue from the browser engine.`,
    );
  }
  if (r.channelTest.phones === 'not heard') parts.push('Phones pair not heard — cue routing needs a native engine.');
  return parts.join(' ');
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
