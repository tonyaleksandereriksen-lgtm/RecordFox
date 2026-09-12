/**
 * The renderer's view of the native audio engine, which lives in Electron's main process behind
 * the `rekordfoxHost.audio` preload bridge (electron/preload.cjs). Null in the browser build.
 */
import type { DeckIndex } from '../engine/types.ts';
import type { EngineCommand } from './mirror.ts';

export interface AudioDevice {
  index: number;
  name: string;
  isDefault: boolean;
  /** 0 when the backend did not say. */
  maxChannels: number;
  nativeRate: number;
  flx2: boolean;
}

export interface AudioRunning {
  state: 'running';
  device: string;
  flx2: boolean;
  exclusive: boolean;
  sampleRate: number;
  channels: number;
  periodFrames: number;
  periods: number;
  latencyMs: number;
  backend: string;
  /** Why the output is not the FLX2 in exclusive mode, when it is not. */
  note: string | null;
  underruns: number;
}

export type AudioStatus =
  /** Browser build, or the addon is not built. */
  | { state: 'unavailable'; reason: string }
  | { state: 'idle' }
  | { state: 'starting' }
  | AudioRunning
  | { state: 'error'; message: string };

/** What the engine reports once per frame. */
export interface EngineSnapshot {
  position: number[];
  playing: boolean[];
  /** Peak since the previous snapshot, per deck (post-fader) and for the master. */
  peak: number[];
  masterPeak: number;
  frames: number;
  underruns: number;
  sampleRate: number;
  callbacks: number;
  maxBlock: number;
}

export interface ProbeInfo {
  lengthSeconds: number;
  sampleRate: number;
  channels: number;
}

export interface AudioHost {
  status(): Promise<AudioStatus>;
  /** Opens the output (the FLX2 in exclusive mode when it is there) and starts the engine. */
  start(opts: { device: string | null }): Promise<AudioRunning>;
  /** After the output died: opens one again, keeping the engine's decks unless the rate changed (`reloaded`). */
  reopen(opts: { device: string | null }): Promise<{ status: AudioRunning; reloaded: boolean }>;
  stop(): Promise<void>;
  devices(): Promise<AudioDevice[]>;
  /** Applies a batch of commands, then returns the engine's snapshot: one round trip per frame. Null once the engine has stopped. */
  frame(cmds: EngineCommand[]): Promise<EngineSnapshot | null>;
  /** Fire-and-forget batch for commands that must not wait for the next frame. */
  send(cmds: EngineCommand[]): void;
  /** Decodes a file into a deck; resolves with its length in seconds. */
  load(deck: DeckIndex, path: string): Promise<number>;
  eject(deck: DeckIndex): Promise<void>;
  probe(path: string): Promise<ProbeInfo>;
  /** Native file picker; resolves with the chosen paths (empty when cancelled). */
  pickFiles(): Promise<string[]>;
}

interface HostGlobal {
  rekordfoxHost?: { isElectron?: boolean; audio?: AudioHost };
}

/** The bridge the preload script exposed, or null outside the desktop app. */
export function audioHost(): AudioHost | null {
  return (globalThis as HostGlobal).rekordfoxHost?.audio ?? null;
}

/** Electron wraps errors from `ipcRenderer.invoke` in "Error invoking remote method 'x': Error: …". */
export function hostErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}
