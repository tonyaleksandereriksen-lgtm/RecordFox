import type { CSSProperties } from 'react';
import { useRef } from 'react';
import { beatLen } from '../../engine/selectors.ts';
import type { DeckIndex } from '../../engine/types.ts';
import { store } from '../../runtime.ts';
import { tokens } from '../../theme/tokens.ts';
import { useEngine, useRaf } from '../hooks.ts';
import { ScrollWave } from '../waveform/Overview.tsx';
import { TRACK_MIME, deckLetter } from './Deck.tsx';
import { GridPanel } from './GridPanel.tsx';
import { dispatch } from '../hooks.ts';

/**
 * A full-width scrolling waveform lane, stacked one per deck at the top of the screen — the
 * rekordbox horizontal arrangement. The bar counter on the right is the playhead in bars.
 */
export function WaveLane({ deck }: { deck: DeckIndex }) {
  const hasTrack = useEngine((s) => s.decks[deck].track !== null);
  const gridEdit = useEngine((s) => s.ui.gridDeck === deck);
  const gridMoved = useEngine((s) => s.decks[deck].track?.bpmOriginal !== undefined);
  const barsRef = useRef<HTMLSpanElement>(null);

  useRaf(() => {
    const d = store.getState().decks[deck];
    if (!barsRef.current) return;
    if (!d.track) {
      barsRef.current.textContent = '';
      return;
    }
    const bars = (d.positionSec - d.track.firstBeatSec) / (beatLen(d.track) * 4);
    barsRef.current.textContent = `${bars < 0 ? 0 : bars.toFixed(1)} Bars`;
  });

  return (
    <div
      className={`wave-lane${hasTrack ? '' : ' empty'}`}
      style={{ '--deck': tokens.color.deck[deck], '--deck-glow': tokens.color.deckGlow[deck] } as CSSProperties}
      aria-label={`Deck ${deckLetter(deck)} waveform`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(TRACK_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(TRACK_MIME);
        if (id) dispatch({ type: 'deck/load', deck, trackId: id });
      }}
    >
      <ScrollWave deck={deck} />
      <span className="lane-badge" aria-hidden="true">
        {deckLetter(deck)}
      </span>
      {hasTrack && (
        <button
          className={`lane-grid-btn${gridEdit ? ' on' : ''}${gridMoved ? ' edited' : ''}`}
          onClick={() => dispatch({ type: 'ui/gridDeck', deck: gridEdit ? null : deck })}
          aria-pressed={gridEdit}
          title={gridEdit ? 'Close the beat-grid editor' : 'Edit the beat grid (downbeat, nudge, BPM, tap)'}
        >
          Grid
        </button>
      )}
      <span className="lane-bars mono" ref={barsRef} />
      {gridEdit && <GridPanel deck={deck} />}
    </div>
  );
}
