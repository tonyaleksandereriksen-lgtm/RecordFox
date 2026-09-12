/**
 * RekordFox mark: a fox mask whose ears are the two deck colours (A blue, B amber) set over a
 * record with grooves — the face is the platter's centre label. Monoline wordmark alongside.
 * Source files: src/assets/brand/rekordfox-mark.svg / rekordfox-wordmark.svg (keep in sync).
 */
export function Mark({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <circle cx="32" cy="36" r="22" fill="#0A1622" stroke="#D6ECF8" strokeOpacity="0.55" strokeWidth="1.4" />
      <circle cx="32" cy="36" r="18.5" fill="none" stroke="#D6ECF8" strokeOpacity="0.18" strokeWidth="1" />
      <circle cx="32" cy="36" r="15" fill="none" stroke="#D6ECF8" strokeOpacity="0.18" strokeWidth="1" />
      <path d="M17 24 L12 3.5 L29.5 17 Z" fill="#2FA6E3" />
      <path d="M47 24 L52 3.5 L34.5 17 Z" fill="#E39A4E" />
      <path d="M15 22.5 H49 L52.5 31.5 L32 58 L11.5 31.5 Z" fill="#D6ECF8" />
      <path d="M21.4 33 L27.8 35.2 L27.1 37 Z" fill="#03080E" />
      <path d="M42.6 33 L36.2 35.2 L36.9 37 Z" fill="#03080E" />
      <circle cx="32" cy="51.5" r="1.7" fill="#03080E" />
    </svg>
  );
}

export function Wordmark({ height = 11 }: { height?: number }) {
  return (
    <svg className="wordmark" height={height} width={(height * 97) / 12} viewBox="-1 -1 97 12" role="img" aria-label="RekordFox">
      <g fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="miter">
        <path d="M0 10V0H4.3A2.75 2.75 0 0 1 4.3 5.5H0M3.6 5.5L7 10" />
        <path transform="translate(10.2 0)" d="M6.5 0H0V10H6.5M0 5H5.4" />
        <path transform="translate(19.9 0)" d="M0 0V10M6.6 0L0.3 6M2.5 3.9L7 10" />
        <circle transform="translate(30.1 0)" cx="5" cy="5" r="5" />
        <path transform="translate(43.3 0)" d="M0 10V0H4.3A2.75 2.75 0 0 1 4.3 5.5H0M3.6 5.5L7 10" />
        <path transform="translate(53.5 0)" d="M0 0H3A5 5 0 0 1 3 10H0Z" />
        <path transform="translate(64.7 0)" d="M6.5 0H0V10M0 5H5.4" />
        <circle transform="translate(74.4 0)" cx="5" cy="5" r="5" />
        <path transform="translate(87.6 0)" d="M0 0L7 10M7 0L0 10" />
      </g>
    </svg>
  );
}
