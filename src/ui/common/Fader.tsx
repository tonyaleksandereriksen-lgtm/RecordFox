import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useRef } from 'react';
import { bindings } from '../../runtime.ts';
import { useGhost } from '../hooks.ts';

interface FaderProps {
  value: number;
  onChange: (v: number) => void;
  orientation?: 'vertical' | 'horizontal';
  /** Vertical faders: true = value 1 at the top (volume). Tempo uses false ("−" at the top, Pioneer style). */
  topIsMax?: boolean;
  centerTick?: boolean;
  fillFromCenter?: boolean;
  /** Draw a level fill from the bottom (channel faders). */
  fill?: boolean;
  accent?: string;
  takeoverKey?: string;
  defaultValue?: number;
  title?: string;
  label?: string;
  className?: string;
}

const PAD = 6;

export function Fader({ value, onChange, orientation = 'vertical', topIsMax = true, centerTick, fillFromCenter, fill, accent, takeoverKey, defaultValue, title, label, className }: FaderProps) {
  const el = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const ghost = useGhost(takeoverKey);
  const vertical = orientation === 'vertical';

  /** Screen position 0..1 (top→bottom or left→right) for a value. */
  const toPos = (v: number) => (vertical && topIsMax ? 1 - v : v);
  const fromEvent = (e: ReactPointerEvent) => {
    const r = el.current!.getBoundingClientRect();
    const t = vertical ? (e.clientY - r.top - PAD) / (r.height - PAD * 2) : (e.clientX - r.left - PAD) / (r.width - PAD * 2);
    return toPos(Math.max(0, Math.min(1, t)));
  };
  const set = (v: number) => {
    if (takeoverKey) bindings.uiChanged(takeoverKey);
    onChange(Math.max(0, Math.min(1, v)));
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.002 : 0.02;
    const up = vertical && !topIsMax ? -1 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(value + step * up);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(value - step * up);
    else if ((e.key === 'Home' || e.key === 'Enter') && defaultValue !== undefined) set(defaultValue);
    else return;
    e.preventDefault();
  };
  const end = () => (dragging.current = false);

  const p = toPos(value);
  const f0 = fillFromCenter ? Math.min(0.5, p) : fill ? (vertical ? p : 0) : 0;
  const f1 = fillFromCenter ? Math.max(0.5, p) : fill ? (vertical ? 1 : p) : 0;
  const style = {
    '--p': p,
    '--f0': f0,
    '--f1': f1,
    ...(ghost !== null ? { '--g': toPos(ghost) } : {}),
    ...(accent ? { '--accent': accent } : {}),
  } as CSSProperties;

  return (
    <div
      ref={el}
      className={`fader ${orientation}${className ? ` ${className}` : ''}`}
      style={style}
      title={title}
      role="slider"
      tabIndex={0}
      aria-label={label ?? title}
      aria-orientation={orientation}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        el.current!.setPointerCapture(e.pointerId);
        dragging.current = true;
        set(fromEvent(e));
      }}
      onPointerMove={(e) => dragging.current && set(fromEvent(e))}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => defaultValue !== undefined && set(defaultValue)}
      onWheel={(e) => set(value + (vertical && !topIsMax ? 1 : -1) * Math.sign(e.deltaY) * 0.01)}
    >
      <div className="fader-track" />
      {(fill || fillFromCenter) && <div className="fader-fill" />}
      {centerTick && <div className="fader-center" />}
      {ghost !== null && <div className="fader-ghost" />}
      <div className="fader-cap" />
    </div>
  );
}
