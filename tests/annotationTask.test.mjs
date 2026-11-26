import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';
const { createAnnotator } = loadTypescript('../app/utils/annotationTask.ts');
const { glossaryOverrides } = loadTypescript('../app/utils/glossary.ts');
const { validateGlossary } = loadTypescript('../app/utils/correctionDatabase.ts');
const noun = (surface, reading) => ({ surface, reading, type: 'hiragana', createdAt: 1 });
const input = (text, extras = {}) => ({ text, rubyType: 'hiragana', glossary: [], sourceOverrides: [], overrides: [], ...extras });
const collect = async (engine, task) => {
  const lines = [];
  await engine.run(task, () => false, chunk => lines.push(...chunk.lines));
  return lines;
};

test('longest glossary match is literal and repeated; manual > source > glossary > automatic', async () => {
  assert.deepEqual(glossaryOverrides('小日向小日向さん', [noun('小日', 'こひ'), noun('小日向', 'こひなた')]).map(v => [v.start, v.surface]), [[0, '小日向'], [3, '小日向']]);
  assert.equal(glossaryOverrides('A+B AAB', [noun('A+B', 'えー')]).length, 1);
  const engine = createAnnotator();
  const task = input('二人で', { glossary: [noun('二人', 'ににん')] });
  const source = { line: '二人で', start: 0, surface: '二人', reading: 'ふたり', type: 'hiragana' };
  const manual = { ...source, reading: 'にひと' };
  assert.equal((await collect(engine, task))[0].tokens[0].readingSource, 'glossary');
  const sourced = await collect(engine, { ...task, sourceOverrides: [source] });
  assert.equal(sourced[0].tokens[0].ruby, 'ふたり');
  assert.equal(sourced[0].tokens[0].readingSource, 'source');
  const corrected = await collect(engine, { ...task, sourceOverrides: [source], overrides: [manual] });
  assert.equal(corrected[0].tokens[0].ruby, 'にひと');
  assert.equal(corrected[0].tokens[0].readingSource, 'manual');
  const removed = await collect(engine, { ...task, overrides: [{ ...manual, reading: '' }] });
  assert.equal(removed[0].tokens[0].annotationSuppressed, true);
  assert.equal(removed[0].tokens[0].needsReview, false);
  assert.equal(removed[0].tokens.map(v => v.surface).join(''), task.text);
  const fresh = await collect(engine, input('二人で'));
  assert.equal(fresh[0].tokens[0].ruby, 'ふたり'); // overlays never mutate the canonical cache
});

test('mode switches reuse canonical readings and format glossary/overrides consistently', async () => {
  const engine = createAnnotator();
  const task = input('学校へ', { glossary: [noun('学校', 'がっこう')] });
  assert.equal((await collect(engine, { ...task, rubyType: 'katakana' }))[0].tokens[0].ruby, 'ガッコウ');
  assert.equal((await collect(engine, { ...task, rubyType: 'romaji' }))[0].tokens[0].ruby, 'gakkou');
  assert.equal((await collect(engine, task))[0].tokens[0].ruby, 'がっこう');
});

test('chunking yields ordered complete lines and cancellation stops subsequent chunks', async () => {
  const engine = createAnnotator();
  const task = input(Array.from({ length: 123 }, (_, i) => `学校へ ${i}`).join('\n'));
  const chunks = [];
  await engine.run(task, () => false, chunk => chunks.push(chunk));
  assert.deepEqual(chunks.map(chunk => [chunk.offset, chunk.lines.length, chunk.total]), [[0, 50, 123], [50, 50, 123], [100, 23, 123]]);
  assert.equal(chunks[2].lines[22].id, '122');
  let cancelled = false;
  let count = 0;
  await assert.rejects(engine.run(task, () => cancelled, () => { count++; cancelled = true; }), { name: 'AbortError' });
  assert.equal(count, 1);
});

test('invalid glossary import is rejected as a whole', () => {
  const good = noun('小日向', 'こひなた');
  assert.deepEqual(validateGlossary({ 小日向: good }), { 小日向: good });
  assert.throws(() => validateGlossary({ 小日向: good, bad: { ...good, surface: 'bad', reading: '' } }));
  assert.throws(() => validateGlossary({ 小日向: { ...good, surface: 'different' } }));
});

test('many overrides on a single line and large glossaries apply cleanly and accurately', async () => {
  const engine = createAnnotator();
  const baseLine = Array.from({ length: 40 }, () => '東京').join('と');
  const overrides = Array.from({ length: 40 }, (_, i) => ({
    line: baseLine,
    start: i * 3,
    surface: '東京',
    reading: i % 2 === 0 ? 'とうきょう' : 'あずま',
    type: 'hiragana',
  }));
  const glossary = [noun('大阪', 'おおさか'), noun('京都', 'きょうと')];
  const lines = await collect(engine, input(`${baseLine}\n大阪へ`, { overrides, glossary }));
  assert.equal(lines.length, 2);
  const readings = lines[0].tokens.filter(t => t.surface === '東京').map(t => t.ruby);
  assert.equal(readings.length, 40);
  assert.equal(readings[0], 'とうきょう');
  assert.equal(readings[1], 'あずま');
  assert.equal(lines[1].tokens[0].ruby, 'おおさか');
  assert.equal(lines[1].tokens[0].readingSource, 'glossary');
});
