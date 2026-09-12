import { useEffect, useRef } from 'react';
import type { DeckIndex, Track, WaveStyle } from '../../engine/types.ts';
import { baseRate } from '../../engine/selectors.ts';
import { waveformFor } from '../../engine/waveform.ts';
import { store } from '../../runtime.ts';
import { tokens } from '../../theme/tokens.ts';
import { dispatch, useCanvas, useEngine, useRaf } from '../hooks.ts';
import { OVERVIEW_REST, drawOverviewOverlay, drawScrolling, renderOverview } from './draw.ts';

type Cache = { key: string; img: HTMLCanvasElement; rest: HTMLCanvasElement | null } | null;

function overviewImages(cache: { current: Cache }, track: Track, style: WaveStyle, w: number, h: number, dpr: number, color: string) {
  const key = `${track.id}|${style}|${w}|${h}|${dpr}|${color}`;
  if (!cache.current || cache.current.key !== key) {
    const data = waveformFor(track);
    cache.current = { key, img: renderOverview(data, style, w, h, dpr, color), rest: style === 'deck' ? renderOverview(data, 'deck', w, h, dpr, OVERVIEW_REST) : null };
  }
  return cache.current;
}

/** Whole-track overview with live playhead, cues and loop. Click = needle search (needle lock aware). */
export function DeckOverview({ deck, className }: { deck: DeckIndex; className?: string }) {
  const [ref, size] = useCanvas();
  const cache = useRef<Cache>(null);
  const hasTrack = useEngine((s) => s.decks[deck].track !== null);
  const color = tokens.color.deck[deck];

  useRaf(() => {
    const c = ref.current;
    const { w, h, dpr } = size.current;
    if (!c || w === 0) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const s = store.getState();
    const d = s.decks[deck];
    if (!d.track) return;
    const style = s.prefs.waveStyle;
    const { img, rest } = overviewImages(cache, d.track, style, w, h, dpr, color);
    if (rest) {
      // deck style: played part in the deck colour, the rest muted
      const px = Math.round((d.positionSec / d.track.durationSec) * c.width);
      ctx.drawImage(rest, 0, 0);
      if (px > 0) ctx.drawImage(img, 0, 0, px, c.height, 0, 0, px, c.height);
    } else ctx.drawImage(img, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverviewOverlay(ctx, d, w, h, color, !rest);
  });

  return (
    <div
      className={`overview${hasTrack ? '' : ' empty'}${className ? ` ${className}` : ''}`}
      title="Click to jump (needle search). Needle lock: hold Shift while the deck plays."
      onPointerDown={(e) => {
        const s = store.getState();
        const d = s.decks[deck];
        if (!d.track) return;
        if (s.prefs.needleLock && d.playing && !e.shiftKey && !d.shift) {
          dispatch({ type: 'ui/toast', text: `Deck ${deck === 0 ? 'A' : 'B'} is playing — needle lock is on (hold Shift to jump)`, tone: 'warn' });
          return;
        }
        const r = e.currentTarget.getBoundingClientRect();
        dispatch({ type: 'deck/seek', deck, positionSec: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d.track.durationSec });
      }}
    >
      <canvas ref={ref} />
    </div>
  );
}

/** Scrolling waveform, playhead centred. Wheel zooms. */
export function ScrollWave({ deck }: { deck: DeckIndex }) {
  const [ref, size] = useCanvas();
  const color = tokens.color.deck[deck];
  useRaf(() => {
    const c = ref.current;
    const { w, h, dpr } = size.current;
    if (!c || w === 0) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = store.getState();
    const d = s.decks[deck];
    if (!d.track) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    const rate = baseRate(s, deck) + d.bend;
    drawScrolling(ctx, waveformFor(d.track), s.prefs.waveStyle, d, w, h, s.ui.zoomSec, Math.max(0.05, rate), color);
  });
  return (
    <div className="scrollwave" title="Scroll to zoom" onWheel={(e) => dispatch({ type: 'ui/zoom', dir: e.deltaY < 0 ? 1 : -1 })}>
      <canvas ref={ref} />
    </div>
  );
}

/** Static whole-track waveform (library detail panel). */
export function TrackWave({ track, color }: { track: Track; color: string }) {
  const [ref, size] = useCanvas();
  const style = useEngine((s) => s.prefs.waveStyle);
  const drawn = useRef('');
  // Size is only known after layout; poll briefly with rAF until the canvas has a box, then draw once per change.
  useRaf(() => {
    const c = ref.current;
    const { w, h, dpr } = size.current;
    if (!c || w === 0) return;
    const key = `${track.id}|${style}|${w}|${h}|${dpr}|${color}`;
    if (drawn.current === key) return;
    drawn.current = key;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(renderOverview(waveformFor(track), style, w, h, dpr, color), 0, 0);
  });
  useEffect(() => {
    drawn.current = '';
  }, [track.id, style]);
  return (
    <div className="trackwave">
      <canvas ref={ref} />
    </div>
  );
}
