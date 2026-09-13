import { audioSummary } from '../../audio/status.ts';
import { LEARNABLE } from '../../midi/learn.ts';
import { connectController, midi, setVirtualAttached } from '../../runtime.ts';
import { dispatch, useHost, useMidiStatus } from '../hooks.ts';

type CheckState = 'ok' | 'wait' | 'bad' | 'off';

function Check({ state, title, note }: { state: CheckState; title: string; note?: string }) {
  return (
    <li className={`check ${state}`}>
      <span className="check-mark" aria-hidden="true">
        {state === 'ok' ? '✓' : state === 'bad' ? '!' : state === 'wait' ? '…' : '–'}
      </span>
      <span>
        {title}
        {note && <small>{note}</small>}
      </span>
    </li>
  );
}

function openTab(tab: 'monitor' | 'virtual') {
  dispatch({ type: 'ui/bottomTab', tab });
  dispatch({ type: 'ui/view', view: 'performance' });
}

export function ControllerSettings() {
  const { status, report, virtual, learnTarget, learned } = useMidiStatus();
  const host = useHost();
  const connected = status.kind === 'connected';
  let line = '';
  switch (status.kind) {
    case 'idle':
      line = 'Not connected yet. Connect asks for MIDI permission, then looks for the DDJ-FLX2.';
      break;
    case 'requesting':
      line = 'Waiting for MIDI permission…';
      break;
    case 'unsupported':
    case 'denied':
      line = status.message;
      break;
    case 'searching':
      line = status.message ?? (status.seen.length ? `Looking for the DDJ-FLX2. Ports seen: ${status.seen.join(', ')}` : 'Looking for the DDJ-FLX2 — plug it in over USB-C.');
      break;
    case 'connected':
      line = `${status.input}${status.output ? ` ↔ ${status.output}` : ''}`;
      break;
  }
  const audio = audioSummary(host.audio);
  const audioState: CheckState = audio.tone === 'warn' ? (host.audio.state === 'error' ? 'bad' : 'ok') : audio.tone;
  const audioNote = audio.long;

  return (
    <div className="settings-page">
      <header className="page-head">
        <h2>Controller</h2>
        <p>DDJ-FLX2 over USB MIDI. The app writes LEDs back to the unit and uses soft takeover on every knob and fader.</p>
      </header>

      <div className="cards">
        <section className="card">
          <h3>Connection</h3>
          <p className={`status-line${connected ? ' ok' : ''}`}>{line}</p>
          {connected && status.generic && <p className="warn-text">Generic port name — unplug and replug the unit to get “DDJ-FLX2”.</p>}
          <div className="btn-row">
            {!connected && (
              <button className="btn primary" onClick={connectController}>
                Connect DDJ-FLX2
              </button>
            )}
            <button className={`btn${virtual ? ' on' : ''}`} onClick={() => setVirtualAttached(!virtual)} aria-pressed={virtual}>
              {virtual ? 'Detach virtual unit' : 'Attach virtual unit'}
            </button>
            <button className="btn" onClick={() => openTab('monitor')}>
              Open MIDI monitor
            </button>
            <button className="btn" onClick={() => openTab('virtual')}>
              Open Virtual FLX2
            </button>
          </div>
          <p className="fine">Windows gives one app a MIDI port at a time — close rekordbox, Serato or Mixxx first.</p>
        </section>

        <section className="card">
          <h3>Init sequence</h3>
          <ol className="checks">
            <Check state={report.midiIn ? 'ok' : connected ? 'wait' : 'off'} title="1 · MIDI in / out opened" note={connected && !report.midiOut ? 'No output port — LEDs cannot be written' : undefined} />
            <Check state={audioState} title="2 · Audio “DDJ-FLX2 Audio Out”" note={audioNote} />
            <Check state={report.vinyl ? 'ok' : 'off'} title="3 · Vinyl mode on (9n 17 7F to both decks)" />
            <Check state={report.leds ? 'ok' : 'off'} title="4 · LEDs lit from the engine" />
            <Check
              state={report.takeover ? 'ok' : 'off'}
              title="5 · Soft takeover armed"
              note={report.statusDump === 'sent' ? 'Optional status-dump SysEx sent' : host.isElectron ? undefined : 'Status-dump SysEx is skipped in the browser'}
            />
          </ol>
        </section>

        <section className="card">
          <h3>MIDI learn</h3>
          <p className="fine">These two knobs are in the official list but their CC numbers need checking on the unit. Click Learn, then turn the knob.</p>
          {LEARNABLE.map((l) => {
            const b = learned.find((x) => x.id === l.id);
            const active = learnTarget === l.id;
            return (
              <div className="learn-row" key={l.id}>
                <span className="learn-name">{l.label}</span>
                <span className="mono learn-val">{b ? `ch ${b.channel + 1} · ${b.msb.toString(16).padStart(2, '0')}/${b.lsb.toString(16).padStart(2, '0')}` : 'unbound'}</span>
                <button className={`btn sm${active ? ' on' : ''}`} onClick={() => (active ? midi.cancelLearn() : midi.startLearn(l.id))}>
                  {active ? 'Listening…' : 'Learn'}
                </button>
              </div>
            );
          })}
          {learned.length > 0 && (
            <button className="btn sm ghost" onClick={() => midi.clearLearned()}>
              Clear learned
            </button>
          )}
        </section>

        <section className="card">
          <h3>Monitor legend</h3>
          <div className="legend">
            <span className="badge hardware">hardware</span>
            <span className="badge pdf">pdf</span>
            <span className="badge family">family</span>
            <span className="badge unverified">verify</span>
            <span className="badge unmapped">unmapped</span>
          </div>
          <p className="fine">hardware = seen coming from the unit · pdf = read from the official DDJ-FLX2 MIDI list · family = FLX2 row, value from the FLX4 layout · verify = confirm on hardware · unmapped = not in the map.</p>
        </section>
      </div>
    </div>
  );
}
