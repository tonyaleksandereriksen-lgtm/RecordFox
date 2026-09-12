import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../../brand.ts';
import { Mark, Wordmark } from '../common/Logo.tsx';

export function About() {
  return (
    <div className="settings-page">
      <section className="card about-hero">
        <Mark size={64} />
        <div>
          <Wordmark height={16} />
          <p className="about-tag">{APP_TAGLINE}</p>
          <p className="fine">
            {APP_NAME} {APP_VERSION} · two-deck performance app for the AlphaTheta DDJ-FLX2
          </p>
        </div>
      </section>
      <div className="cards">
        <section className="card">
          <h3>How it talks to the controller</h3>
          <p className="fine">
            USB MIDI only, using the DDJ-FLX2 MIDI message list AlphaTheta publishes for third-party software. {APP_NAME} is an independent project: it is not made, endorsed or certified by
            AlphaTheta or Pioneer DJ, and DDJ-FLX2 is their trademark.
          </p>
        </section>
        <section className="card">
          <h3>Handy gestures</h3>
          <ul className="plain-list">
            <li>Double-click a knob or fader to reset it; Shift-drag for fine moves.</li>
            <li>Scroll over a deck’s waveform to zoom.</li>
            <li>Shift-click CUE: back to the start. Shift-click PLAY: stutter. Shift-click a hot cue: delete it.</li>
            <li>Double-click a track (or press Enter) to load it on a deck that isn’t playing.</li>
          </ul>
        </section>
        <section className="card">
          <h3>Type</h3>
          <p className="fine">Jost (Indestructible Type) and JetBrains Mono (JetBrains), both under the SIL Open Font License 1.1 and bundled with the app.</p>
        </section>
        <section className="card">
          <h3>Streaming</h3>
          <p className="fine">Spotify was dropped: its terms don’t allow mixing, and its DJ integration is partner-only. Audius (open API) is the candidate for later; playlists can be matched to local files by title and artist.</p>
        </section>
      </div>
    </div>
  );
}
