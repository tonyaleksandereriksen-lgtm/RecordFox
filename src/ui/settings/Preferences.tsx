import type { ReactNode } from 'react';
import type { FaderStartMode, Prefs, TempoRange, WaveStyle } from '../../engine/types.ts';
import { dispatch, useEngine, useHost } from '../hooks.ts';

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="toggle-knob" />
    </button>
  );
}

function Row({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="pref-row">
      <div className="pref-text">
        <span className="pref-title">{title}</span>
        {note && <span className="pref-note">{note}</span>}
      </div>
      <div className="pref-control">{children}</div>
    </div>
  );
}

const set = (patch: Partial<Prefs>) => dispatch({ type: 'prefs/set', patch });

export function Preferences() {
  const p = useEngine((s) => s.prefs);
  const { isElectron } = useHost();
  return (
    <div className="settings-page">
      <header className="page-head">
        <h2>Preferences</h2>
        <p>Saved on this computer and restored at the next launch.</p>
      </header>
      <section className="card prefs">
        <h3>Display</h3>
        <Row title="Waveform colours" note="Deck colour follows the design; RGB, 3-band and blue are the classic styles.">
          <Seg<WaveStyle>
            label="Waveform colours"
            value={p.waveStyle}
            onChange={(v) => set({ waveStyle: v })}
            options={[
              { id: 'deck', label: 'Deck colour' },
              { id: 'rgb', label: 'RGB' },
              { id: '3band', label: '3-Band' },
              { id: 'blue', label: 'Blue' },
            ]}
          />
        </Row>
      </section>
      <section className="card prefs">
        <h3>Decks</h3>
        <Row title="Default tempo range" note="Empty decks change now; loaded decks keep their range.">
          <Seg<TempoRange>
            label="Default tempo range"
            value={p.defaultTempoRange}
            onChange={(v) => set({ defaultTempoRange: v })}
            options={[
              { id: 6, label: '±6%' },
              { id: 10, label: '±10%' },
              { id: 16, label: '±16%' },
            ]}
          />
        </Row>
        <Row title="Quantize on by default" note="Cues, loops and hot cues snap to the beat grid.">
          <Toggle label="Quantize on by default" on={p.defaultQuantize} onChange={(v) => set({ defaultQuantize: v })} />
        </Row>
        <Row title="Needle lock" note="Clicking the overview of a playing deck does nothing unless Shift is held (keyboard or the unit’s SHIFT).">
          <Toggle label="Needle lock" on={p.needleLock} onChange={(v) => set({ needleLock: v })} />
        </Row>
        <Row title="Fader start" note="Whether moving a channel fader up from zero starts that deck (the unit sends fader-start messages).">
          <Seg<FaderStartMode>
            label="Fader start"
            value={p.faderStart}
            onChange={(v) => set({ faderStart: v })}
            options={[
              { id: 'smart', label: 'With Smart Fader' },
              { id: 'always', label: 'Always' },
              { id: 'off', label: 'Off' },
            ]}
          />
        </Row>
      </section>
      <section className="card prefs">
        <h3>Controller</h3>
        <Row title="Ask the unit for its positions at connect" note={isElectron ? 'Sends the optional status-dump SysEx so knobs and faders start in sync. Takes effect on the next connect.' : 'Desktop app only — browsers need extra permission for SysEx.'}>
          <Toggle label="Status dump at connect" on={p.statusDump && isElectron} disabled={!isElectron} onChange={(v) => set({ statusDump: v })} />
        </Row>
      </section>
    </div>
  );
}
