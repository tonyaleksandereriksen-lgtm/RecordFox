import type { CSSProperties } from 'react';
import { useRef, useState } from 'react';
import { effectiveBpm, effectivePct, remainingSec } from '../../engine/selectors.ts';
import type { DeckIndex } from '../../engine/types.ts';
import { formatBpm, formatPct, formatTime } from '../../lib/format.ts';
import { store } from '../../runtime.ts';
import { tokens } from '../../theme/tokens.ts';
import { Artwork } from '../common/Artwork.tsx';
import { dispatch, useEngine, useRaf } from '../hooks.ts';
import { DeckOverview } from '../waveform/Overview.tsx';
import { TRACK_MIME, deckLetter } from './Deck.tsx';

/**
 * The deck's title row plus its whole-track overview, as one horizontal strip. Deck A carries its
 * badge on the left, deck B on the right, mirroring rekordbox's 2-deck horizontal layout.
 */
export function DeckInfo({ deck }: { deck: DeckIndex }) {
  const [over, setOver] = useState(false);
  const track = useEngine((s) => s.decks[deck].track);
  const bpm = useEngine((s) => Math.round(effectiveBpm(s, deck) * 100) / 100);
  const pct = useEngine((s) => Math.round(effectivePct(s, deck) * 100) / 100);
  const range = useEngine((s) => s.decks[deck].tempoRange);
  const sync = useEngine((s) => s.decks[deck].sync);
  const master = useEngine((s) => s.decks[deck].master);
  const timeRef = useRef<HTMLSpanElement>(null);
  const remainRef = useRef<HTMLSpanElement>(null);

  useRaf(() => {
    const d = store.getState().decks[deck];
    if (timeRef.current) timeRef.current.textContent = d.track ? formatTime(d.positionSec) : '--:--.-';
    if (remainRef.current) remainRef.current.textContent = d.track ? `−${formatTime(remainingSec(d), false)}` : '--:--';
  });

  const badge = (
    <span className="deck-badge" aria-hidden="true">
      {deckLetter(deck)}
    </span>
  );

  return (
    <section
      className={`panel deck-info${deck === 1 ? ' right' : ''}${over ? ' drop-target' : ''}`}
      style={{ '--deck': tokens.color.deck[deck], '--deck-dim': tokens.color.deckDim[deck], '--deck-glow': tokens.color.deckGlow[deck] } as CSSProperties}
      aria-label={`Deck ${deckLetter(deck)}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(TRACK_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(TRACK_MIME);
        if (id) dispatch({ type: 'deck/load', deck, trackId: id });
      }}
    >
      <div className="deck-info-row">
        {deck === 0 && badge}
        <Artwork track={track} className="deck-art" />
        <div className="deck-meta">
          <div className="deck-title" title={track?.title}>
            {track ? track.title : 'No track loaded'}
          </div>
          <div className="deck-artist">{track ? `${track.artist} · ${track.genre}` : 'Drag a track here, or use A / B in the library'}</div>
        </div>
        <span className="deck-time mono" ref={timeRef} title="Elapsed" />
        <span className="deck-remain mono" ref={remainRef} title="Remaining" />
        <div className="deck-keys">
          <span className="deck-key" title="Key (Camelot)">
            {track?.key ?? '—'}
          </span>
          <span className="deck-bpm mono" title="BPM">
            {formatBpm(bpm)}
          </span>
        </div>
        <div className="deck-sync">
          <button className="mini range" onClick={() => dispatch({ type: 'deck/tempoRange', deck })} title="Tempo range">
            ±{range}
          </button>
          <span className="deck-pct mono">{formatPct(pct)}</span>
          <button className={`mini${sync ? ' on' : ''}`} onClick={() => dispatch({ type: 'deck/syncToggle', deck })} aria-pressed={sync} title="BEAT SYNC">
            Sync
          </button>
          <button className={`mini${master ? ' on' : ''}`} onClick={() => dispatch({ type: 'deck/setMaster', deck })} aria-pressed={master} disabled={!track} title="Tempo master (long-press BEAT SYNC on the unit)">
            Master
          </button>
        </div>
        {deck === 1 && badge}
      </div>
      <DeckOverview deck={deck} className="deck-info-overview" />
    </section>
  );
}
