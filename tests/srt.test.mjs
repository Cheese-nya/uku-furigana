import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';
const { parseSRT, parseVTT, generateSRT, generateTXT } = loadTypescript('../app/utils/srt.ts');
const { applyRubyOverrides } = loadTypescript('../app/utils/rubyOverrides.ts');
const { annotateLine } = loadTypescript('../app/utils/furigana.ts');

test('SRT import/export retains cue numbers, timecodes, multi-line captions and ruby', () => {
  const input = '\uFEFF3\r\n00:00:02,100 --> 00:00:04,500\r\n二人で行く\r\nまた明日\r\n\r\n9\r\n00:01:10,000 --> 00:01:12,000\r\n学校へ';
  const parsed = parseSRT(input);
  assert.equal(parsed.text, '二人で行く\nまた明日\n学校へ');
  assert.deepEqual(parsed.cues.map(({ index, start, end, lines }) => ({ index, start, end, lines })), [
    { index: '3', start: '00:00:02,100', end: '00:00:04,500', lines: ['二人で行く', 'また明日'] },
    { index: '9', start: '00:01:10,000', end: '00:01:12,000', lines: ['学校へ'] },
  ]);
  const first = applyRubyOverrides(annotateLine('二人で行く'), [{ line: '二人で行く', start: 0, surface: '二人', reading: 'ふたり', type: 'hiragana' }], 'hiragana');
  const output = generateSRT([first, annotateLine('また明日'), annotateLine('学校へ')], parsed.cues);
  assert.match(output, /^3\n00:00:02,100 --> 00:00:04,500\n二人\(ふたり\)で行\(い\)く\nまた明日\(あした\)/m);
  assert.match(output, /9\n00:01:10,000 --> 00:01:12,000\n学校\(がっこう\)へ/);
});

test('invalid SRT blocks are ignored and generated cues include ruby readings', () => {
  assert.deepEqual(parseSRT('plain text\n\n1\nnot a timecode\nignored').cues, []);
  const output = generateSRT([annotateLine('学校へ')]);
  assert.match(output, /00:00:00,000 --> 00:00:03,000\n学校\(がっこう\)へ/);
});

test('parseSRT accepts 1-digit hours and dot milliseconds; parseVTT ignores NOTE/STYLE blocks with arrows and decodes quotes', () => {
  const srt = parseSRT('1\n0:01:02.500 --> 0:01:05.750\n台詞\n');
  assert.deepEqual(srt.cues, [{ index: '1', start: '00:01:02,500', end: '00:01:05,750', lines: ['台詞'] }]);

  const vtt = [
    'WEBVTT',
    '',
    'NOTE 00:00.000 --> 00:01.000 ignored comment',
    'multi-line note',
    '',
    'STYLE',
    '::cue { color: white; } /* a --> b */',
    '',
    '00:02.000 --> 00:04.500',
    '&quot;台詞&quot; &apos;テスト&#39;',
    '',
  ].join('\n');
  const parsed = parseVTT(vtt);
  assert.deepEqual(parsed.cues, [
    { index: '1', start: '00:00:02,000', end: '00:00:04,500', lines: ['"台詞" \'テスト\''] },
  ]);
});

test('generateTXT and generateSRT append optional translations cleanly and stay unchanged when omitted', () => {
  const lines = [annotateLine('学校へ'), annotateLine('また明日')];
  assert.equal(generateTXT(lines), '学校(がっこう)へ\n\nまた明日(あした)');
  assert.equal(
    generateTXT(lines, ['去学校', undefined]),
    '学校(がっこう)へ\n去学校\n\nまた明日(あした)',
  );

  const cues = [
    { index: '1', start: '00:00:01,000', end: '00:00:03,000', lines: ['学校へ', 'また明日'] },
  ];
  const cueSrt = generateSRT(lines, cues, ['去学校', '明天见']);
  assert.equal(
    cueSrt,
    '1\n00:00:01,000 --> 00:00:03,000\n学校(がっこう)へ\nまた明日(あした)\n去学校\n明天见\n',
  );

  const autoSrt = generateSRT(lines, undefined, ['去学校', undefined]);
  assert.match(autoSrt, /00:00:00,000 --> 00:00:03,000\n学校\(がっこう\)へ\n去学校/);
  assert.match(autoSrt, /00:00:04,000 --> 00:00:07,000\nまた明日\(あした\)\n$/);
});
