import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { loadTypescript } from './loadTypescript.mjs';

const { convertTermBank, readYomitanZip } = loadTypescript('../app/utils/yomitanFormat.ts');

const glossList = (...items) => ({ tag: 'ol', data: { content: 'glosses' }, content: items.map(item => ({ tag: 'li', content: item })) });

test('structured content: one gloss per list item, details and backlinks left out, examples kept', () => {
  const [entry] = convertTermBank([[
    '食べる', 'たべる', 'v ichidan vt', 'v1', 0,
    [{ type: 'structured-content', content: [
      { tag: 'div', data: { content: 'preamble' }, content: '词源 …' },
      glossList(
        { tag: 'div', content: ['吃', { tag: 'details', data: { content: 'details-entry-examples' }, content: [
          { tag: 'summary', content: '1 例' },
          { tag: 'div', data: { content: 'example-sentence' }, content: [{ tag: 'div', content: 'ご飯を食べる' }, { tag: 'div', content: '吃饭' }] },
        ] }] },
        '维持生计',
      ),
      { tag: 'div', data: { content: 'backlink' }, content: 'Wiktionary' },
    ] }], 1, '',
  ]]);
  assert.equal(entry[0], '食べる');
  assert.equal(entry[1], 'たべる');
  assert.deepEqual(entry[3], ['吃', '维持生计']);
  assert.deepEqual(entry[2], ['动词', '一段', '他动']);
  assert.ok(entry[4].some(([ja, zh]) => ja === 'ご飯を食べる' && zh === '吃饭'));
});

test('the embedded "【】 1. 2." text form splits into glosses with their examples', () => {
  const [entry] = convertTermBank([[
    '思う', '', '', '', 0,
    [{ type: 'structured-content', content: glossList({ tag: 'div', content: ['思う【おもう】\n他五\n1. 想，认为。\n正しいと思う\n我认为对。\n2. 觉得，感觉。'] }) }], 1, '',
  ]]);
  assert.deepEqual(entry[3], ['想，认为。', '觉得，感觉。']);
  assert.deepEqual(entry[4], [['正しいと思う', '我认为对。']]);
});

test('v1 rows, plain strings, and rows without glosses or with only deinflection links', () => {
  const out = convertTermBank([
    ['猫', 'ねこ', 'n', '', 5, 'cat', 'small animal'],
    ['見た', '', 'non-lemma', 'v', 0, [['見る', ['past']]], 0, ''],
    ['空', 'そら', '', '', 0, [], 0, ''],
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0][3], ['cat', 'small animal']);
  assert.equal(out[0][5], 5);
});

test('readYomitanZip reads every term bank and rejects what is not a dictionary', async () => {
  const zip = new JSZip();
  zip.file('index.json', JSON.stringify({ title: 'T', revision: 'r1', format: 3 }));
  zip.file('term_bank_1.json', JSON.stringify([['夢', 'ゆめ', 'n', '', 0, ['dream'], 1, '']]));
  zip.file('term_bank_2.json', JSON.stringify([['女', 'おんな', 'n', '', 0, ['woman'], 2, '']]));
  const parsed = await readYomitanZip(await zip.generateAsync({ type: 'arraybuffer' }));
  assert.equal(parsed.title, 'T');
  assert.deepEqual(parsed.entries.map(entry => entry[0]).sort(), ['夢', '女'].sort());
  await assert.rejects(readYomitanZip(await new JSZip().generateAsync({ type: 'arraybuffer' })), /不是 Yomitan 词典/);
});

test('Jitendex layout: one gloss per sense, JMdict POS codes as labels, examples without ruby readings', () => {
  const pos = (code, title) => ({ tag: 'span', title, data: { class: 'tag', code, content: 'part-of-speech-info' }, content: code });
  const sense = (items, ja, en) => ({ tag: 'li', data: { content: 'sense' }, content: [
    { tag: 'ul', data: { content: 'glossary' }, content: items.map(item => ({ tag: 'li', content: item })) },
    ...(ja ? [{ tag: 'div', data: { content: 'extra-info' }, content: { tag: 'div', data: { content: 'example-sentence' }, content: [
      { tag: 'div', data: { content: 'example-sentence-a' }, content: { tag: 'span', content: [{ tag: 'ruby', content: ['頭', { tag: 'rt', content: 'あたま' }] }, ja] } },
      { tag: 'div', data: { content: 'example-sentence-b' }, content: [{ tag: 'span', content: en }, { tag: 'span', data: { content: 'attribution-footnote' }, content: '[1]' }] },
    ] } }] : []),
  ] });
  const [entry] = convertTermBank([[
    '見る', 'みる', '★ priority form', 'v1', 200,
    [{ type: 'structured-content', content: { tag: 'ul', data: { content: 'sense-groups' }, content: [
      { tag: 'li', data: { content: 'sense-group' }, content: [pos('v1', 'Ichidan verb'), pos('vt', 'transitive verb'), { tag: 'ol', content: [
        sense(['to see', 'to look'], 'がいたい。', 'My head hurts.'),
        sense(['to examine']),
      ] }] },
    ] } }], 1, '',
  ]]);
  assert.deepEqual(entry[2], ['一段', '他动']);
  assert.deepEqual(entry[3], ['to see; to look', 'to examine']);
  assert.deepEqual(entry[4], [['頭がいたい。', 'My head hurts.']]);
  assert.equal(entry[5], 200);
});

test('明鏡-style bilingual layout: Chinese translation with the Japanese definition, examples with the headword', () => {
  const [entry] = convertTermBank([["静か", "しずか", "", "", 0, [{"type": "structured-content", "content": {"tag": "div", "content": [{"tag": "div", "content": [{"tag": "span", "content": ["しず‐か［静か］"], "data": {"class": "word"}}, {"tag": "span", "content": ["⟨", "形動", "⟩"], "data": {"class": "type"}}], "data": {"class": "head"}}, {"tag": "div", "content": [{"tag": "span", "content": ["① "], "data": {"class": "num"}}, {"tag": "span", "content": [{"tag": "span", "content": ["やかましい声や物音がしないさま。ひっそりしているさま。"]}, {"tag": "span", "lang": "zh", "content": ["/ ", "静，寂静，肃静，静悄悄，清静，平静。"], "data": {"class": "dfcn"}}], "data": {"class": "def2"}}, {"tag": "br"}, {"tag": "span", "content": [{"tag": "span", "data": {"class": "exjp"}, "content": "▲ "}, "「", {"tag": "span", "content": ["～な境内"], "data": {"class": "exjp"}}, "」", {"tag": "span", "data": {"class": "excn"}, "lang": "zh", "content": "清静的神社院内"}], "data": {"class": "exam"}}, {"tag": "br"}, {"tag": "span", "content": [{"tag": "span", "data": {"class": "exjp"}, "content": "▲ "}, "「", {"tag": "span", "content": ["～に廊下を歩く"], "data": {"class": "exjp"}}, "」", {"tag": "span", "data": {"class": "excn"}, "lang": "zh", "content": "轻声经过走廊"}], "data": {"class": "exam"}}], "data": {"class": "def1"}}], "data": {"class": "mjrhsjcd-entry"}}}], 20297, ""]]);
  assert.equal(entry[1], 'しずか');
  assert.deepEqual(entry[2], ['形容动词']);
  assert.deepEqual(entry[3], ['静，寂静，肃静，静悄悄，清静，平静。（やかましい声や物音がしないさま。ひっそりしているさま。）']);
  assert.deepEqual(entry[4][0], ['静かな境内', '清静的神社院内']);
});
