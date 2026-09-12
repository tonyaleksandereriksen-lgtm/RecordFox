/**
 * Canvas renderers for the waveform styles (deck colour / RGB / 3-band / classic blue), the beat
 * grid and cue markers. All colours come from tokens.ts.
 */
import { beatLen } from '../../engine/selectors.ts';
import type { DeckState, WaveStyle } from '../../engine/types.ts';
import type { WaveformData } from '../../engine/waveform.ts';
import { alpha, tokens } from '../../theme/tokens.ts';

const W = tokens.color.wave;
const hexRgb = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const LOW = hexRgb(W.band.low);
const MID = hexRgb(W.band.mid);
const HIGH = hexRgb(W.band.high);

function bandsInRange(w: WaveformData, t0: number, t1: number): [number, number, number] {
  const i0 = Math.max(0, Math.floor(t0 * w.binsPerSec));
  const i1 = Math.min(w.length, Math.max(i0 + 1, Math.ceil(t1 * w.binsPerSec)));
  let l = 0;
  let m = 0;
  let h = 0;
  for (let i = i0; i < i1; i++) {
    if (w.low[i] > l) l = w.low[i];
    if (w.mid[i] > m) m = w.mid[i];
    if (w.high[i] > h) h = w.high[i];
  }
  return [l / 255, m / 255, h / 255];
}

/** Deck colour mixed toward white — the bright core of the single-colour style. */
function lighten(hex: string, k: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgb(${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)})`;
}

/** Draw one column of waveform, mirrored around `mid`. */
function column(ctx: CanvasRenderingContext2D, style: WaveStyle, x: number, colW: number, mid: number, halfH: number, l: number, m: number, h: number, dim: number, deckColor: string) {
  if (style === 'deck') {
    const amp = Math.min(1, l * 0.58 + m * 0.32 + h * 0.28);
    ctx.globalAlpha = dim;
    ctx.fillStyle = deckColor;
    ctx.fillRect(x, mid - amp * halfH, colW, amp * halfH * 2);
    const core = Math.min(amp, h * 0.5 + m * 0.25) * 0.62;
    ctx.fillStyle = lighten(deckColor, 0.6);
    ctx.fillRect(x, mid - core * halfH, colW, core * halfH * 2);
    ctx.globalAlpha = 1;
    return;
  }
  if (style === 'blue') {
    const amp = Math.min(1, l * 0.6 + m * 0.3 + h * 0.25);
    ctx.fillStyle = W.blue.body;
    ctx.globalAlpha = dim;
    ctx.fillRect(x, mid - amp * halfH, colW, amp * halfH * 2);
    const core = amp * 0.5;
    ctx.fillStyle = W.blue.core;
    ctx.fillRect(x, mid - core * halfH, colW, core * halfH * 2);
    ctx.globalAlpha = 1;
    return;
  }
  if (style === '3band') {
    ctx.globalAlpha = dim;
    ctx.fillStyle = W.band.low;
    ctx.fillRect(x, mid - l * halfH, colW, l * halfH * 2);
    ctx.fillStyle = W.band.mid;
    const mm = m * 0.72;
    ctx.fillRect(x, mid - mm * halfH, colW, mm * halfH * 2);
    ctx.fillStyle = W.band.high;
    const hh = h * 0.45;
    ctx.fillRect(x, mid - hh * halfH, colW, hh * halfH * 2);
    ctx.globalAlpha = 1;
    return;
  }
  // RGB: colour is the band balance, height is total energy.
  const sum = l + m + h + 1e-6;
  const r = (LOW[0] * l + MID[0] * m + HIGH[0] * h) / sum;
  const g = (LOW[1] * l + MID[1] * m + HIGH[1] * h) / sum;
  const b = (LOW[2] * l + MID[2] * m + HIGH[2] * h) / sum;
  const amp = Math.min(1, Math.max(l, m * 0.9, h * 0.8));
  ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${dim})`;
  ctx.fillRect(x, mid - amp * halfH, colW, amp * halfH * 2);
}

/** Pre-render a whole-track overview (cached per track/style/size/colour by the caller). */
export function renderOverview(w: WaveformData, style: WaveStyle, width: number, height: number, dpr: number, deckColor: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width * dpr));
  c.height = Math.max(1, Math.round(height * dpr));
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const dur = w.length / w.binsPerSec;
  const mid = height / 2;
  for (let x = 0; x < width; x++) {
    const [l, m, h] = bandsInRange(w, (x / width) * dur, ((x + 1) / width) * dur);
    column(ctx, style, x, 1, mid, mid - 1, l, m, h, 1, deckColor);
  }
  return c;
}

/** Unplayed part of a 'deck' style overview: the same shape in a muted tone. */
export const OVERVIEW_REST = '#3A4E60';

export interface Markers {
  d: DeckState;
  hotcueColors: readonly string[];
}

/** Scrolling waveform: playhead at the centre; `rate` scales the window so synced decks' grids line up. */
export function drawScrolling(
  ctx: CanvasRenderingContext2D,
  w: WaveformData,
  style: WaveStyle,
  d: DeckState,
  width: number,
  height: number,
  zoomSec: number,
  rate: number,
  deckColor: string,
  /** While the grid editor is open, bar lines go red and beats brighten — the grid is the subject. */
  gridEdit = false,
) {
  ctx.clearRect(0, 0, width, height);
  const track = d.track!;
  const pos = d.positionSec;
  const tpp = ((zoomSec * 2) / width) * rate; // track-seconds per CSS pixel
  const t0 = pos - (width / 2) * tpp;
  const mid = height / 2;
  const colW = 2;

  // loop region
  if (d.loop.inSec !== null && d.loop.outSec !== null) {
    const x0 = width / 2 + (d.loop.inSec - pos) / tpp;
    const x1 = width / 2 + (d.loop.outSec - pos) / tpp;
    ctx.fillStyle = alpha(tokens.color.state.loop, d.loop.active ? 0.16 : 0.07);
    ctx.fillRect(x0, 0, x1 - x0, height);
    ctx.fillStyle = tokens.color.state.loop;
    ctx.fillRect(x0, 0, 2, height);
    ctx.fillRect(x1 - 2, 0, 2, height);
  }

  // beat grid
  const bl = beatLen(track);
  const firstIdx = Math.floor((t0 - track.firstBeatSec) / bl);
  const lastIdx = Math.ceil((t0 + width * tpp - track.firstBeatSec) / bl);
  for (let k = firstIdx; k <= lastIdx; k++) {
    const bt = track.firstBeatSec + k * bl;
    if (bt < 0 || bt > track.durationSec) continue;
    const x = width / 2 + (bt - pos) / tpp;
    const bar = ((k % 4) + 4) % 4 === 0;
    ctx.fillStyle = gridEdit ? (bar ? tokens.color.state.danger : 'rgba(214, 236, 248, 0.24)') : bar ? W.gridBar : W.grid;
    ctx.fillRect(Math.round(x), 0, bar ? (gridEdit ? 2 : 1.5) : 1, height);
  }

  // waveform
  for (let x = 0; x < width; x += colW) {
    const t = t0 + x * tpp;
    if (t < 0 || t > track.durationSec) continue;
    const [l, m, h] = bandsInRange(w, t, t + colW * tpp);
    column(ctx, style, x, colW - 0.5, mid, mid - 3, l, m, h, t < pos ? 0.5 : 1, deckColor);
  }

  // memory cue + hot cues
  const cueX = width / 2 + (d.cueSec - pos) / tpp;
  tri(ctx, cueX, 0, 7, tokens.color.led.cue, true);
  d.hotCues.forEach((hc, i) => {
    if (!hc) return;
    const x = width / 2 + (hc.posSec - pos) / tpp;
    if (x < -20 || x > width + 20) return;
    const col = tokens.color.hotcue[i];
    ctx.fillStyle = col;
    ctx.fillRect(x - 0.5, 0, 1.5, height);
    ctx.beginPath();
    ctx.roundRect(x, height - 14, 13, 12, 2);
    ctx.fill();
    ctx.fillStyle = tokens.color.text.inverse;
    ctx.font = `600 9px ${tokens.font.ui}`;
    ctx.fillText(String.fromCharCode(65 + i), x + 3.4, height - 4.6);
  });

  // playhead
  ctx.fillStyle = W.playhead;
  ctx.fillRect(width / 2 - 1, 0, 2, height);
  tri(ctx, width / 2, 0, 6, deckColor, true);
  tri(ctx, width / 2, height, 6, deckColor, false);
}

function tri(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, down: boolean) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - s, y);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, down ? y + s * 1.2 : y - s * 1.2);
  ctx.closePath();
  ctx.fill();
}

/** Overlay for the overview strip: played region, cue/hot cue marks, loop, playhead. */
export function drawOverviewOverlay(ctx: CanvasRenderingContext2D, d: DeckState, width: number, height: number, deckColor: string, dimPlayed = true) {
  const track = d.track!;
  const x = (t: number) => (t / track.durationSec) * width;
  if (dimPlayed) {
    ctx.fillStyle = W.played;
    ctx.fillRect(0, 0, x(d.positionSec), height);
  }
  if (d.loop.inSec !== null && d.loop.outSec !== null) {
    ctx.fillStyle = alpha(tokens.color.state.loop, d.loop.active ? 0.35 : 0.15);
    ctx.fillRect(x(d.loop.inSec), 0, Math.max(2, x(d.loop.outSec) - x(d.loop.inSec)), height);
  }
  d.hotCues.forEach((hc, i) => {
    if (!hc) return;
    ctx.fillStyle = tokens.color.hotcue[i];
    ctx.fillRect(x(hc.posSec) - 1, height - 7, 3, 7);
  });
  tri(ctx, x(d.cueSec), 0, 4, tokens.color.led.cue, true);
  ctx.fillStyle = dimPlayed ? deckColor : W.playhead;
  ctx.fillRect(x(d.positionSec) - 0.75, 0, 1.5, height);
}
