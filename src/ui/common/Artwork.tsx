import { useId, useMemo } from 'react';
import type { Track } from '../../engine/types.ts';
import { mulberry32 } from '../../lib/prng.ts';

/**
 * Generated cover art for tracks without artwork (all demo tracks): a dusk sky over two ridge
 * lines, tinted by the track's hue and shaped by its seed. Real artwork replaces it in slice 2.
 */
export function Artwork({ track, className }: { track: Pick<Track, 'seed' | 'hue' | 'title'> | null; className?: string }) {
  const art = useMemo(() => (track ? build(track.seed, track.hue) : null), [track?.seed, track?.hue]);
  const id = `art${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (!track || !art) {
    return (
      <div className={`artwork empty${className ? ` ${className}` : ''}`} aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
          <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="50" cy="50" r="3" fill="currentColor" />
        </svg>
      </div>
    );
  }
  return (
    <div className={`artwork${className ? ` ${className}` : ''}`} role="img" aria-label={`Artwork: ${track.title}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={`hsl(${art.hue} 45% 7%)`} />
            <stop offset="0.62" stopColor={`hsl(${art.hue + 18} 48% 22%)`} />
            <stop offset="1" stopColor={`hsl(${art.hue + 36} 60% 40%)`} />
          </linearGradient>
          <radialGradient id={`${id}-glow`} cx={art.glowX} cy="0.66" r="0.45">
            <stop offset="0" stopColor={`hsl(${art.hue + 40} 90% 78%)`} stopOpacity="0.85" />
            <stop offset="1" stopColor={`hsl(${art.hue + 40} 90% 60%)`} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${id}-sky)`} />
        <rect width="100" height="100" fill={`url(#${id}-glow)`} />
        {art.stars.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="#EAF6FD" opacity={0.35 + r} />
        ))}
        <path d={art.back} fill={`hsl(${art.hue + 8} 30% 24%)`} />
        <path d={art.front} fill={`hsl(${art.hue} 40% 7%)`} />
        <line x1={art.peakX} y1={art.peakY - 14} x2={art.peakX} y2={art.peakY} stroke={`hsl(${art.hue + 40} 95% 85%)`} strokeWidth="0.8" opacity="0.9" />
      </svg>
    </div>
  );
}

function ridge(rand: () => number, base: number, amp: number, steps: number): { d: string; peak: [number, number] } {
  let d = `M0 100 L0 ${base}`;
  let peak: [number, number] = [50, base];
  for (let i = 1; i <= steps; i++) {
    const x = (i / steps) * 100;
    const y = base - rand() * amp;
    if (y < peak[1]) peak = [x, y];
    d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return { d: `${d} L100 100 Z`, peak };
}

function build(seed: number, hue: number) {
  const rand = mulberry32(seed);
  const back = ridge(rand, 70, 20, 7);
  const front = ridge(rand, 84, 30, 5);
  const stars: [number, number, number][] = Array.from({ length: 9 }, () => [rand() * 100, rand() * 45, 0.25 + rand() * 0.5]);
  return { hue, back: back.d, front: front.d, peakX: front.peak[0], peakY: front.peak[1], glowX: 0.3 + rand() * 0.4, stars };
}
