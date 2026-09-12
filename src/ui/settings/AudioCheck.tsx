import { useEffect, useRef, useState } from 'react';
import {
  ClickProbe,
  type AudioCheckResult,
  type Heard,
  type LatencyReading,
  type OutputDevice,
  listOutputs,
  measureLatency,
  playOnPair,
  revealLabels,
  sinkSupported,
  verdictFor,
} from '../../audio/audioCheck.ts';
import { midi } from '../../runtime.ts';
import { useMidiStatus } from '../hooks.ts';
import { AudioEngine } from './AudioEngine.tsx';

const HINTS: (AudioContextLatencyCategory | number)[] = ['interactive', 'balanced', 0.005];
const hintLabel = (h: string) => (h === 'interactive' ? 'Interactive' : h === 'balanced' ? 'Balanced' : `${Number(h) * 1000} ms hint`);

type Probe = { presses: number; avgHandlingMs: number | null; estimatedTotalMs: number | null };

/**
 * The audio spike from the audit: measures what this engine (Chromium's Web Audio) can do with the
 * DDJ-FLX2 before the audio engine is built. The JSON result decides Web Audio vs a native engine.
 */
export function AudioCheck() {
  const { status } = useMidiStatus();
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [labelsHidden, setLabelsHidden] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [latency, setLatency] = useState<LatencyReading[]>([]);
  const [maxCh, setMaxCh] = useState<number | null>(null);
  const [channelTest, setChannelTest] = useState<{ master: Heard; phones: Heard }>({ master: 'skipped', phones: 'skipped' });
  const [pairState, setPairState] = useState<{ playing: 0 | 1 | null; unsupported: boolean }>({ playing: null, unsupported: false });
  const [probe, setProbe] = useState<Probe>({ presses: 0, avgHandlingMs: null, estimatedTotalMs: null });
  const [probing, setProbing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const probeRef = useRef<{ p: ClickProbe; off: () => void } | null>(null);

  const refresh = async () => {
    const r = await listOutputs();
    setDevices(r.devices);
    setLabelsHidden(r.labelsHidden);
    setDeviceId((cur) => (cur && r.devices.some((d) => d.deviceId === cur) ? cur : (r.devices.find((d) => d.isFlx2)?.deviceId ?? r.devices[0]?.deviceId ?? null)));
  };

  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    const onChange = () => void refresh();
    md?.addEventListener?.('devicechange', onChange);
    return () => {
      md?.removeEventListener?.('devicechange', onChange);
      stopProbe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const measure = () =>
    run(async () => {
      const out: LatencyReading[] = [];
      for (const h of HINTS) {
        const r = await measureLatency(deviceId, h);
        out.push(r.reading);
        setMaxCh(r.maxChannels);
      }
      setLatency(out);
    });

  const testPair = (pair: 0 | 1) =>
    run(async () => {
      setPairState({ playing: pair, unsupported: false });
      const ok = await playOnPair(deviceId, pair);
      setPairState({ playing: null, unsupported: !ok });
    });

  function stopProbe() {
    const cur = probeRef.current;
    if (!cur) return;
    cur.off();
    void cur.p.close();
    probeRef.current = null;
    setProbing(false);
  }

  const startProbe = () =>
    run(async () => {
      stopProbe();
      const p = new ClickProbe();
      await p.open(deviceId);
      const off = midi.onInput((events, t) => {
        if (events.some((e) => e.kind === 'deckButton' && e.id === 'play' && e.pressed)) {
          p.click(t);
          setProbe(p.summary());
        }
      });
      probeRef.current = { p, off };
      setProbe(p.summary());
      setProbing(true);
    });

  const device = devices.find((d) => d.deviceId === deviceId) ?? null;
  const partial = { latency, maxChannelCount: maxCh, channelTest };
  const result: AudioCheckResult = {
    at: new Date().toISOString(),
    userAgent: navigator.userAgent,
    device: device ? { label: device.label, isFlx2: device.isFlx2 } : null,
    sinkSupported: sinkSupported(),
    maxChannelCount: maxCh,
    latency,
    channelTest,
    midiToSound: probe,
    verdict: verdictFor(partial),
  };
  const json = JSON.stringify(result, null, 2);
  const heard = (pair: 'master' | 'phones', v: Heard) => setChannelTest((c) => ({ ...c, [pair]: v }));

  return (
    <div className="settings-page">
      <header className="page-head">
        <h2>Audio</h2>
        <p>The native engine plays the decks. Below it, the browser-side check from the audit stays for comparison: it measured ~52 ms on the FLX2, which is why the engine went native.</p>
      </header>
      <div className="cards one">
        <AudioEngine />
      </div>
      <h3 className="section-title">Browser audio check</h3>
      {error && <p className="error-text">{error}</p>}

      <div className="steps">
        <section className="card step">
          <h3>
            <span className="step-num">1</span> Output device
          </h3>
          <div className="btn-row">
            <select className="select" value={deviceId ?? ''} onChange={(e) => setDeviceId(e.target.value || null)} aria-label="Output device">
              {devices.length === 0 && <option value="">Default output</option>}
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                  {d.isFlx2 ? '  ★ DDJ-FLX2' : ''}
                </option>
              ))}
            </select>
            {labelsHidden && (
              <button
                className="btn"
                onClick={() =>
                  run(async () => {
                    if (await revealLabels()) await refresh();
                  })
                }
              >
                Show device names
              </button>
            )}
          </div>
          <p className="fine">
            {!sinkSupported()
              ? 'This engine can’t pick an output device — it will use the system default.'
              : device?.isFlx2
                ? 'DDJ-FLX2 Audio Out selected.'
                : 'Pick “DDJ-FLX2 Audio Out” if it is listed. Showing names asks for microphone permission once; nothing is recorded.'}
          </p>
        </section>

        <section className="card step">
          <h3>
            <span className="step-num">2</span> Latency
          </h3>
          <button className="btn primary" disabled={busy} onClick={measure}>
            {latency.length ? 'Measure again' : 'Measure'}
          </button>
          {latency.length > 0 && (
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Hint</th>
                  <th>Rate</th>
                  <th>Base</th>
                  <th>Output</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {latency.map((r) => (
                  <tr key={r.hint}>
                    <td>{hintLabel(r.hint)}</td>
                    <td className="mono">{r.sampleRate / 1000} kHz</td>
                    <td className="mono">{r.baseLatencyMs} ms</td>
                    <td className="mono">{r.outputLatencyMs} ms</td>
                    <td className="mono">{Math.round((r.baseLatencyMs + r.outputLatencyMs) * 10) / 10} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {maxCh !== null && <p className="fine">Output channels reachable: {maxCh}</p>}
        </section>

        <section className="card step">
          <h3>
            <span className="step-num">3</span> Master and headphones
          </h3>
          <p className="fine">Plays a one-second tone on channels 1/2 (master) and 3/4 (headphones). Put your headphones on and say what you heard.</p>
          {(['master', 'phones'] as const).map((pair, i) => (
            <div className="pair-row" key={pair}>
              <button className="btn" disabled={busy} onClick={() => testPair(i as 0 | 1)}>
                {pairState.playing === i ? 'Playing…' : `Play on ${pair === 'master' ? 'master (1/2)' : 'phones (3/4)'}`}
              </button>
              <div className="seg" role="group" aria-label={`${pair} result`}>
                {(['heard', 'not heard', 'skipped'] as Heard[]).map((v) => (
                  <button key={v} className={channelTest[pair] === v ? 'on' : ''} onClick={() => heard(pair, v)} aria-pressed={channelTest[pair] === v}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {pairState.unsupported && <p className="warn-text">This output exposes fewer than four channels, so the headphone pair can’t be addressed from here.</p>}
        </section>

        <section className="card step">
          <h3>
            <span className="step-num">4</span> PLAY press to sound
          </h3>
          <p className="fine">Each PLAY press on the unit plays a click. The handling delay is measured from the MIDI timestamp; output latency is added on top.</p>
          <div className="btn-row">
            {!probing ? (
              <button className="btn primary" disabled={busy || status.kind !== 'connected'} onClick={startProbe} title={status.kind !== 'connected' ? 'Connect the DDJ-FLX2 first' : undefined}>
                Start listening
              </button>
            ) : (
              <button className="btn on" onClick={stopProbe}>
                Stop
              </button>
            )}
            <span className="probe-stats mono">
              presses {probe.presses} · handling {probe.avgHandlingMs ?? '–'} ms · est. total {probe.estimatedTotalMs ?? '–'} ms
            </span>
          </div>
          {status.kind !== 'connected' && <p className="fine">Needs the DDJ-FLX2 connected (the virtual unit has no real timing).</p>}
        </section>

        <section className="card step result">
          <h3>
            <span className="step-num">5</span> Result
          </h3>
          <p className="verdict">{result.verdict}</p>
          <textarea className="json mono" readOnly value={json} rows={10} aria-label="Audio check result (JSON)" />
          <div className="btn-row">
            <button
              className="btn"
              onClick={() =>
                void navigator.clipboard?.writeText(json).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  },
                  () => setError('Could not copy — select the text and copy it by hand.'),
                )
              }
            >
              {copied ? 'Copied' : 'Copy result'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
