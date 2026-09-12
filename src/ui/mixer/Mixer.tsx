import type { CSSProperties } from 'react';
import { useRef } from 'react';
import type { ChannelParam } from '../../engine/actions.ts';
import type { DeckIndex } from '../../engine/types.ts';
import { cueAvailable } from '../../audio/status.ts';
import { takeoverKey } from '../../midi/bindings.ts';
import { store } from '../../runtime.ts';
import { tokens } from '../../theme/tokens.ts';
import { deckLetter } from '../deck/Deck.tsx';
import { Fader } from '../common/Fader.tsx';
import { Knob } from '../common/Knob.tsx';
import { dispatch, useCanvas, useEngine, useHost, useMidiStatus, useRaf } from '../hooks.ts';
import { channelLevel } from './levels.ts';

const KNOBS: { param: Exclude<ChannelParam, 'fader'>; label: string }[] = [
  { param: 'trim', label: 'Gain' },
  { param: 'eqHi', label: 'Hi' },
  { param: 'eqMid', label: 'Mid' },
  { param: 'eqLow', label: 'Low' },
  { param: 'cfx', label: 'CFX' },
];

function ChannelKnob({ ch, param, label }: { ch: DeckIndex; param: Exclude<ChannelParam, 'fader'>; label: string }) {
  const value = useEngine((s) => s.mixer.ch[ch][param]);
  const sw = param === 'trim';
  return (
    <Knob
      value={value}
      label={label}
      bipolar
      defaultValue={0.5}
      accent={param === 'cfx' ? tokens.color.fx : tokens.color.deck[ch]}
      softwareOnly={sw}
      takeoverKey={sw ? undefined : takeoverKey.channel(ch, param)}
      onChange={(v) => dispatch({ type: 'mixer/set', ch, param, value: v })}
      title={param === 'cfx' ? `CFX ${ch + 1} — Sound Color FX (filter). Centre = off` : sw ? `Gain ${ch + 1} — software only (the unit has no trim knob)` : `${label} ${ch + 1}`}
    />
  );
}

/** Thin horizontal meter above the channel fader, in the deck colour. */
function Vu({ ch }: { ch: DeckIndex }) {
  const [ref, size] = useCanvas();
  const peak = useRef(0);
  const color = tokens.color.deck[ch];
  useRaf(() => {
    const c = ref.current;
    const { w, h, dpr } = size.current;
    if (!c || w === 0) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    peak.current = Math.max(channelLevel(store.getState(), ch), peak.current - 0.012);
    ctx.fillStyle = 'rgba(214,236,248,0.07)';
    ctx.fillRect(0, 0, w, h);
    const level = Math.min(1.05, peak.current);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, color);
    grad.addColorStop(0.78, color);
    grad.addColorStop(0.88, tokens.color.state.warn);
    grad.addColorStop(1, tokens.color.state.danger);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, (level / 1.05) * w, h);
  });
  return (
    <div className="vu" aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}

/** One channel: the FLX2's knob row, its CUE button and the channel fader. */
const NO_CUE = 'Headphone cue needs a 4-channel output (the DDJ-FLX2); this output has 2';

function ChannelStrip({ ch }: { ch: DeckIndex }) {
  const fader = useEngine((s) => s.mixer.ch[ch].fader);
  const pfl = useEngine((s) => s.mixer.ch[ch].pfl);
  const cue = cueAvailable(useHost().audio);
  return (
    <div className={`ch-strip${ch === 1 ? ' right' : ''}`} style={{ '--deck': tokens.color.deck[ch] } as CSSProperties} aria-label={`Channel ${ch + 1}`}>
      <div className="ch-head">
        <span className="ch-num">{ch + 1}</span>
        <span className="label">Deck {deckLetter(ch)}</span>
      </div>
      <div className="ch-knobs">
        {KNOBS.map((k) => (
          <ChannelKnob key={k.param} ch={ch} param={k.param} label={k.label} />
        ))}
      </div>
      <div className="ch-fader">
        <button className={`mini cue-btn${pfl ? ' on' : ''}`} onClick={() => dispatch({ type: 'mixer/pfl', ch })} aria-pressed={pfl} disabled={!cue} title={cue ? `Headphone CUE ${ch + 1}` : NO_CUE}>
          Cue
        </button>
        <Fader
          className="channel horizontal-channel"
          orientation="horizontal"
          value={fader}
          fill
          onChange={(v) => dispatch({ type: 'mixer/set', ch, param: 'fader', value: v })}
          accent={tokens.color.deck[ch]}
          takeoverKey={takeoverKey.channel(ch, 'fader')}
          label={`Channel ${ch + 1} fader`}
          title={`Channel ${ch + 1} fader`}
        />
        <Vu ch={ch} />
      </div>
    </div>
  );
}

/** The mixer as a horizontal strip under the decks: channel 1, the master column, channel 2. */
export function Mixer() {
  const xf = useEngine((s) => s.mixer.crossfader);
  const masterCue = useEngine((s) => s.mixer.masterCue);
  const smartFader = useEngine((s) => s.mixer.smartFader);
  const smartCfx = useEngine((s) => s.mixer.smartCfx);
  const masterLevel = useEngine((s) => s.mixer.masterLevel);
  const phonesLevel = useEngine((s) => s.mixer.phonesLevel);
  const { learned } = useMidiStatus();
  const isLearned = (id: string) => learned.some((b) => b.id === id);
  const cue = cueAvailable(useHost().audio);
  return (
    <section className="panel mixer" aria-label="Mixer">
      <ChannelStrip ch={0} />
      <div className="mix-centre">
        <div className="mix-top">
        <div className="mix-knobs">
          <Knob
            value={masterLevel}
            accent={tokens.color.text.primary}
            takeoverKey={takeoverKey.master('masterLevel')}
            onChange={(v) => dispatch({ type: 'mixer/master', param: 'masterLevel', value: v })}
            label="Master"
            title={isLearned('masterLevel') ? 'MASTER LEVEL (mapped)' : 'MASTER LEVEL — bind the unit knob with Learn in Settings › Controller'}
          />
          <Knob
            value={phonesLevel}
            accent={tokens.color.state.warn}
            takeoverKey={takeoverKey.master('phonesLevel')}
            onChange={(v) => dispatch({ type: 'mixer/master', param: 'phonesLevel', value: v })}
            label="Phones"
            title={isLearned('phonesLevel') ? 'HEADPHONES LEVEL (mapped)' : 'HEADPHONES LEVEL — bind the unit knob with Learn in Settings › Controller'}
          />
        </div>
        <div className="mix-toggles">
          <button className={`mini${masterCue ? ' on' : ''}`} onClick={() => dispatch({ type: 'mixer/masterCue' })} aria-pressed={masterCue} disabled={!cue} title={cue ? 'Headphone CUE (MASTER)' : NO_CUE}>
            M.Cue
          </button>
          <button className={`mini${smartCfx ? ' on' : ''}`} onClick={() => dispatch({ type: 'mixer/smartCfx' })} aria-pressed={smartCfx} title="Smart CFX (SHIFT + MASTER CUE on the unit)">
            S.CFX
          </button>
          <button className={`mini${smartFader ? ' on' : ''}`} onClick={() => dispatch({ type: 'mixer/smartFader' })} aria-pressed={smartFader} title="Smart Fader — fader start and blend handled in software">
            S.Fader
          </button>
        </div>
        </div>
        <div className="xfader-row">
          <span className="xf-end">A</span>
          <Fader orientation="horizontal" className="cross" value={xf} onChange={(v) => dispatch({ type: 'mixer/crossfader', value: v })} takeoverKey={takeoverKey.crossfader} defaultValue={0.5} centerTick label="Crossfader" title="Crossfader (double-click: centre)" />
          <span className="xf-end">B</span>
        </div>
      </div>
      <ChannelStrip ch={1} />
    </section>
  );
}
