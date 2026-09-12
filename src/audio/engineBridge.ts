/**
 * The audio bridge: mirrors engine state into the native engine and hands its clock back.
 *
 *   store change ──▶ mirrorDeck / mirrorMaster ──▶ commands ──▶ main process (addon)
 *   every animation frame: pending commands + snapshot request ──▶ one IPC round trip
 *   snapshot ──▶ meters, health, 'transport/sync' (the engine's playheads become the state)
 *
 * Transport commands (play, seek, loop) leave the moment they are queued so a PLAY press is not
 * held for the next frame; knob and fader values coalesce per frame, latest value wins.
 */
import type { EngineAction } from '../engine/actions.ts';
import type { DeckIndex, EngineState, Track } from '../engine/types.ts';
import type { Store } from '../lib/store.ts';
import { hostErrorMessage, type AudioHost, type AudioStatus, type EngineSnapshot } from './host.ts';
import { meters } from './meters.ts';
import { coalesceKey, isDiscrete, mirrorDeck, mirrorMaster, scratchReport, type DeckMirror, type EngineCommand } from './mirror.ts';

type Engine = Store<EngineState, EngineAction>;
const DECKS: DeckIndex[] = [0, 1];
const deckName = (deck: DeckIndex) => (deck === 0 ? 'A' : 'B');

/** What a frame's batch was based on, so its reply can be judged when it comes back. */
interface Sent {
  playing: [boolean, boolean];
  engine: [boolean, boolean];
  gen: [number, number];
}

export class EngineBridge {
  private readonly store: Engine;
  private readonly host: AudioHost;
  private readonly onStatus: (status: AudioStatus) => void;

  private running = false;
  private unsubscribe: (() => void) | null = null;
  private mirror: [DeckMirror | null, DeckMirror | null] = [null, null];
  private master: string | null = null;
  /** Track id the engine holds (or is decoding) per deck. */
  private held: [string | null, string | null] = [null, null];
  /** Bumped per track change so a decode that finishes late is recognised as stale. */
  private gen: [number, number] = [0, 0];
  private loadSeq: [number, number] = [0, 0];
  private discrete: EngineCommand[] = [];
  private continuous = new Map<string, EngineCommand>();
  private inFlight = false;
  private underruns = 0;
  private lastStatus: AudioStatus = { state: 'idle' };

  constructor(store: Engine, host: AudioHost, onStatus: (status: AudioStatus) => void) {
    this.store = store;
    this.host = host;
    this.onStatus = onStatus;
  }

  private setStatus(status: AudioStatus): void {
    this.lastStatus = status;
    this.onStatus(status);
  }

  /** Opens the output and starts mirroring. Safe to call again to change the device. */
  async start(device: string | null): Promise<void> {
    this.running = false;
    meters.live = false;
    this.setStatus({ state: 'starting' });
    try {
      const status = await this.host.start({ device });
      this.underruns = 0;
      this.setStatus(status);
    } catch (e) {
      this.setStatus({ state: 'error', message: hostErrorMessage(e) });
      return;
    }
    // A (re)start leaves the engine's decks empty: forget what it held so the tracks are reloaded.
    this.mirror = [null, null];
    this.master = null;
    this.held = [null, null];
    this.discrete = [];
    this.continuous.clear();
    for (const deck of DECKS) this.store.dispatch({ type: 'deck/engine', deck, ready: false });
    this.running = true;
    meters.live = true;
    this.unsubscribe ??= this.store.subscribe(() => this.onState());
    this.onState();
  }

  async stop(): Promise<void> {
    this.running = false;
    meters.live = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const deck of DECKS) this.store.dispatch({ type: 'deck/engine', deck, ready: false });
    try {
      await this.host.stop();
    } catch {
      /* the main process is going away */
    }
    this.setStatus({ state: 'idle' });
  }

  get status(): AudioStatus {
    return this.lastStatus;
  }

  /** After every state change: track hand-offs, then whatever else differs from the mirror. */
  private onState(): void {
    if (!this.running) return;
    const s = this.store.getState();
    for (const deck of DECKS) {
      const d = s.decks[deck];
      const want = d.track?.path ? d.track.id : null;
      if (want !== this.held[deck]) {
        this.held[deck] = want;
        this.gen[deck] += 1;
        this.mirror[deck] = null;
        if (want) void this.load(deck, d.track!, this.gen[deck]);
        else void this.host.eject(deck).catch(() => undefined);
      }
      if (d.track && !d.track.path && d.loadSeq !== this.loadSeq[deck]) {
        this.store.dispatch({ type: 'ui/toast', text: `Deck ${deckName(deck)}: demo track — no audio. Add your own files in the Library.` });
      }
      this.loadSeq[deck] = d.loadSeq;
      if (!d.engine) continue;
      const { cmds, next } = mirrorDeck(this.mirror[deck], s, deck);
      this.mirror[deck] = next;
      for (const c of cmds) this.queue(c);
    }
    const m = mirrorMaster(this.master, s);
    this.master = m.next;
    if (m.cmd) this.queue(m.cmd);
    if (this.discrete.length > 0) this.flush();
  }

  private queue(c: EngineCommand): void {
    if (isDiscrete(c)) this.discrete.push(c);
    else this.continuous.set(coalesceKey(c), c);
  }

  private take(): EngineCommand[] {
    const batch = [...this.discrete, ...this.continuous.values()];
    this.discrete = [];
    this.continuous.clear();
    return batch;
  }

  private flush(): void {
    const batch = this.take();
    if (batch.length > 0) this.host.send(batch);
  }

  /** Once per animation frame: pending commands out, the engine's snapshot back. */
  frame(): void {
    if (!this.running || this.inFlight) return;
    const s = this.store.getState();
    for (const deck of DECKS) {
      const report = scratchReport(s, deck);
      if (report) this.queue(report);
    }
    const sent: Sent = {
      playing: [s.decks[0].playing, s.decks[1].playing],
      engine: [s.decks[0].engine, s.decks[1].engine],
      gen: [this.gen[0], this.gen[1]],
    };
    this.inFlight = true;
    this.host.frame(this.take()).then(
      (snap) => {
        this.inFlight = false;
        if (this.running) this.onSnapshot(snap, sent);
      },
      (e) => {
        this.inFlight = false;
        if (!this.running) return;
        this.running = false;
        meters.live = false;
        this.setStatus({ state: 'error', message: hostErrorMessage(e) });
      },
    );
  }

  private onSnapshot(snap: EngineSnapshot, sent: Sent): void {
    meters.deck[0] = snap.peak[0] ?? 0;
    meters.deck[1] = snap.peak[1] ?? 0;
    meters.master = snap.masterPeak;
    if (snap.underruns !== this.underruns && this.lastStatus.state === 'running') {
      this.underruns = snap.underruns;
      this.setStatus({ ...this.lastStatus, underruns: snap.underruns });
    }
    const s = this.store.getState();
    const positions: [number | null, number | null] = [null, null];
    const playing: [boolean, boolean] = [true, true];
    for (const deck of DECKS) {
      // Only a reply to a batch sent for this very track, while the engine still drives the deck.
      if (!sent.engine[deck] || sent.gen[deck] !== this.gen[deck] || !s.decks[deck].engine) continue;
      positions[deck] = snap.position[deck] ?? null;
      // The engine can only report a stop for a deck we had already told to play.
      playing[deck] = (snap.playing[deck] ?? true) || !sent.playing[deck];
    }
    if (positions[0] !== null || positions[1] !== null) this.store.dispatch({ type: 'transport/sync', positions, playing });
  }

  private async load(deck: DeckIndex, track: Track, gen: number): Promise<void> {
    try {
      await this.host.load(deck, track.path!);
      if (gen !== this.gen[deck]) return; // another track took the deck meanwhile
      this.mirror[deck] = null;
      this.store.dispatch({ type: 'deck/engine', deck, ready: true }); // onState then sends the whole deck
    } catch (e) {
      if (gen !== this.gen[deck]) return;
      this.store.dispatch({ type: 'ui/toast', text: `Deck ${deckName(deck)}: could not load ${track.title} — ${hostErrorMessage(e)}`, tone: 'warn' });
    }
  }
}
