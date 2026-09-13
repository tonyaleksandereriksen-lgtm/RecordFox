import { useMemo, useState } from 'react';
import { APP_NAME } from '../../brand.ts';
import { COLLECTION, tracksInView, viewName } from '../../engine/library.ts';
import { formatTime } from '../../lib/format.ts';
import { CUESHEET_EXT, PLAYLIST_EXT, buildExportFiles, planCopies, safeFileName, uniqueBase, type ExportFile } from '../../lib/exporter.ts';
import { libraryHost } from '../../library/host.ts';
import { Icon } from '../common/Icon.tsx';
import { dispatch, useEngine } from '../hooks.ts';

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

/** Minimal File System Access types (not all are in lib.dom yet). */
interface Writable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface DirHandle {
  name: string;
  keys(): AsyncIterable<string>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{ createWritable(): Promise<Writable> }>;
  queryPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
}
type PickerWindow = Window & { showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<DirHandle> };

const canPickFolder = () => typeof (window as PickerWindow).showDirectoryPicker === 'function';

interface LogLine {
  id: number;
  text: string;
  tone: 'ok' | 'warn' | 'info';
}
let logSeq = 0;

async function writeToFolder(dir: DirHandle, files: ExportFile[]): Promise<void> {
  for (const f of files) {
    const fh = await dir.getFileHandle(f.name, { create: true });
    const w = await fh.createWritable();
    await w.write(f.text);
    await w.close();
  }
}

/** Browser fallback: hand each file to the downloads folder. */
function download(files: ExportFile[]): void {
  for (const f of files) {
    const url = URL.createObjectURL(new Blob([f.text], { type: f.type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export function ExportView() {
  const tracks = useEngine((s) => s.library.tracks);
  const playlists = useEngine((s) => s.library.playlists);
  const [source, setSource] = useState(COLLECTION);
  const [name, setName] = useState<string | null>(null);
  const [dir, setDir] = useState<DirHandle | null>(null);
  /** Desktop app: a plain folder path; the main process writes and copies. */
  const [dirPath, setDirPath] = useState<string | null>(null);
  const [withPlaylist, setWithPlaylist] = useState(true);
  const [withCues, setWithCues] = useState(true);
  const [withAudio, setWithAudio] = useState(true);
  const fileHost = libraryHost();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const lib = { tracks, playlists };
  const rows = useMemo(() => tracksInView({ tracks, playlists }, source), [tracks, playlists, source]);
  const fileBase = safeFileName(name ?? viewName(lib, source));
  const picker = !!fileHost || canPickFolder();
  const localCount = rows.filter((t) => t.source === 'local' && t.path).length;
  const destName = fileHost ? (dirPath ? baseName(dirPath) : null) : dir ? dir.name : null;

  const note = (text: string, tone: LogLine['tone'] = 'info') => setLog((l) => [{ id: ++logSeq, text, tone }, ...l].slice(0, 20));

  const pick = async () => {
    if (fileHost) {
      const p = await fileHost.pickExportFolder();
      if (p) {
        setDirPath(p);
        note(`Folder chosen: ${p}`);
      }
      return;
    }
    try {
      const h = await (window as PickerWindow).showDirectoryPicker!({ id: 'rekordfox-export', mode: 'readwrite', startIn: 'music' });
      setDir(h);
      note(`Folder chosen: ${h.name}`);
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') note(`Could not open the folder: ${(e as Error).message}`, 'warn');
    }
  };

  const doExport = async () => {
    if (!rows.length || (!withPlaylist && !withCues)) return;
    setBusy(true);
    const exts = [withPlaylist && PLAYLIST_EXT, withCues && CUESHEET_EXT].filter((x): x is string => !!x);
    const listName = viewName(lib, source);
    try {
      if (fileHost && dirPath) {
        const taken = await fileHost.listDir(dirPath);
        const base = uniqueBase(fileBase, exts, taken);
        const plan = withAudio ? planCopies(rows, taken) : null;
        const files = buildExportFiles(rows, { name: listName, app: APP_NAME, base, playlist: withPlaylist, cueSheet: withCues, pathFor: plan?.pathFor });
        const r = await fileHost.exportWrite({ dir: dirPath, files: files.map((f) => ({ name: f.name, text: f.text })), copies: plan?.copies ?? [] });
        if (base !== fileBase) note(`“${fileBase}” already exists there — saved as “${base}” instead.`, 'warn');
        note(`Wrote ${r.written.join(' and ')} to ${baseName(dirPath)}`, 'ok');
        if (plan) note(`Copied ${r.copied.length} of ${plan.copies.length} audio file${plan.copies.length === 1 ? '' : 's'}${localCount < rows.length ? ` (${rows.length - localCount} demo track${rows.length - localCount === 1 ? ' has' : 's have'} no file)` : ''}`, r.failed.length ? 'warn' : 'ok');
        for (const f of r.failed) note(`${f.file}: ${f.error}`, 'warn');
        dispatch({ type: 'ui/toast', text: `Exported ${rows.length} tracks to ${baseName(dirPath)}`, tone: r.failed.length ? 'warn' : 'ok' });
      } else if (dir) {
        if (dir.queryPermission && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
          if (!dir.requestPermission || (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Write permission for the folder was not granted.');
        }
        const taken: string[] = [];
        for await (const k of dir.keys()) taken.push(k);
        const base = uniqueBase(fileBase, exts, taken);
        const files = buildExportFiles(rows, { name: listName, app: APP_NAME, base, playlist: withPlaylist, cueSheet: withCues });
        await writeToFolder(dir, files);
        if (base !== fileBase) note(`“${fileBase}” already exists there — saved as “${base}” instead.`, 'warn');
        note(`Wrote ${files.map((f) => f.name).join(' and ')} to ${dir.name}`, 'ok');
        dispatch({ type: 'ui/toast', text: `Exported ${rows.length} tracks to ${dir.name}`, tone: 'ok' });
      } else {
        const files = buildExportFiles(rows, { name: listName, app: APP_NAME, base: fileBase, playlist: withPlaylist, cueSheet: withCues });
        download(files);
        note(`Downloaded ${files.map((f) => f.name).join(' and ')}`, 'ok');
      }
    } catch (e) {
      note(`Export failed: ${(e as Error).message}`, 'warn');
    } finally {
      setBusy(false);
    }
  };

  const sources = [{ id: COLLECTION, name: 'Collection' }, ...playlists.map((p) => ({ id: p.id, name: p.name }))];
  const ready = rows.length > 0 && (withPlaylist || withCues);

  return (
    <div className="view export">
      <nav className="panel side-nav" aria-label="What to export">
        <div className="tree-group">Export from</div>
        {sources.map((s) => (
          <button
            key={s.id}
            className={`tree-item${source === s.id ? ' on' : ''}`}
            aria-current={source === s.id}
            onClick={() => {
              setSource(s.id);
              setName(null);
            }}
          >
            <Icon name={s.id === COLLECTION ? 'collection' : 'playlist'} />
            <span className="tree-name">{s.name}</span>
            <span className="tree-count mono">{tracksInView(lib, s.id).length}</span>
          </button>
        ))}
      </nav>

      <section className="panel export-list" aria-label="Tracks to export">
        <header className="page-head compact">
          <h2>{viewName(lib, source)}</h2>
          <p>
            {rows.length} track{rows.length === 1 ? '' : 's'} · {formatTime(rows.reduce((a, t) => a + t.durationSec, 0), false)} total
          </p>
        </header>
        <div className="export-table">
          <div className="xr head">
            <span>#</span>
            <span>Title</span>
            <span>Artist</span>
            <span>BPM</span>
            <span>Key</span>
            <span>Length</span>
            <span>Hot cues</span>
          </div>
          <div className="xbody">
            {rows.map((t, i) => (
              <div className="xr" key={t.id}>
                <span className="mono dim">{i + 1}</span>
                <span className="ellipsis">{t.title}</span>
                <span className="ellipsis dim">{t.artist}</span>
                <span className="mono">{t.bpm.toFixed(2)}</span>
                <span>{t.key}</span>
                <span className="mono">{formatTime(t.durationSec, false)}</span>
                <span className="mono">{(t.cues ?? []).filter((c) => c !== null && c !== undefined).length}</span>
              </div>
            ))}
            {rows.length === 0 && <div className="table-empty">Nothing to export in this list.</div>}
          </div>
        </div>
      </section>

      <aside className="panel export-dest" aria-label="Destination">
        <h3 className="section-label">Destination</h3>
        {picker ? (
          <>
            <button className="btn folder-btn" onClick={pick} title={dirPath ?? undefined}>
              <Icon name="folder" /> {destName ?? 'Choose a folder…'}
            </button>
            <p className="fine">{destName ? 'Existing files are never replaced — a number is added to the name instead.' : 'Pick any folder on this computer or a USB stick.'}</p>
          </>
        ) : (
          <p className="fine">This browser can’t write to a folder directly; the files go to your Downloads folder instead.</p>
        )}

        <h3 className="section-label">File name</h3>
        <input className="text-input" value={name ?? viewName(lib, source)} onChange={(e) => setName(e.target.value)} aria-label="File name" />

        <h3 className="section-label">Include</h3>
        <label className="check-row">
          <input type="checkbox" checked={withPlaylist} onChange={() => setWithPlaylist(!withPlaylist)} />
          <span className="checkbox" aria-hidden="true">
            <Icon name="check" size={10} />
          </span>
          <span>
            Playlist <span className="mono dim">{fileBase + PLAYLIST_EXT}</span>
          </span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={withCues} onChange={() => setWithCues(!withCues)} />
          <span className="checkbox" aria-hidden="true">
            <Icon name="check" size={10} />
          </span>
          <span>
            Cue sheet <span className="mono dim">{fileBase + CUESHEET_EXT}</span>
          </span>
        </label>
        {fileHost && (
          <label className="check-row">
            <input type="checkbox" checked={withAudio} onChange={() => setWithAudio(!withAudio)} />
            <span className="checkbox" aria-hidden="true">
              <Icon name="check" size={10} />
            </span>
            <span>
              Audio files <span className="mono dim">{localCount} of {rows.length}</span>
            </span>
          </label>
        )}
        <p className="fine">
          The cue sheet keeps BPM, key, rating, comments and hot cues A–H.{' '}
          {fileHost ? 'Audio files are copied next to it under the names the playlist uses; demo tracks have no file.' : 'Copying the audio files needs the desktop app.'}
        </p>

        <button className="btn primary export-go" disabled={!ready || busy || (picker && !destName)} onClick={doExport}>
          <Icon name="export" /> {busy ? 'Exporting…' : picker ? (destName ? `Export to ${destName}` : 'Choose a folder first') : 'Download files'}
        </button>

        {log.length > 0 && (
          <ul className="export-log">
            {log.map((l) => (
              <li key={l.id} className={l.tone}>
                {l.text}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
