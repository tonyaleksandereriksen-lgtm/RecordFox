import type { CSSProperties } from 'react';
import { useRef } from 'react';
import { effectiveBpm, remainingSec } from '../../engine/selectors.ts';
import type { DeckIndex } from '../../engine/types.ts';
import { formatBpm, formatTime } from '../../lib/format.ts';
import { playLook } from '../../midi/leds.ts';
import { store } from '../../runtime.ts';
import { tokens } from '../../theme/tokens.ts';
import { Artwork } from '../common/Artwork.tsx';
import { Icon } from '../common/Icon.tsx';
import { deckLetter } from '../deck/Deck.tsx';
import { dispatch, useEngine, useRaf } from '../hooks.ts';
import { DeckOverview } from '../waveform/Overview.tsx';
import { Library } from './Library.tsx';

/** Compact deck for the Library screen: what's loaded, where it is, play/pause. */
function MiniDeck({ deck }: { deck: DeckIndex }) {
  const track = useEngine((s) => s.decks[deck].track);
  const bpm = useEngine((s) => Math.round(effectiveBpm(s, deck) * 100) / 100);
  const play = useEngine((s) => playLook(s.decks[deck]));
  const playing = useEngine((s) => s.decks[deck].playing);
  const timeRef = useRef<HTMLSpanElement>(null);
  useRaf(() => {
    const d = store.getState().decks[deck];
    if (timeRef.current) timeRef.current.textContent = d.track ? `−${formatTime(remainingSec(d), false)}` : '--:--';
  });
  return (
    <div className="panel minideck" style={{ '--deck': tokens.color.deck[deck] } as CSSProperties} aria-label={`Deck ${deckLetter(deck)}`}>
      <span className="deck-badge sm">{deckLetter(deck)}</span>
      <Artwork track={track} className="minideck-art" />
      <div className="minideck-meta">
        <div className="deck-title">{track ? track.title : 'No track loaded'}</div>
        <div className="deck-artist">{track ? track.artist : 'Use A / B in the list'}</div>
      </div>
      <DeckOverview deck={deck} className="minideck-ov" />
      <span className="deck-key">{track?.key ?? '—'}</span>
      <span className="mono minideck-bpm">{formatBpm(bpm)}</span>
      <span className="mono minideck-time" ref={timeRef} />
      <button className="tbtn play sm" data-look={play} onClick={() => dispatch({ type: 'deck/playPause', deck })} aria-label={playing ? 'Pause' : 'Play'} disabled={!track}>
        <Icon name={playing ? 'pause' : 'play'} size={12} filled />
      </button>
    </div>
  );
}

export function LibraryView() {
  return (
    <div className="view library-view">
      <div className="minidecks">
        <MiniDeck deck={0} />
        <MiniDeck deck={1} />
      </div>
      <section className="panel library-panel" aria-label="Library">
        <Library />
      </section>
    </div>
  );
}
