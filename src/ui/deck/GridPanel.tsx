import type { DeckIndex } from '../../engine/types.ts';
import { formatBpm } from '../../lib/format.ts';
import { dispatch, useEngine } from '../hooks.ts';
import { deckLetter } from './Deck.tsx';

/**
 * Beat-grid editor, opened from the GRID button on a waveform lane. An automatic grid is often a
 * beat out on intros without a kick, so these are the corrections that matter: put the downbeat
 * under the playhead, nudge the whole grid by milliseconds, halve or double a wrong BPM, or tap it
 * out by ear. While this is open the deck's bar lines turn red.
 */
export function GridPanel({ deck }: { deck: DeckIndex }) {
  const track = useEngine((s) => s.decks[deck].track);
  const taps = useEngine((s) => s.decks[deck].gridTaps.length);
  if (!track) return null;
  const edited = track.bpmOriginal !== undefined;
  return (
    <div className="grid-panel" role="group" aria-label={`Deck ${deckLetter(deck)} beat grid`}>
      <span className="label">Grid</span>
      <button className="mini wide" onClick={() => dispatch({ type: 'grid/downbeatHere', deck })} title="Put the nearest downbeat exactly under the playhead">
        Downbeat here
      </button>
      <span className="grid-nudge">
        {[-10, -1, 1, 10].map((ms) => (
          <button key={ms} className="mini" onClick={() => dispatch({ type: 'grid/nudge', deck, ms })} title={`Move the whole grid ${ms > 0 ? 'later' : 'earlier'} by ${Math.abs(ms)} ms`}>
            {ms > 0 ? `+${ms}` : ms}
          </button>
        ))}
        <span className="grid-unit">ms</span>
      </span>
      <button className="mini" onClick={() => dispatch({ type: 'grid/scale', deck, factor: 0.5 })} title="Halve the BPM (the grid was counting double time)">
        ½
      </button>
      <button className="mini" onClick={() => dispatch({ type: 'grid/scale', deck, factor: 2 })} title="Double the BPM (the grid was counting half time)">
        ×2
      </button>
      <button className={`mini wide${taps > 0 ? ' on' : ''}`} onClick={() => dispatch({ type: 'grid/tap', deck })} title="Tap four beats to set the BPM by ear">
        {taps > 0 && taps < 3 ? `Tap ${taps}` : 'Tap'}
      </button>
      <span className="grid-readout mono">
        {formatBpm(track.bpm)} · {track.firstBeatSec.toFixed(3)}s
      </span>
      <button className="mini" onClick={() => dispatch({ type: 'grid/reset', deck })} disabled={!edited} title={edited ? `Back to the analysed grid (${formatBpm(track.bpmOriginal!)} BPM)` : 'The grid has not been changed'}>
        Reset
      </button>
      <button className="mini" onClick={() => dispatch({ type: 'ui/gridDeck', deck: null })} title="Close the grid editor">
        Done
      </button>
    </div>
  );
}
