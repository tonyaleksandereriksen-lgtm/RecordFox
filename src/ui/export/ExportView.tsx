import { useMemo, useState } from 'react';
import { APP_NAME } from '../../brand.ts';
import { COLLECTION, tracksInView, viewName } from '../../engine/library.ts';
import { formatTime } from '../../lib/format.ts';
import { CUESHEET_EXT, PLAYLIST_EXT, buildExportFiles, safeFileName, uniqueBase, type ExportFile } from '../../lib/exporter.ts';
import { Icon } from '../common/Icon.tsx';
import { dispatch, useEngine } from '../hooks.ts';

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
  const [withPlaylist, setWithPlaylist] = useState(true);
  const [withCues, setWithCues] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const lib = { tracks, playlists };
  const rows = useMemo(() => tracksInView({ tracks, playlists }, source), [tracks, playlists, source]);
  const fileBase = safeFileName(name ?? viewName(lib, source));
  const picker = canPickFolder();

  const note = (text: string, tone: LogLine['tone'] = 'info') => setLog((l) => [{ id: ++logSeq, text, tone }, ...l].slice(0, 20));

  const pick = async () => {
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
      if (dir) {
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
            <button className="btn folder-btn" onClick={pick}>
              <Icon name="folder" /> {dir ? dir.name : 'Choose a folder…'}
            </button>
            <p className="fine">{dir ? 'Existing files are never replaced — a number is added to the name instead.' : 'Pick any folder on this computer or a USB stick.'}</p>
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
        <p className="fine">The cue sheet keeps BPM, key, rating, comments and hot cues A–H. Audio files are copied too once real tracks can be added (next slice) — the demo tracks have no audio.</p>

        <button className="btn primary export-go" disabled={!ready || busy || (picker && !dir)} onClick={doExport}>
          <Icon name="export" /> {busy ? 'Exporting…' : picker ? (dir ? `Export to ${dir.name}` : 'Choose a folder first') : 'Download files'}
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
