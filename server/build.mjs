import { build } from 'esbuild';
import { cpSync, rmSync, existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, extname, relative } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 1. Find client dist ──────────────────────────────────────────────────────
const clientDist = join(__dirname, '..', 'client', 'dist');
const serverDist = join(__dirname, 'dist');
const srcDist = existsSync(join(clientDist, 'index.html')) ? clientDist
              : existsSync(join(serverDist, 'index.html')) ? serverDist
              : null;

if (!srcDist) {
  console.error('❌ No client dist found. Run: cd ../client && npm run build');
  process.exit(1);
}

// ── 2. Generate inlinedDist.generated.js (dist files as base64 in JS code) ──
function getMime(ext) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico':  'image/x-icon',
    '.json': 'application/json',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.eot':  'application/vnd.ms-fontobject',
  })[ext] || 'application/octet-stream';
}

function collectFiles(dir, base, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(abs, base, out);
    else out.push({ rel: relative(base, abs).replace(/\\/g, '/'), abs });
  }
  return out;
}

const files = collectFiles(srcDist, srcDist);
const entries = files.map(({ rel, abs }) => {
  const b64  = readFileSync(abs).toString('base64');
  const mime = getMime(extname(rel).toLowerCase());
  return `  ${JSON.stringify(rel)}: [${JSON.stringify(b64)}, ${JSON.stringify(mime)}]`;
});

const generated = `// AUTO-GENERATED — do not edit. Rebuild with: npm run build\n'use strict';\nmodule.exports = {\n${entries.join(',\n')}\n};\n`;
writeFileSync(join(__dirname, 'src', 'inlinedDist.generated.js'), generated);
console.log(`✅ inlinedDist.generated.js (${files.length} files, ${(Buffer.byteLength(generated)/1024).toFixed(0)} KB)`);

// ── 3. Bundle server (now includes the inlined dist module) ──────────────────
await build({
  entryPoints: ['src/server.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'bundle.js',
  external: ['fsevents'],
  format: 'cjs',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
});
console.log('✅ Bundle created: bundle.js');

// ── 4. Ensure release folder ─────────────────────────────────────────────────
const releaseDir = join(__dirname, 'release');
if (!existsSync(releaseDir)) mkdirSync(releaseDir, { recursive: true });

// Copy .env as optional config override (exe works without it)
const envSrc = join(__dirname, '.env');
if (existsSync(envSrc)) {
  copyFileSync(envSrc, join(releaseDir, '.env'));
  console.log('✅ .env copied to release/.env');
}

console.log('\n📦 Bundle ready — starting SEA packaging...\n');

// ── 5. Create EXE via Node.js SEA ────────────────────────────────────────────
const seaConfigPath = join(__dirname, 'sea-config.json');
const seaBlobPath   = join(__dirname, 'sea-prep.blob');
const exePath       = join(releaseDir, 'bahar.exe');

// Write SEA config
writeFileSync(seaConfigPath, JSON.stringify({
  main: 'bundle.js',
  output: 'sea-prep.blob',
  disableExperimentalSEAWarning: true,
}, null, 2));

// Generate blob
execSync('node --experimental-sea-config sea-config.json', { cwd: __dirname, stdio: 'inherit' });
console.log('✅ SEA blob generated');

// Inject blob into a copy of node.exe using resedit (pure JS, no WASM/signtool needed)
const { NtExecutable, NtExecutableResource } = require('resedit');
const exeData = readFileSync(process.execPath);
const exe = NtExecutable.from(exeData, { ignoreCert: true });
const res = NtExecutableResource.from(exe);

const blob = readFileSync(seaBlobPath);
const blobBuf = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
res.entries.push({ type: 10, id: 'NODE_SEA_BLOB', lang: 1033, bin: blobBuf });
res.outputResource(exe);

const outData = exe.generate({ ignoreCert: true });
const exeBuf = Buffer.from(outData);

// Flip the sentinel fuse: Node.js reads this byte at startup to decide
// whether to enter SEA mode. postject normally does this; we must do it
// manually since we replaced postject with resedit.
const FUSE_OFF = Buffer.from('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0');
const fuseIdx = exeBuf.indexOf(FUSE_OFF);
if (fuseIdx === -1) throw new Error('❌ SEA sentinel fuse not found — is process.execPath really a Node.js binary?');
exeBuf[fuseIdx + FUSE_OFF.length - 1] = 0x31; // '0' → '1'  (enable SEA)
console.log(`✅ SEA sentinel fuse flipped at 0x${fuseIdx.toString(16)}`);

writeFileSync(exePath, exeBuf);
console.log('✅ SEA blob injected into bahar.exe');

// Cleanup temp files
try { rmSync(seaConfigPath); } catch {}
try { rmSync(seaBlobPath);   } catch {}

console.log('\n📦 Done — release/bahar.exe is ready (Node.js SEA).');
