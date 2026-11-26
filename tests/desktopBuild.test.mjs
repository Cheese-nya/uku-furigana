import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = relativePath => readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
const scripts = JSON.parse(read('package.json')).scripts;

test('the exe is packaged from the static export, never from a bare `next build`', () => {
  // A plain `next build` emits a server build without out/, and PyInstaller then fails on --add-data "out;out".
  assert.match(scripts['package:exe'], /^node scripts\/build-web\.mjs && /);
  assert.doesNotMatch(scripts['package:exe'], /next build/);
  assert.equal(scripts['build:web'], 'node scripts/build-web.mjs');
});

test('the static export sets NEXT_EXPORT and always restores the Pixiv API route', () => {
  const source = read('scripts/build-web.mjs');
  assert.match(source, /NEXT_EXPORT:\s*'true'/);
  assert.match(source, /finally\s*{\s*restoreApiRoutes\(\)/);
  // Rename cannot cross filesystems (EXDEV on /tmp); the backup must be copied.
  assert.doesNotMatch(source, /renameSync/);
});

test('desktop build dependencies are pinned', () => {
  const requirements = read('requirements-desktop.txt').split('\n').filter(Boolean);
  assert.deepEqual(requirements.map(line => line.split('==')[0]).sort(), ['pyinstaller', 'pywebview']);
  for (const line of requirements) assert.match(line, /^[a-z]+==\d+\.\d+\.\d+$/, line);
});

test('the macOS build packages arm64 and x86_64 DMGs from the static export', () => {
  assert.equal(scripts['package:macos'], 'bash scripts/build-macos.sh');
  const script = read('scripts/build-macos.sh');
  assert.match(script, /node scripts\/build-web\.mjs/);
  assert.match(script, /--onedir/);
  assert.match(script, /--windowed/);
  assert.match(script, /--add-data "out:out"/);
  assert.match(script, /codesign --force --deep --sign -/);
  assert.match(script, /hdiutil create/);

  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /arch:\s*arm64/);
  assert.match(workflow, /arch:\s*x86_64/);
  assert.match(workflow, /Uku-Furigana-v\$\{VERSION\}-macos-arm64\.dmg/);
  assert.match(workflow, /Uku-Furigana-v\$\{VERSION\}-macos-x86_64\.dmg/);
});
