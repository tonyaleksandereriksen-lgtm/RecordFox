import { useRef } from 'react';
import type { View } from '../../engine/types.ts';
import { connectController, store } from '../../runtime.ts';
import { tokens } from '../../theme/tokens.ts';
import { Icon } from '../common/Icon.tsx';
import { Mark, Wordmark } from '../common/Logo.tsx';
import { dispatch, goTo, useCanvas, useClock, useEngine, useMidiStatus, useRaf } from '../hooks.ts';
import { masterLevel } from '../mixer/levels.ts';

const VIEWS: { id: View; label: string }[] = [
  { id: 'performance', label: 'Performance' },
  { id: 'library', label: 'Library' },
  { id: 'export', label: 'Export' },
  { id: 'settings', label: 'Settings' },
];

function ControllerStatus() {
  const { status, virtual } = useMidiStatus();
  if (status.kind === 'idle' && !virtual) {
    return (
      <button className="status-btn" onClick={connectController} title="Ask for MIDI permission and look for the DDJ-FLX2">
        <span className="dot off" /> Connect FLX2
      </button>
    );
  }
  let tone = 'off';
  let text = 'No MIDI';
  let title = '';
  if (status.kind === 'connected') {
    tone = 'ok';
    text = 'DDJ-FLX2';
    title = `${status.input}${status.output ? ` / ${status.output}` : ' — no output port, LEDs off'}`;
  } else if (status.kind === 'searching' || status.kind === 'requesting') {
    tone = 'warn pulse';
    text = status.kind === 'requesting' ? 'Permission…' : 'Searching';
    title = status.kind === 'searching' ? (status.message ?? 'Plug the DDJ-FLX2 in over USB-C') : '';
  } else if (virtual) {
    tone = 'info';
    text = 'Virtual FLX2';
  } else if (status.kind === 'unsupported' || status.kind === 'denied') {
    tone = 'bad';
    title = status.message;
  }
  return (
    <button className="status-btn" onClick={() => goTo('settings', 'controller')} title={title || 'Controller settings'}>
      <span className={`dot ${tone}`} /> {text}
    </button>
  );
}

function MasterMeter() {
  const [ref, size] = useCanvas();
  const peak = useRef(0);
  useRaf(() => {
    const c = ref.current;
    const { w, h, dpr } = size.current;
    if (!c || w === 0) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    peak.current = Math.max(masterLevel(store.getState()), peak.current - 0.01);
    ctx.fillStyle = 'rgba(214,236,248,0.08)';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, tokens.color.deck[0]);
    g.addColorStop(0.72, tokens.color.deck[0]);
    g.addColorStop(0.86, tokens.color.state.warn);
    g.addColorStop(1, tokens.color.state.danger);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, Math.min(1, peak.current) * w, h);
  });
  return (
    <div className="master-meter" title="Master level (demo levels until the audio engine lands)">
      <span className="label">Master</span>
      <div className="meter-bar">
        <canvas ref={ref} />
      </div>
    </div>
  );
}

export function TopBar() {
  const view = useEngine((s) => s.ui.view);
  const clock = useClock();
  return (
    <header className="topbar">
      <div className="brand">
        <Mark size={22} title="RekordFox" />
        <Wordmark height={10} />
      </div>
      <nav className="tabs" role="tablist" aria-label="Screens">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} className={`tab${view === v.id ? ' on' : ''}`} onClick={() => dispatch({ type: 'ui/view', view: v.id })}>
            {v.label}
          </button>
        ))}
      </nav>
      <div className="topbar-right">
        <ControllerStatus />
        <MasterMeter />
        <span className="clock mono" aria-label="Time">
          {clock}
        </span>
        <button className={`icon-btn${view === 'settings' ? ' on' : ''}`} onClick={() => goTo('settings')} aria-label="Settings" title="Settings">
          <Icon name="gear" size={16} />
        </button>
      </div>
    </header>
  );
}
