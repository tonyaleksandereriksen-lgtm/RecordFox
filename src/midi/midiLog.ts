/** Fixed-size ring buffer for the MIDI monitor. Lives outside React state on purpose. */
import type { MidiLogEntry } from './types.ts';

export class MidiLog {
  private readonly buf: MidiLogEntry[] = [];
  private seq = 0;
  private readonly cap: number;
  private readonly listeners = new Set<() => void>();
  paused = false;
  /** Counters survive clear(), useful for the status strip. */
  totals = { in: 0, out: 0, unmapped: 0 };

  constructor(cap = 600) {
    this.cap = cap;
  }

  push(e: Omit<MidiLogEntry, 'seq'>): void {
    if (e.dir === 'in') this.totals.in++;
    else if (e.dir === 'out') this.totals.out++;
    if (e.confidence === 'unmapped') this.totals.unmapped++;
    if (this.paused) return;
    this.buf.push({ ...e, seq: ++this.seq });
    if (this.buf.length > this.cap) this.buf.splice(0, this.buf.length - this.cap);
    for (const l of this.listeners) l();
  }

  entries(): readonly MidiLogEntry[] {
    return this.buf;
  }

  version(): number {
    return this.seq;
  }

  clear(): void {
    this.buf.length = 0;
    this.seq++;
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
