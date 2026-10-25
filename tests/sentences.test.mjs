import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';
const { splitSentences } = loadTypescript('../app/utils/sentences.ts');

const texts = line => splitSentences(line).map(sentence => sentence.text);

test('sentences cover the line completely and in order', () => {
  assert.deepEqual(texts('今日は晴れです。明日は雨です。'), ['今日は晴れです。', '明日は雨です。']);
  for (const line of [
    '今日は晴れです。明日は雨です。',
    '　先頭の全角空白も一行目のもの。次の文。',
    '「どうしたの？」と彼は言った。',
    '「……ね。そうだね。」',
    '終わりのない文',
    '！？',
    '……',
    'a。   b。c',
    '',
    '   ',
    '「」『』（）()【】〈〉《》“”',
  ]) {
    const sentences = splitSentences(line);
    assert.equal(sentences.map(sentence => sentence.text).join(''), sentences.length ? line : '', `${JSON.stringify(line)} round trip`);
    for (const sentence of sentences) {
      assert.equal(sentence.text, line.slice(sentence.start, sentence.end));
      assert.ok(sentence.end > sentence.start);
    }
    assert.deepEqual(sentences.map(sentence => sentence.start), sentences.map((_, index) => (index ? sentences[index - 1].end : 0)));
  }
});

test('a terminator run plus closing brackets and whitespace ends the sentence', () => {
  assert.deepEqual(texts('本当に！？　そうなの。'), ['本当に！？　', 'そうなの。']);
  assert.deepEqual(texts('え……。次'), ['え……。', '次']);
  // The 。 sits inside the quote, so it never splits: the whole line is one sentence.
  assert.deepEqual(texts('「無理。」「そう。」'), ['「無理。」「そう。」']);
  assert.deepEqual(texts('a!? b'), ['a!? ', 'b']);
});

test('nothing splits inside brackets, even with terminators across them', () => {
  assert.deepEqual(texts('「どうしたの？」と彼は言った。'), ['「どうしたの？」と彼は言った。']);
  assert.deepEqual(texts('「……ね。そうだね。」'), ['「……ね。そうだね。」']);
  assert.deepEqual(texts('（そうか。なるほど。）そして終わり。'), ['（そうか。なるほど。）そして終わり。']);
  assert.deepEqual(texts('（そうか。）そして終わり。次'), ['（そうか。）そして終わり。', '次']);
  assert.deepEqual(texts('「無理。」と言った。そう。'), ['「無理。」と言った。', 'そう。']);
  assert.deepEqual(texts('『あ「い」う』え。'), ['『あ「い」う』え。']);
});

test('trailing text without a terminator is its own sentence and whitespace merges back', () => {
  assert.deepEqual(texts('晴れ。'), ['晴れ。']);
  assert.deepEqual(texts('晴れ。　'), ['晴れ。　']);
  assert.deepEqual(texts('晴れ。 次'), ['晴れ。 ', '次']);
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences(' \t '), []);
  assert.deepEqual(splitSentences('　　'), []);
});

test('empty line yields no sentences and leading ideographic space stays with the first one', () => {
  const [first] = splitSentences('　こんにちは。');
  assert.equal(first.start, 0);
  assert.equal(first.text, '　こんにちは。');
});
