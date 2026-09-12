// Builds the native audio addon (native/node -> native/node/rfx.node) with cargo.
// Needs Rust (https://rustup.rs) and the MSVC "Desktop development with C++" workload, like native/.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const native = path.join(root, 'native');
const isWin = process.platform === 'win32';
const built = path.join(native, 'target', 'release', isWin ? 'rfx_node.dll' : process.platform === 'darwin' ? 'librfx_node.dylib' : 'librfx_node.so');
const out = path.join(native, 'node', 'rfx.node');

// A fresh rustup install puts cargo in ~/.cargo/bin, which a shell opened before the install lacks.
const env = { ...process.env, PATH: `${path.join(homedir(), '.cargo', 'bin')}${path.delimiter}${process.env.PATH ?? ''}` };
const cargo = spawnSync('cargo', ['build', '--release', '-p', 'rfx-node'], { cwd: native, stdio: 'inherit', env });
if (cargo.error || cargo.status !== 0) {
  console.error('\nThe native build failed. Rust (rustup.rs) and the Visual Studio Build Tools with the');
  console.error('"Desktop development with C++" workload are required; see native/README.md.');
  process.exit(cargo.status ?? 1);
}
if (!existsSync(built)) {
  console.error(`Build finished but ${built} is missing.`);
  process.exit(1);
}
mkdirSync(path.dirname(out), { recursive: true });
copyFileSync(built, out);
console.log(`native addon: ${path.relative(root, out)}`);
