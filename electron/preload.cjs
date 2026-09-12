const { contextBridge, ipcRenderer } = require('electron');

// Tells the renderer it runs in the desktop shell (auto-connect MIDI with SysEx, no permission prompt)
// and hands it the native audio engine, which lives in the main process (electron/audio.cjs).
contextBridge.exposeInMainWorld('rekordfoxHost', {
  isElectron: true,
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  audio: {
    status: () => ipcRenderer.invoke('rfx:status'),
    start: (opts) => ipcRenderer.invoke('rfx:start', opts),
    reopen: (opts) => ipcRenderer.invoke('rfx:reopen', opts),
    stop: () => ipcRenderer.invoke('rfx:stop'),
    devices: () => ipcRenderer.invoke('rfx:devices'),
    /** Commands in, snapshot out: the one IPC round trip per animation frame. */
    frame: (cmds) => ipcRenderer.invoke('rfx:frame', cmds),
    /** Fire-and-forget for transport commands that must not wait for the frame. */
    send: (cmds) => ipcRenderer.send('rfx:cmds', cmds),
    load: (deck, file) => ipcRenderer.invoke('rfx:load', deck, file),
    eject: (deck) => ipcRenderer.invoke('rfx:eject', deck),
    probe: (file) => ipcRenderer.invoke('rfx:probe', file),
    pickFiles: () => ipcRenderer.invoke('rfx:pickFiles'),
  },
});
