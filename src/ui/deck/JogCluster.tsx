import type { CSSProperties } from 'react';
import { useRef } from 'react';
import type { DeckIndex } from '../../engine/types.ts';
import { formatBeats } from '../../lib/format.ts';
import { takeoverKey } from '../../midi/bindings.ts';
import { cueLook, playLook } from '../../midi/leds.ts';
import { tokens } from '../../theme/tokens.ts';
import { Fader } from '../common/Fader.tsx';
import { Icon } from '../common/Icon.tsx';
import { dispatch, useEngine } from '../hooks.ts';
import { deckLetter } from './Deck.tsx';
import { Jog } from './Jog.tsx';

/** CUE and PLAY, stacked beside the jog like the hardware. */
function Transport({ deck }: { deck: DeckIndex }) {
  const play = useEngine((s) => playLook(s.decks[deck]));
  const cue = useEngine((s) => cueLook(s.decks[deck]));
  const playing = useEngine((s) => s.decks[deck].playing);
  const cueDown = useRef(false);
  const cueUp = () => {
    if (!cueDown.current) return;
    cueDown.current = false;
    dispatch({ type: 'deck/cue', deck, pressed: false });
  };
  return (
    <div className="transport">
      <button
        className="tbtn cue"
        data-look={cue}
        title="CUE (Shift+click: back to the start)"
        onPointerDown={(e) => {
          if (e.shiftKey) return dispatch({ type: 'deck/jumpStart', deck });
          cueDown.current = true;
          dispatch({ type: 'deck/cue', deck, pressed: true });
        }}
        onPointerUp={cueUp}
        onPointerCancel={cueUp}
        onPointerLeave={cueUp}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            cueDown.current = true;
            dispatch({ type: 'deck/cue', deck, pressed: true });
          }
        }}
        onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && cueUp()}
      >
        Cue
      </button>
      <button className="tbtn play" data-look={play} onClick={(e) => dispatch(e.shiftKey ? { type: 'deck/stutter', deck } : { type: 'deck/playPause', deck })} title="PLAY/PAUSE (Shift+click: stutter from the cue)" aria-label={playing ? 'Pause' : 'Play'}>
        <Icon name={playing ? 'pause' : 'play'} size={15} filled />
      </button>
    </div>
  );
}

/** Loop in / out / auto / halve / double and the beat-jump pair, in the compact block rekordbox puts above CUE. */
function LoopBlock({ deck }: { deck: DeckIndex }) {
  const active = useEngine((s) => s.decks[deck].loop.active);
  const beats = useEngine((s) => s.decks[deck].loop.beats);
  const hasIn = useEngine((s) => s.decks[deck].loop.inSec !== null);
  const jump = useEngine((s) => s.decks[deck].beatJumpBeats);
  return (
    <div className="loop-block">
      <div className="loop-row">
        <button className={`mini${hasIn && !active ? ' on' : ''}`} onClick={() => dispatch({ type: 'deck/loopIn', deck })} title="Loop in">
          In
        </button>
        <button className="mini" onClick={() => dispatch({ type: 'deck/loopOut', deck })} title="Loop out">
          Out
        </button>
      </div>
      <div className="loop-row">
        <button className={`mini wide${active ? ' on loop' : ''}`} onClick={() => dispatch(active ? { type: 'deck/loopExit', deck } : { type: 'deck/beatLoop', deck, beats: 4 })} title={active ? 'Exit loop' : 'Auto loop (4 beats)'}>
          {active ? `Exit ${beats ? formatBeats(beats) : ''}` : 'Loop 4'}
        </button>
      </div>
      <div className="loop-row">
        <button className="mini" onClick={() => dispatch({ type: 'deck/loopScale', deck, factor: 0.5 })} title="Halve the loop">
          ½
        </button>
        <button className="mini" onClick={() => dispatch({ type: 'deck/loopScale', deck, factor: 2 })} title="Double the loop">
          ×2
        </button>
      </div>
      <div className="loop-row">
        <button className="mini" onClick={() => dispatch({ type: 'deck/beatJump', deck, dir: -1 })} aria-label="Beat jump back" title="Beat jump back">
          ‹
        </button>
        <button
          className="mini num"
          onClick={() => dispatch({ type: 'deck/beatJumpSize', deck, dir: 1 })}
          onContextMenu={(e) => {
            e.preventDefault();
            dispatch({ type: 'deck/beatJumpSize', deck, dir: -1 });
          }}
          title="Beat jump size (click: bigger · right-click: smaller)"
        >
          {jump}
        </button>
        <button className="mini" onClick={() => dispatch({ type: 'deck/beatJump', deck, dir: 1 })} aria-label="Beat jump forward" title="Beat jump forward">
          ›
        </button>
      </div>
    </div>
  );
}

/** SLIP / MT / Q and the tempo slider, on the jog's inner side. */
function TempoBlock({ deck }: { deck: DeckIndex }) {
  const pos = useEngine((s) => s.decks[deck].tempoPos);
  const slip = useEngine((s) => s.decks[deck].slip);
  const keyLock = useEngine((s) => s.decks[deck].keyLock);
  const quantize = useEngine((s) => s.decks[deck].quantize);
  return (
    <div className="tempo-block">
      <div className="tempo-btns">
        <button className={`mini${slip ? ' on' : ''}`} onClick={() => dispatch({ type: 'deck/slip', deck })} aria-pressed={slip} title="Slip: scratches, loops and held hot cues return to where the track would have been">
          Slip
        </button>
        <button className={`mini${keyLock ? ' on' : ''}`} onClick={() => dispatch({ type: 'deck/keyLock', deck })} aria-pressed={keyLock} title="Master Tempo (key lock)">
          MT
        </button>
        <button className={`mini${quantize ? ' on' : ''}`} onClick={() => dispatch({ type: 'deck/quantize', deck })} aria-pressed={quantize} title="Quantize">
          Q
        </button>
      </div>
      <Fader
        className="tempo"
        value={(pos + 1) / 2}
        onChange={(v) => dispatch({ type: 'deck/tempo', deck, value01: v })}
        topIsMax={false}
        centerTick
        fillFromCenter
        takeoverKey={takeoverKey.tempo(deck)}
        defaultValue={0.5}
        label={`Deck ${deckLetter(deck)} tempo`}
        title="Tempo ('−' at the top, like the unit). Double-click: reset"
      />
    </div>
  );
}

/** Everything around the platter: loop block, CUE/PLAY, the jog itself, SLIP/MT, tempo and Q. */
export function JogCluster({ deck }: { deck: DeckIndex }) {
  return (
    <div className={`jog-cluster${deck === 1 ? ' right' : ''}`} style={{ '--deck': tokens.color.deck[deck], '--deck-glow': tokens.color.deckGlow[deck] } as CSSProperties}>
      <div className="jog-side">
        <LoopBlock deck={deck} />
        <Transport deck={deck} />
      </div>
      <Jog deck={deck} />
      <TempoBlock deck={deck} />
    </div>
  );
}
