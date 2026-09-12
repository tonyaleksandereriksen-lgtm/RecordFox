const { contextBridge } = require('electron');

// Tells the renderer it runs in the desktop shell (auto-connect MIDI with SysEx, no permission prompt).
contextBridge.exposeInMainWorld('rekordfoxHost', {
  isElectron: true,
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
});
