export { BEATLOOP_SIZES } from '../../engine/selectors.ts';

export function formatBeatsShort(b: number): string {
  if (b >= 1) return String(b);
  return `1/${Math.round(1 / b)}`;
}
