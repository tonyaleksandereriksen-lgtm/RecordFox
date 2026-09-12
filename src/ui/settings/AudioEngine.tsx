import { useEffect, useState } from 'react';
import { audioHost, type AudioDevice } from '../../audio/host.ts';
import { audioSummary } from '../../audio/status.ts';
import { restartAudio } from '../../runtime.ts';
import { useEngine, useHost } from '../hooks.ts';

const AUTO = '';

/** The native engine: what it opened, how fast, and which output to use. */
export function AudioEngine() {
  const { audio } = useHost();
  const pref = useEngine((s) => s.prefs.audioDevice);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [choice, setChoice] = useState<string>(pref ?? AUTO);
  const host = audioHost();
  const summary = audioSummary(audio);

  useEffect(() => {
    setChoice(pref ?? AUTO);
  }, [pref]);

  useEffect(() => {
    if (!host || audio.state === 'unavailable') return;
    let alive = true;
    host
      .devices()
      .then((list) => alive && setDevices(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [host, audio.state]);

  const running = audio.state === 'running';
  return (
    <section className="card">
      <h3>Audio engine</h3>
      <p className={`status-line${summary.tone === 'ok' ? ' ok' : ''}`}>{summary.long}</p>
      {!host || audio.state === 'unavailable' ? (
        <p className="fine">The native engine drives the DDJ-FLX2 directly (WASAPI exclusive, ~4 ms). It runs in the desktop app only.</p>
      ) : (
        <>
          <div className="btn-row">
            <select className="select" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Audio output">
              <option value={AUTO}>Automatic — DDJ-FLX2 if present, else the default output</option>
              {devices.map((d) => (
                <option key={d.index} value={d.name}>
                  {d.name}
                  {d.flx2 ? '  ★ DDJ-FLX2' : d.isDefault ? '  (default)' : ''}
                </option>
              ))}
              {choice !== AUTO && !devices.some((d) => d.name === choice) && <option value={choice}>{choice} (not connected)</option>}
            </select>
            <button className="btn primary" disabled={audio.state === 'starting'} onClick={() => restartAudio(choice === AUTO ? null : choice)}>
              {running ? 'Reopen' : 'Start'}
            </button>
          </div>
          <p className="fine">
            The FLX2 is opened in exclusive mode at 48 kHz with 4 channels: master on 1/2, headphones on 3/4. Any other output opens in shared mode with 2 channels, so headphone cue is off
            there. Close rekordbox, Serato and anything else using the unit first — exclusive means one program at a time.
          </p>
          {running && (
            <p className="fine mono">
              {audio.sampleRate / 1000} kHz · {audio.channels} ch · {audio.periods} × {audio.periodFrames} frames · {audio.latencyMs.toFixed(2)} ms · underruns {audio.underruns}
            </p>
          )}
        </>
      )}
    </section>
  );
}
