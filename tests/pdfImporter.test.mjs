import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { importPdf } = loadTypescript('../app/utils/pdfImporter.ts');
const { ScannedPdfError } = loadTypescript('../app/utils/bookAssets.ts');

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
    { title: '第一章', startLine: 0 },
    { title: '第二章', startLine: 2 },
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
