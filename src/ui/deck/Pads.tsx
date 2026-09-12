import type { CSSProperties } from 'react';
import { BEATLOOP_SIZES, formatBeatsShort } from './padLabels.ts';
import type { DeckIndex } from '../../engine/types.ts';
import type { PadMode } from '../../midi/types.ts';
import { padActions } from '../../midi/bindings.ts';
import { PAD_MODES } from '../../midi/flx2Map.ts';
import { formatTime } from '../../lib/format.ts';
import { store } from '../../runtime.ts';
import { tokens } from '../../theme/tokens.ts';
import { dispatch, shallowArray, useEngine } from '../hooks.ts';
import { deckLetter } from './Deck.tsx';

export const MODE_LABEL: Record<PadMode, string> = { hotcue: 'Hot Cue', padfx: 'Pad FX', beatloop: 'Beat Loop', sampler: 'Sampler' };
export const PAD_FX = ['Echo', 'Flanger', 'Reverb', 'Roll', 'Echo Out', 'Backspin', 'Braker', 'Rollout'];

/**
 * Pad-mode tabs over a 4 x 2 grid of pads, like rekordbox's hot-cue panel: each pad shows its
 * label and, for a set hot cue, its time. Pad mode itself lives in the unit's firmware
 * (SHIFT + BEAT SYNC, then pad 1-4); the tabs mirror it and can also set it from here.
 */
export function PadBlock({ deck }: { deck: DeckIndex }) {
  const mode = useEngine((s) => s.decks[deck].padMode);
  const known = useEngine((s) => s.decks[deck].padModeKnown);
  const selecting = useEngine((s) => s.decks[deck].padModeSelecting);
  const hotCues = useEngine((s) => s.decks[deck].hotCues, shallowArray);
  const held = useEngine((s) => s.decks[deck].hotCueHeld);
  const fxHeld = useEngine((s) => s.decks[deck].padFxHeld);
  const loopBeats = useEngine((s) => (s.decks[deck].loop.active ? s.decks[deck].loop.beats : null));
  const slots = useEngine((s) => s.sampler.slots.slice(deck * 8, deck * 8 + 8), shallowArray);
  const playing = useEngine((s) => s.sampler.playing.slice(deck * 8, deck * 8 + 8), shallowArray);
  const hasTrack = useEngine((s) => s.decks[deck].track !== null);

  const press = (pad: number, down: boolean, shift: boolean) => {
    for (const a of padActions(deck, store.getState().decks[deck].padMode, pad, shift, down)) dispatch(a);
  };

  return (
    <div className="padblock" style={{ '--deck': tokens.color.deck[deck] } as CSSProperties}>
      <div className="pad-tabs" role="tablist" aria-label={`Deck ${deckLetter(deck)} pad mode`}>
        {PAD_MODES.map((m, i) => (
          <button
            key={m}
            role="tab"
            aria-selected={m === mode}
            className={`pad-tab${m === mode ? ' on' : ''}`}
            onClick={() => dispatch({ type: 'deck/padMode', deck, mode: m, fromHardware: false })}
            title={`Pad mode ${i + 1} — on the unit: SHIFT + BEAT SYNC, then pad ${i + 1}`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
        <span className="pad-source">{selecting ? 'pick on unit…' : known ? 'from unit' : ''}</span>
      </div>
      <div className="pads" role="group" aria-label={`Deck ${deckLetter(deck)} pads — ${MODE_LABEL[mode]}`}>
        {Array.from({ length: 8 }, (_, i) => {
          let look: 'on' | 'set' | 'off' | 'blink' = 'off';
          let label = String(i + 1);
          let sub = '';
          let title = '';
          if (mode === 'hotcue') {
            const hc = hotCues[i];
            label = String.fromCharCode(65 + i);
            look = hc ? (held === i ? 'on' : 'set') : 'off';
            sub = hc ? formatTime(hc.posSec, false) : '';
            title = hc ? `Hot cue ${label} · ${formatTime(hc.posSec)} — click: jump · Shift+click: delete` : hasTrack ? `Set hot cue ${label}` : `Hot cue ${label}`;
          } else if (mode === 'padfx') {
            label = PAD_FX[i];
            sub = i < 4 ? 'hold' : 'toggle';
            look = fxHeld === i ? 'on' : 'off';
            title = `${PAD_FX[i]} (${i < 4 ? 'hold' : 'toggle'})`;
          } else if (mode === 'beatloop') {
            label = formatBeatsShort(BEATLOOP_SIZES[i]);
            sub = 'beats';
            look = loopBeats === BEATLOOP_SIZES[i] ? 'on' : 'off';
            title = `${label}-beat loop`;
          } else {
            const slot = slots[i];
            label = slot ? slot.name : '—';
            sub = `slot ${deck * 8 + i + 1}`;
            look = slot ? (playing[i] ? 'blink' : 'set') : 'off';
            title = slot ? `Sampler ${deck * 8 + i + 1}: ${slot.name}` : `Sampler ${deck * 8 + i + 1} (empty)`;
          }
          return (
            <button
              key={i}
              className="pad"
              data-look={look}
              title={title}
              aria-label={title}
              onPointerDown={(e) => press(i, true, e.shiftKey)}
              onPointerUp={(e) => press(i, false, e.shiftKey)}
              onPointerCancel={(e) => press(i, false, e.shiftKey)}
              onPointerLeave={(e) => e.buttons > 0 && press(i, false, e.shiftKey)}
              onKeyDown={(e) => {
                if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                  e.preventDefault();
                  press(i, true, e.shiftKey);
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') press(i, false, e.shiftKey);
              }}
            >
              <span className="pad-label">{label}</span>
              <span className="pad-sub mono">{sub}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
