// Dev loop for the desktop shell: Vite (hot reload) + Electron pointed at it.
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';
const url = 'http://localhost:5173';

const vite = spawn(npx, ['vite', '--port', '5173', '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'], shell: isWin });
let electron = null;
vite.stdout.on('data', (buf) => {
  process.stdout.write(buf);
  if (!electron && String(buf).includes('localhost:5173')) {
    electron = spawn(npx, ['electron', '.'], { stdio: 'inherit', shell: isWin, env: { ...process.env, REKORDFOX_DEV_URL: url } });
    electron.on('exit', () => {
      vite.kill();
      process.exit(0);
    });
  }
});
vite.on('exit', (code) => process.exit(code ?? 0));
