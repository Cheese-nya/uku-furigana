import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { before, test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';
const { checkLine, loadReadingTable } = loadTypescript('../app/utils/readingCheck.ts');
const { annotateLine, parseCompoundToTokens } = loadTypescript('../app/utils/furigana.ts');
const { initKuromoji } = loadTypescript('../app/utils/kuromojiEngine.ts');
const { createAnnotator } = loadTypescript('../app/utils/annotationTask.ts');

// Kuromoji's Node loader takes a filesystem path, while the app uses /dict.
before(async () => {
  globalThis.window = { location: { protocol: 'file:' } };
  const kuromoji = loadTypescript('../app/utils/kuromojiEngine.ts');
  const kuromojiPackage = await import('kuromoji');
  const original = kuromojiPackage.default.builder;
  kuromojiPackage.default.builder = options => original({ ...options, dicPath: new URL('../public/dict/', import.meta.url).pathname });
  await initKuromoji();
  delete globalThis.window;
  assert.ok(kuromoji.isKuromojiReady());
});

const table = entries => new Map(Object.entries(entries));
const school = line => line.tokens.find(token => token.surface === '学校');

test('a reading the dictionary does not know is flagged with its readings as alternatives', () => {
  const line = checkLine(annotateLine('学校へ行く'), table({ 学校: ['がくこう', 'かっこう'] }));
  assert.deepEqual([school(line).needsReview, school(line).alternatives], [true, ['がっこう', 'がくこう', 'かっこう']]);
  // The review queue reads the whole word's alternatives, so a flagged token offers them there too.
  assert.deepEqual(school(line).word.alternatives, ['がっこう', 'がくこう', 'かっこう']);
  // No dictionary entry for the word: nothing to compare against, nothing to flag.
  const unknown = checkLine(annotateLine('学校へ行く'), table({ 他: ['ほか'] }));
  assert.deepEqual([school(unknown).needsReview, school(unknown).alternatives], [false, undefined]);
});

test('a valid reading with several dictionary readings gets alternatives but no review flag', () => {
  const line = checkLine(annotateLine('学校へ行く'), table({ 学校: ['がっこう', 'がくこう'] }));
  assert.deepEqual([school(line).needsReview, school(line).alternatives], [false, ['がっこう', 'がくこう']]);
  // The word itself is left alone: a valid reading must not become a review item.
  assert.deepEqual(school(line).word.alternatives, ['がっこう']);
  // The current reading comes first and the list stops at five.
  const many = checkLine(annotateLine('学校へ行く'),
    table({ 学校: ['がっこう', 'がくこう', 'かっこう', 'まなびや', 'がこう', 'がつこう'] }));
  assert.deepEqual([school(many).needsReview, school(many).alternatives],
    [false, ['がっこう', 'がくこう', 'かっこう', 'まなびや', 'がこう']]);
});

test('only automatic readings are checked', () => {
  const token = (surface, reading, readingSource) => ({ surface, hasKanji: true, ruby: reading, readingSource });
  const line = { id: 'x', rawText: '', cleanText: '学校', tokens: [
    token('学校', 'まなびや', 'manual'), token('学校', 'まなびや', 'glossary'),
    token('学校', 'まなびや', 'source'), token('学校', 'まなびや', 'learned'),
    token('学校', 'がくこう', 'automatic'), token('学校', 'まなびや', 'automatic'),
  ] };
  const checked = checkLine(line, table({ 学校: ['がっこう'] }));
  for (const index of [0, 1, 2, 3]) assert.equal(checked.tokens[index], line.tokens[index]);
  assert.deepEqual(checked.tokens.slice(4).map(value => [value.ruby, value.needsReview, value.alternatives]),
    [['がくこう', true, ['がくこう', 'がっこう']], ['まなびや', true, ['まなびや', 'がっこう']]]);
  // A suppressed token keeps its silence, and an already-offered alternative list is not rebuilt.
  const suppressed = checkLine({ ...line, tokens: [{ ...token('学校', 'がくこう', 'automatic'), annotationSuppressed: true },
    { ...token('学校', 'がっこう', 'automatic'), alternatives: ['がっこう'] }] }, table({ 学校: ['がっこう', 'がくこう'] }));
  assert.deepEqual(suppressed.tokens.map(value => [value.needsReview, value.alternatives]),
    [[undefined, undefined], [undefined, ['がっこう']]]);
});

test('checkLine returns a new line and never mutates its input', () => {
  const original = annotateLine('学校へ行く');
  const snapshot = JSON.stringify(original);
  const checked = checkLine(original, table({ 学校: ['がくこう'] }));
  assert.equal(JSON.stringify(original), snapshot);
  assert.notEqual(checked, original);
  assert.equal(school(checked).needsReview, true);
});

test('a split word is compared through its whole reading, not its mora slice', () => {
  // 食べる annotates as 食 (た) + べる; た alone is nobody's reading of 食べる.
  const line = { id: 'x', rawText: '食べる', cleanText: '食べる', tokens: parseCompoundToTokens('食べる', 'たべる') };
  assert.deepEqual(line.tokens.map(token => [token.surface, token.ruby]), [['食', 'た'], ['べる', undefined]]);
  const valid = checkLine(line, table({ 食べる: ['たべる', 'くべる'] }));
  assert.deepEqual(valid.tokens.map(token => [Boolean(token.needsReview), token.alternatives]),
    [[false, undefined], [false, undefined]]);
  const wrong = checkLine(line, table({ 食べる: ['くべる'] }));
  assert.deepEqual([wrong.tokens[0].needsReview, wrong.tokens[0].ruby, wrong.tokens[0].alternatives], [true, 'た', undefined]);
  assert.deepEqual(wrong.tokens[0].word.alternatives, ['たべる', 'くべる']);
  assert.equal(wrong.tokens[1], line.tokens[1]);
});

test('the annotator caches checked lines and catches up when the table arrives', async () => {
  const task = { text: '学校へ行く', rubyType: 'hiragana', glossary: [], sourceOverrides: [], overrides: [] };
  const collect = async (engine, input = task) => {
    const lines = [];
    await engine.run(input, () => false, chunk => lines.push(...chunk.lines));
    return lines;
  };
  let readings = null;
  const engine = createAnnotator(() => readings);
  // Annotation works before the table is ready; the line is checked and cached again afterwards.
  assert.equal(school((await collect(engine))[0]).alternatives, undefined);
  readings = table({ 学校: ['がくこう'] });
  const flagged = (await collect(engine))[0];
  assert.deepEqual([school(flagged).ruby, school(flagged).needsReview], ['がっこう', true]);
  // A manual reading is applied on top of the cached line, never cached itself.
  const corrected = { line: '学校へ行く', start: 0, surface: '学校', reading: 'がっこう', type: 'hiragana' };
  const overlaid = (await collect(engine, { ...task, overrides: [corrected] }))[0];
  assert.deepEqual([school(overlaid).ruby, school(overlaid).readingSource], ['がっこう', 'manual']);
  const again = (await collect(engine))[0];
  assert.deepEqual([school(again).ruby, school(again).needsReview], ['がっこう', true]);
});

test('the reading table is fetched next to the dictionary, gzipped or already decoded', async () => {
  const payload = JSON.stringify({ 学校: ['がっこう', 'がくこう'], 空: [] });
  const original = globalThis.fetch;
  try {
    for (const body of [gzipSync(Buffer.from(payload, 'utf8')), new TextEncoder().encode(payload)]) {
      let requested = '';
      globalThis.fetch = async url => {
        requested = String(url);
        return new Response(body, { status: 200 });
      };
      const loaded = await loadReadingTable('/dict');
      assert.equal(requested, '/dict/readings.json.gz');
      assert.deepEqual([...loaded], [['学校', ['がっこう', 'がくこう']], ['空', []]]);
      assert.deepEqual([...await loadReadingTable('/dict/')], [...loaded]);
    }
    globalThis.fetch = async () => new Response('missing', { status: 404 });
    await assert.rejects(loadReadingTable('/dict'), /注音对照表/);
  } finally {
    globalThis.fetch = original;
  }
});
