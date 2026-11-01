import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const {
  buildImportPreview, importStats, importSampleLines, editFromPreview,
  importEditToUpsertInput, importWarningText, importErrorText, importStageText,
  formatImportBytes,
} = loadTypescript('../app/utils/importPreview.ts');
const { translations } = loadTypescript('../app/utils/i18n.ts');
const { sourcePageLabel } = loadTypescript('../app/utils/libraryDatabase.ts');
const { ImportError } = loadTypescript('../app/utils/importErrors.ts');

const zh = translations['zh-CN'];
const en = translations.en;

const parsed = {
  title: '吾輩は猫である',
  author: '夏目漱石',
  content: '　第一章　始まり\n￼img-1\n本文の続きです。',
  format: 'pdf',
  category: 'novel',
  sourceOverrides: [{ line: '本文の続きです。', start: 0, surface: '本文', reading: 'ほんぶん', type: 'hiragana' }],
  srtCues: [],
  chapters: [
    { title: '第一章', startLine: 0, level: 0, page: 1 },
    { title: '第一節', startLine: 2, level: 1, page: 2 },
  ],
  images: [{ id: 'img-1', mime: 'image/png', data: new Uint8Array([1, 2, 3]) }],
  warnings: [{ code: 'running-heads-removed', count: 2 }],
  pageStarts: [0, 2],
  pageLabels: ['i', '1'],
  pageCount: 2,
  cover: { mime: 'image/jpeg', data: new Uint8Array([4, 5]) },
};

test('importStats counts only readable text and reports structure', () => {
  assert.deepEqual(importStats(parsed), {
    characters: Array.from('　第一章　始まり本文の続きです。').filter(char => !/\s/.test(char)).length,
    lines: 3,
    chapters: 2,
    images: 1,
    rubies: 1,
    pages: 2,
  });
});

test('importSampleLines skips image placeholders and blank lines', () => {
  assert.deepEqual(importSampleLines(parsed.content), ['第一章　始まり', '本文の続きです。']);
  assert.deepEqual(importSampleLines('a\n\n￼img-9\nb\nc', 2), ['a', 'b']);
});

test('buildImportPreview carries metadata, stats, TOC sample, warnings and duplicate info', () => {
  const file = new File([new Uint8Array(2048)], 'wagahai.pdf', { type: 'application/pdf' });
  const duplicate = { bookId: 'book:old', title: '旧版', author: '夏目漱石' };
  const preview = buildImportPreview(file, parsed, { duplicate, folderId: 'missing-folder' });
  assert.equal(preview.fileName, 'wagahai.pdf');
  assert.equal(preview.fileSize, 2048);
  assert.equal(preview.format, 'pdf');
  assert.equal(preview.title, '吾輩は猫である');
  assert.equal(preview.folderId, null);
  assert.equal(preview.stats.pages, 2);
  assert.deepEqual(preview.chapters, [
    { title: '第一章', level: 0, page: 1 },
    { title: '第一節', level: 1, page: 2 },
  ]);
  assert.deepEqual(preview.warnings, parsed.warnings);
  assert.equal(preview.duplicate?.bookId, 'book:old');
  assert.equal(preview.cover, parsed.cover);
  assert.deepEqual(editFromPreview(preview), {
    title: '吾輩は猫である', author: '夏目漱石', category: 'novel', folderId: null,
    description: '', language: '', publisher: '', publishedAt: '', series: '', seriesIndex: '', identifier: '',
  });
});

test('a valid folder in the queue is kept as the preview default', async () => {
  const preview = buildImportPreview(new File(['x'], 'a.epub'), {
    ...parsed, format: 'epub', chapters: [], images: [], pageStarts: undefined, pageLabels: undefined,
  }, { folderId: 'folder:1', folders: [{ folderId: 'folder:1', name: '小説', createdAt: 1 }] });
  assert.equal(preview.folderId, 'folder:1');
});

test('a duplicate merge preview keeps the existing folder, category and metadata the file lacks', () => {
  const preview = buildImportPreview(new File(['x'], 'again.pdf'), { ...parsed, author: '' }, {
    duplicate: {
      bookId: 'book:old', title: '旧题', author: '既存著者', category: 'script', folderId: 'folder:1',
      description: '既存説明', publisher: '既存出版社',
    },
    folders: [{ folderId: 'folder:1', name: '小説', createdAt: 1 }],
    folderId: null,
  });
  assert.equal(preview.title, parsed.title);
  assert.equal(preview.author, '既存著者');
  assert.equal(preview.category, 'script');
  assert.equal(preview.folderId, 'folder:1');
  assert.equal(preview.description, '既存説明');
  assert.equal(preview.publisher, '既存出版社');
});

test('importEditToUpsertInput trims the title, clears blank metadata and keeps layout mappings', () => {
  const input = importEditToUpsertInput(parsed, {
    title: '  新題  ', author: ' 著者 ', category: 'novel', folderId: 'folder:1',
    description: '', language: 'ja', publisher: ' 出版社 ', publishedAt: '', series: ' 系列 ', seriesIndex: '2', identifier: '',
  }, 'fingerprint', { bookId: 'book:1' });
  assert.equal(input.title, '新題');
  assert.equal(input.author, '著者');
  assert.equal(input.description, '');
  assert.equal(input.publisher, ' 出版社 ');
  assert.equal(input.language, 'ja');
  assert.equal(input.folderId, 'folder:1');
  assert.equal(input.format, 'pdf');
  assert.equal(input.coverUrl, undefined);
  assert.deepEqual(input.chapters, parsed.chapters);
  assert.deepEqual(input.pageStarts, [0, 2]);
  assert.deepEqual(input.pageLabels, ['i', '1']);
  assert.equal(input.bookId, 'book:1');
});

test('importEditToUpsertInput keeps the cover generated from the imported file', () => {
  const input = importEditToUpsertInput(parsed, {
    title: parsed.title, author: parsed.author, category: 'novel', folderId: null,
    description: '', language: '', publisher: '', publishedAt: '', series: '', seriesIndex: '', identifier: '',
  }, 'fingerprint', { coverUrl: 'data:image/jpeg;base64,AAAA' });
  assert.equal(input.coverUrl, 'data:image/jpeg;base64,AAAA');
});

test('blank title falls back to the parsed title and allowDuplicate is explicit', () => {
  const input = importEditToUpsertInput(parsed, {
    title: '   ', author: '', category: 'other', folderId: null,
    description: '', language: '', publisher: '', publishedAt: '', series: '', seriesIndex: '', identifier: '',
  }, 'fingerprint', { bookId: 'book:2', allowDuplicate: true });
  assert.equal(input.title, '吾輩は猫である');
  assert.equal(input.allowDuplicate, true);
  assert.equal(input.bookId, 'book:2');
});

test('every warning and error code has a translated message in both locales', () => {
  const warnings = ['auto-chapters', 'running-heads-removed', 'footnotes-inline', 'fixed-layout', 'missing-cover', 'images-skipped', 'low-text', 'unknown-image-format'];
  for (const code of warnings) {
    for (const t of [zh, en]) {
      const text = importWarningText(t, { code, count: 3 });
      assert.ok(text && !text.includes('undefined'), `${code} should be translated`);
    }
  }
  const errors = ['password-required', 'password-wrong', 'drm-protected', 'scanned-pdf', 'empty-book', 'corrupt-file', 'unsupported-format', 'out-of-memory', 'io-error', 'cancelled', 'unknown'];
  for (const code of errors) {
    const texts = [importErrorText(zh, code), importErrorText(en, code)];
    for (const text of texts) assert.ok(text && !text.includes('undefined'), `${code} should be translated`);
    assert.notEqual(texts[0], texts[1], `${code} should be localised`);
  }
  for (const stage of ['reading', 'text', 'images', 'chapters', 'cover', 'done']) {
    assert.ok(importStageText(zh, stage));
    assert.ok(importStageText(en, stage));
  }
});

test('ImportError exposes a stable code, detail, and retryability', () => {
  const error = new ImportError('password-wrong', 'Password wrong', { detail: 'bad', retryable: true });
  assert.equal(error.name, 'ImportError');
  assert.equal(error.code, 'password-wrong');
  assert.equal(error.detail, 'bad');
  assert.equal(error.retryable, true);
  assert.ok(error instanceof Error);
});

test('sourcePageLabel maps an output line to its source page and prefers labels', () => {
  assert.equal(sourcePageLabel([0, -1, 20], undefined, 0), '1');
  assert.equal(sourcePageLabel([0, -1, 20], undefined, 5), '1');
  assert.equal(sourcePageLabel([0, -1, 20], undefined, 20), '3');
  assert.equal(sourcePageLabel([0, -1, 20], ['i', '', '本文 1'], 21), '本文 1');
  assert.equal(sourcePageLabel([-1, -1], undefined, 3), null);
  assert.equal(sourcePageLabel(undefined, undefined, 3), null);
  assert.equal(sourcePageLabel([10], undefined, 2), null);
});

test('formatImportBytes crosses KiB and MiB cleanly', () => {
  assert.equal(formatImportBytes(512), '512 B');
  assert.equal(formatImportBytes(2048), '2 KB');
  assert.equal(formatImportBytes(2 * 1024 * 1024), '2.0 MB');
  assert.equal(formatImportBytes(40 * 1024 * 1024), '40 MB');
});
