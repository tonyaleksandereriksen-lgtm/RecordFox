/**
 * The renderer's view of the library's file side (electron/library.cjs) behind the
 * `rekordfoxHost.library` preload bridge. Null in the browser build.
 */
import type { Saved } from '../lib/persist.ts';

export interface TagInfo {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  comment?: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  bitrateKbps: number;
  hasArtwork: boolean;
}

/** The analysis cache entry (also what the analyser returns, minus the waveform). */
export interface AnalysisMeta {
  version: number;
  size: number;
  mtimeMs: number;
  analysedAt: number;
  durationSec: number;
  bpm: number;
  bpmConfidence: number;
  firstBeatSec: number;
  key: string;
  keyName: string;
  keyFit: number;
  keyMargin: number;
  bins: number;
}

export interface FileDescription {
  path: string;
  size?: number;
  mtimeMs?: number;
  tags?: TagInfo | null;
  probe?: { lengthSeconds: number; sampleRate: number; channels: number } | null;
  analysis?: AnalysisMeta | null;
  error?: string;
}

export interface AnalysisProgress {
  phase: 'analyse' | 'idle';
  done: number;
  total: number;
  current: { id: string; path: string } | null;
}

export type AnalysisEvent = { id: string; ok: true; meta: AnalysisMeta } | { id: string; ok: false; error: string };

export interface ExportWriteResult {
  written: string[];
  copied: string[];
  failed: { file: string; error: string }[];
}

export interface LibraryHost {
  /** Synchronous: the index is needed before the store exists. Null when there is no file yet. */
  load(): Saved | null;
  save(saved: Saved): Promise<void>;
  pickFolder(): Promise<string | null>;
  scan(folder: string): Promise<string[]>;
  describe(items: { path: string; id: string }[]): Promise<FileDescription[]>;
  analyze(items: { id: string; path: string }[]): Promise<{ queued: number; total: number }>;
  cancelAnalysis(): Promise<boolean>;
  waveform(id: string): Promise<Uint8Array | null>;
  onProgress(cb: (p: AnalysisProgress) => void): () => void;
  onAnalysis(cb: (e: AnalysisEvent) => void): () => void;
  pickExportFolder(): Promise<string | null>;
  listDir(dir: string): Promise<string[]>;
  exportWrite(req: { dir: string; files: { name: string; text: string }[]; copies: { from: string; to: string }[] }): Promise<ExportWriteResult>;
}

interface HostGlobal {
  rekordfoxHost?: { library?: LibraryHost };
}

export function libraryHost(): LibraryHost | null {
  return (globalThis as HostGlobal).rekordfoxHost?.library ?? null;
}
