import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    clear: () => data.clear(),
  };
}

test('install and visitor ids persist across reads', async () => {
  globalThis.localStorage = memoryStorage();
  const { getInstallId, getVisitorId } = loadTypescript('../app/utils/telemetryIds.ts');

  const install = await getInstallId();
  const visitor = await getVisitorId();

  assert.match(install, /^[0-9a-f-]{36}$/);
  assert.match(visitor, /^[0-9a-f-]{36}$/);
  assert.notEqual(install, visitor);
  assert.equal(await getInstallId(), install);
  assert.equal(await getVisitorId(), visitor);
  assert.equal(globalThis.localStorage.getItem('uku.telemetry.installId.v1'), install);
});
