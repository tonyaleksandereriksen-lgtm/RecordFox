import { SECONDS_PER_REV, effectiveBpm, effectivePct, remainingSec } from '../../engine/selectors.ts';
import type { DeckIndex } from '../../engine/types.ts';
import { formatBpm, formatPct } from '../../lib/format.ts';
import { store } from '../../runtime.ts';
import { alpha, tokens } from '../../theme/tokens.ts';
import { useCanvas, useRaf } from '../hooks.ts';

/** On-screen jog: thin progress ring, platter turning at 33⅓, cue marker, touch glow. */
export function Jog({ deck }: { deck: DeckIndex }) {
  const [ref, size] = useCanvas();
  const color = tokens.color.deck[deck];

  useRaf((now) => {
    const c = ref.current;
    const { w, dpr } = size.current;
    if (!c || w === 0) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, w);
    const d = store.getState().decks[deck];
    const cx = w / 2;
    const R = w / 2 - 2;
    const TAU = Math.PI * 2;

    // progress ring
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = tokens.color.line.strong;
    ctx.beginPath();
    ctx.arc(cx, cx, R, 0, TAU);
    ctx.stroke();
    if (d.track) {
      const p = Math.min(1, d.positionSec / d.track.durationSec);
      const warn = remainingSec(d) < 30 && d.playing && Math.floor(now / 250) % 2 === 0;
      ctx.strokeStyle = warn ? tokens.color.state.danger : color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cx, R, -Math.PI / 2, -Math.PI / 2 + p * TAU);
      ctx.stroke();
    }

    // platter
    const pr = R - 8;
    const g = ctx.createRadialGradient(cx, cx * 0.8, pr * 0.1, cx, cx, pr);
    g.addColorStop(0, '#0F1E2C');
    g.addColorStop(1, '#060D15');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cx, pr, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = d.jogTouched ? color : tokens.color.line.soft;
    if (d.jogTouched) {
      ctx.shadowColor = alpha(color, 0.7);
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    ctx.arc(cx, cx, pr, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // grooves
    ctx.strokeStyle = 'rgba(214,236,248,0.05)';
    for (const k of [0.82, 0.66]) {
      ctx.beginPath();
      ctx.arc(cx, cx, pr * k, 0, TAU);
      ctx.stroke();
    }

    // centre label with the live BPM and pitch, the way the hardware displays it
    {
      const s = store.getState();
      const label = Math.max(18, pr * 0.52);
      ctx.strokeStyle = tokens.color.line.soft;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cx, label, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = tokens.color.bg.inset;
      ctx.fill();

      ctx.textAlign = 'center';
      if (d.track) {
        const size = Math.max(11, Math.min(17, pr * 0.3));
        ctx.fillStyle = tokens.color.text.primary;
        ctx.font = `400 ${size}px ${tokens.font.mono}`;
        ctx.fillText(formatBpm(Math.round(effectiveBpm(s, deck) * 100) / 100), cx, cx + size * 0.1);
        ctx.fillStyle = tokens.color.text.muted;
        ctx.font = `400 ${Math.max(8, size * 0.62)}px ${tokens.font.mono}`;
        ctx.fillText(formatPct(Math.round(effectivePct(s, deck) * 100) / 100), cx, cx + size * 0.95);
      } else {
        ctx.fillStyle = tokens.color.text.faint;
        ctx.font = `400 ${Math.max(9, pr * 0.16)}px ${tokens.font.ui}`;
        ctx.fillText('—', cx, cx + 4);
      }
    }

    if (d.track) {
      const rot = (d.positionSec / SECONDS_PER_REV) * TAU - Math.PI / 2;
      ctx.strokeStyle = tokens.color.text.primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rot) * pr * 0.7, cx + Math.sin(rot) * pr * 0.7);
      ctx.lineTo(cx + Math.cos(rot) * (pr - 3), cx + Math.sin(rot) * (pr - 3));
      ctx.stroke();
      const cueRot = rot + ((d.cueSec - d.positionSec) / SECONDS_PER_REV) * TAU;
      ctx.fillStyle = tokens.color.led.cue;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(cueRot) * (pr - 6), cx + Math.sin(cueRot) * (pr - 6), 2.4, 0, TAU);
      ctx.fill();
    }

    if (d.jogTouched) {
      ctx.fillStyle = color;
      ctx.font = `500 9px ${tokens.font.ui}`;
      ctx.textAlign = 'center';
      ctx.fillText(d.vinyl ? 'SCRATCH' : 'BEND', cx, cx + pr * 0.78);
    }
  });

  return (
    <div className="jog" title="Jog (the unit's platter: touch to scratch, outer ring to bend)">
      <canvas ref={ref} />
    </div>
  );
}
