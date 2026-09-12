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
import { dispatch, useEngine } from '../hooks.ts';
import { TrackWave } from '../waveform/Overview.tsx';
import { APP_TAGLINE } from '../../brand.ts';

const playlistIcon = (p: Playlist): IconName => (p.smart === 'favorites' ? 'star' : p.smart === 'recent' ? 'clock' : 'playlist');

function load(deck: DeckIndex, trackId: string) {
  dispatch({ type: 'deck/load', deck, trackId });
}

/** Double-click: first deck that isn't playing. */
function loadToFree(trackId: string) {
  const s = store.getState();
  load(!s.decks[0].playing ? 0 : !s.decks[1].playing ? 1 : 0, trackId);
}

function Tree() {
  const tracks = useEngine((s) => s.library.tracks);
  const playlists = useEngine((s) => s.library.playlists);
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
        <Icon name="device" /> Local files
      </div>
      <button className="tree-item indent" disabled title="Adding music folders arrives with the audio engine (slice 2)">
        <Icon name="folder" />
        <span className="tree-name">Add a music folder</span>
        <span className="soon">slice 2</span>
      </button>
      <div className="tree-brand" aria-hidden="true">
        <Mark size={30} />
        <Wordmark height={9} />
        <span>{APP_TAGLINE}</span>
      </div>
    </nav>
  );
}

function Row({ t, i, selected, onDeck }: { t: Track; i: number; selected: boolean; onDeck: [boolean, boolean] }) {
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
      <span className="c-key">{t.key}</span>
      <span className="c-bpm mono">{t.bpm.toFixed(2)}</span>
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
      </div>
      <div className="table" role="grid" aria-label="Tracks" aria-rowcount={rows.length} tabIndex={0} onKeyDown={onKey}>
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
            <Row key={t.id} t={t} i={i} selected={t.id === selected} onDeck={[on0 === t.id, on1 === t.id]} />
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
      <div className="detail-genre">{track.genre}</div>
      <div className="detail-nums">
        <span>{track.key}</span>
        <span className="mono">{track.bpm.toFixed(2)}</span>
        <span className="mono detail-len">{formatTime(track.durationSec, false)}</span>
      </div>
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
