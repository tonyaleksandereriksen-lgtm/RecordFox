#!/usr/bin/env node
/**
 * Zero-dependency static server for the built app (dist/). Web MIDI needs a secure context,
 * and http://localhost counts as one, so this is all the browser needs.
 *   node serve.mjs            → http://localhost:5199
 *   node serve.mjs --open     → also opens Chrome/Edge as an app window
 * If the port is taken by an earlier RekordFox window, that one is reused; otherwise the next free port is used.
 */
import { spawn } from 'node:child_process';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { createServer, get } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.env.REKORDFOX_DIST ?? 'dist');
const basePort = Number(process.env.PORT ?? 5199);
const open = process.argv.includes('--open');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};
// Same policy as the desktop app (electron/main.cjs). Sent as a header so the Vite dev server is unaffected.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self' data:; media-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const MARKER = 'x-rekordfox';

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No build found in ${root}. Run "npm run build" first (or use the prebuilt dist/ that ships with the repo).`);
  process.exit(1);
}

function handler(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);
  let file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', [MARKER]: '1' };
  if (file.endsWith('.html')) headers['Content-Security-Policy'] = CSP;
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

/** Is a RekordFox server already answering on this port? */
function isOurs(port) {
  return new Promise((done) => {
    const req = get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (res) => {
      res.resume();
      done(res.headers[MARKER] === '1');
    });
    req.on('error', () => done(false));
    req.on('timeout', () => {
      req.destroy();
      done(false);
    });
  });
}

function listen(port, attempt = 0) {
  const server = createServer(handler);
  server.once('error', async (err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error(`Could not start the server: ${err.message}`);
      process.exit(1);
    }
    if (await isOurs(port)) {
      const url = `http://localhost:${port}/`;
      console.log(`RekordFox is already running at ${url} — using that one.`);
      if (open) openAppWindow(url);
      return;
    }
    if (attempt >= 10) {
      console.error(`Ports ${basePort}–${port} are all busy. Set PORT to a free port, e.g.  set PORT=5300`);
      process.exit(1);
    }
    console.log(`Port ${port} is busy — trying ${port + 1}.`);
    listen(port + 1, attempt + 1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`RekordFox is running at ${url}  (Ctrl+C to stop)`);
    console.log('Use Chrome or Edge — they support Web MIDI. Allow MIDI when the browser asks.');
    if (open) openAppWindow(url);
  });
}

listen(basePort);

function openAppWindow(target) {
  const p = process.platform;
  const candidates =
    p === 'win32'
      ? [
          `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['LOCALAPPDATA']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : p === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
  const exe = candidates.find((c) => c && existsSync(c));
  if (exe) {
    spawn(exe, [`--app=${target}`, '--autoplay-policy=no-user-gesture-required'], { detached: true, stdio: 'ignore' }).unref();
  } else if (p === 'win32') {
    spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(p === 'darwin' ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
  }
}
