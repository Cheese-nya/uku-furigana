import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTypescript } from './loadTypescript.mjs';

const {
  stripInlineRuby, extractInlineRuby, extractSubtitleInlineRuby, importTextScript, scriptSourceFormat, withLfLineKeys,
} = loadTypescript('../app/utils/inlineRuby.ts');
const { parseSRT, generateTXT, generateSRT, inlineRubyText } = loadTypescript('../app/utils/srt.ts');

const spans = line => stripInlineRuby(line).rubies.map(({ start, surface, reading }) => [start, surface, reading]);

test('half-width kana readings after a kanji run are stripped and anchored to the stripped line', () => {
  const line = '山田(やまだ)先生(せんせい)：これは「未来(みらい)」です。';
  assert.equal(stripInlineRuby(line).text, '山田先生：これは「未来」です。');
  assert.deepEqual(spans(line), [[0, '山田', 'やまだ'], [2, '先生', 'せんせい'], [9, '未来', 'みらい']]);
  // Automatic export splits okurigana: each reading belongs to its own kanji run.
  assert.deepEqual(spans('読(よ)み方(かた)は何(なん)ですか'), [[0, '読', 'よ'], [2, '方', 'かた'], [4, '何', 'なん']]);
  // Katakana-mode exports come back as kana, stored as hiragana like DOCX ruby.
  assert.deepEqual(spans('山田(ヤマダ)'), [[0, '山田', 'やまだ']]);
  // 々 and supplementary-plane kanji are part of the run; offsets are UTF-16 like the rest of the app.
  assert.deepEqual(spans('人々(ひとびと)と𠮟(しか)る'), [[0, '人々', 'ひとびと'], [3, '𠮟', 'しか']]);
  assert.deepEqual(spans('三ヶ月(さんかげつ)'), [[0, '三ヶ月', 'さんかげつ']]);
});

test('only half-width, pure-kana parentheses directly after kanji count as app-exported ruby', () => {
  for (const line of [
    '鈴木（くしゃみ）：はっくしょん！', // full-width is always a stage direction
    '鈴木（すずき）',
    '鈴木(笑)：ふふ', // kanji content
    '漢字(kanji)', // romaji content
    'ねえ(ささやき)', // after kana
    '「はい」(小声)',
    '漢字 (かんじ)', // not directly after the kanji
    '漢字()',
    '辛い(つらい)', // after okurigana, not after a kanji run
    '(かな)だけ',
  ]) {
    assert.deepEqual(stripInlineRuby(line), { text: line, rubies: [] }, line);
  }
  // Mixed: the stage direction stays, the exported reading goes.
  assert.equal(stripInlineRuby('鈴木(すずき)（くしゃみ）：はっくしょん！').text, '鈴木（くしゃみ）：はっくしょん！');
});

test('a corrected word with okurigana inside keeps its whole surface when the reading spells it out', () => {
  assert.deepEqual(spans('この読み方(よみかた)で'), [[2, '読み方', 'よみかた']]);
  assert.deepEqual(spans('取り扱い説明書(とりあつかいせつめいしょ)'), [[0, '取り扱い説明書', 'とりあつかいせつめいしょ']]);
  assert.deepEqual(spans('読み方(ヨミカタ)'), [[0, '読み方', 'よみかた']]);
  // Without that alignment the reading stays on the kanji run itself.
  assert.deepEqual(spans('大きい家(いえ)'), [[3, '家', 'いえ']]);
  assert.deepEqual(spans('漢字の読(よ)み'), [[3, '読', 'よ']]);
});

test('a single pass: already doubled readings lose exactly one layer', () => {
  assert.deepEqual(stripInlineRuby('山田(やまだ)(やまだ)'), { text: '山田(やまだ)', rubies: [{ start: 0, surface: '山田', reading: 'やまだ' }] });
});

test('extractInlineRuby returns source overrides keyed exactly like the annotator splits lines', () => {
  const plain = '山田先生：みなさん\n鈴木（くしゃみ）';
  const untouched = extractInlineRuby(plain);
  assert.equal(untouched.text, plain);
  assert.deepEqual(untouched.overrides, []);

  const { text, overrides } = extractInlineRuby('山田(やまだ)先生(せんせい)\r\n\r\n佐藤(さとう)：はい\n鈴木（くしゃみ）');
  assert.equal(text, '山田先生\r\n\r\n佐藤：はい\n鈴木（くしゃみ）');
  assert.deepEqual(overrides, [
    { line: '山田先生\r', start: 0, surface: '山田', reading: 'やまだ', type: 'hiragana' },
    { line: '山田先生\r', start: 2, surface: '先生', reading: 'せんせい', type: 'hiragana' },
    { line: '佐藤：はい', start: 0, surface: '佐藤', reading: 'さとう', type: 'hiragana' },
  ]);
  for (const entry of overrides) assert.equal(entry.line.slice(entry.start, entry.start + entry.surface.length), entry.surface);
  // Library books store LF text; the keys follow.
  assert.deepEqual(withLfLineKeys(overrides).map(entry => entry.line), ['山田先生', '山田先生', '佐藤：はい']);
  const lf = [{ line: '佐藤', start: 0, surface: '佐藤', reading: 'さとう', type: 'hiragana' }];
  assert.equal(withLfLineKeys(lf), lf);
});

test('identical lines share one override key and the first reading of a range wins', () => {
  const { text, overrides } = extractInlineRuby('辛(から)い\n辛(から)い\n辛(つら)い');
  assert.equal(text, '辛い\n辛い\n辛い');
  assert.deepEqual(overrides, [{ line: '辛い', start: 0, surface: '辛', reading: 'から', type: 'hiragana' }]);
});

test('subtitle import strips cue rows and text together; plain text and broken subtitles fall back', () => {
  const srt = '7\n00:00:01,000 --> 00:00:02,000\n山田(やまだ)：はい\n一本(いっぽん)だけ\n\n8\n00:00:03,000 --> 00:00:04,000\n鈴木（くしゃみ）\n';
  const imported = importTextScript('第2話.SRT', srt);
  assert.equal(imported.text, '山田：はい\n一本だけ\n鈴木（くしゃみ）');
  assert.deepEqual(imported.cues.map(cue => [cue.index, cue.start, cue.lines]), [
    ['7', '00:00:01,000', ['山田：はい', '一本だけ']], ['8', '00:00:03,000', ['鈴木（くしゃみ）']],
  ]);
  assert.equal(imported.cues.flatMap(cue => cue.lines).join('\n'), imported.text);
  assert.deepEqual(imported.overrides.map(({ line, surface, reading }) => [line, surface, reading]),
    [['山田：はい', '山田', 'やまだ'], ['一本だけ', '一本', 'いっぽん']]);
  // Nothing to strip: the parsed cues are returned as they are.
  const parsed = parseSRT('1\n00:00:01,000 --> 00:00:02,000\n山田：はい\n');
  assert.equal(extractSubtitleInlineRuby(parsed).cues, parsed.cues);

  const vtt = importTextScript('a.vtt', 'WEBVTT\n\n00:01.000 --> 00:02.000\n<v 山田>未来(みらい)へ</v>\n');
  assert.deepEqual([vtt.text, vtt.cues[0].start, vtt.overrides[0].surface], ['山田：未来へ', '00:00:01,000', '未来']);

  assert.deepEqual(importTextScript('notes.txt', '未来(みらい)'), { text: '未来', overrides: [{ line: '未来', start: 0, surface: '未来', reading: 'みらい', type: 'hiragana' }], cues: [] });
  // No valid cue: plain text, still stripped. Callers that need timings check `cues`.
  assert.deepEqual(importTextScript('broken.srt', '未来(みらい)'), importTextScript('notes.txt', '未来(みらい)'));
});

test('library format follows the source file, never the export target', () => {
  assert.deepEqual(['a.docx', 'B.DOCX', 'c.srt', 'd.vtt', 'e.txt', 'f.md', 'noext'].map(scriptSourceFormat),
    ['docx', 'docx', 'srt', 'srt', 'txt', 'txt', 'txt']);
});

test('inline export puts the reading on the kanji only, so okurigana stays outside the parentheses', () => {
  const cases = [
    // Aligned: kana between kanji runs is spelled out verbatim in the reading.
    [['辛い', 'つらい'], '辛(つら)い'],
    [['読み方', 'よみかた'], '読(よ)み方(かた)'],
    [['お願い', 'おねがい'], 'お願(ねが)い'],
    [['読み方', 'ヨミカタ'], '読(ヨ)み方(カタ)'],
    [['ドイツ語', 'どいつご'], 'ドイツ語(ご)'],
    [['見た目', 'みため'], '見(み)た目(め)'],
    [['行く', 'ゆく'], '行(ゆ)く'],
    // Unchanged: no okurigana, or no reading.
    [['山田', 'やまだ'], '山田(やまだ)'],
    [['人々', 'ひとびと'], '人々(ひとびと)'],
    [['です', undefined], 'です'],
    // Fallback to the whole word: the kana cannot be found, the split is ambiguous, or the reading is not kana.
    [['辛い', 'つらさ'], '辛い(つらさ)'],
    // い also occurs inside せつめいしょ, so 扱 could end in two places.
    [['取り扱い説明書', 'とりあつかいせつめいしょ'], '取り扱い説明書(とりあつかいせつめいしょ)'],
    [['辛い', 'tsurai'], '辛い(tsurai)'],
  ];
  for (const [[surface, ruby], expected] of cases) assert.equal(inlineRubyText({ surface, ruby }), expected, surface);
});

test('every split export reads back to the same readings on the same kanji', () => {
  const lines = [
    { id: '0', rawText: '', cleanText: '', tokens: [{ surface: '山田', ruby: 'やまだ', hasKanji: true }, { surface: '：', hasKanji: false }] },
    { id: '1', rawText: '', cleanText: '', tokens: [] },
    { id: '2', rawText: '', cleanText: '', tokens: [
      { surface: 'この', hasKanji: false }, { surface: '読み方', ruby: 'よみかた', hasKanji: true },
      { surface: 'は', hasKanji: false }, { surface: '辛い', ruby: 'つらい', hasKanji: true },
      { surface: '（くしゃみ）', hasKanji: false }, { surface: 'お願い', ruby: 'おねがい', hasKanji: true },
    ] },
  ];
  const txt = generateTXT(lines);
  assert.equal(txt, '山田(やまだ)：\n\n\n\nこの読(よ)み方(かた)は辛(つら)い（くしゃみ）お願(ねが)い');
  const imported = importTextScript('a.txt', txt);
  assert.equal(imported.text, '山田：\n\n\n\nこの読み方は辛い（くしゃみ）お願い');
  assert.deepEqual(imported.overrides.map(({ surface, reading }) => [surface, reading]),
    [['山田', 'やまだ'], ['読', 'よ'], ['方', 'かた'], ['辛', 'つら'], ['願', 'ねが']]);
  const srt = importTextScript('a.srt', generateSRT(lines.filter(line => line.tokens.length)));
  assert.equal(srt.text, '山田：\nこの読み方は辛い（くしゃみ）お願い');
  assert.equal(srt.overrides.length, 5);
});

test('the whole-word format of older exports still imports', () => {
  assert.deepEqual(spans('この読み方(よみかた)で'), [[2, '読み方', 'よみかた']]);
  assert.deepEqual(stripInlineRuby('辛い(つらい)'), { text: '辛い(つらい)', rubies: [] });
});

test('editor, library and batch import all go through importTextScript; batch books take the source format', () => {
  const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const page = read('../app/page.tsx');
  const library = read('../app/hooks/useLibraryController.ts');
  const bookImport = read('../app/utils/bookImport.ts');
  const batch = read('../app/hooks/useBatchProcessing.ts');
  assert.match(page, /importTextScript\(file\.name, await file\.text\(\)\)/);
  assert.match(bookImport, /importTextScript\(file\.name, /);
  assert.match(library, /parseBookFile\(file\)/);
  assert.match(batch, /importTextScript\(item\.name, await item\.file\.text\(\)\)/);
  for (const source of [page, library, batch, bookImport]) assert.equal(/\bparseSRT\(|\bparseVtt\b/.test(source), false, 'no private subtitle parsing left');
  assert.match(bookImport, /format: scriptSourceFormat\(file\.name\)/);
  // A content:// pick can arrive without an extension: the detected format then wins.
  assert.match(batch, /format: detectedFormat \?\? scriptSourceFormat\(item\.name\)/);
  assert.equal(/batchTargetFormat === 'docx' \? 'docx'/.test(batch), false, 'the export target must not decide the book format');
  assert.match(page, /return generateTXT\(lines\);/);
  // The editor's "Save to Library" keeps the format of the file the script came from (a DOCX stays docx).
  assert.match(page, /markEditorSource\(resolved\.scriptId, format \?\? scriptSourceFormat\(file\.name\)\)/);
  assert.match(library, /markEditorSource\(resolved\.scriptId, book\.format\)/);
  assert.match(library, /format: editorFormat,/);
  assert.equal(/format: srtCues\.length \? 'srt' : 'txt'/.test(library), false, 'cue presence must not decide the editor book format');
});
