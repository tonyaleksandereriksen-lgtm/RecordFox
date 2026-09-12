export function formatTime(sec: number, showTenths = true): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const whole = Math.floor(r);
  const tenths = Math.floor((r - whole) * 10);
  return `${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}${showTenths ? `.${tenths}` : ''}`;
}

export function formatBpm(bpm: number): string {
  return bpm > 0 ? bpm.toFixed(2) : '--.--';
}

export function formatPct(pct: number): string {
  const v = Math.abs(pct) < 0.005 ? 0 : pct;
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(2)}%`;
}

export function formatBeats(beats: number): string {
  if (beats >= 1) return String(beats);
  const inv = Math.round(1 / beats);
  return `1/${inv}`;
}
