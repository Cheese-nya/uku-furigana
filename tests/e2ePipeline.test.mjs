import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { loadTypescript } from './loadTypescript.mjs';

// End-to-end: real Kuromoji dictionary -> annotation layers -> export -> re-import.
globalThis.DOMParser = DOMParser;
const { initKuromoji, isKuromojiReady } = loadTypescript('../app/utils/kuromojiEngine.ts');
const { createAnnotator } = loadTypescript('../app/utils/annotationTask.ts');
const { parseSRT, parseVTT, generateSRT, generateTXT } = loadTypescript('../app/utils/srt.ts');
const { buildDocxBlob } = loadTypescript('../app/utils/docxExporter.ts');
const { importDocx, parseDocxXml, cleanScriptTitle } = loadTypescript('../app/utils/docxImporter.ts');
const { buildBatchZipBlob } = loadTypescript('../app/utils/fileSave.ts');
const { emptyDatabase, fingerprintText, resolveScript, setScriptOverrides } = loadTypescript('../app/utils/correctionDatabase.ts');
const { collectReviewGroups, makeLearnedReading, selectReviewWord } = loadTypescript('../app/utils/review.ts');
const {
  addBookmark, createStarterBooks, emptyLibraryDatabase, exportLibraryBackup, importLibraryBackup,
  toggleBookFavorite, updateBookMetadata, updateReadingProgress, upsertBook,
} = loadTypescript('../app/utils/libraryDatabase.ts');

// Default editor script (app/page.tsx).
const DEMO_LINES = [
  '山田先生：みなさん、こんにちは！今日の日本語アフレコ台本へようこそ。',
  '佐藤：先生、この漢字の読み方は何ですか？',
  '山田先生：これは「未来」と「希望」です。',
  '鈴木：声優の配音練習を始めましょう！',
];
const DEMO_SCRIPT = DEMO_LINES.join('\n');
const DEMO_RUBY = [
  '山田(やまだ)先生(せんせい)：みなさん、こんにちは！今日(きょう)の日本語(にほんご)アフレコ台本(だいほん)へようこそ。',
  '佐藤(さとう)：先生(せんせい)、この漢字(かんじ)の読(よ)み方(かた)は何(なん)ですか？',
  '山田(やまだ)先生(せんせい)：これは「未来(みらい)」と「希望(きぼう)」です。',
  '鈴木(すずき)：声優(せいゆう)の配(はい)音(おん)練習(れんしゅう)を始(はじ)めましょう！',
];
const SRT_SOURCE = [
  '\uFEFF12',
  '00:00:01,250 --> 00:00:03,900',
  '山田先生：みなさん、こんにちは！',
  '今日の日本語アフレコ台本へようこそ。',
  '',
  '13',
  '00:00:04,000 --> 00:00:06,500 X1:40 X2:600',
  '佐藤：先生、この漢字の読み方は何ですか？',
  '',
  '14',
  '01:02:03,004 --> 01:02:05,000',
  '鈴木：一本だけ、三分で約束の教室へ！',
  '',
].join('\r\n');

before(async () => {
  await initKuromoji(fileURLToPath(new URL('../public/dict/', import.meta.url)));
  assert.ok(isKuromojiReady());
});

const noun = (surface, reading) => ({ surface, reading, type: 'hiragana', createdAt: 1 });
const anchored = (line, surface, reading) => {
  const start = line.indexOf(surface);
  assert.ok(start >= 0, `${surface} is not in ${line}`);
  return { line, start, surface, reading, type: 'hiragana' };
};
const rubyText = line => line.tokens.map(token => token.ruby ? `${token.surface}(${token.ruby})` : token.surface).join('');
const readingOf = line => line.tokens.map(token => token.ruby || token.surface).join('');
const stripInlineRuby = text => text.replace(/\([ぁ-ゖー]+\)/gu, '');

async function annotate(text, extras = {}) {
  const lines = [];
  await createAnnotator().run({ text, rubyType: 'hiragana', glossary: [], sourceOverrides: [], overrides: [], learned: [], ...extras },
    () => false, chunk => lines.push(...chunk.lines));
  assert.equal(lines.length, text.split('\n').length);
  for (const line of lines) assert.equal(line.tokens.map(token => token.surface).join(''), line.cleanText, 'annotation must keep the text intact');
  return lines;
}

function tokenIndex(line, surface) {
  const start = line.cleanText.indexOf(surface);
  let offset = 0;
  for (let index = 0; index < line.tokens.length; index++) {
    if (offset === start && line.tokens[index].surface === surface) return index;
    offset += line.tokens[index].surface.length;
  }
  return assert.fail(`no token ${surface} in ${rubyText(line)}`);
}
const tokenOf = (line, surface) => line.tokens[tokenIndex(line, surface)];

async function documentXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml').async('string');
}

test('real dictionary annotates the default editor script', async () => {
  const lines = await annotate(DEMO_SCRIPT);
  assert.deepEqual(lines.map(rubyText), DEMO_RUBY);
  assert.equal(readingOf(lines[0]).startsWith('やまだせんせい：'), true);
  for (const line of lines) {
    assert.deepEqual(line.tokens.filter(token => token.hasKanji && !token.ruby).map(token => token.surface), [], 'no kanji left without a reading');
  }
});

test('real dictionary annotates the starter dubbing script, including counters and heteronyms', async () => {
  const library = await createStarterBooks(1_700_000_000_000);
  const lines = await annotate(library.books['book:starter-dubbing'].content);
  assert.deepEqual(lines.map(rubyText), [
    '第(だい)1話(わ)　放課後(ほうかご)の約束(やくそく)',
    '生徒(せいと)A：今日(きょう)は一本(いっぽん)だけお願(ねが)いがある。',
    '生徒(せいと)B：二人(ふたり)で帰(かえ)ろう。三分(さんぷん)だけ待(ま)って。',
    '生徒(せいと)A：このラーメン、辛(から)い？　それとも甘(あま)い？',
    '生徒(せいと)B：風(かぜ)が強(つよ)いから、コートを着(き)たほうがいいよ。',
    '生徒(せいと)A：わかった。校門(こうもん)の前(まえ)で。',
    '',
    '第(だい)2話(わ)　夕暮(ゆうぐ)れの教室(きょうしつ)',
    '生徒(せいと)B：昨日(きのう)の約束(やくそく)、覚(おぼ)えてる？',
    '生徒(せいと)A：もちろん。一本(いっぽん)の鉛筆(えんぴつ)を貸(か)してくれた人(ひと)だよ。',
    '生徒(せいと)B：二人(ふたり)分(ぶん)のパンを買(か)ってきた。三分(さんぷん)で食(た)べられるかな。',
    '生徒(せいと)A：辛(つら)い話(はなし)じゃないよ。風(かぜ)の音(おと)を聞(き)きながら帰(かえ)ろう。',
  ]);
  // Counter readings are certain; the heteronyms stay in the review queue with both readings.
  assert.equal(tokenOf(lines[1], '一本').needsReview, false);
  assert.equal(tokenOf(lines[2], '三分').needsReview, false);
  const spicy = collectReviewGroups(lines).filter(group => group.surface === '辛い');
  assert.deepEqual(spicy.map(group => [group.currentRuby, [...group.alternatives].sort()]), [
    ['からい', ['からい', 'つらい']],
    ['つらい', ['からい', 'つらい']],
  ]);
});

for (const [text, reading] of [
  ['約束を守る。', 'やくそくをまもる。'],
  ['夕暮れの教室', 'ゆうぐれのきょうしつ'],
  ['一本だけ', 'いっぽんだけ'],
  ['三本の矢', 'さんぼんのや'],
  ['三分待って', 'さんぷんまって'],
  ['十分待った', 'じゅっぷんまった'],
  ['一分と八分', 'いっぷんとはっぷん'],
  ['二十分', 'にじゅっぷん'],
  ['三分の一', 'さんぶんのいち'],
  ['十分に休んだ', 'じゅうぶんにやすんだ'],
  ['一杯の水', 'いっぱいのみず'],
  ['一冊と三階', 'いっさつとさんがい'],
  ['何本ある？', 'なんぼんある？'],
  ['何杯飲んだ？', 'なんばいのんだ？'],
  ['何匹いる？', 'なんびきいる？'],
  ['何階ですか', 'なんがいですか'],
  ['何発撃った', 'なんぱつうった'],
  ['何回も', 'なんかいも'],
  ['何歳？', 'なんさい？'],
  ['何週間', 'なんしゅうかん'],
  ['何かある', 'なにかある'],
  ['何でもない', 'なんでもない'],
  ['このラーメン、辛い？', 'このラーメン、からい？'],
  ['ラーメンを食べた。辛い話はやめよう。', 'ラーメンをたべた。つらいはなしはやめよう。'],
]) {
  test(`real dictionary reading: ${text}`, async () => {
    const [line] = await annotate(text);
    assert.equal(readingOf(line), reading);
  });
}

test('manual > imported > glossary > learned > automatic, anchored to the exact line', async () => {
  const base = await annotate(DEMO_SCRIPT);
  assert.equal(tokenOf(base[2], '未来').readingSource, 'automatic');

  const glossary = [noun('未来', 'みく'), noun('希望', 'のぞみ'), noun('佐藤', 'さどう')];
  const glossed = await annotate(DEMO_SCRIPT, { glossary });
  assert.equal(rubyText(glossed[2]), '山田(やまだ)先生(せんせい)：これは「未来(みく)」と「希望(のぞみ)」です。');
  assert.deepEqual([tokenOf(glossed[2], '未来').readingSource, tokenOf(glossed[2], '未来').needsReview], ['glossary', false]);
  assert.equal(rubyText(glossed[0]), DEMO_RUBY[0]);

  // Readings learned from review apply in the same context but never override the glossary.
  const learned = [
    makeLearnedReading(selectReviewWord(base[1], tokenIndex(base[1], '何')), 'なに', 'hiragana'),
    makeLearnedReading(selectReviewWord(base[1], tokenIndex(base[1], '佐藤')), 'さとう', 'hiragana'),
  ];
  const withLearned = await annotate(DEMO_SCRIPT, { glossary, learned });
  assert.deepEqual([tokenOf(withLearned[1], '何').ruby, tokenOf(withLearned[1], '何').readingSource], ['なに', 'learned']);
  assert.deepEqual([tokenOf(withLearned[1], '佐藤').ruby, tokenOf(withLearned[1], '佐藤').readingSource], ['さどう', 'glossary']);

  // Imported ruby (DOCX source) beats glossary and learned readings.
  const sourceOverrides = [anchored(DEMO_LINES[2], '希望', 'きぼう'), anchored(DEMO_LINES[1], '何', 'なん')];
  const imported = await annotate(DEMO_SCRIPT, { glossary, learned, sourceOverrides });
  assert.deepEqual([tokenOf(imported[2], '希望').ruby, tokenOf(imported[2], '希望').readingSource], ['きぼう', 'source']);
  assert.deepEqual([tokenOf(imported[1], '何').ruby, tokenOf(imported[1], '何').readingSource], ['なん', 'source']);
  assert.equal(tokenOf(imported[2], '未来').ruby, 'みく');

  // Manual corrections beat everything; an empty reading removes the annotation.
  const overrides = [
    anchored(DEMO_LINES[2], '未来', 'あした'),
    anchored(DEMO_LINES[2], '希望', 'ねがい'),
    anchored(DEMO_LINES[2], '山田', 'さんだ'),
    anchored(DEMO_LINES[1], '漢字', ''),
  ];
  const corrected = await annotate(DEMO_SCRIPT, { glossary, learned, sourceOverrides, overrides });
  assert.equal(rubyText(corrected[2]), '山田(さんだ)先生(せんせい)：これは「未来(あした)」と「希望(ねがい)」です。');
  assert.equal(rubyText(corrected[1]), '佐藤(さどう)：先生(せんせい)、この漢字の読(よ)み方(かた)は何(なん)ですか？');
  assert.deepEqual([tokenOf(corrected[1], '漢字').annotationSuppressed, tokenOf(corrected[1], '漢字').needsReview], [true, false]);
  // The same surface on another line keeps its own reading.
  assert.equal(rubyText(corrected[0]), DEMO_RUBY[0]);
  const reviewed = new Set(collectReviewGroups(corrected).map(group => group.surface));
  for (const surface of ['未来', '希望', '山田', '漢字', '佐藤', '何']) assert.equal(reviewed.has(surface), false, surface);

  // Katakana mode formats every layer the same way.
  const katakana = await annotate(DEMO_SCRIPT, { rubyType: 'katakana', glossary, learned, sourceOverrides, overrides });
  assert.equal(rubyText(katakana[2]), '山田(サンダ)先生(センセイ)：これは「未来(アシタ)」と「希望(ネガイ)」です。');
});

test('a manual correction inside a longer glossary match leaves the remainder flagged, not stale', async () => {
  const lines = await annotate(DEMO_SCRIPT, {
    glossary: [noun('山田先生', 'やまだせんせい')],
    overrides: [anchored(DEMO_LINES[2], '先生', 'せんせ')],
  });
  assert.equal(rubyText(lines[0]).startsWith('山田先生(やまだせんせい)：'), true);
  const remainder = tokenOf(lines[2], '山田');
  assert.deepEqual([remainder.ruby, remainder.needsReview], [undefined, true]);
  assert.equal(tokenOf(lines[2], '先生').ruby, 'せんせ');
});

test('TXT export writes each line with inline readings and reads back as the same paragraphs', async () => {
  const lines = await annotate(DEMO_SCRIPT, { overrides: [anchored(DEMO_LINES[1], '先生', 'せんせ')] });
  const txt = generateTXT(lines);
  assert.equal(txt, [DEMO_RUBY[0], DEMO_RUBY[1].replace('先生(せんせい)', '先生(せんせ)'), DEMO_RUBY[2], DEMO_RUBY[3]].join('\n\n'));
  // The file holds the readings inline; importTextScript (below) turns them back into source readings.
  const reimported = await new File([txt], '放課後_dubbing.txt', { type: 'text/plain' }).text();
  assert.deepEqual(reimported.split('\n\n').map(stripInlineRuby), DEMO_LINES);
});

// Editor, library and batch import all read TXT / SRT through importTextScript.
const { importTextScript, scriptSourceFormat, withLfLineKeys } = loadTypescript('../app/utils/inlineRuby.ts');

test('TXT re-import turns inline 漢字(かな) readings into source readings instead of doubling them', async () => {
  const script = [...DEMO_LINES, '鈴木（くしゃみ）：はっくしょん！'].join('\n');
  const corrections = { glossary: [noun('未来', 'みく')], overrides: [anchored(DEMO_LINES[1], '先生', 'せんせ')] };
  const lines = await annotate(script, corrections);
  const file = new File([generateTXT(lines)], '放課後.txt', { type: 'text/plain' });
  const imported = importTextScript(file.name, await file.text());
  // Each line is its own TXT paragraph; the readings are gone from the text, stage directions stay.
  assert.equal(imported.text, script.split('\n').join('\n\n'));
  assert.equal(imported.text.includes('（くしゃみ）'), true);

  const again = (await annotate(imported.text, { sourceOverrides: imported.overrides })).filter(line => line.cleanText);
  assert.deepEqual(again.map(rubyText), lines.map(rubyText), 'same readings, nothing doubled');
  assert.deepEqual([tokenOf(again[1], '先生').ruby, tokenOf(again[1], '先生').readingSource], ['せんせ', 'source']);
  assert.deepEqual([tokenOf(again[2], '未来').ruby, tokenOf(again[2], '未来').readingSource], ['みく', 'source']);
  assert.equal(generateTXT(again), generateTXT(lines), 'a second round trip is stable');

  // Katakana exports come back the same way.
  const katakana = await annotate(script, { ...corrections, rubyType: 'katakana' });
  const fromKatakana = importTextScript('k.txt', generateTXT(katakana));
  const katakanaAgain = await annotate(fromKatakana.text, { rubyType: 'katakana', sourceOverrides: fromKatakana.overrides });
  assert.deepEqual(katakanaAgain.filter(line => line.cleanText).map(rubyText), katakana.map(rubyText));

  // A CRLF file: editor / batch annotate the raw lines; the library stores LF text with LF keys.
  const crlf = generateTXT(lines).replace(/\n/g, '\r\n');
  const raw = importTextScript('crlf.txt', crlf);
  const rawLines = (await annotate(raw.text, { sourceOverrides: raw.overrides })).filter(line => line.cleanText.trim());
  assert.deepEqual(rawLines.map(line => rubyText(line).replace(/\r$/, '')), lines.map(rubyText));
  for (const overrides of [withLfLineKeys(raw.overrides), importTextScript('crlf.txt', crlf.replace(/\r\n?/g, '\n')).overrides]) {
    const library = await upsertBook(emptyLibraryDatabase(), { title: 'crlf.txt', content: raw.text, format: scriptSourceFormat('crlf.txt'), sourceOverrides: overrides });
    const book = Object.values(library.books)[0];
    assert.equal(book.format, 'txt');
    const shelved = (await annotate(book.content, { sourceOverrides: book.sourceOverrides })).filter(line => line.cleanText);
    assert.deepEqual(shelved.map(rubyText), lines.map(rubyText));
  }
});

test('SRT re-import strips inline readings from cues and text, so export -> import -> export is byte-stable', async () => {
  const parsed = importTextScript('第2話.srt', SRT_SOURCE);
  assert.deepEqual(parsed.overrides, []);
  const lines = await annotate(parsed.text, { overrides: [anchored('佐藤：先生、この漢字の読み方は何ですか？', '先生', 'せんせ')] });
  const exported = generateSRT(lines, parsed.cues);

  const reimported = importTextScript('第2話.srt', exported);
  assert.equal(reimported.text, parsed.text);
  assert.deepEqual(reimported.cues, parsed.cues);
  const again = await annotate(reimported.text, { sourceOverrides: reimported.overrides });
  assert.deepEqual([tokenOf(again[2], '先生').ruby, tokenOf(again[2], '先生').readingSource], ['せんせ', 'source']);
  assert.equal(generateSRT(again, reimported.cues), exported);
  assert.equal(scriptSourceFormat('第2話.srt'), 'srt');
});

test('okurigana words corrected as one token export as 漢字(かな)送り and survive TXT and SRT round trips', async () => {
  const script = ['佐藤：この漢字の読み方は難しい。', '鈴木：辛い話はやめよう。', '取り扱い説明書を読んだ。'].join('\n');
  const corrections = {
    glossary: [noun('読み方', 'よみかた'), noun('取り扱い説明書', 'とりあつかいせつめいしょ')],
    overrides: [anchored('鈴木：辛い話はやめよう。', '辛い', 'つらい')],
  };
  const lines = await annotate(script, corrections);
  for (const [index, surface, ruby] of [[0, '読み方', 'よみかた'], [1, '辛い', 'つらい'], [2, '取り扱い説明書', 'とりあつかいせつめいしょ']]) {
    assert.equal(tokenOf(lines[index], surface).ruby, ruby, 'one token holds the whole word');
  }
  const txt = generateTXT(lines);
  // The reading sits on the kanji only, so the strict importer takes it; an ambiguous split keeps the whole word.
  assert.equal(txt.includes('辛い('), false);
  assert.match(txt, /辛\(つら\)い話/);
  assert.match(txt, /読\(よ\)み方\(かた\)/);
  assert.match(txt, /取り扱い説明書\(とりあつかいせつめいしょ\)/);

  const imported = importTextScript('okuri.txt', txt);
  assert.equal(imported.text, script.split('\n').join('\n\n'), 'no reading is left in the text');
  const again = (await annotate(imported.text, { sourceOverrides: imported.overrides })).filter(line => line.cleanText);
  assert.deepEqual(again.map(readingOf), lines.map(readingOf), 'same readings, nothing doubled');
  assert.equal(generateTXT(again), txt, 'TXT export -> import -> export is stable');

  const srt = generateSRT(lines);
  const fromSrt = importTextScript('okuri.srt', srt);
  assert.equal(fromSrt.text, script);
  const srtAgain = await annotate(fromSrt.text, { sourceOverrides: fromSrt.overrides });
  assert.equal(generateSRT(srtAgain, fromSrt.cues), srt, 'SRT export -> import -> export is stable');
});

test('every starter script survives TXT and SRT export -> import -> export unchanged', async () => {
  const library = await createStarterBooks(1_700_000_000_000);
  for (const book of Object.values(library.books)) {
    const lines = (await annotate(book.content)).filter(line => line.cleanText);
    const txt = generateTXT(lines);
    const fromTxt = importTextScript(`${book.title}.txt`, txt);
    const txtAgain = (await annotate(fromTxt.text, { sourceOverrides: fromTxt.overrides })).filter(line => line.cleanText);
    assert.equal(generateTXT(txtAgain), txt, book.title);
    assert.deepEqual(txtAgain.map(line => line.cleanText), lines.map(line => line.cleanText), book.title);

    const srt = generateSRT(lines);
    const fromSrt = importTextScript(`${book.title}.srt`, srt);
    const srtAgain = await annotate(fromSrt.text, { sourceOverrides: fromSrt.overrides });
    assert.equal(generateSRT(srtAgain, fromSrt.cues), srt, book.title);
  }
});

test('SRT export keeps cue numbers, timings and grouping through a re-import', async () => {
  const parsed = parseSRT(SRT_SOURCE);
  assert.deepEqual(parsed.cues.map(({ index, start, end }) => [index, start, end]), [
    ['12', '00:00:01,250', '00:00:03,900'], ['13', '00:00:04,000', '00:00:06,500'], ['14', '01:02:03,004', '01:02:05,000'],
  ]);
  // The file's final newline is not an extra caption line.
  assert.deepEqual(parsed.cues[2].lines, ['鈴木：一本だけ、三分で約束の教室へ！']);
  assert.equal(parsed.text.split('\n').length, 4);
  const lines = await annotate(parsed.text, { overrides: [anchored('佐藤：先生、この漢字の読み方は何ですか？', '先生', 'せんせ')] });
  const exported = generateSRT(lines, parsed.cues);
  assert.equal(exported, [
    '12', '00:00:01,250 --> 00:00:03,900',
    '山田(やまだ)先生(せんせい)：みなさん、こんにちは！',
    '今日(きょう)の日本語(にほんご)アフレコ台本(だいほん)へようこそ。',
    '',
    '13', '00:00:04,000 --> 00:00:06,500',
    '佐藤(さとう)：先生(せんせ)、この漢字(かんじ)の読(よ)み方(かた)は何(なん)ですか？',
    '',
    '14', '01:02:03,004 --> 01:02:05,000',
    '鈴木(すずき)：一本(いっぽん)だけ、三分(さんぷん)で約束(やくそく)の教室(きょうしつ)へ！',
    '',
  ].join('\n'));

  const reparsed = parseSRT(exported);
  assert.deepEqual(reparsed.cues.map(({ index, start, end, lines: rows }) => [index, start, end, rows.length]),
    parsed.cues.map(({ index, start, end, lines: rows }) => [index, start, end, rows.length]));
  assert.deepEqual(reparsed.text.split('\n'), lines.map(rubyText));
  assert.equal(stripInlineRuby(reparsed.text), parsed.text);
  // Library books keep the parsed cues; exporting again reuses them unchanged.
  assert.equal(generateSRT(lines, reparsed.cues), exported);
  // A changed line count falls back to generated sequential timings.
  const regenerated = generateSRT([...lines, ...(await annotate('教室へ'))], parsed.cues);
  assert.match(regenerated, /^1\n00:00:00,000 --> 00:00:03,000\n山田\(やまだ\)/);
  assert.match(regenerated, /\n5\n00:00:16,000 --> 00:00:19,000\n教室\(きょうしつ\)へ\n$/);
});

test('VTT import normalizes WebVTT timings and markup, then exports as SRT', async () => {
  const vtt = [
    '\uFEFFWEBVTT - 放課後',
    'Kind: captions',
    'Language: ja',
    '',
    'NOTE 第1話のリハーサル用',
    '',
    'intro',
    '00:00:01.000 --> 00:00:03.500 align:start position:10%',
    '<v 山田先生>みなさん、こんにちは！</v>',
    '',
    '00:04.000 --> 00:06.250',
    '<c.yellow>佐藤</c>：「<ruby>未来<rt>みらい</rt></ruby>」と「希望」&amp;約束',
    '<c></c>',
    '',
    '1:00:07.000 --> 1:00:09.000',
    '一本だけ',
    '三分で教室へ',
    '',
  ].join('\r\n');
  const parsed = parseVTT(vtt);
  assert.deepEqual(parsed.cues, [
    { index: '1', start: '00:00:01,000', end: '00:00:03,500', lines: ['山田先生：みなさん、こんにちは！'] },
    { index: '2', start: '00:00:04,000', end: '00:00:06,250', lines: ['佐藤：「未来」と「希望」&約束'] },
    { index: '3', start: '01:00:07,000', end: '01:00:09,000', lines: ['一本だけ', '三分で教室へ'] },
  ]);
  assert.equal(parsed.text, '山田先生：みなさん、こんにちは！\n佐藤：「未来」と「希望」&約束\n一本だけ\n三分で教室へ');

  const lines = await annotate(parsed.text);
  const srt = generateSRT(lines, parsed.cues);
  assert.equal(srt.split('\n\n')[0], '1\n00:00:01,000 --> 00:00:03,500\n山田(やまだ)先生(せんせい)：みなさん、こんにちは！');
  assert.equal(srt.split('\n\n')[2], '3\n01:00:07,000 --> 01:00:09,000\n一本(いっぽん)だけ\n三分(さんぷん)で教室(きょうしつ)へ\n');
  assert.deepEqual(parseSRT(srt).cues.map(({ start, end }) => [start, end]), parsed.cues.map(({ start, end }) => [start, end]));
});

test('DOCX export re-imports to the identical script, ruby and correction record', async () => {
  const title = '放課後_dubbing';
  const fingerprint = await fingerprintText(DEMO_SCRIPT);
  const resolved = resolveScript(emptyDatabase(), title, DEMO_SCRIPT, fingerprint);
  const database = setScriptOverrides(resolved.database, resolved.scriptId, [
    anchored(DEMO_LINES[1], '先生', 'せんせ'),
    anchored(DEMO_LINES[1], '漢字', ''),
  ]);
  const glossary = [noun('未来', 'みく')];
  const lines = await annotate(DEMO_SCRIPT, { glossary, overrides: database.scripts[resolved.scriptId].overrides });
  const blob = await buildDocxBlob(lines, { title });

  const xml = await documentXml(await blob.arrayBuffer());
  assert.equal(xml.includes('dubbing'), false);
  assert.equal(xml.split('>放課後<').length, 2, 'cleaned title appears once, as the heading');

  const imported = await importDocx(await blob.arrayBuffer());
  assert.equal(imported.text, DEMO_SCRIPT, 'the exporter title must not come back as a script line');
  assert.deepEqual(imported.overrides.filter(entry => entry.line === DEMO_LINES[1]).map(({ start, surface, reading }) => [start, surface, reading]), [
    [0, '佐藤', 'さとう'], [3, '先生', 'せんせ'], [11, '読', 'よ'], [13, '方', 'かた'], [15, '何', 'なん'],
  ]);
  assert.equal(imported.overrides.find(entry => entry.surface === '未来').reading, 'みく');

  // Same text -> same fingerprint -> the editor re-links the stored corrections.
  const reimportedFingerprint = await fingerprintText(imported.text);
  assert.equal(reimportedFingerprint, fingerprint);
  const relinked = resolveScript(database, '放課後', imported.text, reimportedFingerprint);
  assert.equal(relinked.scriptId, resolved.scriptId);
  const restored = await annotate(imported.text, { sourceOverrides: imported.overrides, overrides: relinked.database.scripts[relinked.scriptId].overrides });
  assert.deepEqual(restored.map(rubyText), lines.map(rubyText));
  assert.equal(tokenOf(restored[2], '未来').readingSource, 'source');
  assert.equal(tokenOf(restored[1], '先生').readingSource, 'manual');
  assert.equal(tokenOf(restored[1], '漢字').annotationSuppressed, true);

  // Readings exported in katakana come back as kana and render again in either mode.
  const katakana = await annotate(DEMO_SCRIPT, { rubyType: 'katakana' });
  const fromKatakana = await importDocx(await (await buildDocxBlob(katakana, { title })).arrayBuffer());
  assert.equal(fromKatakana.overrides[0].reading, 'やまだ');
  const again = await annotate(fromKatakana.text, { rubyType: 'katakana', sourceOverrides: fromKatakana.overrides });
  assert.deepEqual(again.map(rubyText), katakana.map(rubyText));
});

test('DOCX import keeps a heading the user wrote; only the exporter title is dropped', () => {
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraph = (text, extra = '') => `<w:p>${extra}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const result = parseDocxXml(`<w:document xmlns:w="${ns}"><w:body>${[
    paragraph('放課後', '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:bookmarkStart w:id="1" w:name="_FuriganaTitle"/>'),
    paragraph('第1話', '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:bookmarkStart w:id="2" w:name="_Toc1"/>'),
    paragraph('生徒A：一本だけ。'),
  ].join('')}</w:body></w:document>`);
  assert.equal(result.text, '第1話\n生徒A：一本だけ。');
});

test('batch ZIP holds one cleaned file name per script with the annotated contents', async () => {
  const docxSource = await buildDocxBlob(await annotate(DEMO_SCRIPT, { overrides: [anchored(DEMO_LINES[1], '先生', 'せんせ')] }), { title: '台本' });
  const files = [
    new File([DEMO_SCRIPT], '放課後_dubbing.txt'),
    new File([SRT_SOURCE], '第2話-DUBBING.srt'),
    new File([await docxSource.arrayBuffer()], '台本_dubbing_dubbing.docx'),
    new File(['一本だけ'], '放課後.txt'),
    new File(['三分'], '_dubbing.txt'),
  ];

  // Mirrors the batch queue: parse by extension, annotate, render, name by cleaned title.
  async function runBatch(format) {
    const outputs = [];
    for (const file of files) {
      const lower = file.name.toLowerCase();
      let text;
      let sourceOverrides = [];
      let cues = [];
      if (lower.endsWith('.docx')) ({ text, overrides: sourceOverrides } = await importDocx(await file.arrayBuffer()));
      else if (lower.endsWith('.srt')) ({ text, cues } = parseSRT(await file.text()));
      else text = await file.text();
      const title = file.name.replace(/\.[^/.]+$/, '');
      const lines = await annotate(text, { sourceOverrides });
      const blob = format === 'docx' ? await buildDocxBlob(lines, { title })
        : new Blob([format === 'srt' ? generateSRT(lines, cues) : generateTXT(lines)], { type: 'text/plain' });
      outputs.push({ filename: `${cleanScriptTitle(title) || 'japanese_script'}.${format}`, blob });
    }
    return JSZip.loadAsync(await (await buildBatchZipBlob(outputs)).arrayBuffer());
  }

  for (const format of ['txt', 'srt', 'docx']) {
    const zip = await runBatch(format);
    const names = Object.keys(zip.files);
    assert.deepEqual(names, ['放課後', '第2話', '台本', '放課後 (2)', 'japanese_script'].map(name => `${name}.${format}`));
    assert.equal(names.some(name => /dubbing/i.test(name)), false);
    if (format === 'txt') {
      assert.equal(await zip.file('放課後.txt').async('string'), DEMO_RUBY.join('\n\n'));
      assert.equal(await zip.file('放課後 (2).txt').async('string'), '一本(いっぽん)だけ');
      assert.equal(await zip.file('japanese_script.txt').async('string'), '三分(さんぷん)');
      assert.match(await zip.file('台本.txt').async('string'), /佐藤\(さとう\)：先生\(せんせ\)、/);
    } else if (format === 'srt') {
      const subtitle = await zip.file('第2話.srt').async('string');
      assert.deepEqual(parseSRT(subtitle).cues.map(({ index, start, end }) => [index, start, end]),
        parseSRT(SRT_SOURCE).cues.map(({ index, start, end }) => [index, start, end]));
      assert.match(await zip.file('放課後.srt').async('string'), /^1\n00:00:00,000 --> 00:00:03,000\n山田\(やまだ\)先生\(せんせい\)：/);
    } else {
      const script = await importDocx(await zip.file('放課後.docx').async('arraybuffer'));
      assert.equal(script.text, DEMO_SCRIPT);
      const corrected = await importDocx(await zip.file('台本.docx').async('arraybuffer'));
      assert.equal(corrected.text, DEMO_SCRIPT);
      assert.ok(corrected.overrides.some(entry => entry.surface === '先生' && entry.reading === 'せんせ'));
      const subtitle = await importDocx(await zip.file('第2話.docx').async('arraybuffer'));
      assert.equal(subtitle.text, parseSRT(SRT_SOURCE).text);
      for (const name of names) {
        const xml = await documentXml(await zip.file(name).async('arraybuffer'));
        assert.equal(/dubbing/i.test(xml), false, name);
        const heading = name === 'japanese_script.docx' ? '日语假名配音台本' : name.replace(/(?: \(2\))?\.docx$/, '');
        assert.ok(xml.includes(`>${heading}<`), `${name} has the cleaned title as its heading`);
      }
    }
  }
});

test('library backup restores imported books, progress and bookmarks, and rejects malformed input', async () => {
  const docx = await importDocx(await (await buildDocxBlob(
    await annotate(DEMO_SCRIPT, { overrides: [anchored(DEMO_LINES[1], '先生', 'せんせ')] }), { title: '放課後' })).arrayBuffer());
  const srt = parseSRT(SRT_SOURCE);
  let db = await createStarterBooks(100);
  db = await upsertBook(db, { bookId: 'book:docx', title: '放課後_dubbing.docx', content: docx.text, format: 'docx', sourceOverrides: docx.overrides, now: 200 });
  db = await upsertBook(db, { bookId: 'book:srt', title: '第2話.srt', content: srt.text, format: 'srt', category: 'subtitle', srtCues: srt.cues, now: 210 });
  db = updateReadingProgress(db, 'book:docx', { chapterIndex: 0, lineIndex: 2, percentage: 66.5 }, 300);
  db = addBookmark(db, 'book:docx', { id: 'bookmark:mirai', chapterIndex: 0, lineIndex: 2, label: '未来', snippet: DEMO_LINES[2] }, 310);
  db = addBookmark(db, 'book:srt', { id: 'bookmark:cue', chapterIndex: 0, lineIndex: 3, label: '一本', snippet: '鈴木：一本だけ' }, 320);
  db = toggleBookFavorite(db, 'book:srt', 330);
  db = updateBookMetadata(db, 'book:docx', { author: ' 生徒A ', description: '練習用', coverUrl: 'https://example.com/cover.jpg' }, 340);
  assert.equal(db.books['book:docx'].title, '放課後');

  const raw = exportLibraryBackup(db);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['books', 'folders', 'kind', 'version']);
  const restored = importLibraryBackup(emptyLibraryDatabase(), raw);
  assert.deepEqual(restored, db);
  assert.deepEqual(importLibraryBackup(db, raw), db, 're-importing the same backup is a no-op');

  // Restored books render exactly as before: source ruby and subtitle timings survive.
  const book = restored.books['book:docx'];
  const before = await annotate(db.books['book:docx'].content, { sourceOverrides: db.books['book:docx'].sourceOverrides });
  const after = await annotate(book.content, { sourceOverrides: book.sourceOverrides });
  assert.deepEqual(after.map(rubyText), before.map(rubyText));
  assert.equal(tokenOf(after[1], '先生').ruby, 'せんせ');
  assert.deepEqual([book.readingProgress.lineIndex, book.readingProgress.percentage, book.author, book.coverUrl], [2, 66.5, '生徒A', 'https://example.com/cover.jpg']);
  assert.deepEqual(restored.books['book:srt'].bookmarks.map(item => item.id), ['bookmark:cue']);
  assert.equal(restored.books['book:srt'].favorite, true);
  const subtitleLines = await annotate(restored.books['book:srt'].content);
  assert.equal(generateSRT(subtitleLines, restored.books['book:srt'].srtCues), generateSRT(subtitleLines, srt.cues));

  const snapshot = structuredClone(db);
  const tampered = mutate => {
    const value = JSON.parse(raw);
    mutate(value.books);
    return JSON.stringify(value);
  };
  for (const [input, error] of [
    ['{"kind":"furigana-library"', /JSON/],
    [JSON.stringify({ kind: 'furigana-library', version: 3, books: {} }), /备份格式无效/],
    [tampered(books => { books['book:docx'].fingerprint = 'sha256:nope'; }), /台本记录无效/],
    [tampered(books => { books['book:docx'].sourceOverrides[0].surface = '未来'; }), /台本注音损坏/],
    [tampered(books => { books['book:docx'].bookmarks[0].lineIndex = -1; }), /书签行号无效/],
    [tampered(books => { books['book:docx'].readingProgress.percentage = null; }), /阅读百分比无效/],
    [tampered(books => { books['book:srt'].srtCues[0].lines = '鈴木'; }), /字幕时间轴格式无效/],
    [tampered(books => { books['book:new'] = { ...books['book:srt'], bookId: 'book:wrong' }; }), /台本记录无效/],
  ]) {
    assert.throws(() => importLibraryBackup(db, input), error);
  }
  assert.deepEqual(db, snapshot, 'a rejected backup leaves the library untouched');
});
