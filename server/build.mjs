import { build } from 'esbuild';
import { rmSync, existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'fs';
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

// Copy node.exe then inject blob using postject CLI
copyFileSync(process.execPath, exePath);
const postjectBin = join(__dirname, 'node_modules', '.bin', 'postject.cmd');
execSync(
  `"${postjectBin}" "${exePath}" NODE_SEA_BLOB "${seaBlobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  { cwd: __dirname, stdio: 'inherit' }
);
console.log('✅ SEA blob injected into bahar.exe');

// Cleanup temp files
try { rmSync(seaConfigPath); } catch {}
try { rmSync(seaBlobPath);   } catch {}

console.log('\n📦 Done — release/bahar.exe is ready (Node.js SEA).');
