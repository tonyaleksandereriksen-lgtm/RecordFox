import type { CSSProperties, KeyboardEvent } from 'react';
import { useRef } from 'react';
import { bindings } from '../../runtime.ts';
import { useGhost } from '../hooks.ts';

interface KnobProps {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  /** Arc grows from 12 o'clock (EQ, filter) instead of from the minimum. */
  bipolar?: boolean;
  defaultValue?: number;
  accent?: string;
  takeoverKey?: string;
  softwareOnly?: boolean;
  title?: string;
  /** CSS size override in px; default comes from --knob. */
  size?: number;
}

const START = -135;
const SWEEP = 270;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [20 + r * Math.cos(a), 20 + r * Math.sin(a)];
}

function arc(r: number, a0: number, a1: number): string {
  if (Math.abs(a1 - a0) < 0.5) return '';
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

export function Knob({ value, onChange, label, bipolar, defaultValue, accent, takeoverKey, softwareOnly, title, size }: KnobProps) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const ghost = useGhost(takeoverKey);
  const set = (v: number) => {
    if (takeoverKey) bindings.uiChanged(takeoverKey);
    onChange(Math.max(0, Math.min(1, v)));
  };
  const reset = defaultValue ?? (bipolar ? 0.5 : 0);
  const ang = START + value * SWEEP;
  const from = bipolar ? START + SWEEP / 2 : START;
  const [px, py] = polar(11, ang);
  const [ix, iy] = polar(4, ang);
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.005 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(value + step);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(value - step);
    else if (e.key === 'Home' || e.key === 'Enter') set(reset);
    else return;
    e.preventDefault();
  };
  const end = () => (drag.current = null);
  const style = { ...(accent ? { '--accent': accent } : {}), ...(size ? { '--knob': `${size}px` } : {}) } as CSSProperties;
  return (
    <div
      className={`knob${softwareOnly ? ' sw' : ''}`}
      style={style}
      title={title ?? label}
      role="slider"
      tabIndex={0}
      aria-label={label ?? title}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, v: value };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        set(drag.current.v + (drag.current.y - e.clientY) / (e.shiftKey ? 800 : 180));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => set(reset)}
      onWheel={(e) => set(value - Math.sign(e.deltaY) * 0.02)}
    >
      {label && <span className="knob-label">{label}</span>}
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path className="knob-arc-bg" d={arc(18, START, START + SWEEP)} />
        <path className="knob-arc" d={arc(18, Math.min(from, ang), Math.max(from, ang))} />
        <circle className="knob-body" cx="20" cy="20" r="14" />
        {ghost !== null &&
          (() => {
            const [gx, gy] = polar(18, START + ghost * SWEEP);
            return <circle className="knob-ghost" cx={gx} cy={gy} r="2.4" />;
          })()}
        <line className="knob-pointer" x1={ix} y1={iy} x2={px} y2={py} />
      </svg>
    </div>
  );
}
