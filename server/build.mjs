import { build } from 'esbuild';
import { cpSync, rmSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1) Bundle server code into a single JS file
await build({
  entryPoints: ['src/server.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'bundle.js',
  external: ['fsevents'],
  format: 'cjs',
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});
console.log('✅ Bundle created: bundle.js');

// 2) Copy client dist into release/dist so the exe finds it at runtime
//    Check ../client/dist first (monorepo layout), then server/dist as fallback
const clientDist = join(__dirname, '..', 'client', 'dist');
const serverDist = join(__dirname, 'dist');
const srcDist    = existsSync(join(clientDist, 'index.html')) ? clientDist
                 : existsSync(join(serverDist, 'index.html')) ? serverDist
                 : null;
const releaseDir = join(__dirname, 'release');
const destDist   = join(releaseDir, 'dist');

if (!existsSync(releaseDir)) mkdirSync(releaseDir, { recursive: true });

if (srcDist) {
  if (existsSync(destDist)) rmSync(destDist, { recursive: true, force: true });
  cpSync(srcDist, destDist, { recursive: true });
  console.log(`✅ dist copied from ${srcDist} → release/dist`);
} else {
  console.warn('⚠️  No client dist folder found — run: cd ../client && npm run build');
}

// 3) Copy .env to release/ so the exe finds it at runtime
const envSrc  = join(__dirname, '.env');
const envDest = join(releaseDir, '.env');
if (existsSync(envSrc)) {
  copyFileSync(envSrc, envDest);
  console.log('✅ .env copied to release/.env');
} else {
  console.warn('⚠️  No .env file found — create one in server/.env before running the exe');
}
