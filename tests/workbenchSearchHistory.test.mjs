import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { emptyDatabase, learnReading, migrateDatabase, resolveScript } = loadTypescript('../app/utils/correctionDatabase.ts');
const { applyRubyOverrides, upsertRubyOverride } = loadTypescript('../app/utils/rubyOverrides.ts');
const {
  applyCorrectionOperation, materializeLegacyOverrides, occurrenceStart, READING_HISTORY_LIMIT,
  revertHistoryEntry,
} = loadTypescript('../app/utils/readingHistory.ts');
const { searchWorkbench, nextSearchHit } = loadTypescript('../app/utils/workbenchSearch.ts');

const scriptLine = (id, cleanText, tokens) => ({
  id: String(id),
  rawText: cleanText,
  cleanText,
  tokens: tokens.map(token => ({ hasKanji: /[一-鿿]/.test(token.surface), ...token })),
});
const entry = (line, start, surface, reading, occurrence) => ({
  line, start, surface, reading, type: 'hiragana',
  ...(occurrence === undefined ? {} : { lineOccurrence: occurrence }),
});
const readingAt = line => line.tokens.map(({ surface, ruby }) => [surface, ruby]);
async function newScript(text, id = 'script:a') {
  const resolved = resolveScript(emptyDatabase(), '测试', text, `sha256:${'a'.repeat(64)}`, id);
  return { database: resolved.database, id: resolved.scriptId };
}

test('occurrence-scoped overrides apply to one identical line only', () => {
  const line = scriptLine(0, '人は人', [{ surface: '人' }, { surface: 'は' }, { surface: '人' }]);
  const legacy = entry('人は人', 0, '人', 'ひと');
  const second = entry('人は人', 2, '人', 'じん', 1);
  assert.deepEqual(readingAt(applyRubyOverrides(line, [legacy, second], 'hiragana', 'manual', 0)), [['人', 'ひと'], ['は', undefined], ['人', undefined]]);
  assert.deepEqual(readingAt(applyRubyOverrides(line, [legacy, second], 'hiragana', 'manual', 1)), [['人', 'ひと'], ['は', undefined], ['人', 'じん']]);
});

test('an occurrence-specific upsert leaves legacy and other occurrences untouched', () => {
  const legacy = entry('同じ', 0, '同', 'おな');
  const other = entry('同じ', 0, '同', 'どう', 1);
  const first = entry('同じ', 0, '同', 'おなじ', 0);
  const stored = upsertRubyOverride([legacy, other], first);
  assert.deepEqual(stored, [legacy, other, first]);
});

test('materializing old line-wide entries preserves the visible reading on every duplicate', () => {
  const text = '同じ\n違う\n同じ';
  const legacy = entry('同じ', 0, '同', 'おな');
  const migrated = materializeLegacyOverrides([legacy], text, ['同じ']);
  assert.equal(migrated.length, 2);
  assert.deepEqual(migrated.map(value => value.lineOccurrence), [0, 1]);
  const line = scriptLine(2, '同じ', [{ surface: '同' }, { surface: 'じ' }]);
  assert.deepEqual(readingAt(applyRubyOverrides(line, migrated, 'hiragana', 'manual', 1)), [['同', 'おな'], ['じ', undefined]]);
});

test('one bulk correction is one history entry and edits each duplicate occurrence separately', async () => {
  const text = '人は人\n人は人';
  const script = await newScript(text);
  const result = applyCorrectionOperation(script.database, script.id, text, [
    { line: text.split('\n')[0], lineOccurrence: 0, start: 0, surface: '人', reading: 'じん', type: 'hiragana' },
    { line: text.split('\n')[0], lineOccurrence: 1, start: 0, surface: '人', reading: 'じん', type: 'hiragana' },
  ], 'bulk-edit', { totalMatches: 4, skippedManual: 0 }, 100);
  assert.ok(result.entry);
  assert.equal(result.entry.kind, 'bulk-edit');
  assert.equal(result.entry.changes.length, 2);
  assert.equal(result.entry.totalMatches, 4);
  assert.equal(result.database.scripts[script.id].history.length, 1);
  assert.deepEqual(result.database.scripts[script.id].overrides.map(value => [value.lineOccurrence, value.start, value.reading]),
    [[0, 0, 'じん'], [1, 0, 'じん']]);
});

test('reverting skips a target that changed after the original operation', async () => {
  const text = '人';
  let script = await newScript(text);
  const first = applyCorrectionOperation(script.database, script.id, text, [
    { line: '人', lineOccurrence: 0, start: 0, surface: '人', reading: 'じん', type: 'hiragana' },
  ], 'edit', {}, 100);
  script = { database: first.database, id: script.id };
  const second = applyCorrectionOperation(script.database, script.id, text, [
    { line: '人', lineOccurrence: 0, start: 0, surface: '人', reading: 'ひと', type: 'hiragana' },
  ], 'edit', {}, 200);
  const reverted = revertHistoryEntry(second.database, script.id, text, first.entry.id);
  assert.equal(reverted.applied, 0);
  assert.equal(reverted.skipped, 1);
  assert.equal(reverted.database.scripts[script.id].overrides[0].reading, 'ひと');
  const latest = revertHistoryEntry(second.database, script.id, text, second.entry.id);
  assert.equal(latest.applied, 1);
  assert.equal(latest.database.scripts[script.id].overrides[0].reading, 'じん');
  const redone = revertHistoryEntry(latest.database, script.id, text, latest.entry.id);
  assert.equal(redone.applied, 1);
  assert.equal(redone.entry.kind, 'redo');
  assert.equal(redone.database.scripts[script.id].overrides[0].reading, 'ひと');
});

test('restore removes the manual override and its learned reading; undo brings both back', async () => {
  const text = '人';
  const state = await newScript(text);
  const learned = { surface: '人', reading: 'ひと', alternatives: [], type: 'hiragana', before: '', after: '', createdAt: 1 };
  let database = learnReading(state.database, state.id, learned);
  const edit = applyCorrectionOperation(database, state.id, text, [
    { line: '人', lineOccurrence: 0, start: 0, surface: '人', reading: 'じん', type: 'hiragana' },
  ], 'edit', {}, 100);
  database = edit.database;
  assert.equal(database.scripts[state.id].learned.length, 1);
  const restore = applyCorrectionOperation(database, state.id, text, [
    { line: '人', lineOccurrence: 0, start: 0, surface: '人', reading: null, type: 'hiragana', removeLearned: true },
  ], 'restore', {}, 200);
  assert.equal(restore.entry.changes[0].learnedBefore.length, 1);
  assert.deepEqual(restore.database.scripts[state.id].overrides, []);
  assert.deepEqual(restore.database.scripts[state.id].learned, []);

  const reverted = revertHistoryEntry(restore.database, state.id, text, restore.entry.id);
  assert.equal(reverted.applied, 1);
  assert.deepEqual(reverted.database.scripts[state.id].overrides.map(value => value.reading), ['じん']);
  assert.deepEqual(reverted.database.scripts[state.id].learned.map(value => value.reading), ['ひと']);
});

test('reverting a bulk operation applies clean targets and skips targets edited later', async () => {
  const text = '人\n人';
  const state = await newScript(text);
  const bulk = applyCorrectionOperation(state.database, state.id, text, [
    { line: '人', lineOccurrence: 0, start: 0, surface: '人', reading: 'じん', type: 'hiragana' },
    { line: '人', lineOccurrence: 1, start: 0, surface: '人', reading: 'じん', type: 'hiragana' },
  ], 'bulk-edit', {}, 100);
  const later = applyCorrectionOperation(bulk.database, state.id, text, [
    { line: '人', lineOccurrence: 1, start: 0, surface: '人', reading: 'ひと', type: 'hiragana' },
  ], 'edit', {}, 200);
  const reverted = revertHistoryEntry(later.database, state.id, text, bulk.entry.id);
  assert.equal(reverted.applied, 1);
  assert.equal(reverted.skipped, 1);
  assert.deepEqual(reverted.database.scripts[state.id].overrides.map(value => [value.lineOccurrence, value.reading]), [[1, 'ひと']]);
});

test('history is persisted by strict migration and capped at 500 operations', async () => {
  const text = '人';
  let state = await newScript(text);
  let database = state.database;
  for (let index = 0; index < READING_HISTORY_LIMIT + 3; index++) {
    const result = applyCorrectionOperation(database, state.id, text, [
      { line: '人', lineOccurrence: 0, start: 0, surface: '人', reading: index % 2 ? 'じん' : 'ひと', type: 'hiragana' },
    ], 'edit', {}, 1000 + index);
    database = result.database;
  }
  const history = database.scripts[state.id].history;
  assert.equal(history.length, READING_HISTORY_LIMIT);
  assert.equal(history.at(-1).createdAt, 1000 + READING_HISTORY_LIMIT + 2);
  assert.deepEqual(migrateDatabase(database), database);
});

test('search finds literal matches inside a longer token and navigates across lines', () => {
  const lines = [
    scriptLine(0, '人生と人', [{ surface: '人生' }, { surface: 'と' }, { surface: '人' }]),
    scriptLine(1, '人人', [{ surface: '人' }, { surface: '人' }]),
  ];
  const hits = searchWorkbench(lines, '人', 'text');
  assert.equal(hits.length, 4);
  assert.deepEqual(hits.map(hit => [hit.lineIndex, hit.start, hit.end, hit.insideLongerToken]),
    [[0, 0, 1, true], [0, 3, 4, false], [1, 0, 1, false], [1, 1, 2, false]]);
  assert.equal(nextSearchHit(hits, hits[0].id, 1), 1);
  assert.equal(nextSearchHit(hits, hits[0].id, -1), hits.length - 1);
});

test('reading search treats hiragana and katakana as equal', () => {
  const lines = [
    scriptLine(0, '人と人生', [{ surface: '人', ruby: 'ひと' }, { surface: 'と' }, { surface: '人生', ruby: 'じんせい' }]),
  ];
  assert.equal(searchWorkbench(lines, 'ひと', 'reading').length, 1);
  assert.equal(searchWorkbench(lines, 'ヒト', 'reading').length, 1);
  assert.equal(searchWorkbench(lines, 'ジンセイ', 'reading')[0].surface, '人生');
});

test('literal search preserves fullwidth and compatibility characters', () => {
  const line = scriptLine(0, 'Ａ①㍿', [{ surface: 'Ａ①㍿' }]);
  for (const query of ['Ａ', '①', '㍿']) {
    assert.equal(searchWorkbench([line], query, 'text')[0].surface, query);
  }
});

test('undo never restores a larger override over a newer neighboring edit', async () => {
  const { database, id } = await newScript('人生');
  const edit = (db, start, surface, reading) => applyCorrectionOperation(db, id, '人生', [
    { line: '人生', lineOccurrence: 0, start, surface, reading, type: 'hiragana' },
  ], 'edit');
  const whole = edit(database, 0, '人生', 'じんせい');
  const first = edit(whole.database, 0, '人', 'ひと');
  const neighbor = edit(first.database, 1, '生', 'せい');
  const undone = revertHistoryEntry(neighbor.database, id, '人生', first.entry.id);
  assert.equal(undone.applied, 0);
  assert.equal(undone.skipped, 1);
  assert.deepEqual(undone.database, neighbor.database);
});

test('overlapping literal bulk writes undo in reverse order', async () => {
  const { database, id } = await newScript('人人人');
  const bulk = applyCorrectionOperation(database, id, '人人人', [0, 1].map(start => ({
    line: '人人人', lineOccurrence: 0, start, surface: '人人', reading: 'ひとびと', type: 'hiragana',
  })), 'bulk-edit');
  const undone = revertHistoryEntry(bulk.database, id, '人人人', bulk.entry.id);
  assert.equal(undone.applied, 2);
  assert.deepEqual(undone.database.scripts[id].overrides, []);
  const redone = revertHistoryEntry(undone.database, id, '人人人', undone.entry.id);
  assert.deepEqual(redone.database.scripts[id].overrides, bulk.database.scripts[id].overrides);
});

test('occurrenceStart distinguishes identical lines and rejects an impossible occurrence', () => {
  const lines = ['同じ', '違う', '同じ'];
  assert.equal(occurrenceStart(lines, '同じ', 0), 0);
  assert.equal(occurrenceStart(lines, '同じ', 1), 2);
  assert.equal(occurrenceStart(lines, '同じ', 2), -1);
});
