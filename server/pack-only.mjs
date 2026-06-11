// Pack-only: skips esbuild, uses existing bundle.js
import { existsSync, copyFileSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seaConfigPath = join(__dirname, 'sea-config.json');
const seaBlobPath   = join(__dirname, 'sea-prep.blob');
const exePath       = join(__dirname, 'release', 'bahar.exe');
const postjectBin   = join(__dirname, 'node_modules', '.bin', 'postject.cmd');

if (!existsSync(join(__dirname, 'bundle.js'))) {
  console.error('bundle.js not found. Run full build first.');
  process.exit(1);
}

writeFileSync(seaConfigPath, JSON.stringify({ main: 'bundle.js', output: 'sea-prep.blob', disableExperimentalSEAWarning: true }, null, 2));

console.log('Generating SEA blob...');
execSync('node --experimental-sea-config sea-config.json', { cwd: __dirname, stdio: 'inherit' });
console.log('SEA blob generated');

copyFileSync(process.execPath, exePath);
console.log('node.exe copied');

console.log('Injecting blob...');
execSync(`"${postjectBin}" "${exePath}" NODE_SEA_BLOB "${seaBlobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, { cwd: __dirname, stdio: 'inherit' });
console.log('Done - release/bahar.exe is ready.');

try { rmSync(seaConfigPath); } catch {}
try { rmSync(seaBlobPath);   } catch {}
