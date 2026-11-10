import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';
const {
  saveBlob, isMobileSharePreferred, pickBatchDirectory, saveBlobToDirectory, buildBatchZipBlob, buildBatchSaveOutput,
} = loadTypescript('../app/utils/fileSave.ts');
import JSZip from 'jszip';
const originalWindow = globalThis.window;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalReader = globalThis.FileReader;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalCreateObjectURL = globalThis.URL?.createObjectURL;
const originalRevokeObjectURL = globalThis.URL?.revokeObjectURL;
const originalSetTimeout = globalThis.setTimeout;
let revokeDelays = [];
let activeTimers = new Set();
afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete globalThis.document;
  if (originalReader === undefined) delete globalThis.FileReader;
  else globalThis.FileReader = originalReader;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  if (originalCreateObjectURL) globalThis.URL.createObjectURL = originalCreateObjectURL;
  if (originalRevokeObjectURL) globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
  globalThis.setTimeout = originalSetTimeout;
  for (const timer of activeTimers) timer.unref?.();
  activeTimers = new Set();
  revokeDelays = [];
});

function installDirectDownload() {
  let anchorClicked = false;
  const element = { href: '', download: '', style: {}, click: () => { anchorClicked = true; }, remove: () => {} };
  globalThis.document = { createElement: () => element, body: { appendChild: () => {} } };
  globalThis.URL.createObjectURL = () => 'blob:direct';
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.setTimeout = (fn, delay) => {
    revokeDelays.push(delay);
    // Do not keep Node's test runner alive for a real browser-scale revoke delay.
    const timer = originalSetTimeout(fn, delay);
    timer.unref?.();
    activeTimers.add(timer);
    return timer;
  };
  return { element, wasClicked: () => anchorClicked };
}

function nativeSave(result) {
  globalThis.FileReader = class {
    readAsDataURL() { this.result = 'data:text/plain;base64,44GC'; this.onload(); }
  };
  globalThis.window = { pywebview: { api: { save_file: async () => result } },
    showSaveFilePicker: () => assert.fail('must not fall through to another save method') };
}

test('native cancellation remains cancellation; write failures are reported', async () => {
  nativeSave({ success: false, error: 'Cancelled' });
  assert.deepEqual(await saveBlob(new Blob(['あ']), '台本.txt'), { success: false });
  nativeSave({ success: false, error: 'Disk full' });
  await assert.rejects(saveBlob(new Blob(['あ']), '台本.txt'), /Disk full/);
  nativeSave({ success: true, path: '台本.txt' });
  assert.deepEqual(await saveBlob(new Blob(['あ']), '台本.txt'), { success: true, path: '台本.txt' });
});

test('browser picker cancellation differs from a failed write', async () => {
  globalThis.window = { showSaveFilePicker: async () => { throw new DOMException('cancel', 'AbortError'); } };
  assert.deepEqual(await saveBlob(new Blob(), '台本.txt'), { success: false });
  globalThis.window = { showSaveFilePicker: async () => ({ createWritable: async () => ({
    write: async () => { throw new Error('Permission denied'); }, close: async () => {},
  }) }) };
  await assert.rejects(saveBlob(new Blob(), '台本.txt'), /Permission denied/);
});

test('browser save only completes after closing the file', async () => {
  const operations = [];
  const blob = new Blob(['あ']);
  globalThis.window = { showSaveFilePicker: async () => ({ name: '台本.txt', createWritable: async () => ({
    write: async value => { assert.equal(value, blob); operations.push('write'); },
    close: async () => { operations.push('close'); },
  }) }) };
  assert.deepEqual(await saveBlob(blob, '台本.txt'), { success: true, path: '台本.txt' });
  assert.deepEqual(operations, ['write', 'close']);
});

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Node exposes `navigator` as a getter-only global; swap it via defineProperty.
function installNavigator(nav) {
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
}

function mobileShareWindow(shareImpl, canShareImpl = () => true) {
  const nav = {
    userAgent: ANDROID_UA,
    share: shareImpl,
    canShare: canShareImpl,
  };
  installNavigator(nav);
  return { navigator: nav };
}

test('mobile share sheet succeeds like any other save target', async () => {
  const blob = new Blob(['台本']);
  const shares = [];
  globalThis.window = mobileShareWindow(async data => { shares.push(data); });
  assert.equal(isMobileSharePreferred(globalThis.window), true);
  assert.deepEqual(await saveBlob(blob, '台本.txt'), { success: true, path: '台本.txt' });
  assert.equal(shares.length, 1);
  assert.equal(shares[0].title, '台本.txt');
  assert.equal(shares[0].files.length, 1);
  assert.ok(shares[0].files[0] instanceof File);
});

test('mobile share sheet cancellation remains cancellation', async () => {
  globalThis.window = mobileShareWindow(async () => { throw new DOMException('cancel', 'AbortError'); });
  assert.deepEqual(await saveBlob(new Blob(['あ']), '台本.txt'), { success: false });
});

test('mobile share failures fall back to a direct download', async () => {
  const download = installDirectDownload();
  globalThis.window = mobileShareWindow(async () => { throw new Error('Not allowed to share'); });
  const result = await saveBlob(new Blob(['あ']), '台本.epub');
  assert.equal(download.wasClicked(), true);
  assert.equal(download.element.download, '台本.epub');
  assert.deepEqual(result, { success: true, path: '台本.epub', downloadStarted: true });
  assert.deepEqual(revokeDelays, [60_000]);
});

test('share cancellation stays cancellation and skipShare bypasses the share sheet', async () => {
  globalThis.window = mobileShareWindow(async () => { throw new DOMException('cancel', 'AbortError'); });
  assert.deepEqual(await saveBlob(new Blob(['あ']), '台本.txt'), { success: false });

  const download = installDirectDownload();
  let shared = false;
  globalThis.window = mobileShareWindow(async () => { shared = true; });
  assert.deepEqual(await saveBlob(new Blob(['あ']), '台本.epub', { skipShare: true }),
    { success: true, path: '台本.epub', downloadStarted: true });
  assert.equal(shared, false);
  assert.equal(download.element.download, '台本.epub');
});

test('desktop without a picker prefers direct download over the share sheet', async () => {
  globalThis.window = {
    navigator: { userAgent: DESKTOP_UA, share: async () => assert.fail('desktop must not use the share sheet'), canShare: () => true },
  };
  assert.equal(isMobileSharePreferred(globalThis.window), false);
});

test('an unshareable file type falls back to direct download', async () => {
  let anchorClicked = false;
  const element = { href: '', download: '', style: {}, click: () => { anchorClicked = true; }, remove: () => {} };
  globalThis.window = mobileShareWindow(async () => assert.fail('share must not be called'), () => false);
  globalThis.document = { createElement: () => element, body: { appendChild: () => {} }, }; // weightless anchor scaffold
  globalThis.URL.createObjectURL = () => 'blob:fake';
  globalThis.URL.revokeObjectURL = () => {};
  const result = await saveBlob(new Blob(['あ']), '台本.txt');
  delete globalThis.document;
  assert.equal(anchorClicked, true);
  assert.deepEqual(result, { success: true, path: '台本.txt', downloadStarted: true });
});

test('coarse pointer devices lean toward the share sheet even without a mobile UA', async () => {
  const nav = { userAgent: DESKTOP_UA, share: async () => {}, canShare: () => true };
  globalThis.window = { navigator: nav, matchMedia: query => ({ matches: query === '(pointer: coarse)' }) };
  installNavigator(nav);
  assert.equal(isMobileSharePreferred(globalThis.window), true);
});

test('skipFilePicker bypasses showSaveFilePicker and uses a direct download', async () => {
  const download = installDirectDownload();
  globalThis.window = {
    showSaveFilePicker: async () => { throw new Error('picker must be skipped'); },
  };
  const result = await saveBlob(new Blob(['あ']), '台本.txt', { skipFilePicker: true });
  assert.equal(download.wasClicked(), true);
  assert.equal(download.element.download, '台本.txt');
  assert.deepEqual(result, { success: true, path: '台本.txt', downloadStarted: true });
});

test('native save still runs when skipFilePicker is set', async () => {
  nativeSave({ success: true, path: 'native.txt' });
  assert.deepEqual(await saveBlob(new Blob(['あ']), '台本.txt', { skipFilePicker: true }), { success: true, path: 'native.txt' });
});

test('pickBatchDirectory uses readwrite mode and propagates cancellation', async () => {
  const calls = [];
  globalThis.window = {
    showDirectoryPicker: async options => { calls.push(options); return { kind: 'directory' }; },
  };
  assert.deepEqual(await pickBatchDirectory(), { kind: 'directory' });
  assert.deepEqual(calls, [{ mode: 'readwrite' }]);

  globalThis.window = {
    showDirectoryPicker: async () => { throw new DOMException('cancel', 'AbortError'); },
  };
  await assert.rejects(pickBatchDirectory(), error => error.name === 'AbortError');

  globalThis.window = {};
  assert.equal(await pickBatchDirectory(), null);
});

test('saveBlobToDirectory writes through the chosen directory handle', async () => {
  const operations = [];
  const blob = new Blob(['台本']);
  const dirHandle = {
    getFileHandle: async (name, options) => {
      operations.push(['handle', name, options]);
      return { createWritable: async () => ({
        write: async value => { assert.equal(value, blob); operations.push('write'); },
        close: async () => { operations.push('close'); },
      }) };
    },
  };
  await saveBlobToDirectory(dirHandle, '放課後/台本.txt', blob);
  assert.deepEqual(operations, [['handle', '放課後_台本.txt', { create: true }], 'write', 'close']);
});

test('buildBatchZipBlob bundles files and disambiguates duplicate names', async () => {
  const zipBlob = await buildBatchZipBlob([
    { filename: '放課後.txt', blob: new Blob(['一']) },
    { filename: '放課後.txt', blob: new Blob(['二']) },
    { filename: 'notes.srt', blob: new Blob(['三']) },
    { filename: '放課後.txt', blob: new Blob(['四']) },
  ]);
  const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, ['notes.srt', '放課後 (2).txt', '放課後 (3).txt', '放課後.txt']);
  assert.equal(await zip.file('放課後.txt').async('string'), '一');
  assert.equal(await zip.file('放課後 (2).txt').async('string'), '二');
  assert.equal(await zip.file('放課後 (3).txt').async('string'), '四');
});

test('buildBatchSaveOutput saves one EPUB as itself and keeps multiple outputs in a ZIP', async () => {
  const epub = new Blob(['epub'], { type: 'application/epub+zip' });
  const single = await buildBatchSaveOutput([{ filename: '号哭.epub', blob: epub }]);
  assert.equal(single.filename, '号哭.epub');
  assert.equal(single.blob, epub);

  const multiple = await buildBatchSaveOutput([
    { filename: '号哭.epub', blob: epub },
    { filename: '続き.epub', blob: new Blob(['second']) },
  ]);
  assert.equal(multiple.filename, '台本批量导出.zip');
  const zip = await JSZip.loadAsync(await multiple.blob.arrayBuffer());
  assert.deepEqual(Object.keys(zip.files).sort(), ['号哭.epub', '続き.epub'].sort());
});
