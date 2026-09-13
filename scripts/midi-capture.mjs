// Records everything the DDJ-FLX2 sends, for a hardware verification session (docs/NEXT.md M3).
// Launches the built desktop app, subscribes to its MIDI log from inside the page (lossless — the
// monitor's ring buffer keeps 600 entries, a platter revolution is more than that) and appends each
// incoming message as one JSON line to --out until --minutes pass or the app is closed.
//   node scripts/midi-capture.mjs --out capture.jsonl [--minutes 20] [--attach]
// --attach records from an app that is already running with --remote-debugging-port=9334 instead of launching one.
// Lines: { t, wall, bytes: "9x xx xx", label, detail, confidence } for dir "in", plus "sys" notes.
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = createRequire(import.meta.url)('electron');
const PORT = 9334;
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const OUT = path.resolve(opt('out', 'midi-capture.jsonl'));
const MINUTES = Number(opt('minutes', 20));

if (!args.includes('--attach')) {
  const app = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'], detached: true });
  app.unref();
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
  throw new Error('the app window never appeared (is another instance running?)');
}

const target = await pageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let closed = false;
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
  closed = true;
  for (const settle of pending.values()) settle({ error: { message: 'the app closed' } });
  pending.clear();
};
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await cdp('Runtime.enable');
for (let i = 0; i < 100; i += 1) {
  if (await evaluate('!!(window.rekordfox && window.rekordfox.midi)')) break;
  await new Promise((r) => setTimeout(r, 100));
}
await evaluate(`
  if (!window.__cap) {
    window.__cap = { buf: [], last: rekordfox.midi.log.version(), t0: Date.now() - performance.now() };
    rekordfox.midi.log.subscribe(() => {
      for (const e of rekordfox.midi.log.entries()) {
        if (e.seq > __cap.last) { __cap.last = e.seq; if (e.dir !== 'out') __cap.buf.push(e); }
      }
    });
  }
  true
`);
if (!args.includes('--attach')) writeFileSync(OUT, '');
console.log(`recording to ${OUT} for up to ${MINUTES} min — press controls on the unit; close the app or wait to stop`);

const hex = (b) => b.map((x) => x.toString(16).padStart(2, '0')).join(' ');
const t0 = await evaluate('__cap.t0'); // wall-clock origin of the page's performance.now()
const deadline = Date.now() + MINUTES * 60_000;
let lines = 0;
while (!closed && Date.now() < deadline) {
  let batch = [];
  try {
    batch = await evaluate('__cap.buf.splice(0)');
  } catch (e) {
    console.error(`stopping: ${e.message}`);
    break;
  }
  for (const e of batch) {
    appendFileSync(OUT, JSON.stringify({ t: Math.round(e.t), wall: new Date(t0 + e.t).toISOString(), dir: e.dir, bytes: hex(e.bytes), label: e.label, detail: e.detail ?? null, confidence: e.confidence }) + '\n');
    lines += 1;
  }
  const status = await evaluate('rekordfox.midi.status.kind').catch((e) => `gone (${e.message})`);
  if (status.startsWith('gone')) {
    console.error(`stopping: ${status}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 150));
}
console.log(`stopped: ${lines} messages recorded`);
try {
  ws.close();
} catch {
  /* fine */
}
process.exit(0);
