import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bytesToHex } from '../../midi/decoder.ts';
import type { MidiLogEntry } from '../../midi/types.ts';
import { midi } from '../../runtime.ts';
import { goTo, useMidiStatus } from '../hooks.ts';

type Filter = 'all' | 'in' | 'out' | 'unmapped';
const ROW_H = 20;
const OVERSCAN = 8;
/** The log can take hundreds of messages a second (jog, LED blink); the view refreshes at ~10 fps. */
const REFRESH_MS = 100;

function useThrottledLog(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = midi.log.subscribe(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setVersion((v) => v + 1);
      }, REFRESH_MS);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return version;
}

function statusLine(s: ReturnType<typeof useMidiStatus>): string {
  const st = s.status;
  switch (st.kind) {
    case 'connected':
      return `${st.input}${st.output ? ` ↔ ${st.output}` : ' · no output port'}`;
    case 'searching':
      return st.message ?? 'Looking for the DDJ-FLX2…';
    case 'requesting':
      return 'Waiting for MIDI permission…';
    case 'idle':
      return s.virtual ? 'Virtual FLX2 attached' : 'Not connected';
    default:
      return st.message;
  }
}

export function MidiMonitor() {
  const version = useThrottledLog();
  const ms = useMidiStatus();
  const [filter, setFilter] = useState<Filter>('all');
  const [paused, setPaused] = useState(midi.log.paused);
  const [showBlink, setShowBlink] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(240);
  const scroller = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Newest first. Filtering ≤600 entries ten times a second is cheap; rendering them all was not.
  const rows = useMemo(() => {
    const entries = midi.log.entries();
    const out: MidiLogEntry[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.quiet && !showBlink) continue;
      if (filter === 'in' && e.dir !== 'in') continue;
      if (filter === 'out' && e.dir !== 'out') continue;
      if (filter === 'unmapped' && e.confidence !== 'unmapped') continue;
      out.push(e);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, filter, showBlink]);

  const t0 = midi.log.entries()[0]?.t ?? 0;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const visible = rows.slice(first, last);
  const totals = midi.log.totals;

  return (
    <div className="monitor">
      <div className="mon-toolbar">
        <div className="seg" role="group" aria-label="Filter">
          {(['all', 'in', 'out', 'unmapped'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)} aria-pressed={filter === f}>
              {f}
            </button>
          ))}
        </div>
        <button
          className={`mini${paused ? ' on' : ''}`}
          onClick={() => {
            midi.log.paused = !midi.log.paused;
            setPaused(midi.log.paused);
          }}
          aria-pressed={paused}
        >
          {paused ? 'Paused' : 'Pause'}
        </button>
        <button className="mini" onClick={() => midi.log.clear()}>
          Clear
        </button>
        <button className={`mini${showBlink ? ' on' : ''}`} onClick={() => setShowBlink(!showBlink)} aria-pressed={showBlink} title="Show LED writes that only toggle a blink">
          Blink LEDs
        </button>
        <span className="mon-status">
          <span className={`dot ${ms.status.kind === 'connected' ? 'ok' : ms.virtual ? 'info' : 'off'}`} />
          {statusLine(ms)}
        </span>
        <span className="mon-count mono">
          in {totals.in} · out {totals.out} · unmapped {totals.unmapped}
        </span>
        <button className="label-btn" onClick={() => goTo('settings', 'controller')}>
          Controller setup ›
        </button>
      </div>
      <div className="log" role="log" aria-label="MIDI messages">
        <div className="log-row head mono">
          <span>Time</span>
          <span>Dir</span>
          <span>Bytes</span>
          <span>Control</span>
          <span>Value</span>
          <span>Source</span>
        </div>
        <div className="log-body" ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            {visible.map((e, k) => (
              <div key={e.seq} className={`log-row mono${e.dir === 'sys' ? ' sys' : ''}`} style={{ top: (first + k) * ROW_H }}>
                <span>{((e.t - t0) / 1000).toFixed(3)}</span>
                <span className={`dir ${e.dir}`}>{e.dir.toUpperCase()}</span>
                <span>{e.bytes.length ? bytesToHex(e.bytes) : ''}</span>
                <span className="ellipsis">{e.label}</span>
                <span className="ellipsis">{e.detail ?? ''}</span>
                <span className={`badge ${e.confidence}`}>{e.confidence === 'unverified' ? 'verify' : e.confidence}</span>
              </div>
            ))}
          </div>
          {rows.length === 0 && <div className="log-empty">No messages yet. Touch a control on the DDJ-FLX2 — or open the Virtual FLX2 tab.</div>}
        </div>
      </div>
    </div>
  );
}
