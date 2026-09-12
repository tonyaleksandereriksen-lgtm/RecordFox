/**
 * Runtime wiring: one engine store, one FLX2 driver, bindings between them, the LED writer,
 * the on-screen virtual unit, persistence, and the two clocks: the native audio engine (through
 * the bridge, desktop app only) for the decks it holds, the animation frame for everything else.
 * The UI imports from here.
 */
import { probeFlx2Audio, type AudioProbe } from './audio/devices.ts';
import { EngineBridge } from './audio/engineBridge.ts';
import { meters } from './audio/meters.ts';
import { audioHost, type AudioStatus } from './audio/host.ts';
import type { EngineAction } from './engine/actions.ts';
import { DEFAULT_PREFS, initialState } from './engine/initialState.ts';
import { reduce } from './engine/reducer.ts';
import type { EngineState } from './engine/types.ts';
import { loadSaved, mergePrefs, save, savedLocalTracks } from './lib/persist.ts';
import { createStore } from './lib/store.ts';
import { Bindings } from './midi/bindings.ts';
import { OUT } from './midi/flx2Map.ts';
import { Flx2Midi } from './midi/Flx2Midi.ts';
import { BLINK_MS, computeLeds, diffLeds, ledKey, type LedFrame } from './midi/leds.ts';
import type { DeckIndex } from './midi/types.ts';
import { VirtualFlx2 } from './midi/virtualFlx2.ts';

const saved = loadSaved();
const local = savedLocalTracks(saved);
let boot = initialState(mergePrefs(DEFAULT_PREFS, saved.prefs));
if (local.length) boot = reduce(boot, { type: 'library/add', tracks: local });
if (saved.tracks) boot = reduce(boot, { type: 'library/hydrate', edits: saved.tracks });
export const store = createStore<EngineState, EngineAction>(boot, reduce);
export const midi = new Flx2Midi();
export const bindings = new Bindings(store);
export const virtualUnit = new VirtualFlx2();

interface HostState {
  isElectron: boolean;
  /** The browser's view of audio outputs (the audit's spike); informational only. */
  probe: AudioProbe;
  /** The native engine. */
  audio: AudioStatus;
}
const hostAudio = audioHost();
export const host = createStore<HostState, Partial<HostState>>(
  {
    isElectron: !!(globalThis as { rekordfoxHost?: { isElectron?: boolean } }).rekordfoxHost?.isElectron,
    probe: { state: 'unknown' },
    audio: hostAudio ? { state: 'idle' } : { state: 'unavailable', reason: 'Audio needs the desktop app (start-desktop.bat): the browser build has no audio engine.' },
  },
  (s, patch) => ({ ...s, ...patch }),
);
/** The audio bridge, when the desktop shell exposes the engine. */
export const audio: EngineBridge | null = hostAudio ? new EngineBridge(store, hostAudio, (status) => host.dispatch({ audio: status })) : null;

/** Writes only changed LEDs; a (re)connect clears the cache so the next frame writes everything. */
class LedWriter {
  private prev: LedFrame = new Map();
  private loadSeq: [number, number] = [0, 0];

  resync(): void {
    this.prev = new Map();
    const s = store.getState();
    this.loadSeq = [s.decks[0].loadSeq, s.decks[1].loadSeq];
  }

  tick(now: number): void {
    if (!midi.hardwareConnected && !midi.virtual) return;
    const s = store.getState();
    for (const deck of [0, 1] as DeckIndex[]) {
      if (s.decks[deck].loadSeq !== this.loadSeq[deck]) {
        this.loadSeq[deck] = s.decks[deck].loadSeq;
        if (s.decks[deck].track) midi.send(OUT.loaded(deck));
      }
    }
    const next = computeLeds(s, now);
    // LEDs that differ between the two blink phases are blinking: log those writes as "quiet".
    const other = computeLeds(s, now + BLINK_MS);
    for (const m of diffLeds(this.prev, next)) {
      const k = ledKey(m[0], m[1]);
      midi.send(m, { quiet: this.prev.size > 0 && other.get(k) !== next.get(k) });
    }
    this.prev = next;
  }

  /** All LEDs off — used when the app closes so the unit isn't left lit. */
  blackout(): void {
    for (const k of this.prev.keys()) midi.send([k >> 8, k & 0xff, 0]);
    this.prev = new Map();
  }
}
export const leds = new LedWriter();

midi.onEvent((e) => bindings.handle(e));
midi.onConnect(({ reconnect }) => {
  leds.resync();
  if (reconnect) bindings.releaseAll();
  // Soft-takeover adopt window opens now: first values within it are taken as the hardware truth.
  bindings.markConnected();
  // Step 4: light play/cue/sync/pads from engine state; replay load illumination for loaded decks.
  leds.tick(performance.now());
  const s = store.getState();
  for (const deck of [0, 1] as DeckIndex[]) if (s.decks[deck].track) midi.send(OUT.loaded(deck));
  midi.markReport({ leds: true, takeover: true });
});

let started = false;
export function startRuntime(): void {
  if (started) return;
  started = true;

  // The frame clock: advances decks the engine does not hold, then exchanges one IPC round trip
  // with the engine (commands out, playheads back) for the decks it does.
  let last = performance.now();
  const frame = (now: number) => {
    store.dispatch({ type: 'transport/tick', dt: (now - last) / 1000 });
    last = now;
    audio?.frame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setInterval(() => leds.tick(performance.now()), 30);

  // Persist prefs and library edits (debounced; only when those slices change).
  let lastPrefs = store.getState().prefs;
  let lastTracks = store.getState().library.tracks;
  let timer: ReturnType<typeof setTimeout> | null = null;
  store.subscribe(() => {
    const s = store.getState();
    if (s.prefs === lastPrefs && s.library.tracks === lastTracks) return;
    lastPrefs = s.prefs;
    lastTracks = s.library.tracks;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => save(store.getState()), 400);
  });

  window.addEventListener('pagehide', () => {
    save(store.getState());
    leds.blackout();
    midi.dispose();
    void audio?.stop();
  });

  const refreshProbe = () => void probeFlx2Audio().then((probe) => host.dispatch({ probe })).catch(() => host.dispatch({ probe: { state: 'unsupported' } }));
  refreshProbe();
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshProbe);

  void audio?.start(store.getState().prefs.audioDevice);
  void autoConnect();
}

/** Settings › Audio: reopen the engine on another output (null = automatic). */
export function restartAudio(device: string | null): void {
  store.dispatch({ type: 'prefs/set', patch: { audioDevice: device } });
  void audio?.start(device);
}

/** Electron: connect straight away (permissions are granted by the main process).
 *  Browser: connect only if MIDI permission was already granted; otherwise wait for a click. */
async function autoConnect(): Promise<void> {
  if (!Flx2Midi.supported) {
    await midi.start();
    return;
  }
  if (host.getState().isElectron) {
    const dump = store.getState().prefs.statusDump;
    await midi.start({ sysex: dump, statusDump: dump });
    return;
  }
  try {
    const p = await navigator.permissions.query({ name: 'midi' as PermissionName });
    if (p.state === 'granted') await midi.start();
  } catch {
    /* Permissions API without 'midi' — wait for the Connect button */
  }
}

export function connectController(): void {
  const electron = host.getState().isElectron;
  const dump = electron && store.getState().prefs.statusDump;
  void midi.start({ sysex: dump, statusDump: dump });
}

export function setVirtualAttached(on: boolean): void {
  midi.attachVirtual(on ? virtualUnit : null);
}

/** For debugging from DevTools: window.rekordfox.store.getState() */
(globalThis as Record<string, unknown>).rekordfox = { store, midi, bindings, virtualUnit, audio, meters };
