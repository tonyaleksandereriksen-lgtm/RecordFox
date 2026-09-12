import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef } from 'react';
import { DECK_CH, GLOBAL_CH, NOTE_ON, PAD_CH, PAD_MODE_BASE } from '../../midi/flx2Map.ts';
import { JOG_TICKS_PER_REV } from '../../engine/selectors.ts';
import type { DeckAbsId, DeckIndex, GlobalAbsId } from '../../midi/types.ts';
import type { VirtualButton } from '../../midi/virtualFlx2.ts';
import { setVirtualAttached, virtualUnit } from '../../runtime.ts';
import { tokens } from '../../theme/tokens.ts';
import { Fader } from '../common/Fader.tsx';
import { Knob } from '../common/Knob.tsx';
import { useCanvas, useMidiStatus, useRaf, useVirtualVersion } from '../hooks.ts';

const DEFAULTS: Record<string, number> = { tempo: 0.5, eqHi: 0.5, eqMid: 0.5, eqLow: 0.5, chFader: 0, cfx1: 0.5, cfx2: 0.5, crossfader: 0.5, masterLevel: 0.8, phonesLevel: 0.6 };
const absOf = (key: string, id: string) => virtualUnit.abs.get(key) ?? DEFAULTS[id] ?? 0;

function VButton({ deck, id, label, led, ledColor, round, latch }: { deck: DeckIndex; id: VirtualButton; label: string; led?: [number, number]; ledColor?: string; round?: boolean; latch?: boolean }) {
  useVirtualVersion();
  const lit = led ? virtualUnit.led(led[0], led[1]) : latch ? virtualUnit.shift[deck] : false;
  return (
    <button
      className={`v-btn${round ? ' round' : ''}${lit ? ' lit' : ''}`}
      style={ledColor ? ({ '--led': ledColor } as CSSProperties) : undefined}
      onPointerDown={() => (latch ? virtualUnit.button(deck, id, !virtualUnit.shift[deck]) : virtualUnit.button(deck, id, true))}
      onPointerUp={() => !latch && virtualUnit.button(deck, id, false)}
      onPointerLeave={(e) => !latch && e.buttons > 0 && virtualUnit.button(deck, id, false)}
      onPointerCancel={() => !latch && virtualUnit.button(deck, id, false)}
    >
      {label}
    </button>
  );
}

function VJog({ deck }: { deck: DeckIndex }) {
  const [ref, size] = useCanvas();
  const drag = useRef<{ a: number; acc: number; top: boolean } | null>(null);
  const color = tokens.color.deck[deck];
  useRaf((now) => {
    const c = ref.current;
    const { w, dpr } = size.current;
    if (!c || w === 0) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, w);
    const cx = w / 2;
    const R = w / 2 - 2;
    const flash = now - virtualUnit.loadFlash[deck] < 900;
    ctx.fillStyle = tokens.color.bg.inset;
    ctx.beginPath();
    ctx.arc(cx, cx, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = flash ? color : tokens.color.line.strong;
    if (flash) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
    }
    ctx.beginPath();
    ctx.arc(cx, cx, R - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = drag.current?.top ? tokens.color.bg.selected : tokens.color.bg.raised;
    ctx.beginPath();
    ctx.arc(cx, cx, R * 0.76, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tokens.color.text.muted;
    ctx.font = `500 9px ${tokens.font.ui}`;
    ctx.textAlign = 'center';
    ctx.fillText(virtualUnit.vinyl[deck] ? 'VINYL' : 'NO VINYL MSG', cx, cx + 3);
  });
  const release = () => {
    if (drag.current?.top) virtualUnit.jogTouch(deck, false);
    drag.current = null;
  };
  const angle = (e: ReactPointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  return (
    <div
      className="v-jog"
      title="Drag round the platter to scratch (touch), or the outer ring to bend"
      onPointerDown={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const top = Math.hypot(dx, dy) < (r.width / 2) * 0.76;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { a: angle(e), acc: 0, top };
        if (top) virtualUnit.jogTouch(deck, true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const a = angle(e);
        let da = a - d.a;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        d.a = a;
        d.acc += (da / (Math.PI * 2)) * JOG_TICKS_PER_REV;
        const ticks = Math.trunc(d.acc);
        if (ticks !== 0) {
          d.acc -= ticks;
          virtualUnit.jogTurn(deck, ticks, d.top);
        }
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <canvas ref={ref} />
    </div>
  );
}

function VPads({ deck }: { deck: DeckIndex }) {
  useVirtualVersion();
  const mode = virtualUnit.padMode[deck];
  const selecting = virtualUnit.padSelect[deck];
  const status = NOTE_ON | PAD_CH[deck].normal;
  const col = tokens.color.padMode[mode];
  const st = NOTE_ON | DECK_CH[deck];
  return (
    <div className="v-pads">
      <div className="v-transport">
        <VButton deck={deck} id="cue" label="Cue" round led={[st, 0x0c]} ledColor={tokens.color.led.cue} />
        <VButton deck={deck} id="play" label="Play" round led={[st, 0x0b]} ledColor={tokens.color.led.play} />
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <button
          key={i}
          className={`v-pad${virtualUnit.led(status, PAD_MODE_BASE[mode] + i) || (selecting && i < 4) ? ' lit' : ''}`}
          style={{ '--led': selecting && i < 4 ? tokens.color.padMode[(['hotcue', 'padfx', 'beatloop', 'sampler'] as const)[i]] : col } as CSSProperties}
          onPointerDown={() => virtualUnit.pad(deck, i, true)}
          onPointerUp={() => virtualUnit.pad(deck, i, false)}
          onPointerCancel={() => virtualUnit.pad(deck, i, false)}
          title={selecting && i < 4 ? ['Hot Cue', 'Pad FX', 'Beat Loop', 'Sampler'][i] : `Pad ${i + 1}`}
        />
      ))}
    </div>
  );
}

function VDeck({ deck }: { deck: DeckIndex }) {
  useVirtualVersion();
  const st = NOTE_ON | DECK_CH[deck];
  return (
    <div className={`v-deck${deck === 1 ? ' right' : ''}`}>
      <div className="v-left">
        <span className="v-caption">Deck {deck === 0 ? 'A' : 'B'}</span>
        <VButton deck={deck} id="shift" label={virtualUnit.shift[deck] ? 'Shift ●' : 'Shift'} latch ledColor={tokens.color.led.shift} />
        <VButton deck={deck} id="sync" label="Sync" led={[st, 0x58]} ledColor={tokens.color.led.sync} />
      </div>
      <VJog deck={deck} />
      <Fader className="tempo" value={absOf(`${deck}.tempo`, 'tempo')} onChange={(v) => virtualUnit.deckAbs(deck, 'tempo', v)} topIsMax={false} centerTick accent={tokens.color.deck[deck]} title="Tempo slider (virtual)" />
      <VPads deck={deck} />
    </div>
  );
}

function VKnob({ deck, id, label }: { deck: DeckIndex; id: DeckAbsId; label: string }) {
  useVirtualVersion();
  return <Knob size={24} value={absOf(`${deck}.${id}`, id)} label={label} bipolar accent={tokens.color.deck[deck]} onChange={(v) => virtualUnit.deckAbs(deck, id, v)} />;
}

function VGlobalKnob({ id, label, accent }: { id: GlobalAbsId; label: string; accent: string }) {
  useVirtualVersion();
  const { learned } = useMidiStatus();
  const b = learned.find((x) => x.id === id);
  const isMapped = id.startsWith('cfx') || id === 'crossfader' || !!b;
  return (
    <div style={{ opacity: isMapped ? 1 : 0.4 }} title={isMapped ? label : `${label}: not learned yet — its CC number is unknown`}>
      <Knob size={24} value={absOf(id, id)} label={label} bipolar={id.startsWith('cfx')} accent={accent} onChange={(v) => isMapped && virtualUnit.globalAbs(id, v, b?.channel, b?.msb, b?.lsb)} />
    </div>
  );
}

function VChannel({ deck }: { deck: DeckIndex }) {
  return (
    <div className="v-ch">
      <VKnob deck={deck} id="eqHi" label="Hi" />
      <VKnob deck={deck} id="eqMid" label="Mid" />
      <VKnob deck={deck} id="eqLow" label="Low" />
      <VGlobalKnob id={deck === 0 ? 'cfx1' : 'cfx2'} label="CFX" accent={tokens.color.fx} />
      <div style={{ gridColumn: '1 / -1' }}>
        <VButton deck={deck} id="chCue" label="Cue" led={[NOTE_ON | DECK_CH[deck], 0x54]} ledColor={tokens.color.led.cue} />
      </div>
    </div>
  );
}

function VMixer() {
  useVirtualVersion();
  const g = NOTE_ON | GLOBAL_CH;
  return (
    <div className="v-mixer">
      <VChannel deck={0} />
      <Fader className="channel" fill value={absOf('0.chFader', 'chFader')} onChange={(v) => virtualUnit.deckAbs(0, 'chFader', v)} accent={tokens.color.deck[0]} />
      <div className="v-center">
        <div style={{ display: 'flex', gap: 4 }}>
          <VGlobalKnob id="masterLevel" label="Mstr" accent={tokens.color.text.primary} />
          <VGlobalKnob id="phonesLevel" label="Phn" accent={tokens.color.state.warn} />
        </div>
        <button className={`v-btn${virtualUnit.led(g, 0x63) ? ' lit' : ''}`} style={{ '--led': tokens.color.led.cue } as CSSProperties} onPointerDown={() => virtualUnit.masterCue(true)} onPointerUp={() => virtualUnit.masterCue(false)} onPointerCancel={() => virtualUnit.masterCue(false)}>
          M.Cue
        </button>
        <button className={`v-btn${virtualUnit.led(g, 0x01) ? ' lit' : ''}`} style={{ '--led': tokens.color.fx } as CSSProperties} onPointerDown={() => virtualUnit.smartFader(true)} onPointerUp={() => virtualUnit.smartFader(false)} onPointerCancel={() => virtualUnit.smartFader(false)}>
          Smart F.
        </button>
      </div>
      <Fader className="channel" fill value={absOf('1.chFader', 'chFader')} onChange={(v) => virtualUnit.deckAbs(1, 'chFader', v)} accent={tokens.color.deck[1]} />
      <VChannel deck={1} />
      <div style={{ gridColumn: '1 / -1', width: '100%' }}>
        <Fader orientation="horizontal" className="cross" centerTick value={absOf('crossfader', 'crossfader')} onChange={(v) => virtualUnit.globalAbs('crossfader', v)} accent={tokens.color.text.secondary} />
      </div>
    </div>
  );
}

export function VirtualPanel() {
  const { virtual } = useMidiStatus();
  useEffect(() => {
    // First visit attaches the virtual unit so the whole MIDI path can be exercised without hardware.
    if (!virtual) setVirtualAttached(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="virtual-wrap">
      <div className="v-toolbar">
        <button className={`mini${virtual ? ' on' : ''}`} onClick={() => setVirtualAttached(!virtual)} aria-pressed={virtual}>
          {virtual ? 'Virtual unit attached' : 'Attach virtual unit'}
        </button>
        <span className="hint">Sends the exact bytes a DDJ-FLX2 sends · LEDs show what the app writes back · SHIFT latches · SHIFT + SYNC then pad 1–4 changes pad mode</span>
      </div>
      <div className="virtual">
        <VDeck deck={0} />
        <VMixer />
        <VDeck deck={1} />
      </div>
    </div>
  );
}
