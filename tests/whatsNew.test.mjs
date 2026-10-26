import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { RELEASE_NOTES } = loadTypescript('../app/data/releaseNotes.ts');
const { WHATS_NEW_SEEN_KEY, hasUnseenNotes, markNotesSeen } = loadTypescript('../app/utils/whatsNew.ts');

function installStorage(value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value });
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  };
}

test('release notes are newest first and complete in both locales', () => {
  assert.ok(RELEASE_NOTES.length > 0);
  const versions = RELEASE_NOTES.map(note => note.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => b.localeCompare(a, 'en', { numeric: true })));
  for (const note of RELEASE_NOTES) {
    assert.match(note.version, /^\d+\.\d+\.\d+$/);
    assert.match(note.date, /^\d{4}-\d{2}-\d{2}$/);
    for (const locale of ['zh-CN', 'en']) {
      assert.ok(Array.isArray(note.items[locale]) && note.items[locale].length > 0, `${note.version} ${locale} bullets`);
      for (const item of note.items[locale]) assert.ok(item.trim().length > 0, `${note.version} ${locale} bullet is empty`);
    }
  }
});

test('the dot appears until the newest version has been opened', () => {
  const records = new Map();
  const restore = installStorage({ getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) });
  try {
    assert.equal(hasUnseenNotes('1.6.0'), true, 'nothing stored yet');
    markNotesSeen('1.6.0');
    assert.equal(records.get(WHATS_NEW_SEEN_KEY), '1.6.0');
    assert.equal(hasUnseenNotes('1.6.0'), false);
    assert.equal(hasUnseenNotes('1.6.1'), true, 'a newer release brings the dot back');
    assert.equal(hasUnseenNotes(''), false, 'no version to compare against');
  } finally {
    restore();
  }
});

test('storage failures only lose the dot, never throw', () => {
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const restore = installStorage(throwing);
  try {
    assert.equal(hasUnseenNotes('1.6.0'), false, 'unreadable storage reads as seen');
    assert.doesNotThrow(() => markNotesSeen('1.6.0'));
  } finally {
    restore();
  }
});
