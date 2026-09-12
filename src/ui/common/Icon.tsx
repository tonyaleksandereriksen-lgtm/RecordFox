/** Hairline icon set (16 px grid, 1.4 px stroke) drawn for RekordFox. */
const PATHS: Record<string, string> = {
  search: 'M7 12.2A5.2 5.2 0 1 0 7 1.8a5.2 5.2 0 0 0 0 10.4ZM10.8 10.8 14.5 14.5',
  gear: 'M13.13 6.66 L14.93 7.00 L14.93 9.00 L13.13 9.34 L12.57 10.68 L13.60 12.19 L12.19 13.60 L10.68 12.57 L9.34 13.13 L9.00 14.93 L7.00 14.93 L6.66 13.13 L5.32 12.57 L3.81 13.60 L2.40 12.19 L3.43 10.68 L2.87 9.34 L1.07 9.00 L1.07 7.00 L2.87 6.66 L3.43 5.32 L2.40 3.81 L3.81 2.40 L5.32 3.43 L6.66 2.87 L7.00 1.07 L9.00 1.07 L9.34 2.87 L10.68 3.43 L12.19 2.40 L13.60 3.81 L12.57 5.32Z M10.2 8a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z',
  collection: 'M2 3.5h12v9H2zM2 6.5h12M5 3.5v9',
  playlist: 'M6 12.5a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0Zm0 0V3l7.5-1.5v9M13.5 10.5a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0Z',
  star: 'm8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z',
  clock: 'M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4ZM8 4.5V8l2.5 1.6',
  folder: 'M1.8 3.2h4.4l1.5 1.6h6.5v8H1.8z',
  cloud: 'M4.5 12.5h7.2a2.8 2.8 0 0 0 .3-5.6 4 4 0 0 0-7.7-.8 3.2 3.2 0 0 0 .2 6.4Z',
  file: 'M3.5 1.8h6l3 3v9.4h-9zM9.5 1.8v3h3',
  play: 'M5 3.2v9.6L12.6 8Z',
  pause: 'M4.8 3.2h2.2v9.6H4.8zM9 3.2h2.2v9.6H9z',
  check: 'm3 8.4 3 3 7-7',
  chevron: 'm6 3.5 4.5 4.5L6 12.5',
  midi: 'M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4ZM7 1.9v1.5h2V1.9M4.6 8.6h.01M5.4 5.6h.01M8 6.2h.01M10.6 5.6h.01M11.4 8.6h.01',
  speaker: 'M2.2 6h2.6l3.4-2.8v9.6L4.8 10H2.2zM11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8',
  sliders: 'M3 2v12M8 2v12M13 2v12M1.5 10h3M6.5 5h3M11.5 8.5h3',
  info: 'M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4ZM8 7.2v4M8 4.8h.01',
  export: 'M8 10V1.8M4.8 5 8 1.8 11.2 5M2.5 9.5v4.7h11V9.5',
  device: 'M2.5 3h11v7.5h-11zM1 13h14',
  list: 'M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01',
  close: 'm4 4 8 8M12 4l-8 8',
  copy: 'M5.5 5.5h8v8h-8zM2.5 10.5v-8h8',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14, filled, className }: { name: IconName; size?: number; filled?: boolean; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
