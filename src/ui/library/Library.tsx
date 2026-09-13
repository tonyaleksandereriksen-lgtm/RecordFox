import type { CSSProperties, KeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { COLLECTION, searchTracks, tracksInView, viewName } from '../../engine/library.ts';
import type { DeckIndex, Playlist, Track } from '../../engine/types.ts';
import { formatTime } from '../../lib/format.ts';
import { store } from '../../runtime.ts';
import { tokens } from '../../theme/tokens.ts';
import { Artwork } from '../common/Artwork.tsx';
import { Icon, type IconName } from '../common/Icon.tsx';
import { Mark, Wordmark } from '../common/Logo.tsx';
import { Stars } from '../common/Stars.tsx';
import { TRACK_MIME, deckLetter } from '../deck/Deck.tsx';
import { dispatch, useEngine, useHost } from '../hooks.ts';
import { TrackWave } from '../waveform/Overview.tsx';
import { APP_TAGLINE } from '../../brand.ts';
import { audioHost } from '../../audio/host.ts';
import { library } from '../../runtime.ts';
import { keyLabel } from '../../library/tracks.ts';

/** Desktop only: pick audio files or a folder; tags, duration and analysis follow through the controller. */
function AddButtons() {
  const [busy, setBusy] = useState(false);
  const host = audioHost();
  const lib = library;
  if (!host || !lib) return null;
  const run = (job: () => Promise<void>) => {
    setBusy(true);
    job()
      .catch((e) => dispatch({ type: 'ui/toast', text: `Could not add: ${String((e as Error)?.message ?? e)}`, tone: 'warn' }))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <button className="btn" disabled={busy} onClick={() => run(() => lib.addFolder())} title="Add a folder: every wav, flac and mp3 in it, with subfolders">
        <Icon name="folder" /> Add folder…
      </button>
      <button className="btn" disabled={busy} onClick={() => run(async () => lib.addFiles(await host.pickFiles()))} title="Add single wav, flac or mp3 files">
        <Icon name="file" /> Add files…
      </button>
    </>
  );
}

/** Folder import and analysis, while they run. */
function ImportStrip() {
  const p = useHost().library;
  if (p.phase === 'idle') return null;
  const text =
    p.phase === 'scanning'
      ? `Scanning ${p.current ?? ''}…`
      : p.phase === 'reading'
        ? `Reading files ${p.done} / ${p.total}…`
        : `Analysing ${Math.min(p.done + 1, p.total)} / ${p.total}${p.current ? ` — ${p.current}` : ''}`;
  const frac = p.total > 0 ? Math.min(1, p.done / p.total) : 0;
  return (
    <div className="import-strip" role="status" aria-live="polite">
      <span className="ellipsis">{text}</span>
      <span className="import-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(frac * 100)}%` }} />
      </span>
      {p.phase === 'analysing' && (
        <button className="mini" onClick={() => void library?.cancel()} title="Stop analysing (what is done stays)">
          Stop
        </button>
      )}
    </div>
  );
}

function bpmText(t: Track, analysing: boolean): string {
  if (t.bpm > 0) return t.bpm.toFixed(2);
  if (t.source !== 'local') return '—';
  if (t.analysisError) return '?';
  return analysing ? '…' : '—';
}

const playlistIcon = (p: Playlist): IconName => (p.smart === 'favorites' ? 'star' : p.smart === 'recent' ? 'clock' : 'playlist');

function load(deck: DeckIndex, trackId: string) {
  dispatch({ type: 'deck/load', deck, trackId });
}

/** Double-click: first deck that isn't playing. */
function loadToFree(trackId: string) {
  const s = store.getState();
  load(!s.decks[0].playing ? 0 : !s.decks[1].playing ? 1 : 0, trackId);
}

const folderName = (f: string) => f.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || f;

function Tree() {
  const tracks = useEngine((s) => s.library.tracks);
  const playlists = useEngine((s) => s.library.playlists);
  const folders = useEngine((s) => s.library.folders);
  const view = useEngine((s) => s.library.view);
  const lib = { tracks, playlists };
  const item = (id: string, label: string, icon: IconName, count: number, indent = false) => (
    <button key={id} className={`tree-item${indent ? ' indent' : ''}${view === id ? ' on' : ''}`} onClick={() => dispatch({ type: 'library/view', view: id })} aria-current={view === id}>
      <Icon name={icon} />
      <span className="tree-name">{label}</span>
      <span className="tree-count mono">{count}</span>
    </button>
  );
  return (
    <nav className="tree" aria-label="Library">
      {item(COLLECTION, 'Collection', 'collection', tracks.length)}
      <div className="tree-group">
        <Icon name="folder" /> Playlists
      </div>
      {playlists.map((p) => item(p.id, p.name, playlistIcon(p), tracksInView(lib, p.id).length, true))}
      <div className="tree-group">
        <Icon name="cloud" /> Streaming
      </div>
      <button className="tree-item indent" disabled title="Audius has an open API. Wiring it in (and checking its terms for live mixing) comes after the audio engine.">
        <Icon name="cloud" />
        <span className="tree-name">Audius</span>
        <span className="soon">soon</span>
      </button>
      <div className="tree-group">
        <Icon name="device" /> Music folders
      </div>
      {folders.map((f) => (
        <div key={f} className="tree-item indent folder-item" title={f}>
          <Icon name="folder" />
          <span className="tree-name ellipsis">{folderName(f)}</span>
          <span className="tree-count mono">{tracks.filter((t) => t.path && t.path.startsWith(f)).length}</span>
          <button className="tree-mini" onClick={() => void library?.importFolder(f)} title="Rescan this folder for new files">
            ↻
          </button>
          <button className="tree-mini" onClick={() => void library?.removeFolder(f)} title="Remove this folder and its tracks from the library (files stay on disk)">
            ×
          </button>
        </div>
      ))}
      {folders.length === 0 && (
        <button className="tree-item indent" disabled={!library} onClick={() => void library?.addFolder()} title={library ? 'Add a folder of wav, flac or mp3 files' : 'Folders need the desktop app'}>
          <Icon name="folder" />
          <span className="tree-name">Add a music folder</span>
          {!library && <span className="soon">desktop</span>}
        </button>
      )}
      <div className="tree-brand" aria-hidden="true">
        <Mark size={30} />
        <Wordmark height={9} />
        <span>{APP_TAGLINE}</span>
      </div>
    </nav>
  );
}

function Row({ t, i, selected, onDeck, analysing }: { t: Track; i: number; selected: boolean; onDeck: [boolean, boolean]; analysing: boolean }) {
  return (
    <div
      role="row"
      aria-selected={selected}
      className={`tr${selected ? ' sel' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TRACK_MIME, t.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => dispatch({ type: 'library/select', trackId: t.id })}
      onDoubleClick={() => loadToFree(t.id)}
    >
      <span className="c-num mono">{i + 1}</span>
      <span className="c-art">
        <Artwork track={t} />
      </span>
      <span className="c-title">
        {([0, 1] as DeckIndex[]).map((d) =>
          onDeck[d] ? (
            <span key={d} className="on-deck" style={{ '--deck': tokens.color.deck[d] } as CSSProperties} title={`Loaded on deck ${deckLetter(d)}`}>
              {deckLetter(d)}
            </span>
          ) : null,
        )}
        <span className="ellipsis">{t.title}</span>
      </span>
      <span className="c-artist ellipsis">{t.artist}</span>
      <span className="c-key" title={t.keyName ? `${t.keyName}${t.keyMargin !== undefined && t.keyMargin < 0.05 ? ' — ambiguous, could be its relative' : ''}` : undefined}>
        {keyLabel(t)}
      </span>
      <span className="c-bpm mono" title={t.analysisError ? `Analysis failed: ${t.analysisError}` : undefined}>
        {bpmText(t, analysing)}
      </span>
      <span className="c-len mono">{formatTime(t.durationSec, false)}</span>
      <span className="c-genre ellipsis">{t.genre}</span>
      <span className="c-rating">
        <Stars trackId={t.id} rating={t.rating} />
      </span>
      <span className="c-load">
        {([0, 1] as DeckIndex[]).map((d) => (
          <button
            key={d}
            className="load-btn"
            style={{ '--deck': tokens.color.deck[d] } as CSSProperties}
            onClick={(e) => {
              e.stopPropagation();
              load(d, t.id);
            }}
            title={`Load to deck ${deckLetter(d)}`}
            aria-label={`Load ${t.title} to deck ${deckLetter(d)}`}
          >
            {deckLetter(d)}
          </button>
        ))}
      </span>
    </div>
  );
}

function TrackTable() {
  const tracks = useEngine((s) => s.library.tracks);
  const playlists = useEngine((s) => s.library.playlists);
  const view = useEngine((s) => s.library.view);
  const query = useEngine((s) => s.library.query);
  const selected = useEngine((s) => s.library.selectedId);
  const on0 = useEngine((s) => s.decks[0].track?.id ?? null);
  const on1 = useEngine((s) => s.decks[1].track?.id ?? null);
  const analysing = useHost().library.phase !== 'idle';
  const rows = useMemo(() => searchTracks(tracksInView({ tracks, playlists }, view), query), [tracks, playlists, view, query]);
  const body = useRef<HTMLDivElement>(null);

  // keep the selected row in view when moving with the keyboard
  useEffect(() => {
    body.current?.querySelector('.tr.sel')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const onKey = (e: KeyboardEvent) => {
    if (!rows.length) return;
    const i = rows.findIndex((t) => t.id === selected);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const j = i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      dispatch({ type: 'library/select', trackId: rows[j].id });
    } else if (e.key === 'Enter' && i >= 0) {
      e.preventDefault();
      loadToFree(rows[i].id);
    } else if (e.key === 'Delete' && i >= 0 && rows[i].source === 'local') {
      // Removes the entry only; the file stays on disk. Demo tracks cannot be removed.
      e.preventDefault();
      dispatch({ type: 'library/remove', trackIds: [rows[i].id] });
    }
  };

  return (
    <div className="tracks">
      <div className="search-row">
        <label className="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder={`Search in ${viewName({ playlists }, view).toLowerCase()}…`}
            value={query}
            onChange={(e) => dispatch({ type: 'library/query', query: e.target.value })}
            aria-label="Search tracks"
          />
        </label>
        <span className="search-count mono">
          {rows.length} / {tracks.length}
        </span>
        <AddButtons />
      </div>
      <ImportStrip />
      <div className="table" role="grid" aria-label="Tracks" aria-rowcount={rows.length} tabIndex={0} onKeyDown={onKey} title="Enter loads onto a free deck · Delete removes a local file from the library">
        <div className="tr head" role="row">
          <span className="c-num">#</span>
          <span className="c-art">Artwork</span>
          <span className="c-title">Track title</span>
          <span className="c-artist">Artist</span>
          <span className="c-key">Key</span>
          <span className="c-bpm">BPM</span>
          <span className="c-len">Length</span>
          <span className="c-genre">Genre</span>
          <span className="c-rating">Rating</span>
          <span className="c-load">Load</span>
        </div>
        <div className="tbody" ref={body}>
          {rows.map((t, i) => (
            <Row key={t.id} t={t} i={i} selected={t.id === selected} onDeck={[on0 === t.id, on1 === t.id]} analysing={analysing} />
          ))}
          {rows.length === 0 && <div className="table-empty">{query ? `Nothing matches “${query}”.` : 'This playlist is empty — tick it in a track’s detail panel to add tracks.'}</div>}
        </div>
      </div>
    </div>
  );
}

function Comment({ track }: { track: Track }) {
  const [text, setText] = useState(track.comment);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setText(track.comment), [track.id, track.comment]);
  const commit = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (v !== track.comment) dispatch({ type: 'library/comment', trackId: track.id, comment: v });
  };
  return (
    <textarea
      className="comment"
      value={text}
      rows={3}
      placeholder="Add a note for this track…"
      aria-label="Comments"
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), 600);
      }}
      onBlur={(e) => commit(e.target.value)}
    />
  );
}

function Detail() {
  const selectedId = useEngine((s) => s.library.selectedId);
  const track = useEngine((s) => s.library.tracks.find((t) => t.id === s.library.selectedId) ?? null);
  const playlists = useEngine((s) => s.library.playlists);
  if (!track || !selectedId) {
    return (
      <aside className="detail empty" aria-label="Track details">
        Select a track to see its details.
      </aside>
    );
  }
  const cues = (track.cues ?? [])
    .map((c, i) => (c === null || c === undefined ? null : { slot: String.fromCharCode(65 + i), sec: c }))
    .filter((c): c is { slot: string; sec: number } => c !== null);
  return (
    <aside className="detail" aria-label="Track details">
      <Artwork track={track} className="detail-art" />
      <div className="detail-title">{track.title}</div>
      <div className="detail-artist">{track.artist}</div>
      <div className="detail-genre">
        {[track.album, track.year ? String(track.year) : '', track.genre].filter(Boolean).join(' · ')}
      </div>
      <div className="detail-nums">
        <span title={track.keyName}>{keyLabel(track)}</span>
        <span className="mono">{track.bpm > 0 ? track.bpm.toFixed(2) : '—'}</span>
        <span className="mono detail-len">{formatTime(track.durationSec, false)}</span>
      </div>
      {track.source === 'local' && (
        <div className="fine detail-file">
          {track.analysisError
            ? `Analysis failed: ${track.analysisError}`
            : track.analysedAt
              ? `${track.keyName ?? ''}${track.keyMargin !== undefined && track.keyMargin < 0.05 ? ' (ambiguous)' : ''} · ${track.bpmOriginal !== undefined ? 'grid corrected by hand' : 'analysed'}${track.sampleRate ? ` · ${track.sampleRate / 1000} kHz` : ''}${track.bitrateKbps ? ` · ${track.bitrateKbps} kbps` : ''}`
              : 'Not analysed yet'}
        </div>
      )}
      <TrackWave track={track} color={tokens.color.deck[0]} />
      <div className="detail-section">
        <span className="section-label">Rating</span>
        <Stars trackId={track.id} rating={track.rating} size={13} />
      </div>
      {cues.length > 0 && (
        <div className="detail-section">
          <span className="section-label">Hot cues</span>
          <div className="cue-chips">
            {cues.map((c) => (
              <span key={c.slot} className="cue-chip mono" title={formatTime(c.sec)}>
                <b>{c.slot}</b> {formatTime(c.sec, false)}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="detail-section">
        <span className="section-label">Playlists</span>
        {playlists
          .filter((p) => !p.smart)
          .map((p) => (
            <label key={p.id} className="check-row">
              <input type="checkbox" checked={track.playlists.includes(p.id)} onChange={() => dispatch({ type: 'library/togglePlaylist', trackId: track.id, playlistId: p.id })} />
              <span className="checkbox" aria-hidden="true">
                <Icon name="check" size={10} />
              </span>
              {p.name}
            </label>
          ))}
      </div>
      <div className="detail-section">
        <span className="section-label">Comments</span>
        <Comment track={track} />
      </div>
    </aside>
  );
}

export function Library() {
  return (
    <div className="library">
      <Tree />
      <TrackTable />
      <Detail />
    </div>
  );
}
