import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { uniqueId } = loadTypescript('../app/utils/uniqueId.ts');
const { emptyDatabase, resolveScript } = loadTypescript('../app/utils/correctionDatabase.ts');

test('old WebViews create UUIDs and new scripts without randomUUID', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const native = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    getRandomValues: native.getRandomValues.bind(native),
  } });
  try {
    const ids = Array.from({ length: 100 }, uniqueId);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.match(resolveScript(emptyDatabase(), 'new', '人', `sha256:${'a'.repeat(64)}`).scriptId, /^script:/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', original);
  }
});
