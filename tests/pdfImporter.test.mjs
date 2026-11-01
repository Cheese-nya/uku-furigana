import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { importPdf } = loadTypescript('../app/utils/pdfImporter.ts');
const { ScannedPdfError, imageLine } = loadTypescript('../app/utils/bookAssets.ts');

function makeItem(str, { y = 700, height = 10, hasEOL = true, rot = 0 } = {}) {
  return {
    str,
    transform: [10, rot, 0, height, 50, y],
    width: str.length * 10,
    height,
    hasEOL,
  };
}

test('importPdf joins wrapped Japanese/ASCII lines, respects paragraph breaks, and drops page numbers', async () => {
  const fakeLoader = {
    numPages: 2,
    getPage(n) {
      if (n === 1) {
        return {
          getTextContent() {
            return {
              items: [
                makeItem('　吾輩は猫である。名前はまだ', { y: 760, height: 10, hasEOL: false }),
                makeItem('', { y: 760, height: 10, hasEOL: true }),
                makeItem('無い。', { y: 746, height: 10 }),
                makeItem('「どこで生まれたか', { y: 732, height: 10 }),
                makeItem('とんと見当がつかぬ」', { y: 718, height: 10 }),
                makeItem('続きの文がここで折り返して', { y: 704, height: 10 }),
                makeItem('さらに続く', { y: 690, height: 10 }),
                // Large vertical gap (> 1.6 * 10 = 16): 690 -> 660 (gap 30) starts a new paragraph
                makeItem('ギャップ後の新しい段落でHello', { y: 660, height: 10 }),
                makeItem('Worldと繋がる。', { y: 646, height: 10 }),
                makeItem(' - 1 - ', { y: 40, height: 10 }),
              ],
            };
          },
        };
      }
      return {
        getTextContent() {
          return {
            items: [
              // Rotated text ignores vertical gap check and wraps unless punctuation/indent triggers
              makeItem('縦書き回転テキストの前半', { y: 700, height: 10, rot: 1 }),
              makeItem('と後半が繋がる。', { y: 500, height: 10, rot: 1 }),
              makeItem('（括弧から始まる新しい段落）', { y: 480, height: 10 }),
              makeItem('１２', { y: 30, height: 10 }),
            ],
          };
        },
      };
    },
    getMetadata() {
      return { info: { Title: '吾輩は猫である', Author: '夏目漱石' } };
    },
    getOutline() {
      return null;
    },
    getPageIndex() {
      return 0;
    },
    getDestination() {
      return null;
    },
  };

  const book = await importPdf(new ArrayBuffer(8), 'fallback.pdf', fakeLoader);
  assert.equal(book.title, '吾輩は猫である');
  assert.equal(book.author, '夏目漱石');
  assert.deepEqual(book.overrides, []);
  assert.deepEqual(book.images, []);
  assert.equal(book.cover, undefined);

  assert.deepEqual(book.text.split('\n'), [
    '　吾輩は猫である。名前はまだ無い。',
    '「どこで生まれたかとんと見当がつかぬ」',
    '続きの文がここで折り返してさらに続く',
    'ギャップ後の新しい段落でHello Worldと繋がる。',
    '縦書き回転テキストの前半と後半が繋がる。',
    '（括弧から始まる新しい段落）',
  ]);
});

test('importPdf drops NUL, control characters and lone surrogates from text and metadata', async () => {
  const fakeLoader = {
    numPages: 1,
    getPage() {
      return {
        getTextContent() {
          return {
            items: [
              // pdf.js writes "\u0000" for unmapped glyphs (.notdef / CID 0 fonts); the stray
              // bytes used to travel into the book and crash the tokenizer.
              makeItem('　第一章の冒頭テキストです。\u0000十分な文字数を確保します。', { y: 750 }),
              makeItem('次の行に\u0007制御文字が混ざっています。', { y: 736 }),
            ],
          };
        },
      };
    },
    getMetadata() {
      return { info: { Title: 'タイトル\u0000', Author: '著者\uD800' } };
    },
    getOutline() {
      return null;
    },
    getPageIndex() {
      return 0;
    },
    getDestination() {
      return null;
    },
  };

  const book = await importPdf(new ArrayBuffer(8), 'scan.pdf', fakeLoader);
  assert.equal(book.title, 'タイトル');
  assert.equal(book.author, '著者');
  assert.equal(book.text, '　第一章の冒頭テキストです。十分な文字数を確保します。\n次の行に制御文字が混ざっています。');
  assert.equal(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/u.test(book.text), false);
});

test('importPdf resolves outline chapters and falls back when info.Title is a file path', async () => {
  const pages = [
    [
      makeItem('　第一章の冒頭テキストです。十分な文字数を確保します。', { y: 750 }),
      makeItem('　第一章の二段落目です。', { y: 736 }),
      makeItem('1', { y: 40 }),
    ],
    [
      makeItem('　第二章の冒頭テキストです。こちらも十分な文字数があります。', { y: 750 }),
      makeItem('　第二章の二段落目です。', { y: 736 }),
      makeItem('— 2 —', { y: 40 }),
    ],
  ];

  const fakeLoader = {
    numPages: 2,
    getPage(n) {
      return {
        getTextContent() {
          return { items: pages[n - 1] };
        },
      };
    },
    getMetadata() {
      return { info: { Title: 'C:\\Users\\author\\Documents\\draft.pdf', Author: '' } };
    },
    getOutline() {
      return [
        { title: '第一章', dest: [{ ref: 'p1' }, { name: 'XYZ' }] },
        { title: '壊れた章', dest: 'broken-dest' },
        { title: '第二章', dest: 'named-ch2' },
      ];
    },
    getDestination(name) {
      if (name === 'named-ch2') return [{ ref: 'p2' }, { name: 'XYZ' }];
      return null;
    },
    getPageIndex(ref) {
      if (ref && ref.ref === 'p1') return 0;
      if (ref && ref.ref === 'p2') return 1;
      throw new Error('Unknown page ref');
    },
  };

  const book = await importPdf(new ArrayBuffer(8), '雪国.pdf', fakeLoader);
  assert.equal(book.title, '雪国');
  assert.equal(book.author, '');
  assert.deepEqual(book.chapters, [
    { title: '第一章', startLine: 0, level: 0, page: 1 },
    { title: '第二章', startLine: 2, level: 0, page: 2 },
  ]);
});

test('importPdf throws ScannedPdfError when extracted text is below threshold', async () => {
  const scannedLoader = {
    numPages: 3,
    getPage(n) {
      return {
        getTextContent() {
          return {
            items: [makeItem(`${n}`, { y: 30 })],
          };
        },
      };
    },
    getMetadata() {
      return { info: {} };
    },
    getOutline() {
      return null;
    },
    getPageIndex() {
      return 0;
    },
    getDestination() {
      return null;
    },
  };

  await assert.rejects(
    () => importPdf(new ArrayBuffer(8), 'scanned.pdf', scannedLoader),
    err => {
      assert.ok(err instanceof ScannedPdfError);
      assert.equal(err.name, 'ScannedPdfError');
      assert.equal(err.message, '这是扫描版 PDF，没有可提取的文字');
      return true;
    },
  );
});

test('importPdf (real Chrome-printed layout): wide line spacing joins, indented lines start paragraphs, radicals fold', async () => {
  // Line spacing 25 with 14pt glyphs (line-height 1.8); paragraph starts are indented by one em (x 98 vs 84).
  const at = (str, x, y) => ({ str, transform: [14, 0, 0, 14, x, y], width: str.length * 14, height: 14, hasEOL: true });
  const doc = {
    numPages: 1,
    getPage: () => ({ getTextContent: () => ({ items: [
      at('こんな夢を⾒た。', 98, 641),
      at('腕組をして仰向に寝た⼥が、静かな声でもう', 98, 615),
      at('死にますと云う。⼥は⻑い髪を枕に敷いて', 84, 590),
      at('いる。', 84, 565),
      at('そこで、そうかね、と聞いて見た', 98, 540),
      at('のである', 84, 515),
    ] }) }),
    getMetadata: () => ({ info: {} }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(new ArrayBuffer(0), 'x.pdf', doc);
  assert.deepEqual(book.text.split('\n'), [
    'こんな夢を見た。',
    '腕組をして仰向に寝た女が、静かな声でもう死にますと云う。女は長い髪を枕に敷いている。',
    'そこで、そうかね、と聞いて見たのである',
  ]);
});

test('importPdf (tategaki, one glyph per item): rebuilds columns instead of one character per line', async () => {
  // A vertical page set with a horizontal font reaches pdf.js as one item per glyph, each ending its
  // own "line". Glyphs of a column share an x and descend; columns run right to left. The paragraph
  // joiner used to see every glyph as a paragraph, so the reader showed one character per line.
  const glyph = (ch, x, y) => ({ str: ch, transform: [12, 0, 0, 12, x, y], width: 12, height: 12, hasEOL: true, fontName: 'f1' });
  const column = (text, x, top) => Array.from(text).map((ch, row) => glyph(ch, x, top - row * 14));
  const doc = {
    numPages: 1,
    getPage: () => ({
      getTextContent: () => ({
        items: [
          // The second paragraph starts one glyph below the top margin, as a tategaki indent does.
          ...column('最初の段落の文章がここに続きます', 520, 780),
          ...column('次の段落です。もっと続きます。', 506, 766),
        ],
        styles: { f1: { vertical: false } },
      }),
      getViewport: () => ({ width: 595, height: 842 }),
    }),
    getMetadata: () => ({ info: {} }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(new ArrayBuffer(8), 'tate.pdf', doc);
  assert.deepEqual(book.text.split('\n'), ['最初の段落の文章がここに続きます', '次の段落です。もっと続きます。']);
  assert.equal(book.pdfLayout?.vertical, true);
});

test('importPdf (tategaki, one item per column): joins columns into paragraphs right to left', async () => {
  // pdf.js already groups a vertical font into one item per column; the columns arrive top-aligned
  // and are read right to left, and an x-indent check meant for horizontal text used to split them.
  const at = (str, x, y) => ({ str, transform: [14, 0, 0, 14, x, y], width: 14, height: 14, hasEOL: true, fontName: 'v1' });
  const doc = {
    numPages: 1,
    getPage: () => ({
      getTextContent: () => ({
        items: [
          at('三列目の文章がここから', 476, 780),
          at('最初の列の文章がここに', 520, 780),
          at('二列目の文章が続いて', 498, 780),
        ],
        styles: { v1: { vertical: true } },
      }),
      getViewport: () => ({ width: 595, height: 842 }),
    }),
    getMetadata: () => ({ info: {} }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(new ArrayBuffer(8), 'tate-columns.pdf', doc);
  assert.deepEqual(book.text.split('\n'), ['最初の列の文章がここに二列目の文章が続いて三列目の文章がここから']);
});

test('importPdf (tategaki, one item per column): an indented column starts the next paragraph', async () => {
  // A paragraph's first column begins one glyph below the top margin. Most columns still share the
  // margin, so the page counts as columns, and the indent is where the paragraph breaks.
  const at = (str, x, y) => ({ str, transform: [14, 0, 0, 14, x, y], width: 14, height: 14, hasEOL: true, fontName: 'v1' });
  const doc = {
    numPages: 1,
    getPage: () => ({
      getTextContent: () => ({
        items: [
          at('四列目の段落も続きます', 454, 766),
          at('最初の列の文章がここに', 520, 780),
          at('三列目の文章がここから', 476, 780),
          at('二列目の文章が続いて', 498, 780),
        ],
        styles: { v1: { vertical: true } },
      }),
      getViewport: () => ({ width: 595, height: 842 }),
    }),
    getMetadata: () => ({ info: {} }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(new ArrayBuffer(8), 'tate-indent.pdf', doc);
  assert.deepEqual(book.text.split('\n'), ['最初の列の文章がここに二列目の文章が続いて三列目の文章がここから', '四列目の段落も続きます']);
});

test('importPdf (horizontal, one glyph per item): rejoins the runs instead of one item per line', async () => {
  // Some fonts reach pdf.js as one item per glyph with hasEOL on each, even in horizontal text.
  // The glyph x positions then repeat from line to line, which used to look like tategaki columns.
  const glyph = (ch, x, y) => ({ str: ch, transform: [12, 0, 0, 12, x, y], width: 12, height: 12, hasEOL: true, fontName: 'f1' });
  const row = (text, y) => Array.from(text).map((ch, index) => glyph(ch, 60 + index * 12, y));
  const doc = {
    numPages: 1,
    getPage: () => ({
      getTextContent: () => ({
        items: [
          ...row('最初の行の文章がここに続きます', 760),
          ...row('次の行の文章もここに続きます', 744),
          // A gap of well over one line step starts a new paragraph.
          ...row('新しい段落の文章がここから続きます', 660),
        ],
        styles: { f1: { vertical: false } },
      }),
      getViewport: () => ({ width: 595, height: 842 }),
    }),
    getMetadata: () => ({ info: {} }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(new ArrayBuffer(8), 'yoko.pdf', doc);
  assert.deepEqual(book.text.split('\n'), ['最初の行の文章がここに続きます次の行の文章もここに続きます', '新しい段落の文章がここから続きます']);
  assert.notEqual(book.pdfLayout?.vertical, true);
});

test('importPdf (horizontal, justified glyphs): wide inter-character spacing stays inside the line', async () => {
  // Justification stretches the gaps between glyphs; the run must not break apart at every gap.
  const glyph = (ch, x, y) => ({ str: ch, transform: [12, 0, 0, 12, x, y], width: 12, height: 12, hasEOL: true, fontName: 'f1' });
  const row = (text, y) => Array.from(text).map((ch, index) => glyph(ch, 60 + index * 24, y));
  const doc = {
    numPages: 1,
    getPage: () => ({
      getTextContent: () => ({
        items: [...row('均等割りの行がここに続いていきます', 760), ...row('次の行も均等割りで続いていきます', 744)],
        styles: { f1: { vertical: false } },
      }),
      getViewport: () => ({ width: 595, height: 842 }),
    }),
    getMetadata: () => ({ info: {} }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(new ArrayBuffer(8), 'yoko-justified.pdf', doc);
  assert.deepEqual(book.text.split('\n'), ['均等割りの行がここに続いていきます次の行も均等割りで続いていきます']);
});

test('importPdf (horizontal, a line split after a long run): rejoins the split tail', async () => {
  // pdf.js can switch granularity inside one line: a long run, then one item per glyph.
  const at = (str, x, y) => ({ str, transform: [12, 0, 0, 12, x, y], width: str.length * 12, height: 12, hasEOL: false, fontName: 'f1' });
  const glyphTail = (ch, x, y) => ({ str: ch, transform: [12, 0, 0, 12, x, y], width: 12, height: 12, hasEOL: true, fontName: 'f1' });
  const doc = {
    numPages: 1,
    getPage: () => ({
      getTextContent: () => ({
        items: [
          at('途中から一文字ずつになっていく', 60, 760),
          glyphTail('に', 60 + 15 * 12, 760),
          glyphTail('な', 72 + 15 * 12, 760),
          at('次の行も同じように続いていく', 60, 744),
          glyphTail('な', 60 + 15 * 12, 744),
          glyphTail('る', 72 + 15 * 12, 744),
        ],
        styles: { f1: { vertical: false } },
      }),
      getViewport: () => ({ width: 595, height: 842 }),
    }),
    getMetadata: () => ({ info: {} }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(new ArrayBuffer(8), 'yoko-mixed.pdf', doc);
  assert.deepEqual(book.text.split('\n'), ['途中から一文字ずつになっていくにな次の行も同じように続いていくなる']);
  assert.notEqual(book.pdfLayout?.vertical, true);
});

test('importPdf (tategaki Type3 /ActualText): recovers kana from MarkedContent, drops un-EOL ruby, and keeps inline numbers and rotated ellipsis', async () => {
  // Real vertical bunko PDFs (e.g. Type3 subset fonts) emit "\u0000" for kana and store the character in
  // /Span <</ActualText (...)>> BDC ... EMC. Source ruby (7.5pt) often has hasEOL:false right before the
  // 15pt base kanji, inline numbers (2015, 11) sit inside columns, and "……" / "───" are rotated 90°.
  const spanGlyph = (actualText, rawStr, x, y, height = 15, hasEOL = false) => [
    { type: 'beginMarkedContentProps', tag: 'Span', actualText },
    { str: '', transform: [height, 0, 0, height, x, y], width: 0, height: 0, hasEOL: true },
    { str: rawStr, transform: [height, 0, 0, height, x, y], width: height, height, hasEOL },
    { type: 'endMarkedContent' },
  ];
  const plainGlyph = (str, x, y, height = 15, hasEOL = true) => ({
    str,
    transform: [height, 0, 0, height, x, y],
    width: height,
    height,
    hasEOL,
  });
  const rotatedInline = (str, x, y, height = 15) => ({
    str,
    transform: [0, -height, height, 0, x, y],
    width: height * str.length,
    height,
    hasEOL: false,
  });

  // Column 1 (x = 380): "問い・人は平等であるか否か。" with 7.5pt ruby "い","な" at x = 395.5 (hasEOL:false before "否")
  const col1 = [
    plainGlyph('問', 380, 700),
    ...spanGlyph('い', '\u0000', 380, 685),
    plainGlyph('・', 380, 670),
    plainGlyph('人', 380, 655),
    ...spanGlyph('は', '\u0000', 380, 640),
    plainGlyph('平', 380, 625),
    plainGlyph('等', 380, 610),
    ...spanGlyph('で', '\u0000', 380, 595),
    ...spanGlyph('あ', '\u0000', 380, 580),
    ...spanGlyph('る', '\u0000', 380, 565),
    ...spanGlyph('か', '\u0000', 380, 550),
    // Source ruby "い", "な" at 7.5pt without EOL before the 15pt base kanji "否",
    // including a non-zero width+height synthetic space inherited from the unrotated 15pt glyph above.
    { type: 'beginMarkedContentProps', tag: 'Span', actualText: 'い' },
    { str: ' ', transform: [15, 0, 0, 15, 380, 542], width: 15, height: 15, hasEOL: false },
    { str: '\u0000', transform: [7.5, 0, 0, 7.5, 395.5, 542], width: 7.5, height: 7.5, hasEOL: false },
    { type: 'endMarkedContent' },
    ...spanGlyph('な', '\u0000', 395.5, 534.5, 7.5, false),
    plainGlyph('否', 380, 535, 15, false),
    ...spanGlyph('か', '\u0000', 380, 520),
    ...spanGlyph('。', '︒', 380, 505),
  ];

  // Column 2 (x = 350, indented at y = 685): "２０１５年の交響曲11番が……。"
  const col2 = [
    plainGlyph('２', 350, 685),
    plainGlyph('０', 350, 670),
    plainGlyph('１', 350, 655),
    plainGlyph('５', 350, 640),
    plainGlyph('年', 350, 625),
    ...spanGlyph('の', '\u0000', 350, 610),
    plainGlyph('交', 350, 595),
    plainGlyph('響', 350, 580),
    plainGlyph('曲', 350, 565, 15, false),
    plainGlyph('11', 349.2, 550, 15, false),
    plainGlyph('番', 350, 535, 15, false),
    ...spanGlyph('が', '\u0000', 350, 520),
    // Synthetic 0-height space before rotated inline ellipsis, followed by vertical period
    { str: ' ', transform: [15, 0, 0, 15, 365, 520], width: 2.4, height: 0, hasEOL: false },
    rotatedInline('……', 351.1, 518, 15),
    // 2-char rotated 7.5pt ruby (advance height = 15, but glyph font size = 7.5) must still be dropped
    { str: '・・', transform: [0, -7.5, 7.5, 0, 365.5, 518], width: 15, height: 15, hasEOL: false },
    // Ruby with synthetic space inside MarkedContent span right after rotated ellipsis
    { type: 'beginMarkedContentProps', tag: 'Span', actualText: 'わ' },
    { str: ' ', transform: [0, -15, 15, 0, 351.1, 488], width: 19.5, height: 0, hasEOL: false },
    { str: '\u0000', transform: [7.5, 0, 0, 7.5, 365.5, 480], width: 7.5, height: 7.5, hasEOL: false },
    { type: 'endMarkedContent' },
    ...spanGlyph('。', '︒', 350, 475),
    // Multi-glyph bottom-margin folio ("1", "2") aligned with column 2's x, separated by a wide gap (> 2.5 * 15)
    plainGlyph('1', 350, 45),
    plainGlyph('2', 350, 30),
  ];

  // Column 3 (x = 320, top-aligned numeric section heading "１" that must NOT be dropped as a page number)
  const col3 = [plainGlyph('１', 320, 685)];

  const doc = {
    numPages: 1,
    getPage: () => ({
      getTextContent: () => ({ items: [...col1, ...col2, ...col3], styles: {} }),
      getViewport: () => ({ width: 595, height: 842 }),
    }),
    getMetadata: () => ({ info: {} }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };

  const book = await importPdf(new ArrayBuffer(8), 'tate-actualtext.pdf', doc);
  assert.deepEqual(book.text.split('\n'), [
    '問い・人は平等であるか否か。',
    '２０１５年の交響曲11番が……。',
    '１',
  ]);
  assert.equal(book.pdfLayout?.vertical, true);
});

test('importPdf (horizontal Tagged PDF): preserves spaces across non-ActualText spans and merges inline superscripts', async () => {
  const items = [
    { type: 'beginMarkedContentProps', tag: 'P', actualText: null },
    { type: 'beginMarkedContentProps', tag: 'Span', actualText: null },
    { str: 'Hello, ', transform: [12, 0, 0, 12, 60, 760], width: 42, height: 12, hasEOL: false },
    { type: 'endMarkedContent' },
    { type: 'beginMarkedContentProps', tag: 'Span', actualText: null },
    { str: 'world! ', transform: [12, 0, 0, 12, 102, 760], width: 42, height: 12, hasEOL: false },
    { type: 'endMarkedContent' },
    // Inline superscript "1" mid-sentence must not be dropped as a page number or split the paragraph
    { str: 'これは例文', transform: [12, 0, 0, 12, 144, 760], width: 60, height: 12, hasEOL: false },
    { str: '1', transform: [8, 0, 0, 8, 204, 765], width: 8, height: 8, hasEOL: false },
    { str: 'です。十分な文字数を確保します。', transform: [12, 0, 0, 12, 212, 760], width: 192, height: 12, hasEOL: true },
    { type: 'endMarkedContent' },
  ];
  const doc = {
    numPages: 1,
    getPage: () => ({
      getTextContent: () => ({ items, styles: {} }),
      getViewport: () => ({ width: 595, height: 842 }),
    }),
    getMetadata: () => ({ info: {} }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(new ArrayBuffer(8), 'tagged-horizontal.pdf', doc);
  assert.deepEqual(book.text.split('\n'), ['Hello, world! これは例文1です。十分な文字数を確保します。']);
});



test('importPdf removes repeated running heads, infers chapters, and maps every page', async () => {
  const body1 = '　第一章　始まりの章です。この章には十分な長さの本文があります。';
  const body2 = '　第二章　続きの章です。こちらにも十分な長さの本文があります。';
  const pages = [
    [makeItem('吾輩は猫である', { y: 780, height: 8 }), makeItem(body1, { y: 700, height: 12 }), makeItem('1', { y: 20, height: 8 })],
    [makeItem('吾輩は猫である', { y: 780, height: 8 }), makeItem(body2, { y: 700, height: 12 }), makeItem('2', { y: 20, height: 8 })],
    // A page with only the running head: it maps to -1 instead of borrowing the previous page.
    [makeItem('吾輩は猫である', { y: 780, height: 8 }), makeItem('3', { y: 20, height: 8 })],
  ];
  const fakeLoader = {
    numPages: 3,
    getPage(n) {
      return {
        getViewport: () => ({ width: 600, height: 800 }),
        getTextContent: () => ({ items: pages[n - 1] }),
      };
    },
    getMetadata() {
      return {
        info: { Title: '吾輩は猫である', Author: '夏目漱石', CreationDate: "D:20200102030405+09'00'" },
        metadata: {
          get(name) {
            return {
              'dc:language': 'ja',
              'dc:publisher': '出版社',
              'dc:identifier': 'urn:isbn:123',
              'dc:date': '2020-02-03',
              'dc:description': '説明文',
            }[name];
          },
        },
      };
    },
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
    getPageLabels: () => ['i', '1', '2'],
  };

  const book = await importPdf(new ArrayBuffer(8), 'neko.pdf', fakeLoader);
  assert.deepEqual(book.text.split('\n'), [body1, body2]);
  assert.equal(book.text.includes('吾輩は猫である\n'), false);
  assert.deepEqual(book.chapters, [
    { title: '第一章　始まりの章です。この章には十分な長さの本文があります。', startLine: 0, level: 0, page: 1 },
    { title: '第二章　続きの章です。こちらにも十分な長さの本文があります。', startLine: 1, level: 0, page: 2 },
  ]);
  assert.deepEqual(book.pageStarts, [0, 1, -1]);
  assert.deepEqual(book.pageLabels, ['i', '1', '2']);
  assert.equal(book.language, 'ja');
  assert.equal(book.publisher, '出版社');
  assert.equal(book.authors ?? book.author, '夏目漱石');
  assert.equal(book.publishedAt, '2020-01-02');
  assert.equal(book.identifier, 'urn:isbn:123');
  assert.equal(book.description, '説明文');
  assert.deepEqual(book.warnings.filter(w => w.code === 'running-heads-removed'), [{ code: 'running-heads-removed', count: 6 }]);
  assert.deepEqual(book.warnings.filter(w => w.code === 'auto-chapters'), [{ code: 'auto-chapters', count: 2 }]);
  assert.deepEqual(book.warnings.filter(w => w.code === 'missing-cover'), [{ code: 'missing-cover' }]);
});

test('importPdf preserves nested outline levels and pages, and keeps a parent at a shared start line', async () => {
  const pages = [
    [makeItem('　第一章の本文です。十分な文字数を確保します。', { y: 750 })],
    [
      makeItem('　第二章の本文です。こちらも十分な文字数があります。', { y: 750 }),
      makeItem('　第一節の本文です。', { y: 736 }),
    ],
  ];
  const fakeLoader = {
    numPages: 2,
    getPage(n) {
      return {
        getViewport: () => ({ width: 600, height: 800 }),
        getTextContent: () => ({ items: pages[n - 1] }),
      };
    },
    getMetadata: () => ({ info: { Title: '階層', Author: '' } }),
    getOutline() {
      return [{
        title: '第一部', dest: [{ ref: 'p1' }],
        items: [{
          title: '第一章', dest: [{ ref: 'p2' }],
          items: [{ title: '第一節', dest: [{ ref: 'p2' }] }],
        }],
      }];
    },
    getPageIndex(ref) {
      return ref.ref === 'p1' ? 0 : 1;
    },
    getDestination: () => null,
  };

  const book = await importPdf(new ArrayBuffer(8), 'levels.pdf', fakeLoader);
  assert.deepEqual(book.chapters, [
    { title: '第一部', startLine: 0, level: 0, page: 1 },
    { title: '第一章', startLine: 1, level: 1, page: 2 },
    { title: '第一節', startLine: 1, level: 2, page: 2 },
  ]);
});

test('importPdf inserts large page images at the page head and shifts pageStarts', async () => {
  const body1 = '　第一章　始まりの章です。この章には十分な長さの本文があり、全体で十分な文字数を確保します。';
  const body2 = '　第二章　挿絵のページです。';
  const imageObject = { width: 300, height: 400, kind: 1, data: new Uint8Array([1, 0, 1]) };
  const pages = [
    [makeItem(body1, { y: 750 })],
    [makeItem(body2, { y: 750 })],
  ];
  const encodeCalls = [];
  const fakeLoader = {
    numPages: 2,
    getPage(n) {
      return {
        getViewport: () => ({ width: 600, height: 800 }),
        getTextContent: () => ({ items: pages[n - 1] }),
        getOperatorList: async () => ({ fnArray: [1], argsArray: [['Im1']] }),
        objs: { get: name => (name === 'Im1' ? imageObject : undefined) },
      };
    },
    getMetadata: () => ({ info: { Title: '挿絵', Author: '' } }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };

  const cover = { mime: 'image/jpeg', data: new Uint8Array([7]) };
  const book = await importPdf(new ArrayBuffer(8), 'illust.pdf', fakeLoader, {
    renderCover: async () => cover,
    encodeImage: async image => { encodeCalls.push(image); return { mime: 'image/png', data: new Uint8Array([9]) }; },
    ops: { paintImageXObject: 1 },
  });

  assert.equal(encodeCalls.length, 1);
  assert.equal(encodeCalls[0], imageObject);
  assert.equal(book.images.length, 1);
  assert.equal(book.images[0].id, 'img-1');
  assert.equal(book.images[0].mime, 'image/png');
  assert.deepEqual(Array.from(book.images[0].data), [9]);
  assert.equal(book.cover?.mime, 'image/jpeg');
  assert.deepEqual(book.text.split('\n'), [body1, imageLine('img-1'), body2]);
  assert.deepEqual(book.pageStarts, [0, 1]);
  assert.equal(book.warnings.some(w => w.code === 'missing-cover'), false);
  assert.equal(book.warnings.some(w => w.code === 'images-skipped'), false);
});

test('importPdf maps an image-only page to its inserted image line', async () => {
  const imageObject = { width: 300, height: 400, kind: 1, data: new Uint8Array([1, 0, 1]) };
  const fakeLoader = {
    numPages: 2,
    getPage(n) {
      return {
        getViewport: () => ({ width: 600, height: 800 }),
        getTextContent: () => ({
          items: n === 1 ? [makeItem('　第一章の本文です。十分な文字数を確保します。この行は画像ページの判定に必要です。', { y: 750 })] : [],
        }),
        getOperatorList: async () => (
          n === 2 ? { fnArray: [1], argsArray: [['Im1']] } : { fnArray: [], argsArray: [] }
        ),
        objs: { get: name => (name === 'Im1' ? imageObject : undefined) },
      };
    },
    getMetadata: () => ({ info: { Title: '図版のみ', Author: '' } }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(new ArrayBuffer(8), 'plate.pdf', fakeLoader, {
    encodeImage: async () => ({ mime: 'image/png', data: new Uint8Array([9]) }),
    ops: { paintImageXObject: 1 },
  });
  assert.deepEqual(book.text.split('\n'), [
    '　第一章の本文です。十分な文字数を確保します。この行は画像ページの判定に必要です。',
    imageLine('img-1'),
  ]);
  assert.deepEqual(book.pageStarts, [0, 1]);
});

test('importPdf keeps a horizontal author line out of the vertical copyright columns', async () => {
  const at = (str, x, y) => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 10, height: 10, hasEOL: false });
  const pages = [
    [at('ようこそ実力至上主義の教室へ２', 50, 760), at('第二巻', 50, 746), at('衣笠彰梧', 50, 660)],
    [at('本作品の全部', 500, 700), at('無断で複製', 450, 700), at('転載を禁止', 400, 700), at('します。', 350, 700)],
  ];
  const fakeLoader = {
    numPages: 2,
    getPage(n) { return { getTextContent: () => ({ items: pages[n - 1] }) }; },
    getMetadata: () => ({ info: { Title: 'ようこそ2', Author: '' } }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(new ArrayBuffer(8), 'mixed.pdf', fakeLoader);
  assert.deepEqual(book.text.split('\n'), [
    'ようこそ実力至上主義の教室へ２第二巻',
    '衣笠彰梧',
    '本作品の全部無断で複製転載を禁止します。',
  ]);
});

test('importPdf recovers a section whose bookmark shares its neighbour page', async () => {
  const at = (str, x, y) => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 10, height: 10, hasEOL: false });
  const items = [
    at('目次', 50, 760),
    at('佐倉愛里の独白', 50, 720),
    at('　佐倉の本文です。十分な文字数を確保します。', 80, 706),
  ];
  const fakeLoader = {
    numPages: 1,
    getPage() { return { getTextContent: () => ({ items }) }; },
    getMetadata: () => ({ info: { Title: '章分け', Author: '' } }),
    getOutline: () => [
      { title: 'contents', dest: [{ ref: 'p1' }] },
      { title: '佐倉愛里の独白', dest: [{ ref: 'p1' }] },
    ],
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(new ArrayBuffer(8), 'dup-bookmarks.pdf', fakeLoader);
  assert.deepEqual(book.chapters, [
    { title: 'contents', startLine: 0, level: 0, page: 1 },
    { title: '佐倉愛里の独白', startLine: 1, level: 0, page: 1 },
  ]);
});

test('importPdf strips download-site tags from the filename title', async () => {
  const fakeLoader = {
    numPages: 1,
    getPage() {
      return {
        getTextContent: () => ({
          items: [makeItem('　本文です。十分な文字数を確保します。この行はタイトル判定のための本文です。', { y: 750 })],
        }),
      };
    },
    getMetadata: () => ({ info: {} }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const book = await importPdf(
    new ArrayBuffer(8),
    'ようこそ2 (MF文庫J) (衣笠彰梧) (z-library.sk, 1lib.sk, z-lib.sk).pdf',
    fakeLoader,
  );
  assert.equal(book.title, 'ようこそ2 (MF文庫J) (衣笠彰梧)');
});

test('importPdf exposes progress stages and aborts between pages', async () => {
  const pages = [
    [makeItem('　第一章の本文です。十分な文字数を確保します。', { y: 750 })],
    [makeItem('　第二章の本文です。', { y: 750 })],
  ];
  const fakeLoader = {
    numPages: 2,
    getPage(n) {
      return { getViewport: () => ({ width: 600, height: 800 }), getTextContent: () => ({ items: pages[n - 1] }) };
    },
    getMetadata: () => ({ info: { Title: '進捗', Author: '' } }),
    getOutline: () => null,
    getPageIndex: () => 0,
    getDestination: () => null,
  };
  const stages = [];
  const book = await importPdf(new ArrayBuffer(8), 'progress.pdf', fakeLoader, {
    onProgress: progress => stages.push(`${progress.stage}:${progress.current}/${progress.total ?? ''}`),
  });
  assert.ok(book.text);
  assert.ok(stages.includes('reading:0/'));
  assert.ok(stages.includes('text:1/2'));
  assert.ok(stages.includes('text:2/2'));
  assert.ok(stages.includes('chapters:1/1'));
  assert.ok(stages.includes('cover:1/1'));
  assert.ok(stages.includes('done:1/1'));

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => importPdf(new ArrayBuffer(8), 'abort.pdf', fakeLoader, { signal: controller.signal }),
    error => error.name === 'AbortError',
  );
});

test('importPdf spaces wrapped English after punctuation and keeps headings on their own line', async () => {
  const loader = {
    numPages: 1,
    getPage() {
      return {
        getTextContent() {
          return {
            items: [
              makeItem('Chapter One', { y: 760 }),
              makeItem('This is the first sentence.', { y: 746 }),
              makeItem('The next line wraps after a period.', { y: 732 }),
              makeItem('A closing bracket (like this)', { y: 718 }),
              makeItem('continues on the next line.', { y: 704 }),
              makeItem('A hyphenated word exam-', { y: 690 }),
              makeItem('ple stays joined.', { y: 676 }),
            ],
          };
        },
      };
    },
    getMetadata() { return { info: { Title: 'English Sample' } }; },
    getOutline() { return null; },
    getPageIndex() { return 0; },
    getDestination() { return null; },
  };

  const book = await importPdf(new ArrayBuffer(8), 'english.pdf', loader);
  assert.deepEqual(book.text.split('\n'), [
    'Chapter One',
    'This is the first sentence. The next line wraps after a period. A closing bracket (like this) continues on the next line. A hyphenated word exam-ple stays joined.',
  ]);
});
