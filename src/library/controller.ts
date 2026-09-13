/**
 * The library controller (desktop app): folders in, tracks out. Scans a folder, reads what each
 * file says about itself in batches (tags, duration, cached analysis), upserts the records into
 * the store as they arrive, and queues whatever still needs the analyser — whose results come back
 * as events and become 'library/analysis'. It also serves waveforms to the canvases on demand.
 */
import type { EngineAction } from '../engine/actions.ts';
import type { EngineState, Track } from '../engine/types.ts';
import { forgetWaveform, hasWaveform, onWaveformMissing, setWaveform, waveformFromBytes } from '../engine/waveform.ts';
import type { Store } from '../lib/store.ts';
import { localTrackId } from '../audio/localFiles.ts';
import type { AnalysisEvent, AnalysisProgress, LibraryHost } from './host.ts';
import { analysisResult, needsAnalysis, trackFromDescription } from './tracks.ts';

export interface ImportProgress {
  phase: 'idle' | 'scanning' | 'reading' | 'analysing';
  done: number;
  total: number;
  /** What is being worked on right now — a folder while scanning, a track title while analysing. */
  current: string | null;
  /** Analysis failures during this run, for the summary toast. */
  failed: number;
}

export const IDLE_PROGRESS: ImportProgress = { phase: 'idle', done: 0, total: 0, current: null, failed: 0 };

const DESCRIBE_BATCH = 24;

export class LibraryController {
  private readonly store: Store<EngineState, EngineAction>;
  private readonly host: LibraryHost;
  private readonly setProgress: (p: ImportProgress) => void;
  private progress: ImportProgress = IDLE_PROGRESS;
  private readonly waveRequested = new Set<string>();
  private importing = false;
  private analysing = false;

  constructor(store: Store<EngineState, EngineAction>, host: LibraryHost, setProgress: (p: ImportProgress) => void) {
    this.store = store;
    this.host = host;
    this.setProgress = setProgress;
  }

  /** Subscribes to the analyser, serves waveforms, and queues anything the index left unanalysed. */
  start(): void {
    this.host.onAnalysis((e) => this.onAnalysis(e));
    this.host.onProgress((p) => this.onAnalysisProgress(p));
    onWaveformMissing((track) => this.requestWaveform(track));
    void this.queueAnalysis(this.store.getState().library.tracks.filter(needsAnalysis));
  }

  private update(patch: Partial<ImportProgress>): void {
    this.progress = { ...this.progress, ...patch };
    this.setProgress(this.progress);
  }

  private tell(text: string, tone: 'info' | 'warn' | 'ok' = 'info'): void {
    this.store.dispatch({ type: 'ui/toast', text, tone });
  }

  /** "Add folder…": pick, then import (which remembers the folder). */
  async addFolder(): Promise<void> {
    const folder = await this.host.pickFolder();
    if (folder) await this.importFolder(folder);
  }

  async removeFolder(folder: string): Promise<void> {
    const s = this.store.getState();
    this.store.dispatch({ type: 'library/folders', folders: s.library.folders.filter((f) => f !== folder) });
    const prefix = folder.replace(/[\\/]+$/, '') + (folder.includes('\\') ? '\\' : '/');
    const gone = s.library.tracks.filter((t) => t.source === 'local' && t.path && t.path.startsWith(prefix)).map((t) => t.id);
    if (gone.length) this.store.dispatch({ type: 'library/remove', trackIds: gone });
  }

  async rescanAll(): Promise<void> {
    for (const folder of this.store.getState().library.folders) await this.importFolder(folder);
  }

  async importFolder(folder: string): Promise<void> {
    if (this.importing) {
      this.tell('An import is already running — wait for it to finish', 'warn');
      return;
    }
    this.importing = true;
    const folders = this.store.getState().library.folders;
    if (!folders.includes(folder)) this.store.dispatch({ type: 'library/folders', folders: [...folders, folder] });
    this.update({ phase: 'scanning', done: 0, total: 0, current: folder, failed: 0 });
    try {
      const files = await this.host.scan(folder);
      if (files.length === 0) {
        this.tell(`No wav, flac or mp3 files found in ${folder}`, 'warn');
        return;
      }
      await this.importPaths(files, folder);
    } catch (e) {
      this.tell(`Could not read ${folder}: ${String((e as Error)?.message ?? e)}`, 'warn');
    } finally {
      this.importing = false;
      if (!this.analysing) this.update({ ...IDLE_PROGRESS });
    }
  }

  /** "Add files…" from the picker goes through the same path as a folder. */
  async addFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    this.importing = true;
    this.update({ phase: 'reading', done: 0, total: paths.length, current: null, failed: 0 });
    try {
      await this.importPaths(paths, null);
    } finally {
      this.importing = false;
      if (!this.analysing) this.update({ ...IDLE_PROGRESS });
    }
  }

  private async importPaths(paths: string[], folder: string | null): Promise<void> {
    const byId = new Map(this.store.getState().library.tracks.map((t) => [t.id, t]));
    // Files already in the library are only re-read when they changed on disk; the rest are new.
    const todo = paths.filter((p) => {
      const t = byId.get(localTrackId(p));
      return !t || t.fileSize === undefined;
    });
    this.update({ phase: 'reading', done: 0, total: todo.length, current: folder });
    let added = 0;
    let unreadable = 0;
    const toAnalyse: Track[] = [];
    for (let i = 0; i < todo.length; i += DESCRIBE_BATCH) {
      const batch = todo.slice(i, i + DESCRIBE_BATCH).map((p) => ({ path: p, id: localTrackId(p) }));
      const described = await this.host.describe(batch);
      const tracks: Track[] = [];
      for (const d of described) {
        if (!d || d.error) {
          unreadable += 1;
          continue;
        }
        const t = trackFromDescription(d, Date.now(), byId.get(localTrackId(d.path)));
        tracks.push(t);
        if (needsAnalysis(t)) toAnalyse.push(t);
      }
      if (tracks.length) {
        this.store.dispatch({ type: 'library/upsert', tracks });
        added += tracks.length;
      }
      this.update({ done: Math.min(todo.length, i + batch.length) });
    }
    const skipped = paths.length - todo.length;
    const parts = [`${added} track${added === 1 ? '' : 's'} added`];
    if (skipped) parts.push(`${skipped} already in the library`);
    if (unreadable) parts.push(`${unreadable} unreadable`);
    this.tell(parts.join(', '), unreadable ? 'warn' : 'ok');
    await this.queueAnalysis(toAnalyse);
  }

  async queueAnalysis(tracks: Track[]): Promise<void> {
    const items = tracks.filter((t) => t.path).map((t) => ({ id: t.id, path: t.path! }));
    if (items.length === 0) return;
    this.analysing = true;
    const r = await this.host.analyze(items);
    this.update({ phase: 'analysing', total: r.total, current: null });
  }

  async cancel(): Promise<void> {
    await this.host.cancelAnalysis();
  }

  private titleOf(id: string): string | null {
    const t = this.store.getState().library.tracks.find((x) => x.id === id);
    return t ? `${t.artist ? `${t.artist} — ` : ''}${t.title}` : null;
  }

  private onAnalysisProgress(p: AnalysisProgress): void {
    if (p.phase === 'idle') {
      this.analysing = false;
      if (!this.importing) {
        if (this.progress.total > 0) this.tell(`Analysed ${this.progress.done - this.progress.failed} track${this.progress.done - this.progress.failed === 1 ? '' : 's'}${this.progress.failed ? `, ${this.progress.failed} failed` : ''}`, this.progress.failed ? 'warn' : 'ok');
        this.update({ ...IDLE_PROGRESS });
      }
      return;
    }
    this.analysing = true;
    this.update({ phase: 'analysing', done: p.done, total: p.total, current: p.current ? this.titleOf(p.current.id) ?? p.current.path : null });
  }

  private onAnalysis(e: AnalysisEvent): void {
    if (e.ok) {
      this.store.dispatch({ type: 'library/analysis', trackId: e.id, result: analysisResult(e.meta) });
      // A fresh waveform is on disk now: the next draw fetches it.
      forgetWaveform(e.id);
      this.waveRequested.delete(e.id);
    } else {
      this.store.dispatch({ type: 'library/analysisFailed', trackId: e.id, error: e.error });
      this.update({ failed: this.progress.failed + 1 });
    }
  }

  private requestWaveform(track: Track): void {
    if (hasWaveform(track.id) || this.waveRequested.has(track.id)) return;
    if (track.analysedAt === undefined) return; // nothing on disk yet; onAnalysis will clear the way
    this.waveRequested.add(track.id);
    this.host
      .waveform(track.id)
      .then((bytes) => {
        const data = bytes ? waveformFromBytes(bytes) : null;
        if (data) setWaveform(track.id, data);
      })
      .catch(() => undefined);
  }
}
