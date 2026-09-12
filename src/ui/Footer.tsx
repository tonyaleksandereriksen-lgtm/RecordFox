import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../brand.ts';
import { useEngine, useHost, useMidiStatus } from './hooks.ts';

export function Footer() {
  const count = useEngine((s) => s.library.tracks.length);
  const { status, virtual } = useMidiStatus();
  const { audio, isElectron } = useHost();
  const midiText = status.kind === 'connected' ? 'FLX2 connected' : virtual ? 'Virtual FLX2' : status.kind === 'searching' ? 'Searching for FLX2' : 'FLX2 not connected';
  const audioText = audio.state === 'found' ? 'FLX2 audio found' : 'Audio engine: next slice';
  return (
    <footer className="footer">
      <span>
        {APP_NAME} {APP_VERSION}
      </span>
      <span>2 decks</span>
      <span>{count} tracks</span>
      <span>{midiText}</span>
      <span>{audioText}</span>
      <span>{isElectron ? 'Desktop' : 'Browser'}</span>
      <span className="spacer" />
      <svg className="footer-glyph" width="46" height="10" viewBox="0 0 46 10" aria-hidden="true">
        <path d="M0 5h14M16 5v-3M18 5v3M20 5v-4.5M22 5v4.5M24 5v-2.5M26 5v2.5M28 5v-1.5M30 5h16" stroke="currentColor" strokeWidth="1" fill="none" />
      </svg>
      <span className="tagline">{APP_TAGLINE.replace(/\.\s*/g, ' / ').replace(/\s*\/\s*$/, '')}</span>
    </footer>
  );
}
