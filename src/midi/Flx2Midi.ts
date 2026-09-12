/**
 * Flx2Midi — the DDJ-FLX2 driver. Owns Web MIDI access, port discovery and hot-plug, the init
 * sequence, the decode loop and all writes to the unit. Emits hardware events; knows nothing
 * about decks (see bindings.ts) or LEDs policy (see leds.ts).
 *
 * Control path is MIDI only (USB class-compliant). No WebHID, no CDJ/Pro DJ Link handshake.
 */
import { bytesToHex, Flx2Decoder, type LearnedBinding } from './decoder.ts';
import { GENERIC_PORT_PATTERNS, OUT, PORT_NAME_PATTERNS } from './flx2Map.ts';
import { bindingFromCc, loadLearned, saveLearned } from './learn.ts';
import { MidiLog } from './midiLog.ts';
import type { Flx2Event, GlobalAbsId } from './types.ts';
import type { VirtualFlx2 } from './virtualFlx2.ts';

export type Flx2Status =
  | { kind: 'idle' }
  | { kind: 'unsupported'; message: string }
  | { kind: 'requesting' }
  | { kind: 'denied'; message: string }
  | { kind: 'searching'; seen: string[]; message?: string }
  | { kind: 'connected'; input: string; output: string | null; generic: boolean; sysex: boolean };

export interface InitReport {
  midiIn: boolean;
  midiOut: boolean;
  vinyl: boolean;
  leds: boolean;
  takeover: boolean;
  statusDump: 'off' | 'sent' | 'no-sysex';
  at: number;
}

export interface ConnectInfo {
  target: 'hardware' | 'virtual';
  reconnect: boolean;
}

const emptyReport = (): InitReport => ({
  midiIn: false,
  midiOut: false,
  vinyl: false,
  leds: false,
  takeover: false,
  statusDump: 'off',
  at: 0,
});

function matches(name: string | null | undefined, patterns: readonly RegExp[]): boolean {
  return !!name && patterns.some((r) => r.test(name));
}

export function pickPort<T extends MIDIPort>(ports: Iterable<T>): { port: T | null; generic: boolean } {
  const list = [...ports].filter((p) => p.state !== 'disconnected');
  const named = list.find((p) => matches(p.name, PORT_NAME_PATTERNS));
  if (named) return { port: named, generic: false };
  const generic = list.filter((p) => matches(p.name, GENERIC_PORT_PATTERNS));
  if (generic.length === 1) return { port: generic[0], generic: true };
  return { port: null, generic: false };
}

export class Flx2Midi {
  readonly log = new MidiLog();
  readonly decoder: Flx2Decoder;
  status: Flx2Status = { kind: 'idle' };
  report: InitReport = emptyReport();
  virtual: VirtualFlx2 | null = null;
  learnTarget: GlobalAbsId | null = null;
  learned: LearnedBinding[];

  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private output: MIDIOutput | null = null;
  private sysex = false;
  private wantStatusDump = false;
  private opening = false;
  private connects = 0;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly eventListeners = new Set<(e: Flx2Event) => void>();
  private readonly inputListeners = new Set<(events: readonly Flx2Event[], t: number) => void>();
  private readonly statusListeners = new Set<() => void>();
  private readonly connectListeners = new Set<(info: ConnectInfo) => void>();

  constructor() {
    this.learned = loadLearned();
    this.decoder = new Flx2Decoder(this.learned);
  }

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  onEvent(fn: (e: Flx2Event) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /** Decoded events of one incoming message with its MIDI timestamp (the audio check measures latency with it). */
  onInput(fn: (events: readonly Flx2Event[], t: number) => void): () => void {
    this.inputListeners.add(fn);
    return () => this.inputListeners.delete(fn);
  }

  onStatus(fn: () => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onConnect(fn: (info: ConnectInfo) => void): () => void {
    this.connectListeners.add(fn);
    return () => this.connectListeners.delete(fn);
  }

  get hardwareConnected(): boolean {
    return this.status.kind === 'connected';
  }

  private starting: Promise<void> | null = null;

  /** Step 1 of the init sequence: open MIDI in/out named DDJ-FLX2 (or the generic USB name). */
  start(opts: { sysex?: boolean; statusDump?: boolean } = {}): Promise<void> {
    // Overlapping calls (auto-connect + a click) share one attempt instead of opening two sessions.
    if (!this.starting) this.starting = this.startOnce(opts).finally(() => (this.starting = null));
    return this.starting;
  }

  private async startOnce(opts: { sysex?: boolean; statusDump?: boolean }): Promise<void> {
    if (!Flx2Midi.supported) {
      this.setStatus({
        kind: 'unsupported',
        message: window.isSecureContext
          ? 'This browser has no Web MIDI. Use Chrome or Edge, or the desktop app.'
          : 'Web MIDI needs a secure context — open via http://localhost or the desktop app.',
      });
      return;
    }
    if (this.access) return this.rescan();
    this.setStatus({ kind: 'requesting' });
    this.wantStatusDump = opts.statusDump ?? false;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: opts.sysex ?? false });
      this.sysex = opts.sysex ?? false;
    } catch (err) {
      if (opts.sysex) {
        try {
          this.access = await navigator.requestMIDIAccess({ sysex: false });
          this.sysex = false;
        } catch (err2) {
          this.setStatus({ kind: 'denied', message: String((err2 as Error)?.message ?? err2) });
          return;
        }
      } else {
        this.setStatus({ kind: 'denied', message: String((err as Error)?.message ?? err) });
        return;
      }
    }
    this.system(`Web MIDI ready${this.sysex ? ' (SysEx allowed)' : ''}`);
    this.access.onstatechange = () => void this.rescan();
    await this.rescan();
  }

  /** Attach (or detach with null) the on-screen controller. It shares the whole input path. */
  attachVirtual(v: VirtualFlx2 | null): void {
    if (this.virtual === v) return;
    this.virtual?.disconnect();
    this.virtual = v;
    if (v) {
      v.connect((bytes) => this.receive(bytes, performance.now(), v.name));
      this.system('Virtual FLX2 attached');
      this.runInit('virtual');
    } else {
      this.system('Virtual FLX2 detached');
      if (!this.hardwareConnected) this.stopFlush();
    }
    this.emitStatus();
  }

  /** Write to the unit (and mirror to the virtual unit). */
  send(bytes: number[], opts: { quiet?: boolean } = {}): void {
    if (this.output) {
      try {
        this.output.send(bytes);
      } catch (err) {
        this.system(`Send failed: ${String((err as Error)?.message ?? err)}`);
      }
    }
    this.virtual?.receive(bytes);
    if (this.output || this.virtual) {
      const d = this.decoder.describe(bytes, 'out');
      this.log.push({ t: performance.now(), dir: 'out', port: this.output?.name ?? 'virtual', bytes, label: d.label, detail: d.detail, confidence: d.confidence, quiet: opts.quiet });
    }
  }

  /** Entry point for every incoming message (hardware, virtual or tests). */
  receive(bytes: number[], t: number, port: string): void {
    if (this.learnTarget) this.tryLearn(bytes);
    const events = this.decoder.decode(bytes, t);
    const d = this.decoder.describe(bytes, 'in');
    let detail = d.detail;
    for (const e of events) {
      if (e.kind === 'deckAbs' || e.kind === 'globalAbs') detail = `${(e.value * 100).toFixed(1)}%  ·  ${e.raw14}/16383`;
    }
    this.log.push({ t, dir: 'in', port, bytes, label: d.label, detail, confidence: d.confidence });
    for (const e of events) this.emit(e);
    if (events.length) for (const l of this.inputListeners) l(events, t);
  }

  startLearn(id: GlobalAbsId): void {
    this.learnTarget = id;
    this.system(`Learn: move the ${id === 'masterLevel' ? 'MASTER LEVEL' : 'HEADPHONES LEVEL'} knob on the unit`);
    this.emitStatus();
  }

  cancelLearn(): void {
    this.learnTarget = null;
    this.emitStatus();
  }

  clearLearned(): void {
    this.learned = [];
    saveLearned(this.learned);
    this.decoder.setLearned(this.learned);
    this.system('Learned bindings cleared');
    this.emitStatus();
  }

  markReport(patch: Partial<InitReport>): void {
    this.report = { ...this.report, ...patch };
    this.emitStatus();
  }

  private tryLearn(bytes: number[]): void {
    const [status, d1] = bytes;
    if ((status & 0xf0) !== 0xb0 || !this.learnTarget) return;
    if (this.decoder.describe(bytes).confidence !== 'unmapped') return;
    const binding = bindingFromCc(status & 0x0f, d1, this.learnTarget);
    this.learned = [...this.learned.filter((b) => b.id !== binding.id), binding];
    saveLearned(this.learned);
    this.decoder.setLearned(this.learned);
    this.system(`Learned ${binding.id}: ch ${binding.channel + 1} CC 0x${binding.msb.toString(16)}/0x${binding.lsb.toString(16)}`);
    this.learnTarget = null;
    this.emitStatus();
  }

  private async rescan(): Promise<void> {
    const access = this.access;
    if (!access || this.opening) return;
    const seen = [...access.inputs.values()].map((p) => p.name ?? '?');

    if (this.output && (this.output.state === 'disconnected' || ![...access.outputs.values()].includes(this.output))) {
      this.system(`Output ${this.output.name ?? ''} disappeared — LEDs paused`);
      this.output = null;
      this.markReport({ midiOut: false });
    }
    if (this.input && (this.input.state === 'disconnected' || ![...access.inputs.values()].includes(this.input))) {
      this.system(`Lost ${this.input.name ?? 'controller'}`);
      this.closePorts();
      this.setStatus({ kind: 'searching', seen, message: 'Controller unplugged — waiting for it to come back' });
    }
    if (this.input) return;

    const { port: input, generic } = pickPort(access.inputs.values());
    if (!input) {
      if (this.status.kind !== 'searching' || this.status.seen.join() !== seen.join()) {
        this.setStatus({ kind: 'searching', seen });
      }
      return;
    }
    const sameName = [...access.outputs.values()].find((o) => o.name === input.name && o.state !== 'disconnected');
    const output = sameName ?? pickPort(access.outputs.values()).port;

    this.opening = true;
    try {
      input.onmidimessage = (ev: MIDIMessageEvent) => {
        if (ev.data) this.receive(Array.from(ev.data), ev.timeStamp, input.name ?? 'DDJ-FLX2');
      };
      await input.open();
      if (output) await output.open();
      this.input = input;
      this.output = output ?? null;
      this.setStatus({ kind: 'connected', input: input.name ?? 'DDJ-FLX2', output: output?.name ?? null, generic, sysex: this.sysex });
      this.system(`MIDI in: ${input.name}${output ? ` · out: ${output.name}` : ' · no output port (LEDs off)'}${generic ? ' (generic name — reconnect to get DDJ-FLX2)' : ''}`);
      this.runInit('hardware');
    } catch (err) {
      input.onmidimessage = null;
      this.setStatus({
        kind: 'searching',
        seen,
        message: `Could not open ${input.name}: ${String((err as Error)?.message ?? err)} — close rekordbox/Serato/Mixxx if they are running (Windows MIDI ports are exclusive).`,
      });
    } finally {
      this.opening = false;
    }
  }

  private closePorts(): void {
    if (this.input) this.input.onmidimessage = null;
    try {
      void this.input?.close();
      void this.output?.close();
    } catch {
      /* already gone */
    }
    this.input = null;
    this.output = null;
    this.decoder.reset();
    if (!this.virtual) this.stopFlush();
  }

  /** Steps 3–5 of the init sequence. The app's onConnect handler writes LEDs and arms takeover. */
  private runInit(target: 'hardware' | 'virtual'): void {
    this.connects++;
    const reconnect = this.connects > 1;
    this.decoder.reset();
    this.send(OUT.vinyl(0, true));
    this.send(OUT.vinyl(1, true));
    let statusDump: InitReport['statusDump'] = 'off';
    if (target === 'hardware' && this.wantStatusDump) {
      if (this.sysex) {
        this.send(OUT.statusDumpSysex);
        statusDump = 'sent';
        this.system(`Status dump request sent (${bytesToHex(OUT.statusDumpSysex)}) — optional; the unit may ignore it`);
      } else statusDump = 'no-sysex';
    }
    this.report = { ...this.report, midiIn: true, midiOut: target === 'virtual' || !!this.output, vinyl: true, statusDump, at: performance.now() };
    for (const l of this.connectListeners) l({ target, reconnect });
    this.startFlush();
    this.emitStatus();
  }

  private startFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      for (const e of this.decoder.flush(performance.now())) this.emit(e);
    }, 5);
    // Node (tests): don't keep the process alive for this timer.
    (this.flushTimer as unknown as { unref?: () => void }).unref?.();
  }

  /** Close everything (tests, window unload). */
  dispose(): void {
    if (this.access) this.access.onstatechange = null;
    this.closePorts();
    this.virtual?.disconnect();
    this.virtual = null;
    this.stopFlush();
  }

  private stopFlush(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  private emit(e: Flx2Event): void {
    for (const l of this.eventListeners) l(e);
  }

  private system(label: string): void {
    this.log.push({ t: performance.now(), dir: 'sys', port: 'system', bytes: [], label, confidence: 'system' });
  }

  private setStatus(s: Flx2Status): void {
    this.status = s;
    this.emitStatus();
  }

  private emitStatus(): void {
    for (const l of this.statusListeners) l();
  }
}
