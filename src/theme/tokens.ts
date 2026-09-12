/**
 * Design tokens — single source of truth for colour, radius, spacing, type and motion.
 * Direction: Tony's design vision (docs/design/vision-mockup.png) — near-black navy, two deck
 * colours (A blue, B amber), hairline borders, small corners, light wide-tracked labels.
 * CSS custom properties are generated from this object at boot (applyTokens); canvas renderers
 * import the same values.
 */
export const tokens = {
  color: {
    bg: {
      base: '#03080E',
      app: '#050B12',
      panel: '#07111B',
      raised: '#0A1622',
      inset: '#040A11',
      hover: '#0D1C2A',
      selected: '#0B243B',
      overlay: 'rgba(2, 6, 11, 0.78)',
    },
    line: { soft: '#112030', strong: '#1B3043', focus: '#2FA6E3' },
    text: { primary: '#D6ECF8', secondary: '#95AEC1', muted: '#7892A6', faint: '#4D6376', inverse: '#03131F' },
    deck: ['#2FA6E3', '#E39A4E'] as const,
    deckDim: ['#12405A', '#5A3A1C'] as const,
    deckGlow: ['rgba(47, 166, 227, 0.35)', 'rgba(227, 154, 78, 0.35)'] as const,
    state: {
      ok: '#5CD6A0',
      warn: '#E9B44C',
      danger: '#F2606E',
      info: '#2FA6E3',
      loop: '#5CD6A0',
    },
    /** Sound Color FX / filter accent. */
    fx: '#B394F2',
    /** On-screen LEDs of the virtual unit (what the app writes back to the hardware). */
    led: { play: '#5CD6A0', cue: '#E9B44C', sync: '#2FA6E3', pfl: '#E9B44C', shift: '#D6ECF8' },
    /** Firmware pad modes (virtual unit and monitor); on-screen deck pads use the deck colour. */
    padMode: { hotcue: '#2FA6E3', padfx: '#B394F2', beatloop: '#5CD6A0', sampler: '#E9B44C' },
    /** Hot cue marker tints (waveform flags); pads use the deck colour. */
    hotcue: ['#2FA6E3', '#E39A4E', '#5CD6A0', '#B394F2', '#F2606E', '#E9B44C', '#4FC6C9', '#E07AB8'] as const,
    wave: {
      band: { low: '#E07A6A', mid: '#E9B44C', high: '#5CC3EE' },
      blue: { body: '#1F6BFF', core: '#9FD0FF' },
      played: 'rgba(3, 8, 14, 0.55)',
      grid: 'rgba(214, 236, 248, 0.10)',
      gridBar: 'rgba(214, 236, 248, 0.28)',
      playhead: '#EAF6FD',
    },
  },
  radius: { xs: 3, sm: 4, md: 6, lg: 8, pill: 999 },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 },
  font: {
    ui: '"Jost", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif',
    mono: '"JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace',
  },
  size: { xxs: 10, xs: 11, sm: 12, md: 13, lg: 15, xl: 18, xxl: 24, hero: 30 },
  tracking: { label: '0.14em', wide: '0.32em' },
  motion: { fast: '90ms', base: '160ms', slow: '280ms', ease: 'cubic-bezier(.2,.8,.2,1)' },
} as const;

export type Tokens = typeof tokens;

/** Flatten tokens into CSS custom properties: color.bg.base -> --color-bg-base */
export function tokensToCssVars(t: object = tokens, prefix = '-'): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, `${path}-${k}`);
    } else if (typeof node === 'number') {
      out[path] = path.includes('radius') || path.includes('space') || path.includes('size') ? `${node}px` : String(node);
    } else if (typeof node === 'string') {
      out[path] = node;
    }
  };
  walk(t, prefix);
  return out;
}

export function applyTokens(root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(tokensToCssVars())) root.style.setProperty(k, v);
}

/** Hex colour with alpha (0..1) — for glows and tints computed in TS. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
