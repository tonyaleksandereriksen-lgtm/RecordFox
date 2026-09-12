// Runs the native checks (DSP, device shim, engine, analysis) with cargo, finding cargo in
// ~/.cargo/bin when the shell was opened before Rust was installed. Used by `npm run check`.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const native = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'native');
const env = { ...process.env, PATH: `${path.join(homedir(), '.cargo', 'bin')}${path.delimiter}${process.env.PATH ?? ''}` };
const r = spawnSync('cargo', ['run', '--release', '--bin', 'rfx-tests'], { cwd: native, stdio: 'inherit', env });
process.exit(r.error ? 1 : (r.status ?? 1));
