import type { BottomTab } from '../../engine/types.ts';
import { DeckInfo } from '../deck/DeckInfo.tsx';
import { JogCluster } from '../deck/JogCluster.tsx';
import { PadBlock } from '../deck/Pads.tsx';
import { WaveLane } from '../deck/WaveLane.tsx';
import { dispatch, useEngine, useMidiStatus } from '../hooks.ts';
import { Library } from '../library/Library.tsx';
import { Mixer } from '../mixer/Mixer.tsx';
import { MidiMonitor } from '../monitor/MidiMonitor.tsx';
import { VirtualPanel } from '../virtual/VirtualPanel.tsx';

const TABS: { id: BottomTab; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'monitor', label: 'MIDI Monitor' },
  { id: 'virtual', label: 'Virtual FLX2' },
];

function BottomPanel() {
  const tab = useEngine((s) => s.ui.bottomTab);
  const zoom = useEngine((s) => s.ui.zoomSec);
  const { status } = useMidiStatus();
  return (
    <section className="panel bottom" aria-label="Browser">
      <div className="bottom-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`subtab${tab === t.id ? ' on' : ''}`} onClick={() => dispatch({ type: 'ui/bottomTab', tab: t.id })}>
            {t.label}
            {t.id === 'monitor' && status.kind === 'connected' && <span className="dot ok" />}
          </button>
        ))}
        <span className="spacer" />
        <span className="label">Waveform zoom</span>
        <div className="seg" role="group" aria-label="Waveform zoom">
          <button onClick={() => dispatch({ type: 'ui/zoom', dir: -1 })} aria-label="Zoom out" title="Zoom out">
            −
          </button>
          <span className="seg-val mono">{zoom * 2}s</span>
          <button onClick={() => dispatch({ type: 'ui/zoom', dir: 1 })} aria-label="Zoom in" title="Zoom in">
            +
          </button>
        </div>
      </div>
      <div className="bottom-body">
        {tab === 'library' && <Library />}
        {tab === 'monitor' && <MidiMonitor />}
        {tab === 'virtual' && <VirtualPanel />}
      </div>
    </section>
  );
}

/**
 * Two-deck horizontal layout: full-width waveforms stacked at the top, a title strip per deck with
 * its overview under it, then the pads and jogs in one row, the mixer across, and the browser below.
 */
export function PerformanceView() {
  return (
    <div className="view perf">
      <section className="panel wavestack" aria-label="Waveforms">
        <WaveLane deck={0} />
        <WaveLane deck={1} />
      </section>
      <div className="deck-infos">
        <DeckInfo deck={0} />
        <DeckInfo deck={1} />
      </div>
      <div className="deck-controls">
        <PadBlock deck={0} />
        <JogCluster deck={0} />
        <JogCluster deck={1} />
        <PadBlock deck={1} />
      </div>
      <Mixer />
      <BottomPanel />
    </div>
  );
}
