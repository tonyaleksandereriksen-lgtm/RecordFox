/**
 * Demo collection so the shell is alive before the audio slice lands. All titles and artists
 * are invented. Local files (slice 2) and Spotify (slice 3) replace this with real analysis.
 */
import type { Playlist, SamplerSlot, Track } from './types.ts';

interface Seed {
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  key: string;
  dur: string;
  hue: number;
}

const SEEDS: Seed[] = [
  { title: 'Neon Harbor', artist: 'Kit Ferro', genre: 'Tech House', bpm: 124, key: '8A', dur: '6:12', hue: 190 },
  { title: 'Glass Tide', artist: 'Luma Vale', genre: 'Deep House', bpm: 122, key: '5A', dur: '5:48', hue: 262 },
  { title: 'Copper Sun', artist: 'Orla Minx', genre: 'House', bpm: 126, key: '10B', dur: '6:30', hue: 32 },
  { title: 'Midnight Relay', artist: 'Sable Echo', genre: 'Techno', bpm: 128, key: '1A', dur: '5:55', hue: 320 },
  { title: 'Paper Lanterns', artist: 'Juno Brask', genre: 'Melodic House', bpm: 120, key: '4B', dur: '6:05', hue: 48 },
  { title: 'Static Bloom', artist: 'Vesper Kline', genre: 'Techno', bpm: 132, key: '7A', dur: '5:20', hue: 290 },
  { title: 'Fjord Lights', artist: 'Aurora Stad', genre: 'Organic House', bpm: 118, key: '11A', dur: '6:40', hue: 168 },
  { title: 'Heat Mirage', artist: 'Tamsin Rook', genre: 'Afro House', bpm: 125, key: '9A', dur: '5:32', hue: 12 },
  { title: 'Velvet Circuit', artist: 'Nico Tarn', genre: 'Progressive', bpm: 127, key: '2B', dur: '6:18', hue: 228 },
  { title: 'Low Orbit', artist: 'Kit Ferro', genre: 'Breaks', bpm: 87, key: '6A', dur: '4:44', hue: 140 },
];

function parseDur(d: string): number {
  const [m, s] = d.split(':').map(Number);
  return m * 60 + s;
}

/** Section boundaries in bars — shared with the waveform generator so cues land on the drops. */
export function sectionBars(track: Track): { start: number; bars: number; energy: number; kick: boolean; name: string }[] {
  const barLen = (60 / track.bpm) * 4;
  const total = Math.floor((track.durationSec - track.firstBeatSec) / barLen);
  const plan = [
    { name: 'intro', frac: 0.125, energy: 0.45, kick: true },
    { name: 'build', frac: 0.125, energy: 0.62, kick: true },
    { name: 'drop', frac: 0.25, energy: 1, kick: true },
    { name: 'break', frac: 0.125, energy: 0.34, kick: false },
    { name: 'drop2', frac: 0.25, energy: 1, kick: true },
    { name: 'outro', frac: 0.125, energy: 0.5, kick: true },
  ];
  let at = 0;
  return plan.map((p, i) => {
    const bars = i === plan.length - 1 ? total - at : Math.max(8, Math.round((total * p.frac) / 8) * 8);
    const sec = { start: at, bars, energy: p.energy, kick: p.kick, name: p.name };
    at += bars;
    return sec;
  });
}

export const DEMO_PLAYLISTS: Playlist[] = [
  { id: 'pl-warmup', name: 'Warm-up' },
  { id: 'pl-peak', name: 'Peak Time' },
  { id: 'pl-after', name: 'Afterhours' },
  { id: 'smart-favorites', name: 'Favorites', smart: 'favorites' },
  { id: 'smart-recent', name: 'Recently Added', smart: 'recent' },
];

const RATINGS = [5, 4, 3, 4, 0, 3, 5, 2, 4, 0];
const COMMENTS = ['Big room opener — drop at 01:32.', '', 'Crowd warmer, clean intro.', '', '', 'Hard hitter for the last hour.', 'Sunrise track.', '', '', 'Half-time breaks — sync at 2× on 174 BPM sets.'];

function demoPlaylists(bpm: number, i: number): string[] {
  const out: string[] = [];
  if (bpm <= 122) out.push('pl-warmup');
  if (bpm >= 126) out.push('pl-peak');
  if (i % 3 === 0) out.push('pl-after');
  return out;
}

export function buildDemoTracks(now = Date.UTC(2026, 8, 11)): Track[] {
  return SEEDS.map((s, i) => {
    const t: Track = {
      id: `demo-${i + 1}`,
      title: s.title,
      artist: s.artist,
      genre: s.genre,
      bpm: s.bpm,
      key: s.key,
      durationSec: parseDur(s.dur),
      firstBeatSec: 0.08 + (i % 4) * 0.06,
      hue: s.hue,
      seed: 1000 + i * 7919,
      source: 'demo',
      rating: RATINGS[i] ?? 0,
      comment: COMMENTS[i] ?? '',
      playlists: demoPlaylists(s.bpm, i),
      addedAt: now - i * 86_400_000 * 2,
    };
    const barLen = (60 / t.bpm) * 4;
    const secs = sectionBars(t);
    const at = (name: string) => {
      const sec = secs.find((x) => x.name === name);
      return sec ? t.firstBeatSec + sec.start * barLen : null;
    };
    t.cues = [at('build'), at('drop'), at('break'), at('drop2'), null, null, null, null];
    return t;
  });
}

export function buildDemoSamples(): (SamplerSlot | null)[] {
  const names = ['Air Horn', 'Rewind', 'Vox “Hey”', 'Clap Roll', 'Siren', 'Laser', 'Sub Drop', 'Crash', 'Snare Fill', 'Riser', 'Scratch', 'Shaker', null, null, null, null];
  return names.map((name) => (name ? { name, lengthSec: 1.6 } : null));
}
