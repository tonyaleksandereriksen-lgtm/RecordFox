// Runs one expression inside the built desktop app and prints the result as JSON — the quickest way
// to read real state (the MIDI log, the library, the engine) without a debugger.
//   node scripts/app-eval.mjs "rekordfox.store.getState().library.tracks.length"
//   node scripts/app-eval.mjs @expr.js          (a file holding one expression, may be an async IIFE)
//   node scripts/app-eval.mjs @expr.js shot.png (also captures the window afterwards)
//   node scripts/app-eval.mjs --keep "…"        (leaves the app open — for a hardware session)
// Available in the page: window.rekordfox = { store, midi, bindings, virtualUnit, audio, meters, library, hasWaveform }
// and window.rekordfoxHost (the preload bridge). Uses the DevTools protocol on port 9334; needs `npm run build` first.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = createRequire(import.meta.url)('electron');
const PORT = 9334;
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const rest = args.filter((a) => a !== '--keep');
const arg = rest[0] ?? 'Object.keys(window.rekordfox)';
const expr = arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg;
const shot = rest[1] ?? null;

const app = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'], detached: keep });
let exited = false;
app.on('exit', () => (exited = true));

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
  throw new Error('the app window never appeared (is another instance running?)');
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
ws.onclose = () => {
  for (const settle of pending.values()) settle({ error: { message: 'the app closed' } });
  pending.clear();
};
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
await cdp('Runtime.enable');
for (let i = 0; i < 100; i += 1) {
  const r = await cdp('Runtime.evaluate', { expression: '!!window.rekordfox', returnByValue: true });
  if (r.result.value) break;
  await new Promise((r) => setTimeout(r, 100));
}
await new Promise((r) => setTimeout(r, 1500));
const r = await cdp('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.exceptionDetails ? { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } : r.result.value, null, 2));
if (shot) {
  await cdp('Page.enable');
  const png = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shot, Buffer.from(png.data, 'base64'));
  console.error(`screenshot: ${shot}`);
}
if (keep) {
  ws.close();
  app.unref();
  process.exit(0);
}
try {
  await cdp('Browser.close');
} catch {
  /* already gone */
}
for (let i = 0; i < 50 && !exited; i += 1) await new Promise((r) => setTimeout(r, 100));
if (!exited) app.kill();
process.exit(r.exceptionDetails ? 1 : 0);
