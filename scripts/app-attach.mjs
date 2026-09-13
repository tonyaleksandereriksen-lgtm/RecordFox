// Evaluates one expression in an ALREADY RUNNING desktop app started with --remote-debugging-port
// (scripts/midi-capture.mjs and app-eval.mjs --keep leave one on port 9334). Prints JSON.
//   node scripts/app-attach.mjs "rekordfox.midi.log.totals"   [--port 9334]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const pi = args.indexOf('--port');
const PORT = pi >= 0 ? Number(args[pi + 1]) : 9334;
const arg = args.filter((a, i) => a !== '--port' && !(pi >= 0 && i === pi + 1))[0] ?? 'Object.keys(window.rekordfox)';
const expr = arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page' && /^app:\/\//.test(t.url));
if (!target) {
  console.error('no app page on the debugging port');
  process.exit(1);
}
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
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
await cdp('Runtime.enable');
const r = await cdp('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.exceptionDetails ? { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } : r.result.value, null, 2));
ws.close();
process.exit(r.exceptionDetails ? 1 : 0);
