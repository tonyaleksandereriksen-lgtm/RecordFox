/**
 * The library's file side, in the main process: the music folders (pick, recursive scan), what a
 * file says about itself (tags through lofty, duration through the engine's probe), the analyser
 * queue (one file at a time on the addon's thread pool, progress streamed to the renderer), the
 * per-file analysis cache, and the library index itself — one JSON file in userData, written
 * atomically. The renderer keeps the model; this side only moves bytes.
 *
 *   <userData>/library.json          the index (prefs, folders, local tracks, edits)
 *   <userData>/analysis/<id>.json    BPM, downbeat, key … keyed by track id, checked against size+mtime
 *   <userData>/analysis/<id>.rfxwave low/mid/high bytes per 10 ms, what the decks draw
 */
const { app, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const audio = require('./audio.cjs');

const AUDIO_EXT = new Set(['.wav', '.flac', '.mp3']);
const ANALYSIS_VERSION = 2; // bump when the analyser changes enough that old numbers should be redone
const DESCRIBE_CONCURRENCY = 4;

const userData = () => app.getPath('userData');
const libraryFile = () => path.join(userData(), 'library.json');
const analysisDir = () => path.join(userData(), 'analysis');
/** Track ids look like "local:1a2b3c4d"; the colon is not welcome in file names. */
const fileStem = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '-');

// --- the index ---------------------------------------------------------------------------------

/** Synchronous on purpose: the renderer needs it before it can build its store. */
function loadLibrarySync() {
  try {
    const parsed = JSON.parse(fs.readFileSync(libraryFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

let saveChain = Promise.resolve();
function saveLibrary(saved) {
  const file = libraryFile();
  const tmp = `${file}.tmp`;
  const json = JSON.stringify(saved);
  saveChain = saveChain.then(async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(tmp, json, 'utf8');
    await fsp.rename(tmp, file);
  });
  return saveChain;
}

// --- folders -----------------------------------------------------------------------------------

async function scanFolder(root) {
  const out = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
    }
  };
  await walk(root);
  return out;
}

async function stat(file) {
  try {
    const s = await fsp.stat(file);
    return { size: s.size, mtimeMs: Math.round(s.mtimeMs) };
  } catch {
    return null;
  }
}

// --- describing files --------------------------------------------------------------------------

async function readCachedAnalysis(id, size, mtimeMs) {
  try {
    const meta = JSON.parse(await fsp.readFile(path.join(analysisDir(), `${fileStem(id)}.json`), 'utf8'));
    if (!meta || meta.version !== ANALYSIS_VERSION || meta.size !== size || meta.mtimeMs !== mtimeMs) return null;
    return meta;
  } catch {
    return null;
  }
}

/** Everything the renderer needs to make a Track: tags, duration, and cached analysis if any. */
async function describe(file, id) {
  const rfx = audio.addon;
  const st = await stat(file);
  if (!st) return { path: file, error: 'file not found' };
  let tags = null;
  let probe = null;
  if (rfx) {
    try {
      tags = await rfx.readTags(file);
    } catch {
      tags = null; // lofty refuses some containers (a streamed WAV with an unfinished header); the engine still plays them
    }
    if (!tags || !(tags.durationSeconds > 0)) {
      try {
        probe = await rfx.probeFile(file);
      } catch (e) {
        return { path: file, ...st, tags, error: String(e && e.message ? e.message : e) };
      }
    }
  }
  const analysis = id ? await readCachedAnalysis(id, st.size, st.mtimeMs) : null;
  return { path: file, ...st, tags, probe, analysis };
}

async function describeAll(items) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await describe(items[i].path, items[i].id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DESCRIBE_CONCURRENCY, items.length) }, worker));
  return out;
}

// --- the analysis queue ------------------------------------------------------------------------

let queue = [];
let running = false;
let cancelled = false;
let done = 0;
let total = 0;
let sendTo = null; // webContents to stream progress and results to

function emit(channel, payload) {
  if (sendTo && !sendTo.isDestroyed()) sendTo.send(channel, payload);
}

function progress(current) {
  emit('library:progress', { phase: running ? 'analyse' : 'idle', done, total, current: current ?? null });
}

async function analyseOne(item) {
  const rfx = audio.addon;
  if (!rfx) throw new Error('the native engine is not loaded');
  const st = await stat(item.path);
  if (!st) throw new Error('file not found');
  const cached = await readCachedAnalysis(item.id, st.size, st.mtimeMs);
  if (cached) return cached;
  const a = await rfx.analyze(item.path);
  const dir = analysisDir();
  await fsp.mkdir(dir, { recursive: true });
  const stem = fileStem(item.id);
  const meta = {
    version: ANALYSIS_VERSION,
    size: st.size,
    mtimeMs: st.mtimeMs,
    analysedAt: Date.now(),
    durationSec: a.durationSeconds,
    bpm: a.bpm,
    bpmConfidence: a.bpmConfidence,
    firstBeatSec: a.firstBeatSeconds,
    key: a.key,
    keyName: a.keyName,
    keyFit: a.keyFit,
    keyMargin: a.keyMargin,
    bins: a.bins,
  };
  await fsp.writeFile(path.join(dir, `${stem}.rfxwave`), a.wave);
  await fsp.writeFile(path.join(dir, `${stem}.json`), JSON.stringify(meta));
  return meta;
}

async function drain() {
  if (running) return;
  running = true;
  cancelled = false;
  while (queue.length > 0 && !cancelled) {
    const item = queue.shift();
    progress(item);
    try {
      const meta = await analyseOne(item);
      done += 1;
      emit('library:analysis', { id: item.id, ok: true, meta });
    } catch (e) {
      done += 1;
      emit('library:analysis', { id: item.id, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }
  queue = [];
  running = false;
  done = 0;
  total = 0;
  progress(null);
}

function enqueue(items) {
  const known = new Set(queue.map((q) => q.id));
  for (const it of items) {
    if (!it || typeof it.id !== 'string' || typeof it.path !== 'string' || known.has(it.id)) continue;
    queue.push({ id: it.id, path: it.path });
    known.add(it.id);
    total += 1;
  }
  void drain();
  return { queued: queue.length, total };
}

async function readWaveform(id) {
  try {
    return await fsp.readFile(path.join(analysisDir(), `${fileStem(id)}.rfxwave`));
  } catch {
    return null;
  }
}

// --- export: write text files and copy audio next to them ---------------------------------------

async function exportWrite({ dir, files, copies }) {
  if (typeof dir !== 'string') throw new Error('no folder');
  await fsp.mkdir(dir, { recursive: true });
  const written = [];
  for (const f of files ?? []) {
    if (!f || typeof f.name !== 'string' || typeof f.text !== 'string') continue;
    const target = path.join(dir, path.basename(f.name));
    await fsp.writeFile(target, f.text, 'utf8');
    written.push(path.basename(f.name));
  }
  const copied = [];
  const failed = [];
  for (const c of copies ?? []) {
    if (!c || typeof c.from !== 'string' || typeof c.to !== 'string') continue;
    const target = path.join(dir, path.basename(c.to));
    try {
      // COPYFILE_EXCL: never replace a file that is already there — the caller picked unique names.
      await fsp.copyFile(c.from, target, fs.constants.COPYFILE_EXCL);
      copied.push(path.basename(c.to));
    } catch (e) {
      failed.push({ file: path.basename(c.to), error: String(e && e.message ? e.message : e) });
    }
  }
  return { written, copied, failed };
}

async function listDir(dir) {
  try {
    return await fsp.readdir(dir);
  } catch {
    return [];
  }
}

// --- IPC ---------------------------------------------------------------------------------------

function registerLibrary(getWindow) {
  ipcMain.on('library:load', (e) => {
    e.returnValue = loadLibrarySync();
  });
  ipcMain.handle('library:save', (_e, saved) => saveLibrary(saved));
  ipcMain.handle('library:pickFolder', async () => {
    const win = getWindow();
    const r = await dialog.showOpenDialog(win ?? undefined, { title: 'Add a music folder', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('library:scan', (_e, folder) => (typeof folder === 'string' ? scanFolder(folder) : []));
  ipcMain.handle('library:describe', (_e, items) => (Array.isArray(items) ? describeAll(items) : []));
  ipcMain.handle('library:analyze', (e, items) => {
    sendTo = e.sender;
    return enqueue(Array.isArray(items) ? items : []);
  });
  ipcMain.handle('library:cancelAnalysis', () => {
    cancelled = true;
    queue = [];
    return true;
  });
  ipcMain.handle('library:waveform', (_e, id) => (typeof id === 'string' ? readWaveform(id) : null));
  ipcMain.handle('library:pickExportFolder', async () => {
    const win = getWindow();
    const r = await dialog.showOpenDialog(win ?? undefined, { title: 'Export to a folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('library:listDir', (_e, dir) => (typeof dir === 'string' ? listDir(dir) : []));
  ipcMain.handle('library:exportWrite', (_e, req) => exportWrite(req ?? {}));
}

module.exports = { registerLibrary, loadLibrarySync, saveLibrary, scanFolder, describe };
