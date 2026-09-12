// M1 acceptance check. Launches the built desktop app (dist/ + native addon), drives it over the
// Chrome DevTools Protocol and measures: the engine's clock against wall time (drift), whether
// seek / loop / tempo / cue / scratch are followed by the engine, the fader and crossfader through
// the real meters, and the underrun count. Writes docs/m1-check-<date>.json.
//   node scripts/m1-check.mjs [--seconds 60] [--wav path] [--shot file.png]
// Sound comes out of the FLX2's master at a low level (master knob at 0.25). --shot captures the
// window while the track plays.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The electron package exports the path of its binary; spawning it directly (no shell wrapper)
// means kill() reaches the app itself.
const electronBin = createRequire(import.meta.url)('electron');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const SECONDS = Number(opt('seconds', 60));
const SHOT = opt('shot', null);
// The track must outlast the run: the engine stops a deck at the end of its track (by design).
const TRACK_SECONDS = SECONDS + 90;
const WAV = path.resolve(opt('wav', path.join(root, 'native', 'target', `rekordfox-test-120bpm-${TRACK_SECONDS}s.wav`)));
const PORT = 9333;

if (!existsSync(WAV)) {
  mkdirSync(path.dirname(WAV), { recursive: true });
  const gen = spawn(process.execPath, [path.join(root, 'scripts', 'make-test-wav.mjs'), WAV, String(TRACK_SECONDS)], { stdio: 'inherit' });
  await new Promise((r) => gen.on('exit', r));
}

const electron = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
electron.stdout.on('data', (b) => process.stdout.write(`[app] ${b}`));
electron.stderr.on('data', (b) => {
  const line = String(b);
  if (!/disk_cache|gpu_disk_cache/.test(line)) process.stderr.write(`[app] ${line}`);
});
let exited = false;
electron.on('exit', () => {
  exited = true;
});
/** Asks the app to quit (the window closes, audio stops), then insists. */
async function closeApp() {
  try {
    await cdp('Browser.close');
  } catch {
    /* already gone */
  }
  for (let i = 0; i < 50 && !exited; i += 1) await new Promise((r) => setTimeout(r, 100));
  if (!exited) electron.kill();
}

async function pageTarget() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && /^app:\/\//.test(t.url));
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('the app window never appeared on the debugging port');
}

const target = await pageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
let appClosed = false;
ws.onclose = () => {
  appClosed = true;
  for (const settle of pending.values()) settle({ error: { message: 'the app window was closed' } });
  pending.clear();
};
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
await cdp('Runtime.enable');
await cdp('Page.enable');

/** Runs an async function body in the page; returns its JSON value. */
async function inPage(body) {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

await inPage(`
  window.__m1 = {
    state: () => rekordfox.store.getState(),
    dispatch: (a) => rekordfox.store.dispatch(a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    waitFor: async (fn, timeout) => {
      const t0 = performance.now();
      while (performance.now() - t0 < timeout) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
      return fn();
    },
    deck: () => rekordfox.store.getState().decks[0],
  };
  return true;
`);

const results = {};
const check = (name, ok, detail) => {
  results[name] = { ok: !!ok, ...detail };
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && detail.note ? ` — ${detail.note}` : ''}`);
};

// 1. the engine is running
const status = await inPage(`await __m1.waitFor(() => window.rekordfox && window.rekordfox.audio && window.rekordfox.audio.status.state === 'running', 15000); return window.rekordfox && window.rekordfox.audio ? window.rekordfox.audio.status : null;`);
check('engine running', status && status.state === 'running', { status, note: status ? `${status.device} ${status.exclusive ? 'exclusive' : 'shared'} ${status.sampleRate} Hz ${status.channels} ch ${status.latencyMs.toFixed(2)} ms` : 'no engine' });
if (!status || status.state !== 'running') {
  await closeApp();
  process.exit(1);
}

// 2. a local file on deck A. Earlier runs may have left a test track behind: clear it first so the
//    deck gets this run's file, not a persisted record pointing at a shorter one.
const wavJson = JSON.stringify(WAV);
const loaded = await inPage(`
  const stale = __m1.state().library.tracks.filter((t) => t.source === 'local' && /^local:m1/.test(t.id)).map((t) => t.id);
  if (stale.length) __m1.dispatch({ type: 'library/remove', trackIds: stale });
  __m1.dispatch({ type: 'library/add', tracks: [{ id: 'local:m1', title: 'M1 test 120 BPM', artist: 'RekordFox', genre: '', bpm: 120, key: '', durationSec: ${TRACK_SECONDS}, firstBeatSec: 0, hue: 200, seed: 7, source: 'local', path: ${wavJson}, rating: 0, comment: '', playlists: [], addedAt: Date.now() }] });
  __m1.dispatch({ type: 'deck/load', deck: 0, trackId: 'local:m1' });
  const t0 = performance.now();
  const ok = await __m1.waitFor(() => __m1.deck().engine, 15000);
  return { ok, ms: Math.round(performance.now() - t0), title: __m1.deck().track && __m1.deck().track.title };
`);
check('local file decoded into the engine', loaded.ok, { note: `${loaded.title} in ${loaded.ms} ms` });

// 3. mixer set-up: fader up, crossfader hard left, master quiet
await inPage(`
  __m1.dispatch({ type: 'mixer/set', ch: 0, param: 'fader', value: 1 });
  __m1.dispatch({ type: 'mixer/crossfader', value: 0 });
  __m1.dispatch({ type: 'mixer/master', param: 'masterLevel', value: 0.25 });
  return true;
`);

// 4. play and follow the clock — sampled from here, one second at a time, so a run cut short by a
//    closed window still reports what it saw.
await inPage(`
  document.title = 'RekordFox — M1 check running for ${SECONDS} s, please leave this window open';
  __m1.dispatch({ type: 'deck/playPause', deck: 0 });
  await __m1.sleep(300);
  window.__m1.t0 = performance.now(); window.__m1.p0 = __m1.deck().positionSec;
  return true;
`);
const samples = [];
let clockError = null;
try {
  while (samples.length < SECONDS) {
    await new Promise((r) => setTimeout(r, 1000));
    samples.push(await inPage(`const d = __m1.deck(); const h = rekordfox.audio.health; return { t: (performance.now() - __m1.t0) / 1000, p: d.positionSec - __m1.p0, playing: d.playing, underruns: h.underruns, frames: h.frames, callbacks: h.callbacks, maxBlock: h.maxBlock, stalls: h.stalls, reopens: h.reopens, frameMs: Math.round(h.frameMs * 10) / 10, snapshotAgeMs: Math.round(performance.now() - h.snapshotAt) };`));
  }
} catch (e) {
  clockError = e.message;
}
const last = samples[samples.length - 1] ?? { t: 0, p: 0, playing: false, underruns: 0 };
const worst = samples.reduce((m, s) => Math.max(m, Math.abs(s.p - s.t)), 0);
// Where the playhead and the wall clock parted company, if they did: the biggest jump in (p - t) between samples.
let jump = { at: 0, ms: 0 };
for (let i = 1; i < samples.length; i += 1) {
  const d = (samples[i].p - samples[i].t - (samples[i - 1].p - samples[i - 1].t)) * 1000;
  if (Math.abs(d) > Math.abs(jump.ms)) jump = { at: samples[i].t, ms: d };
}
const clock = { playing: last.playing, seconds: last.t, moved: last.p, driftMs: (last.p - last.t) * 1000, worstMs: worst * 1000, underruns: last.underruns, stalls: last.stalls, reopens: last.reopens, biggestJump: jump, samples, cutShort: clockError };
check('playhead follows the engine (no drift)', clock.playing && !clockError && Math.abs(clock.driftMs) < 50 && clock.worstMs < 80, {
  ...clock,
  note: `${clock.seconds.toFixed(1)} s wall, ${clock.moved.toFixed(3)} s audio, drift ${clock.driftMs.toFixed(1)} ms, worst ${clock.worstMs.toFixed(1)} ms, underruns ${clock.underruns}, stalls ${clock.stalls ?? 0}, reopens ${clock.reopens ?? 0}, biggest jump ${jump.ms.toFixed(0)} ms at ${jump.at.toFixed(0)} s${clock.playing ? '' : ' — the deck stopped (end of track?)'}${clockError ? ` — cut short: ${clockError}` : ''}`,
});
if (appClosed) {
  const report = { at: new Date().toISOString(), seconds: SECONDS, status, results, cutShort: true };
  writeFileSync(path.join(root, 'docs', `m1-check-${report.at.slice(0, 10)}.json`), JSON.stringify(report, null, 2));
  console.log('the app window was closed before the run finished — partial report written');
  process.exit(1);
}
// The rest needs a playing deck.
await inPage(`if (!__m1.deck().playing) __m1.dispatch({ type: 'deck/playPause', deck: 0 }); return true;`);
if (SHOT) {
  await new Promise((r) => setTimeout(r, 400));
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.resolve(SHOT), Buffer.from(shot.data, 'base64'));
  console.log(`screenshot: ${SHOT}`);
}

// 4b. reopening the output mid-playback (what happens after a stall) keeps the deck and its position
const reopen = await inPage(`
  const before = __m1.deck().positionSec; const t0 = performance.now();
  await rekordfox.audio.reopenNow();
  const opened = performance.now() - t0;
  await __m1.sleep(1500);
  const d = __m1.deck();
  const elapsed = (performance.now() - t0) / 1000;
  return { state: rekordfox.audio.status.state, engine: d.engine, playing: d.playing, openedMs: Math.round(opened), lostMs: Math.round((elapsed - (d.positionSec - before)) * 1000), reopens: rekordfox.audio.health.reopens };
`);
check('reopening the output keeps the deck playing where it was', reopen.state === 'running' && reopen.engine && reopen.playing && reopen.lostMs < 700, { ...reopen, note: `reopened in ${reopen.openedMs} ms, ${reopen.lostMs} ms of audio lost, deck ${reopen.engine ? 'kept' : 'RELOADED'}` });

// 5. seek
const seek = await inPage(`
  __m1.dispatch({ type: 'deck/seek', deck: 0, positionSec: 30 });
  await __m1.sleep(250);
  return __m1.deck().positionSec;
`);
check('seek is followed', seek >= 30 && seek < 30.5, { position: seek, note: `at ${seek.toFixed(3)} s 250 ms after seeking to 30` });

// 6. a 4-beat loop at 120 BPM holds the playhead inside 2 s
const loop = await inPage(`
  __m1.dispatch({ type: 'deck/beatLoop', deck: 0, beats: 4 });
  const l = __m1.deck().loop; let min = 1e9, max = -1e9;
  for (let i = 0; i < 40; i += 1) { await __m1.sleep(100); const p = __m1.deck().positionSec; min = Math.min(min, p); max = Math.max(max, p); }
  __m1.dispatch({ type: 'deck/loopExit', deck: 0 });
  return { inSec: l.inSec, outSec: l.outSec, min, max };
`);
check('loop holds the playhead', loop.min >= loop.inSec - 0.02 && loop.max <= loop.outSec + 0.02, { ...loop, note: `${loop.inSec.toFixed(2)}–${loop.outSec.toFixed(2)} s, seen ${loop.min.toFixed(3)}–${loop.max.toFixed(3)} over 4 s` });

// 7. tempo +10 %
const tempo = await inPage(`
  __m1.dispatch({ type: 'deck/tempo', deck: 0, value01: 1 });
  await __m1.sleep(200);
  const t0 = performance.now(); const p0 = __m1.deck().positionSec;
  await __m1.sleep(5000);
  const rate = (__m1.deck().positionSec - p0) / ((performance.now() - t0) / 1000);
  __m1.dispatch({ type: 'deck/tempoReset', deck: 0 });
  return rate;
`);
check('tempo slider changes the engine rate', Math.abs(tempo - 1.1) < 0.01, { rate: tempo, note: `+10 % slider → ${tempo.toFixed(4)}x` });

// 8. CUE while playing: pause + jump back
const cue = await inPage(`
  __m1.dispatch({ type: 'deck/cue', deck: 0, pressed: true });
  await __m1.sleep(250);
  const d = __m1.deck();
  __m1.dispatch({ type: 'deck/cue', deck: 0, pressed: false });
  return { playing: d.playing, pos: d.positionSec, cue: d.cueSec };
`);
check('CUE stops and returns to the cue point', !cue.playing && Math.abs(cue.pos - cue.cue) < 0.02, { ...cue, note: `paused at ${cue.pos.toFixed(3)} s (cue ${cue.cue.toFixed(3)} s)` });

// 9. scratch-follow: 20 jog ticks every 50 ms for a second (about 1x forward), then release
const scratch = await inPage(`
  __m1.dispatch({ type: 'deck/seek', deck: 0, positionSec: 40 });
  __m1.dispatch({ type: 'deck/jogTouch', deck: 0, touched: true });
  const start = __m1.deck().positionSec;
  for (let i = 0; i < 20; i += 1) { __m1.dispatch({ type: 'deck/jog', deck: 0, mode: 'scratch', ticks: 20 }); await __m1.sleep(50); }
  const target = __m1.deck().positionSec;
  __m1.dispatch({ type: 'deck/jogTouch', deck: 0, touched: false });
  await __m1.sleep(250);
  return { start, target, landed: __m1.deck().positionSec };
`);
check('the jog scratches (engine follows the hand)', scratch.target > scratch.start + 0.5 && Math.abs(scratch.landed - scratch.target) < 0.12, { ...scratch, note: `hand moved ${(scratch.target - scratch.start).toFixed(3)} s, engine landed ${(scratch.landed - scratch.target) * 1000 > 0 ? '+' : ''}${((scratch.landed - scratch.target) * 1000).toFixed(0)} ms from it` });

// 10. fader and crossfader through the real meters
const mix = await inPage(`
  __m1.dispatch({ type: 'deck/playPause', deck: 0 });
  const peak = async () => { let m = 0; for (let i = 0; i < 12; i += 1) { await __m1.sleep(50); m = Math.max(m, rekordfox.meters.deck[0]); } return m; };
  const master = async () => { let m = 0; for (let i = 0; i < 12; i += 1) { await __m1.sleep(50); m = Math.max(m, rekordfox.meters.master); } return m; };
  const up = await peak();
  __m1.dispatch({ type: 'mixer/set', ch: 0, param: 'fader', value: 0 });
  await __m1.sleep(100);
  const down = await peak();
  __m1.dispatch({ type: 'mixer/set', ch: 0, param: 'fader', value: 1 });
  __m1.dispatch({ type: 'mixer/crossfader', value: 1 });
  await __m1.sleep(100);
  const right = await master();
  __m1.dispatch({ type: 'mixer/crossfader', value: 0 });
  await __m1.sleep(100);
  const left = await master();
  __m1.dispatch({ type: 'deck/playPause', deck: 0 });
  return { up, down, left, right, underruns: rekordfox.audio.status.underruns };
`);
check('channel fader gates the deck', mix.up > 0.05 && mix.down < 0.001, { note: `deck peak ${mix.up.toFixed(3)} with the fader up, ${mix.down.toFixed(4)} down` });
check('crossfader hard right removes deck A from the master', mix.left > 0.02 && mix.right < 0.001, { note: `master peak ${mix.left.toFixed(3)} hard left, ${mix.right.toFixed(4)} hard right` });
check('no underruns', mix.underruns === 0, { underruns: mix.underruns, note: `${mix.underruns} over the whole run` });

// Leave the library as it was: eject the test track and remove it.
await inPage(`
  if (__m1.deck().playing) __m1.dispatch({ type: 'deck/playPause', deck: 0 });
  __m1.dispatch({ type: 'deck/eject', deck: 0 });
  __m1.dispatch({ type: 'library/remove', trackIds: ['local:m1'] });
  await __m1.sleep(600);
  return true;
`);

const report = { at: new Date().toISOString(), seconds: SECONDS, status, results };
const file = path.join(root, 'docs', `m1-check-${report.at.slice(0, 10)}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`\nreport: ${path.relative(root, file)}`);

const failed = Object.values(results).filter((r) => !r.ok).length;
console.log(failed === 0 ? 'M1 check passed' : `${failed} M1 check(s) FAILED`);
await closeApp();
process.exit(failed === 0 ? 0 : 1);
