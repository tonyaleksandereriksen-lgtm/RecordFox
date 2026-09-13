// M2 acceptance check. Builds a temporary music folder (generated tracks at known tempos, a
// subfolder, a non-audio file), launches the built desktop app, imports the folder through the
// library controller and verifies: tracks from tags/names with real durations, BPM within 0.1 of
// the truth, waveforms served to the decks, export copying the audio, and a second launch that is
// complete from the index without re-analysing. Removes its folder from the library afterwards.
//   node scripts/m2-check.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = createRequire(import.meta.url)('electron');
const PORT = 9335;
const music = path.join(tmpdir(), 'rekordfox-m2-music');
const exportDir = path.join(tmpdir(), 'rekordfox-m2-export');
/** Ten-second tracks: enough beats for the analyser, quick to make. */
const TRACKS = [
  { file: 'Kit Ferro - Neon Test.wav', bpm: 100 },
  { file: 'Luma Vale - Glass Test.wav', bpm: 128 },
  { file: path.join('Sub Folder', 'deeper track.wav'), bpm: 140 },
];

rmSync(music, { recursive: true, force: true });
rmSync(exportDir, { recursive: true, force: true });
mkdirSync(path.join(music, 'Sub Folder'), { recursive: true });
for (const t of TRACKS) {
  const r = spawn(process.execPath, [path.join(root, 'scripts', 'make-test-wav.mjs'), path.join(music, t.file), '20', String(t.bpm)], { stdio: 'ignore' });
  await new Promise((res) => r.on('exit', res));
}
writeFileSync(path.join(music, 'notes.txt'), 'not audio');

// Clear this run's analysis cache entries so the analyser really runs (ids as src/audio/localFiles.ts makes them).
const localTrackId = (p) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < p.length; i += 1) {
    h ^= p.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `local:${h.toString(16).padStart(8, '0')}`;
};
const analysisDir = path.join(process.env.APPDATA ?? path.join(process.env.HOME ?? '', '.config'), 'rekordfox', 'analysis');
let cleared = 0;
for (const t of TRACKS) {
  const stem = localTrackId(path.join(music, t.file)).replace(/[^A-Za-z0-9_-]/g, '-');
  for (const ext of ['.json', '.rfxwave']) {
    const f = path.join(analysisDir, stem + ext);
    if (existsSync(f)) {
      rmSync(f);
      cleared += 1;
    }
  }
}
if (cleared) console.log(`cleared ${cleared} cached analysis file(s) from the previous run`);

const results = {};
const check = (name, ok, note) => {
  results[name] = { ok: !!ok, note };
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${note ? ` — ${note}` : ''}`);
};

async function launch() {
  const app = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  app.stderr.on('data', (b) => {
    const line = String(b);
    if (/Error occurred|Uncaught|TypeError|ReferenceError/.test(line)) process.stderr.write(`[app] ${line}`);
  });
  let exited = false;
  app.on('exit', () => (exited = true));
  let target = null;
  for (let i = 0; i < 100 && !target; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && /^app:\/\//.test(t.url)) ?? null;
    } catch {
      /* not up yet */
    }
    if (!target) await new Promise((r) => setTimeout(r, 200));
  }
  if (!target) throw new Error('the app window never appeared');
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
  ws.onclose = () => {
    for (const s of pending.values()) s({ error: { message: 'the app closed' } });
    pending.clear();
  };
  const cdp = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  await cdp('Runtime.enable');
  const inPage = async (body) => {
    const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const close = async () => {
    try {
      await cdp('Browser.close');
    } catch {
      /* gone */
    }
    for (let i = 0; i < 50 && !exited; i += 1) await new Promise((r) => setTimeout(r, 100));
    if (!exited) app.kill();
  };
  return { inPage, close };
}

const helpers = `
  window.__m2 = {
    state: () => window.rekordfox.store.getState(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    waitFor: async (fn, timeout) => { const t0 = performance.now(); while (performance.now() - t0 < timeout) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return fn(); },
    mine: () => window.rekordfox.store.getState().library.tracks.filter((t) => t.path && t.path.startsWith(${JSON.stringify(music)})),
  };
  return true;
`;
const musicJson = JSON.stringify(music);

// ---- first launch: import, analyse, waveforms, export ----------------------------------------
let app = await launch();
await app.inPage(helpers);
await app.inPage(`return __m2.waitFor(() => window.rekordfox && window.rekordfox.library, 15000);`);
const t0 = Date.now();
const imported = await app.inPage(`
  await rekordfox.library.importFolder(${musicJson});
  const t1 = performance.now();
  await __m2.waitFor(() => __m2.mine().length === 3, 10000);
  const tracks = __m2.mine();
  const gotAll = await __m2.waitFor(() => __m2.mine().every((t) => t.analysedAt || t.analysisError), 60000);
  await __m2.waitFor(() => rekordfox.store.getState().library.folders.includes(${musicJson}) , 1000);
  return { ms: Math.round(performance.now() - t1), count: tracks.length, gotAll, tracks: __m2.mine().map((t) => ({ title: t.title, artist: t.artist, bpm: t.bpm, key: t.key, dur: t.durationSec, firstBeat: t.firstBeatSec, err: t.analysisError, path: t.path })), folders: rekordfox.store.getState().library.folders };
`);
check('folder scanned recursively, audio only', imported.count === 3 && imported.tracks.some((t) => /Sub Folder/.test(t.path)), `${imported.count} tracks, ${imported.tracks.filter((t) => /Sub Folder/.test(t.path)).length} from the subfolder, notes.txt ignored`);
const neon = imported.tracks.find((t) => /Neon Test/.test(t.path));
check('titles and artists from the file names (no tags in a WAV)', neon && neon.title === 'Neon Test' && neon.artist === 'Kit Ferro', neon ? `"${neon.artist} — ${neon.title}"` : 'missing');
check('durations from the headers', imported.tracks.every((t) => Math.abs(t.dur - 20) < 0.05), imported.tracks.map((t) => t.dur.toFixed(3)).join(', '));
const bpmOk = TRACKS.every((x) => {
  const t = imported.tracks.find((y) => y.path.endsWith(path.basename(x.file)));
  return t && Math.abs(t.bpm - x.bpm) < 0.1;
});
check('BPM analysed within 0.1 of the truth', imported.gotAll && bpmOk, imported.tracks.map((t) => `${t.bpm.toFixed(2)}${t.err ? ` (${t.err})` : ''}`).join(', ') + ` in ${Date.now() - t0} ms including analysis`);
check('folder remembered', imported.folders.includes(music), imported.folders.length + ' folder(s)');
check('downbeats near the first click', imported.tracks.every((t) => t.firstBeat < 0.05 || Math.abs(t.firstBeat - 60 / (imported.tracks.length ? 1 : 1)) < 0.05), imported.tracks.map((t) => `${(t.firstBeat * 1000).toFixed(0)} ms`).join(', '));

const wave = await app.inPage(`
  const t = __m2.mine()[0];
  rekordfox.store.dispatch({ type: 'deck/load', deck: 1, trackId: t.id });
  const ok = await __m2.waitFor(() => rekordfox.hasWaveform(t.id), 5000);
  return { ok, id: t.id };
`);
check('analysed waveform reaches the deck', wave.ok, wave.id);

const exp = await app.inPage(`
  const t = __m2.mine()[0];
  const r = await rekordfoxHost.library.exportWrite({ dir: ${JSON.stringify(exportDir)}, files: [{ name: 'M2.m3u8', text: '#EXTM3U\\n' }], copies: [{ from: t.path, to: 'Copy One.wav' }, { from: t.path, to: 'Copy One.wav' }] });
  return r;
`);
const copied = existsSync(path.join(exportDir, 'Copy One.wav')) && statSync(path.join(exportDir, 'Copy One.wav')).size > 1000;
check('export writes the playlist and copies audio, never over an existing file', exp.written.length === 1 && exp.copied.length === 1 && exp.failed.length === 1 && copied, `${exp.copied.length} copied, ${exp.failed.length} refused (already there)`);

await app.close();

// ---- second launch: instant from the index, nothing re-analysed ------------------------------
app = await launch();
await app.inPage(helpers);
const second = await app.inPage(`
  const t0 = performance.now();
  await __m2.waitFor(() => window.rekordfox && window.rekordfox.library, 15000);
  const ready = __m2.mine();
  const msUntilReady = performance.now() - t0;
  await __m2.sleep(1500);
  const after = __m2.mine();
  return { count: ready.length, analysed: ready.filter((t) => t.bpm > 0).length, msUntilReady: Math.round(msUntilReady), unchanged: after.every((t, i) => t.analysedAt === ready[i].analysedAt), phase: rekordfox.store.getState ? 'ok' : '?' };
`);
check('second launch has the analysed library at once', second.count === 3 && second.analysed === 3 && second.msUntilReady < 1500, `${second.analysed}/${second.count} analysed, ready ${second.msUntilReady} ms after the page loaded`);
check('nothing is re-analysed on the second launch', second.unchanged, 'analysedAt stamps unchanged after 1.5 s');

// ---- cleanup: leave the library as it was -------------------------------------------------
await app.inPage(`
  const ids = __m2.mine().map((t) => t.id);
  if (rekordfox.store.getState().decks[1].track) rekordfox.store.dispatch({ type: 'deck/eject', deck: 1 });
  await rekordfox.library.removeFolder(${musicJson});
  await __m2.sleep(800);
  return true;
`);
const left = await app.inPage(`return __m2.mine().length;`);
check('cleanup: the test folder is gone from the library', left === 0, `${left} left`);
await app.close();
rmSync(music, { recursive: true, force: true });
rmSync(exportDir, { recursive: true, force: true });

const failed = Object.values(results).filter((r) => !r.ok).length;
writeFileSync(path.join(root, 'docs', `m2-check-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(failed === 0 ? 'M2 check passed' : `${failed} M2 check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
