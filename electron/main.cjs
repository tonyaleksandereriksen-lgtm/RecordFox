/**
 * Electron shell for RekordFox. Serves the built renderer from dist/ over a privileged app://
 * scheme (a secure context, so Web MIDI and audio device selection work), grants MIDI + SysEx,
 * audio and folder-picker permissions, and lifts the autoplay gesture requirement.
 *
 * The FLX2 control path stays Web MIDI inside Chromium (WinMM on Windows, CoreMIDI on macOS).
 */
const { app, BrowserWindow, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.REKORDFOX_DEV_URL; // e.g. http://localhost:5173 (see scripts/app-dev.mjs)
const DIST = path.join(__dirname, '..', 'dist');
const ICON = path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self' data:; media-src 'self' blob: data:; connect-src 'self'";
// Everything the renderer may ask for. Camera/HID/USB/serial are refused: the FLX2 is MIDI + audio only.
const ALLOWED = new Set(['midi', 'midiSysex', 'speaker-selection', 'fullscreen', 'clipboard-sanitized-write', 'fileSystem']);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// One window only: on Windows a MIDI port can be held by a single process.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1180,
    minHeight: 640,
    backgroundColor: '#03080E',
    title: 'RekordFox',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false, // keep the clock/LED loop running when the window is covered
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadURL('app://rekordfox/index.html');
}

function insideDist(file) {
  const rel = path.relative(DIST, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!insideDist(file)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });

  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media') {
      // Microphone only (Chrome hides audio device names until a media permission exists); never camera.
      const types = (details && details.mediaTypes) || [];
      return callback(types.length > 0 && types.every((t) => t === 'audio'));
    }
    callback(ALLOWED.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission) || permission === 'media');
  ses.setDevicePermissionHandler?.(() => false); // no WebHID/WebUSB/serial: the FLX2 is MIDI-only

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
