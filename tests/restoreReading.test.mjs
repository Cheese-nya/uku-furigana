import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from './loadTypescript.mjs';

// restoreAutomaticReading against the real dictionary (database utility; the UI action was removed with the mockup rebuild).
const { initKuromoji } = loadTypescript('../app/utils/kuromojiEngine.ts');
const { createAnnotator } = loadTypescript('../app/utils/annotationTask.ts');
const { emptyDatabase, fingerprintText, resolveScript, setScriptOverrides, learnReading } = loadTypescript('../app/utils/correctionDatabase.ts');
const { selectReviewWord, makeLearnedReading } = loadTypescript('../app/utils/review.ts');
const { upsertRubyOverride } = loadTypescript('../app/utils/rubyOverrides.ts');
const { restoreAutomaticReading } = loadTypescript('../app/utils/restoreReading.ts');

const SCRIPT = ['生徒A：このラーメン、辛い？', '生徒B：このラーメン、辛い？', '生徒A：辛い話じゃないよ。'].join('\n');

before(async () => {
  await initKuromoji(fileURLToPath(new URL('../public/dict/', import.meta.url)));
});

async function newScript() {
  const resolved = resolveScript(emptyDatabase(), '台本', SCRIPT, await fingerprintText(SCRIPT), 'script:test');
  return { database: resolved.database, id: resolved.scriptId };
}

async function annotate({ database, id }) {
  const lines = [];
  const script = database.scripts[id];
  await createAnnotator().run({ text: SCRIPT, rubyType: 'hiragana', glossary: [], sourceOverrides: [], overrides: script.overrides, learned: script.learned },
    () => false, chunk => lines.push(...chunk.lines));
  return lines;
}

const offsetOf = (line, index) => line.tokens.slice(0, index).reduce((sum, token) => sum + token.surface.length, 0);
function tokenAt(line, surface) {
  const start = line.cleanText.indexOf(surface);
  const index = line.tokens.findIndex((_, i) => offsetOf(line, i) === start);
  assert.ok(index >= 0, `no token starts at ${surface} in ${line.cleanText}`);
  return index;
}

// openTokenEditor: the editor opens on the whole review word.
function openEditor(line, surface) {
  const selection = selectReviewWord(line, tokenAt(line, surface));
  const tokens = line.tokens.slice(selection.tokenIndex, selection.tokenEndIndex + 1);
  return { line, tokenIndex: selection.tokenIndex, surface: tokens.map(token => token.surface).join('') };
}

// updateTokenRuby: anchored override, plus a learned reading for a non-empty one.
function save(state, editing, reading) {
  const start = offsetOf(editing.line, editing.tokenIndex);
  const entry = { line: editing.line.cleanText, start, surface: editing.surface, reading, type: 'hiragana' };
  let database = setScriptOverrides(state.database, state.id, upsertRubyOverride(state.database.scripts[state.id].overrides, entry));
  if (reading) database = learnReading(database, state.id, makeLearnedReading(selectReviewWord(editing.line, editing.tokenIndex), reading, 'hiragana'));
  return { ...state, database };
}

// restoreAutomaticRuby
function restore(state, editing) {
  const start = offsetOf(editing.line, editing.tokenIndex);
  return { ...state, database: restoreAutomaticReading(state.database, state.id, editing.line.cleanText, start, start + editing.surface.length) };
}

const reading = (line, surface) => {
  const token = line.tokens[tokenAt(line, surface)];
  return [token.ruby || '', token.readingSource || '', Boolean(token.annotationSuppressed)];
};

test('restore removes the correction and the reading it taught, so the automatic reading returns', async () => {
  let state = await newScript();
  const automatic = await annotate(state);
  assert.deepEqual(reading(automatic[0], '辛い'), ['から', 'automatic', false]);

  state = save(state, openEditor(automatic[0], '辛'), 'つらい');
  // Another correction on the same line and an unrelated learned context must survive.
  state = save(state, openEditor(automatic[0], '生徒'), 'せーと');
  state = save(state, openEditor(automatic[2], '話'), 'わ');
  let lines = await annotate(state);
  assert.deepEqual(reading(lines[0], '辛い'), ['つらい', 'manual', false]);
  // The same clause on another line follows the learned reading.
  assert.deepEqual(reading(lines[1], '辛い'), ['つらい', 'learned', false]);

  state = restore(state, openEditor(lines[0], '辛い'));
  const script = state.database.scripts[state.id];
  assert.deepEqual(script.overrides.map(entry => [entry.line, entry.surface, entry.reading]),
    [['生徒A：このラーメン、辛い？', '生徒', 'せーと'], ['生徒A：辛い話じゃないよ。', '話', 'わ']]);
  assert.deepEqual(script.learned.map(entry => [entry.surface, entry.reading]), [['生徒', 'せーと'], ['話', 'わ']]);
  lines = await annotate(state);
  assert.deepEqual(reading(lines[0], '辛い'), ['から', 'automatic', false]);
  assert.deepEqual(reading(lines[1], '辛い'), ['から', 'automatic', false]);
  assert.deepEqual(reading(lines[0], '生徒'), ['せーと', 'manual', false]);
  assert.deepEqual(reading(lines[2], '話'), ['わ', 'manual', false]);
});

test('restore on a learned occurrence forgets that context but keeps the manual correction elsewhere', async () => {
  let state = await newScript();
  state = save(state, openEditor((await annotate(state))[0], '辛'), 'つらい');
  let lines = await annotate(state);
  state = restore(state, openEditor(lines[1], '辛い'));
  assert.deepEqual(state.database.scripts[state.id].learned, []);
  assert.equal(state.database.scripts[state.id].overrides.length, 1);
  lines = await annotate(state);
  assert.deepEqual(reading(lines[0], '辛い'), ['つらい', 'manual', false]);
  assert.deepEqual(reading(lines[1], '辛い'), ['から', 'automatic', false]);
});

test('an empty saved reading still means "no ruby"; restore is what brings the reading back', async () => {
  let state = await newScript();
  state = save(state, openEditor((await annotate(state))[0], '辛'), '');
  assert.deepEqual(state.database.scripts[state.id].learned, [], 'an empty reading teaches nothing');
  let lines = await annotate(state);
  assert.deepEqual(reading(lines[0], '辛い'), ['', 'manual', true]);
  state = restore(state, openEditor(lines[0], '辛い'));
  lines = await annotate(state);
  assert.deepEqual(reading(lines[0], '辛い'), ['から', 'automatic', false]);
});

test('restore on an automatic reading changes nothing, and unknown scripts are ignored', async () => {
  const state = await newScript();
  const lines = await annotate(state);
  assert.equal(restore(state, openEditor(lines[0], '辛')).database, state.database);
  assert.equal(restoreAutomaticReading(state.database, 'script:missing', lines[0].cleanText, 0, 2), state.database);
});
