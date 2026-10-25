// Builds the static web bundle (`out/`) that the desktop runner, the native shells and the
// website serve. Cross-platform on purpose: the Windows exe build runs it too.
//
// The Pixiv API route needs a Node server, which a static export cannot contain, so it is
// moved out of the way for the duration of the build and always restored.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(root, 'app', 'api');
const outDir = join(root, 'out');
const nextBin = createRequire(join(root, 'package.json')).resolve('next/dist/bin/next');

// Copy + delete instead of rename: the temp dir is often on another filesystem (EXDEV).
let backupDir = null;
function restoreApiRoutes() {
  if (backupDir && existsSync(join(backupDir, 'api')) && !existsSync(apiDir)) {
    cpSync(join(backupDir, 'api'), apiDir, { recursive: true });
    rmSync(backupDir, { recursive: true, force: true });
  }
  backupDir = null;
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { restoreApiRoutes(); process.exit(1); });
}

let status = 1;
try {
  rmSync(outDir, { recursive: true, force: true });
  spawnSync(process.execPath, [join(root, 'scripts', 'vendor-assets.mjs')], { cwd: root, stdio: 'inherit' });
  if (existsSync(apiDir)) {
    backupDir = mkdtempSync(join(tmpdir(), 'uku-web-api-backup-'));
    cpSync(apiDir, join(backupDir, 'api'), { recursive: true });
    rmSync(apiDir, { recursive: true, force: true });
  }
  status = spawnSync(process.execPath, [nextBin, 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NEXT_EXPORT: 'true' },
  }).status ?? 1;
} finally {
  restoreApiRoutes();
}

if (status !== 0) process.exit(status);
if (!existsSync(join(outDir, 'index.html'))) {
  console.error('ERROR: static export out/index.html was not generated.');
  process.exit(1);
}
console.log('==> Static bundle ready in out/');
