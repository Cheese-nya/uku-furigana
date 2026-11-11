import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const {
  nameReadingSkeleton, normalizeNameKey, normalizeNameReading, splitNameReadingSegments,
  buildNameReadingTable, builtInNameReadingTable, buildImportedReadingData, mergeReadingTables,
  applyNameReadings, applyFlexibleGlossary, applyImportedReadingCompounds,
} = loadTypescript('../app/utils/nameReadings.ts');
const { annotateLine, formatRuby } = loadTypescript('../app/utils/furigana.ts');
const { checkLine } = loadTypescript('../app/utils/readingCheck.ts');
const { createAnnotator } = loadTypescript('../app/utils/annotationTask.ts');
const { applyGlossary } = loadTypescript('../app/utils/glossary.ts');
const { applyRubyOverrides } = loadTypescript('../app/utils/rubyOverrides.ts');
const { learnedOverrides, needsReview } = loadTypescript('../app/utils/review.ts');
const { initKuromoji } = loadTypescript('../app/utils/kuromojiEngine.ts');

const entry = (surface, reading, type = 'hiragana') => ({ surface, reading, type, createdAt: 1 });
const task = (text, extras = {}) => ({ text, rubyType: 'hiragana', glossary: [], sourceOverrides: [], overrides: [], ...extras });
const collect = async (engine, input) => {
  const lines = [];
  await engine.run(input, () => false, chunk => lines.push(...chunk.lines));
  return lines[0];
};
const ruby = (line, surface) => {
  let offset = 0;
  for (const token of line.tokens) {
    if (offset === line.cleanText.indexOf(surface)) return token;
    offset += token.surface.length;
  }
  return null;
};

before(async () => { await initKuromoji(new URL('../public/dict/', import.meta.url).pathname); });

test('the NFKC skeleton maps whitespace-free matches back to UTF-16 offsets', () => {
  const text = '峰岸  　美丘';
  const skeleton = nameReadingSkeleton(text);
  assert.equal(skeleton.text, '峰岸美丘');
  assert.deepEqual(skeleton.chars.map(value => [value.char, value.start]), [
    ['峰', 0], ['岸', 1], ['美', 5], ['丘', 6],
  ]);
  assert.equal(normalizeNameKey('ＡＢ　Ｃ'), 'ABC');
  assert.equal(normalizeNameReading('ミネギシ　ミオカ'), 'みねぎし みおか');
  assert.deepEqual(splitNameReadingSegments('みねぎし　みおか'), ['みねぎし', 'みおか']);
});

test('built-in name readings preserve original whitespace and ruby segments', async () => {
  const table = builtInNameReadingTable();
  for (const text of ['峰岸美丘', '峰岸 美丘', '峰岸　美丘', '峰岸  \u3000 美丘', '峰岸美丘さん']) {
    const line = (await collect(createAnnotator(), task(text)));
    assert.equal(line.tokens.map(token => token.surface).join(''), text, text);
    assert.equal(ruby(line, '峰岸')?.ruby, 'みねぎし', text);
    assert.equal(ruby(line, '美丘')?.ruby, 'みおか', text);
    for (const token of line.tokens) {
      if (/^\s+$/u.test(token.surface)) assert.equal(token.ruby, undefined, text);
    }
    if (text.endsWith('さん')) assert.equal(ruby(line, 'さん')?.ruby, undefined);
  }
});

test('kana-only text and ordinary words stay untouched', async () => {
  const engine = createAnnotator();
  const kana = await collect(engine, task('みねぎし　みおか'));
  assert.equal(kana.tokens.map(token => token.ruby || '').join(''), '');
  const words = await collect(engine, task('学校へ行く'));
  assert.equal(words.tokens.map(token => token.surface).join(''), '学校へ行く');
  assert.notEqual(ruby(words, '学校')?.ruby, 'みねぎし');
});

test('canonical name readings are formatted for hiragana, katakana and romaji', async () => {
  const engine = createAnnotator();
  for (const [type, expected] of [['hiragana', 'みねぎし'], ['katakana', 'ミネギシ'], ['romaji', 'minegishi']]) {
    const line = await collect(engine, task('峰岸美丘', { rubyType: type }));
    assert.equal(ruby(line, '峰岸')?.ruby, expected);
    assert.equal(ruby(line, '美丘')?.ruby, formatRuby('みおか', type));
  }
});

test('name readings with one segment survive a space in the middle of a word', () => {
  const table = buildNameReadingTable([{ surface: '小日向', reading: 'こひなた', score: 5, alternatives: [] }]);
  const line = applyNameReadings(annotateLine('小 日 向さん'), table);
  assert.equal(line.tokens.map(token => token.surface).join(''), '小 日 向さん');
  assert.equal(line.tokens[0].ruby, 'こひなた');
  assert.ok(line.tokens.some(token => /^\s+$/u.test(token.surface) && !token.ruby));
});

test('imported general readings also cross half/full-width spaces and keep alternatives', () => {
  const table = new Map([['国実百合', ['くにざねゆり', 'くにみゆり']]]);
  for (const text of ['国　実 百合', '国実百合']) {
    const line = applyImportedReadingCompounds(annotateLine(text), table);
    assert.equal(line.tokens.map(token => token.surface).join(''), text);
    assert.ok(line.tokens.some(token => token.ruby === 'くにざねゆり'));
    assert.ok(line.tokens.some(token => token.alternatives?.includes('くにみゆり')));
    assert.equal(needsReview(line.tokens.find(token => token.ruby === 'くにざねゆり')), true);
  }
});

test('ambiguous imported readings become review alternatives, not forced replacements', () => {
  const table = buildNameReadingTable([
    { surface: '国実百合', reading: 'くにざねゆり', score: 9, alternatives: ['くにみゆり'] },
    { surface: '国実渚', reading: 'くにざねなぎさ', score: 9, alternatives: ['くにみなぎさ'] },
  ], 'ambiguous');
  assert.ok(table.get('国実百合').alternatives.includes('くにみゆり'));
  assert.deepEqual(table.get('峰岸').alternatives, []);
  const line = applyNameReadings(annotateLine('国実渚さん'), table);
  assert.equal(ruby(line, '国実渚')?.ruby, 'くにざねなぎさ');
  assert.ok(ruby(line, '国実渚')?.alternatives?.includes('くにみなぎさ'));
  assert.equal(needsReview(ruby(line, '国実渚')), true);
  assert.equal(needsReview({ hasKanji: true, readingSource: 'glossary' }), false);
});

test('common-word collisions and generated-table exclusions do not override context rules', () => {
  const table = buildNameReadingTable([{ surface: '日本', reading: 'やまと', score: 999, alternatives: [] }], 'collision');
  assert.equal(table.has(normalizeNameKey('日本')), false);
  const readingTable = mergeReadingTables(new Map([['日本', ['にほん', 'にっぽん']]]), new Map([['日本', ['やまと']]]));
  assert.deepEqual(readingTable.get('日本'), ['にほん', 'にっぽん']);
});

test('flexible glossary crosses mixed spaces without changing literal glossary semantics', () => {
  const entries = [entry('峰岸美丘', 'みねぎし　みおか'), entry('小日向', 'こひなた')];
  const literal = applyGlossary(annotateLine('峰岸美丘と小日向'), entries, 'hiragana');
  assert.equal(ruby(literal, '峰岸美丘')?.ruby, 'みねぎし　みおか');
  const spaced = applyFlexibleGlossary(applyGlossary(annotateLine('峰岸  　美丘'), entries, 'hiragana'), entries, 'hiragana');
  assert.equal(spaced.tokens.map(token => token.surface).join(''), '峰岸  　美丘');
  assert.equal(ruby(spaced, '峰岸')?.ruby, 'みねぎし');
  assert.equal(ruby(spaced, '美丘')?.ruby, 'みおか');
  assert.equal(ruby(spaced, '峰岸')?.readingSource, 'glossary');
});

test('flexible glossary respects katakana and romaji readings', () => {
  const katakana = applyFlexibleGlossary(annotateLine('小 日向'), [entry('小日向', 'コヒナタ', 'katakana')], 'hiragana');
  assert.equal(katakana.tokens[0].ruby, 'こひなた');
  const romaji = applyFlexibleGlossary(annotateLine('小 日向'), [entry('小日向', 'kohinata', 'romaji')], 'katakana');
  assert.equal(romaji.tokens[0].ruby, 'kohinata');
});

test('manual, source, learned and literal glossary precedence is preserved', async () => {
  const engine = createAnnotator();
  const text = '峰岸 美丘';
  const source = [{ line: text, start: 0, surface: '峰岸', reading: 'こねぎし', type: 'hiragana' }];
  const manual = [{ line: text, start: 0, surface: '峰岸', reading: 'みねざき', type: 'hiragana' }];
  const learned = [{ surface: '美', reading: 'みお', alternatives: [], type: 'hiragana', before: '', after: '', createdAt: 1 }];
  const sourced = await collect(engine, task(text, { sourceOverrides: source }));
  assert.equal(ruby(sourced, '峰岸')?.ruby, 'こねぎし');
  assert.equal(ruby(sourced, '峰岸')?.readingSource, 'source');
  const corrected = await collect(engine, task(text, { sourceOverrides: source, overrides: manual }));
  assert.equal(ruby(corrected, '峰岸')?.ruby, 'みねざき');
  assert.equal(ruby(corrected, '峰岸')?.readingSource, 'manual');
  const glossed = await collect(engine, task(text, { glossary: [entry('美丘', 'みお')] }));
  assert.equal(ruby(glossed, '美丘')?.ruby, 'みお');
  assert.equal(ruby(glossed, '美丘')?.readingSource, 'glossary');
  const target = annotateLine('美');
  const overrides = learnedOverrides({ ...target, id: '0' }, learned, 'hiragana');
  assert.equal(applyRubyOverrides(target, overrides, 'hiragana', 'learned').tokens[0].ruby, 'みお');
});

test('imported dictionaries merge into the canonical reading check and cache key', async () => {
  const libraries = [{ id: 'a', title: 'Test', revision: '1', updatedAt: 1,
    names: [{ surface: '美丘', reading: 'みおか', score: 5, alternatives: [] }],
    readings: [{ surface: '号哭', readings: ['ごうこく'] }],
  }];
  const data = buildImportedReadingData(libraries);
  assert.equal(data.nameTable.get('美丘')?.reading, 'みおか');
  assert.equal(data.readingTable.get('号哭')?.[0], 'ごうこく');
  const checked = checkLine(annotateLine('悠に咲き乱れるこの号哭が、'), data.readingTable);
  assert.equal(checked.tokens.map(token => token.ruby || token.surface).join(''), 'ゆうにさきみだれるこのごうこくが、');
  const input = task('学校へ行く');
  const lines = [];
  const engine = createAnnotator(() => ({ table: new Map([['学校', ['がくこう']]]), nameTable: data.nameTable, importedTable: data.readingTable }));
  await engine.run(input, () => false, chunk => lines.push(...chunk.lines));
  assert.equal(school(lines[0]).needsReview, true);
});

function school(line) { return line.tokens.find(token => token.surface === '学校'); }
