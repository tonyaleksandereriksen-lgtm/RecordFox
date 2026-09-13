/**
 * The native audio engine in the main process. Loads native/node/rfx.node (built by
 * `npm run native`), opens the output — the DDJ-FLX2 in WASAPI exclusive mode when it is there,
 * with a fallback ladder down to the default output in shared mode — and serves the renderer over
 * IPC: one `rfx:frame` round trip per animation frame (a batch of commands in, a snapshot out),
 * `rfx:cmds` for batches that cannot wait, and Promise-based track loading on the thread pool.
 *
 * Track operations (load, eject) are serialised per deck: the addon decodes on a worker thread
 * and the C engine expects one control thread per deck.
 */
const { dialog, ipcMain } = require('electron');
const path = require('node:path');

const ADDON = path.join(__dirname, '..', 'native', 'node', 'rfx.node');
const FLX2 = /DDJ[-_ ]?FLX2/i;
const RATE = 48000;

let rfx = null;
let status = { state: 'unavailable', reason: 'native engine not loaded' };
try {
  rfx = require(ADDON);
  status = { state: 'idle' };
} catch (e) {
  status = { state: 'unavailable', reason: `The native audio engine is not built (${path.relative(path.join(__dirname, '..'), ADDON)}): run "npm run native". ${e.message}` };
}

const trackOps = [Promise.resolve(), Promise.resolve()];
/** Queues a load/eject behind whatever the deck is already doing. */
function trackOp(deck, fn) {
  const next = trackOps[deck].then(fn, fn);
  trackOps[deck] = next.catch(() => undefined);
  return next;
}

const isDeck = (d) => d === 0 || d === 1;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const flag = (v) => (v ? true : false);

function apply(cmds) {
  if (!rfx || status.state !== 'running' || !Array.isArray(cmds)) return;
  for (const c of cmds) {
    if (!Array.isArray(c)) continue;
    const deck = c[1];
    switch (c[0]) {
      case 'play':
        if (isDeck(deck)) rfx.deckPlay(deck, flag(c[2]));
        break;
      case 'seek':
        if (isDeck(deck)) rfx.deckSeek(deck, num(c[2]));
        break;
      case 'rate':
        if (isDeck(deck)) rfx.deckSetRate(deck, num(c[2]));
        break;
      case 'scratch':
        if (isDeck(deck)) rfx.deckScratchTo(deck, flag(c[2]), num(c[3]));
        break;
      case 'loop':
        if (isDeck(deck)) rfx.deckSetLoop(deck, num(c[2]), num(c[3]), flag(c[4]));
        break;
      case 'channel':
        if (isDeck(deck)) rfx.deckSetChannel(deck, num(c[2]), num(c[3]), num(c[4]), num(c[5]), num(c[6]), num(c[7]), flag(c[8]));
        break;
      case 'master':
        rfx.engineSetMaster(num(c[1]), num(c[2]), num(c[3]), num(c[4]), flag(c[5]));
        break;
      default:
        break;
    }
  }
}

function listDevices() {
  if (!rfx) return [];
  if (status.state !== 'running') {
    // Re-enumerate: a unit plugged in after launch only shows up in a fresh context.
    rfx.uninit();
    rfx.init();
  }
  return rfx.devices().map((d) => ({ ...d, flx2: FLX2.test(d.name) }));
}

async function stopAudio() {
  if (!rfx || status.state !== 'running') return;
  await Promise.all(trackOps);
  rfx.engineShutdown();
  rfx.close();
  status = { state: 'idle' };
}

/**
 * Opens `opts.device` (by name), else the FLX2, else the default output. The FLX2 is tried
 * exclusive at 48 kHz / 4 ch from 96 frames up (what the probe measured at 4 ms), then shared;
 * anything else is opened shared with 2 channels, so a surround card never gets the cue bus.
 * Re-enumerates first, so a unit plugged in (or pulled) since the last open is seen.
 */
function openOutput(opts) {
  rfx.uninit();
  const backend = rfx.init();
  const list = rfx.devices();
  const wantName = opts && typeof opts.device === 'string' ? opts.device : null;
  const wanted = wantName ? list.find((d) => d.name === wantName) : null;
  const unit = list.find((d) => FLX2.test(d.name)) ?? null;
  const chosen = wanted ?? unit ?? null;
  const flx2 = !!chosen && FLX2.test(chosen.name);
  const attempts = flx2
    ? [
        [true, RATE, 4, 96],
        [true, RATE, 4, 128],
        [true, RATE, 4, 256],
        [false, 0, 4, 0],
      ]
    : [[false, 0, 2, 0]];
  const refused = [];
  let info = null;
  for (const [exclusive, rate, channels, period] of attempts) {
    try {
      info = rfx.open(chosen ? chosen.index : -1, exclusive, rate, channels, period);
      break;
    } catch (e) {
      refused.push(`${exclusive ? 'exclusive' : 'shared'}${period ? ` ${period} frames` : ''}: ${e.message}`);
    }
  }
  if (!info) throw new Error(`Could not open ${chosen ? chosen.name : 'the default output'} — ${refused.join('; ')}`);

  const notes = [];
  if (wantName && !wanted) notes.push(`"${wantName}" is not connected — using ${chosen ? chosen.name : 'the default output'}`);
  if (!chosen) notes.push('No DDJ-FLX2 audio output found — using the default output in shared mode');
  else if (flx2 && !info.exclusive) notes.push(`Exclusive mode was refused (${refused[refused.length - 1] ?? 'unknown reason'}) — shared mode, higher latency`);
  if (info.channels < 4) notes.push(`This output has ${info.channels} channels, so headphone cue is off`);

  return {
    state: 'running',
    device: info.name,
    flx2,
    exclusive: info.exclusive,
    sampleRate: info.sampleRate,
    channels: info.channels,
    periodFrames: info.periodFrames,
    periods: info.periods,
    latencyMs: info.latencyMs,
    backend,
    note: notes.length ? notes.join('. ') : null,
    underruns: 0,
  };
}

async function startAudio(opts) {
  if (!rfx) throw new Error(status.reason);
  await stopAudio();
  const opened = openOutput(opts);
  rfx.engineInit(opened.sampleRate);
  status = opened;
  return status;
}

/**
 * The output died (unplugged, or taken by another program): open an output again but keep the
 * engine — its decks, positions and settings stay in RAM — unless the new output runs at another
 * rate, in which case the engine must restart and the renderer reload the tracks (`reloaded`).
 */
async function reopenAudio(opts) {
  if (!rfx) throw new Error(status.reason);
  await Promise.all(trackOps);
  rfx.close();
  status = { state: 'idle' };
  const opened = openOutput(opts);
  let reloaded = false;
  if (opened.sampleRate !== rfx.engineSampleRate()) {
    rfx.engineShutdown();
    rfx.engineInit(opened.sampleRate);
    reloaded = true;
  }
  status = opened;
  return { status, reloaded };
}

function registerAudio(getWindow) {
  ipcMain.handle('rfx:status', () => status);
  ipcMain.handle('rfx:start', (_e, opts) => startAudio(opts));
  ipcMain.handle('rfx:reopen', (_e, opts) => reopenAudio(opts));
  ipcMain.handle('rfx:stop', () => stopAudio());
  ipcMain.handle('rfx:devices', () => listDevices());
  ipcMain.handle('rfx:frame', (_e, cmds) => {
    // null = not running (stopping at quit, or between reopens): the bridge goes quiet, no error.
    if (!rfx || status.state !== 'running') return null;
    apply(cmds);
    return rfx.snapshot();
  });
  ipcMain.on('rfx:cmds', (_e, cmds) => apply(cmds));
  ipcMain.handle('rfx:load', (_e, deck, file) => {
    if (!rfx || status.state !== 'running') throw new Error('the audio engine is not running');
    if (!isDeck(deck) || typeof file !== 'string') throw new Error('bad load request');
    return trackOp(deck, () => rfx.deckLoad(deck, file));
  });
  ipcMain.handle('rfx:eject', (_e, deck) => {
    if (!rfx || status.state !== 'running' || !isDeck(deck)) return;
    return trackOp(deck, () => rfx.deckEject(deck));
  });
  ipcMain.handle('rfx:probe', (_e, file) => {
    if (!rfx) throw new Error(status.reason);
    if (typeof file !== 'string') throw new Error('bad probe request');
    return rfx.probeFile(file);
  });
  ipcMain.handle('rfx:pickFiles', async () => {
    const win = getWindow();
    const r = await dialog.showOpenDialog(win ?? undefined, {
      title: 'Add audio files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio (wav, flac, mp3)', extensions: ['wav', 'flac', 'mp3'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return r.canceled ? [] : r.filePaths;
  });
}

/** Last resort at quit, when nothing can be awaited any more. */
function shutdownSync() {
  if (!rfx || status.state !== 'running') return;
  try {
    rfx.engineShutdown();
    rfx.close();
    rfx.uninit();
  } catch {
    /* going down anyway */
  }
  status = { state: 'idle' };
}

module.exports = { registerAudio, startAudio, reopenAudio, stopAudio, shutdownSync, available: rfx !== null, addon: rfx };
