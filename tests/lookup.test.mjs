import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { lookupAt, deinflect, INFLECTION_LABELS } = loadTypescript('../app/utils/lookup.ts');

// Tokens as kuromoji gives them (offsets filled in from the surfaces).
function tokens(...list) {
  let offset = 0;
  return list.map(([surface, pos, posDetail = '*', basicForm = surface]) => {
    const start = offset;
    offset += surface.length;
    return { surface, basicForm, reading: '', pos, posDetail, conjugatedForm: '*', start, end: offset };
  });
}
const DICT = [
  { term: '死ぬ', reading: 'しぬ' }, { term: '静か', reading: 'しずか' }, { term: '思う', reading: 'おもう' },
  { term: '仕方がない', reading: 'しかたがない' }, { term: '食べる', reading: 'たべる' }, { term: '学生', reading: 'がくせい' },
  { term: '夢', reading: 'ゆめ' }, { term: '女', reading: 'おんな' },
].map(entry => ({ dict: 'd', tags: [], glosses: ['x'], examples: [], score: 0, ...entry }));
const calls = [];
const find = async terms => { calls.push(terms); return DICT.filter(entry => terms.includes(entry.term) || terms.includes(entry.reading)); };

test('an inflected verb is found by its dictionary form and keeps its auxiliaries highlighted', async () => {
  const text = 'もう死にますと';
  const list = tokens(['もう', '副詞'], ['死に', '動詞', '自立', '死ぬ'], ['ます', '助動詞'], ['と', '助詞', '格助詞']);
  const result = await lookupAt(text, 2, list, find);
  assert.equal(result.query, '死にます');
  assert.equal(result.lemma, '死ぬ');
  assert.deepEqual(result.inflections, ['masu']);
  assert.deepEqual([result.start, result.end], [2, 6]);
  assert.equal(INFLECTION_LABELS.masu.zh, 'ます形');
});

test('past tense, adjectival nouns and multi-token expressions', async () => {
  let text = '確にそう思った。';
  let list = tokens(['確', '名詞'], ['に', '助詞'], ['そう', '副詞'], ['思っ', '動詞', '自立', '思う'], ['た', '助動詞'], ['。', '記号']);
  let result = await lookupAt(text, 5, list, find);
  assert.equal(result.query, '思った');
  assert.deepEqual(result.inflections, ['past']);

  text = '静かな声';
  list = tokens(['静か', '名詞', '形容動詞語幹'], ['な', '助動詞', '*', 'だ'], ['声', '名詞']);
  result = await lookupAt(text, 0, list, find);
  assert.equal(result.query, '静かな');
  assert.deepEqual(result.inflections, [], 'the copula is not an inflection');

  text = '仕方がないわ';
  list = tokens(['仕方', '名詞'], ['が', '助詞'], ['ない', '形容詞', '自立'], ['わ', '助詞', '終助詞']);
  result = await lookupAt(text, 0, list, find);
  assert.equal(result.query, '仕方がない', 'the longest known run wins');
});

test('nouns do not swallow a following copula; punctuation and misses return null; single kanji is a last resort', async () => {
  const text = '学生です。女だ';
  const list = tokens(['学生', '名詞'], ['です', '助動詞'], ['。', '記号'], ['女', '名詞'], ['だ', '助動詞']);
  assert.equal((await lookupAt(text, 0, list, find)).query, '学生');
  assert.equal(await lookupAt(text, 4, list, find), null);
  const unknown = tokens(['夢見', '名詞']);
  const result = await lookupAt('夢見', 0, unknown, find);
  assert.equal(result.query, '夢');
});

test('our deinflector reaches the dictionary form through several steps', () => {
  assert.ok(deinflect('食べなかった').includes('食べる'));
  assert.ok(deinflect('死にます').includes('死ぬ'));
  assert.ok(deinflect('読んで').includes('読む'));
  assert.ok(deinflect('来られる').includes('来る'));
  assert.ok(deinflect('高かった').includes('高い'));
});
