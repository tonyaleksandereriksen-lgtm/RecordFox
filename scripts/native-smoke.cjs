// Loads the native audio addon the way the desktop app does and exercises it for half a second:
//   npm run native:smoke          (inside Electron's main process — the real test)
//   node scripts/native-smoke.cjs (plain Node, same addon)
// Set RFX_BACKEND=null to run without a sound card. Exit code 0 means the addon loaded, listed
// outputs, opened one, ran the engine and shut down cleanly.
const path = require('node:path');

const ADDON = path.join(__dirname, '..', 'native', 'node', 'rfx.node');
const electron = process.versions.electron ? require('electron') : null;

async function run() {
  const rfx = require(ADDON);
  console.log(`addon loaded in ${electron ? `Electron ${process.versions.electron}` : `Node ${process.versions.node}`} (Node-API ${process.versions.napi})`);
  console.log(`miniaudio ${rfx.version()}, backend ${rfx.init()}`);
  const devices = rfx.devices();
  for (const d of devices) console.log(`  [${d.index}] ${d.name}${d.isDefault ? ' (default)' : ''} — ${d.maxChannels || '?'} ch, ${d.nativeRate || '?'} Hz`);
  const flx2 = devices.find((d) => /DDJ[-_ ]?FLX2/i.test(d.name));
  const target = flx2 ? flx2.index : -1;
  let info = null;
  if (flx2) {
    try {
      info = rfx.open(target, true, 48000, 4, 96);
    } catch (e) {
      console.log(`  exclusive open refused: ${e.message}`);
    }
  }
  if (!info) info = rfx.open(target, false, 0, flx2 ? 4 : 2, 0);
  console.log(`opened ${info.name}: ${info.sampleRate} Hz, ${info.channels} ch, ${info.periods} x ${info.periodFrames} frames = ${info.latencyMs.toFixed(2)} ms${info.exclusive ? ', exclusive' : ', shared'}`);
  rfx.engineInit(info.sampleRate);
  await new Promise((r) => setTimeout(r, 500));
  const s = rfx.snapshot();
  console.log(`engine ran: ${s.frames} frames in ${s.callbacks} callbacks, largest block ${s.maxBlock}, underruns ${s.underruns}`);
  rfx.engineShutdown();
  rfx.close();
  rfx.uninit();
  console.log('closed cleanly');
  if (s.frames <= 0) throw new Error('the device callback never ran');
}

const done = run().then(
  () => 0,
  (e) => {
    console.error(`native smoke test failed: ${e.stack || e}`);
    return 1;
  },
);

if (electron) {
  electron.app.whenReady().then(() => done.then((code) => electron.app.exit(code)));
} else {
  done.then((code) => process.exit(code));
}
