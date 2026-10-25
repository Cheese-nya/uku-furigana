import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const {
  emptyLibraryDatabase, extractChapters, createStarterBooks, validateLibraryDatabase,
  upsertBook, deleteBook, toggleBookFavorite, updateReadingProgress, addBookmark, removeBookmark,
  exportLibraryBackup, importLibraryBackup, listBooks, updateBookMetadata,
} = loadTypescript('../app/utils/libraryDatabase.ts');
const {
  extractPixivNovelId, cleanPixivDescription, cleanPixivContent, toPixivMirrorCoverUrl,
} = loadTypescript('../app/utils/pixivImporter.ts');
const { fingerprintText } = loadTypescript('../app/utils/correctionDatabase.ts');

function lines(count, prefix = '本文') {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join('\n');
}

test('台本始终保持单章，标题会去掉 _dubbing 后缀', () => {
  const headed = extractChapters('前言\n第1話　放課後\n一行\nChapter 2\n二行\n【終章】\n終わり\nEpisode 4\n最后\n■幕间', '放課後_dubbing');
  assert.deepEqual(headed, [{ id: 'chapter:1', title: '放課後', startLine: 0, endLine: 9 }]);

  const longScript = extractChapters(lines(250), '备用_dubbing_dubbing.docx');
  assert.deepEqual(longScript, [{ id: 'chapter:1', title: '备用', startLine: 0, endLine: 249 }]);

  const single = extractChapters('短い本文\n二行目', '短篇');
  assert.deepEqual(single, [{ id: 'chapter:1', title: '短篇', startLine: 0, endLine: 1 }]);
  assert.deepEqual(extractChapters('', '   '), [{ id: 'chapter:1', title: '全文', startLine: 0, endLine: 0 }]);
  assert.equal(extractChapters(lines(121)).length, 1);
});

test('内置示例书包含三本精选读物与真实指纹', async () => {
  const db = await createStarterBooks(1_700_000_000_000);
  const ids = ['book:starter-dubbing', 'book:starter-soseki', 'book:starter-miyazawa'];
  assert.deepEqual(Object.keys(db.books), ids);
  const dubbing = db.books[ids[0]];
  assert.equal(dubbing.category, 'script');
  assert.match(dubbing.title, /声優アフレコ練習台本：放課後の約束/);
  assert.match(dubbing.content, /第1話/);
  assert.match(dubbing.content, /第2話/);
  for (const word of ['一本', '二人', '三分', '辛い', '風']) assert.match(dubbing.content, new RegExp(word));
  assert.equal(dubbing.chapters.length, 1);
  assert.equal(dubbing.chapters[0].id, 'chapter:1');
  assert.equal(dubbing.chapters[0].title, dubbing.title);
  assert.equal(dubbing.chapters[0].startLine, 0);
  assert.equal(dubbing.readingProgress.chapterIndex, 0);
  assert.equal(dubbing.fingerprint, await fingerprintText(dubbing.content));
  assert.equal(db.books[ids[1]].author, '夏目漱石');
  assert.match(db.books[ids[1]].title, /夢十夜（第一夜）/);
  assert.equal(db.books[ids[2]].author, '宮沢賢治');
  assert.match(db.books[ids[2]].content, /銀河/);
  assert.equal(db.version, 2);
  assert.equal(validateLibraryDatabase(db).version, 2);
});

test('增删改查、指纹复用、进度与书签会保留已有阅读状态', async () => {
  const created = await upsertBook(emptyLibraryDatabase(), {
    bookId: 'book:one', title: '短篇', author: '作者', category: 'novel', content: '短い本文', now: 10,
  });
  assert.equal(created.books['book:one'].coverTheme, 'indigo');
  assert.equal(created.books['book:one'].favorite, false);
  const fingerprint = created.books['book:one'].fingerprint;

  const progressed = updateReadingProgress(created, 'book:one', { chapterIndex: 0, lineIndex: 3, percentage: 40 }, 20);
  const marked = addBookmark(progressed, 'book:one', { chapterIndex: 0, lineIndex: 3, label: '此处', snippet: '短い', id: 'bookmark:a', createdAt: 21 });
  const favored = toggleBookFavorite(marked, 'book:one', 22);
  const reused = await upsertBook(favored, { title: '短篇改名', content: '短い本文', now: 30 });
  const book = reused.books['book:one'];
  assert.equal(Object.keys(reused.books).length, 1);
  assert.equal(book.title, '短篇改名');
  assert.equal(book.chapters.length, 1);
  assert.equal(book.chapters[0].title, '短篇改名');
  assert.equal(book.readingProgress.chapterIndex, 0);
  assert.equal(book.fingerprint, fingerprint);
  assert.equal(book.favorite, true);
  assert.equal(book.readingProgress.lineIndex, 3);
  assert.equal(book.bookmarks.length, 1);
  assert.equal(book.createdAt, 10);
  assert.equal(book.coverTheme, 'indigo');

  const removedMark = removeBookmark(reused, 'book:one', 'bookmark:a', 40);
  assert.deepEqual(removedMark.books['book:one'].bookmarks, []);
  const removed = deleteBook(removedMark, 'book:one');
  assert.deepEqual(removed, emptyLibraryDatabase());
  assert.equal(deleteBook(removed, 'book:missing'), removed);
});

test('listBooks 优先按最近阅读时间排序，未阅读则按更新时间倒序', async () => {
  let db = emptyLibraryDatabase();
  db = await upsertBook(db, { bookId: 'book:1', title: '一', content: '本文一', now: 100 });
  db = await upsertBook(db, { bookId: 'book:2', title: '二', content: '本文二', now: 200 });
  db = await upsertBook(db, { bookId: 'book:3', title: '三', content: '本文三', now: 300 });

  // Initially sorted by updatedAt: 3, 2, 1
  assert.deepEqual(listBooks(db).map(b => b.bookId), ['book:3', 'book:2', 'book:1']);

  // Reading book:1 updates lastReadAt to 400 -> book:1 becomes first
  db = updateReadingProgress(db, 'book:1', { chapterIndex: 0, lineIndex: 1, percentage: 50 }, 400);
  assert.deepEqual(listBooks(db).map(b => b.bookId), ['book:1', 'book:3', 'book:2']);
});

test('备份导入导出合并书籍并拒绝损坏数据', async () => {
  const first = await upsertBook(emptyLibraryDatabase(), { bookId: 'book:a', title: '甲', content: '甲の本文', now: 10 });
  const second = await upsertBook(emptyLibraryDatabase(), { bookId: 'book:b', title: '乙', content: '乙の本文', favorite: true, now: 50 });
  const raw = exportLibraryBackup(second);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.kind, 'furigana-library');
  assert.equal(parsed.version, 2);
  const merged = importLibraryBackup(first, raw);
  assert.deepEqual(Object.keys(merged.books).sort(), ['book:a', 'book:b']);
  assert.equal(merged.books['book:b'].favorite, true);

  const newer = updateReadingProgress(first, 'book:a', { chapterIndex: 0, lineIndex: 1, percentage: 80, updatedAt: 90 }, 90);
  const olderBackup = exportLibraryBackup(await addBookmark(first, 'book:a', {
    chapterIndex: 0, lineIndex: 0, label: '旧签', snippet: '甲', id: 'bookmark:old', createdAt: 11,
  }));
  const kept = importLibraryBackup(newer, olderBackup);
  assert.equal(kept.books['book:a'].readingProgress.percentage, 80);
  assert.equal(kept.books['book:a'].bookmarks[0].id, 'bookmark:old');

  const sameText = exportLibraryBackup(await upsertBook(emptyLibraryDatabase(), { bookId: 'book:copy', title: '甲复制', content: '甲の本文', now: 100 }));
  const reused = importLibraryBackup(first, sameText);
  assert.equal(Object.keys(reused.books).length, 1);
  assert.equal(reused.books['book:a'].title, '甲复制');

  for (const version of [0, 3, '2', undefined]) {
    assert.throws(() => validateLibraryDatabase({ version, books: {} }), /不支持书库版本/);
    assert.throws(() => importLibraryBackup(first, JSON.stringify({ kind: 'furigana-library', version, books: {} })), /备份格式无效/);
  }
  for (const version of [1, 2]) {
    assert.throws(() => validateLibraryDatabase({ version, books: { 'book:bad': { bookId: 'book:other' } } }), /台本记录无效/);
  }
  assert.throws(() => importLibraryBackup(first, '{broken'), /JSON/);
  assert.throws(() => importLibraryBackup(first, JSON.stringify({ kind: 'other', version: 1, books: {} })), /备份格式无效/);
  assert.throws(() => exportLibraryBackup({ version: 1, books: null }), /台本格式无效/);
});

test('写入与校验会清理水印、_dubbing 标题，并把多章进度折回单章', async () => {
  const dirty = [
    '放課後_dubbing',
    '',
    'Furigana Dubbing Studio 自动注音导出',
    '',
    '生徒A：今日は一本だけ。',
    '由 Furigana Dubbing Studio 自动生成 • チーズ@beimisama',
    '',
  ].join('\n');
  const saved = await upsertBook(emptyLibraryDatabase(), {
    bookId: 'book:dirty', title: '放課後_dubbing_dubbing.docx', content: dirty, now: 10,
  });
  const book = saved.books['book:dirty'];
  assert.equal(book.title, '放課後');
  assert.equal(book.content, '放課後_dubbing\n\n\n生徒A：今日は一本だけ。');
  assert.deepEqual(book.chapters, [{ id: 'chapter:1', title: '放課後', startLine: 0, endLine: 3 }]);
  assert.equal(book.fingerprint, await fingerprintText(book.content));

  const raw = JSON.parse(exportLibraryBackup(saved));
  raw.books['book:dirty'].title = '放課後_dubbing.txt';
  raw.books['book:dirty'].content = `\nFurigana Dubbing Studio 自动注音导出\n\n一行\n\n由 Furigana Dubbing Studio 自动生成\n`;
  raw.books['book:dirty'].chapters = [
    { id: 'chapter:1', title: '第1話', startLine: 0, endLine: 0 },
    { id: 'chapter:2', title: '第2話', startLine: 1, endLine: 1 },
  ];
  raw.books['book:dirty'].readingProgress = { chapterIndex: 3, lineIndex: 4, percentage: 20, updatedAt: 10 };
  const cleaned = validateLibraryDatabase(raw);
  assert.equal(cleaned.books['book:dirty'].title, '放課後');
  assert.equal(cleaned.books['book:dirty'].content, '一行');
  assert.equal(cleaned.books['book:dirty'].chapters.length, 1);
  assert.equal(cleaned.books['book:dirty'].chapters[0].title, '放課後');
  assert.equal(cleaned.books['book:dirty'].readingProgress.chapterIndex, 0);
  assert.equal(cleaned.books['book:dirty'].readingProgress.lineIndex, 4);

  const unnamed = await upsertBook(emptyLibraryDatabase(), { title: '   _dubbing', content: '本文', now: 1 });
  assert.equal(Object.values(unnamed.books)[0].title, '未命名台本');
});

/** Browser storage shims: window, localStorage and a one-record IndexedDB. */
function installStorageShims() {
  const records = new Map();
  const idb = new Map();
  globalThis.window = { location: { search: '' } };
  globalThis.localStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction() {
            return { objectStore: () => ({
              get() { const get = {}; queueMicrotask(() => { get.result = idb.get('database'); get.onsuccess?.(); }); return get; },
              put(value) { idb.set('database', value); const put = {}; queueMicrotask(() => put.onsuccess?.()); return put; },
            }) };
          },
          close() {},
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
  return {
    records,
    idb,
    cleanup() {
      delete globalThis.window;
      delete globalThis.localStorage;
      delete globalThis.indexedDB;
    },
  };
}

test('书库存储优先桌面接口，否则 IndexedDB 与 localStorage 双写并初始化示例书', async () => {
  const { loadLibrary, saveLibrary } = loadTypescript('../app/utils/libraryStorage.ts');
  const { records, idb, cleanup } = installStorageShims();
  try {
    const initial = await loadLibrary();
    assert.equal(Object.keys(initial.books).length, 3);
    assert.equal(JSON.parse(records.get('furigana-library-v1')).version, 2);
    assert.equal(idb.get('database').books['book:starter-dubbing'].category, 'script');

    const custom = await upsertBook(emptyLibraryDatabase(), { bookId: 'book:saved', title: '保存测试', content: '本文', now: 5 });
    await saveLibrary(custom);
    records.clear();
    assert.equal((await loadLibrary()).books['book:saved'].title, '保存测试');
    records.set('furigana-library-v1', JSON.stringify(custom));
    idb.clear();
    assert.equal((await loadLibrary()).books['book:saved'].title, '保存测试');
    assert.equal(idb.get('database').version, 2);

    await assert.rejects(saveLibrary({ version: 9, books: {} }), /不支持书库版本/);
    idb.set('database', { version: 9, books: {} });
    await assert.rejects(loadLibrary(), /不支持书库版本/);

    const desktop = new Map();
    globalThis.window.pywebview = { api: {
      async load_library_database() { return desktop.get('db') ?? null; },
      async save_library_database(data) { desktop.set('db', data); return { success: true }; },
    } };
    records.clear();
    idb.clear();
    const fromDesktop = await loadLibrary();
    assert.equal(desktop.get('db').books['book:starter-soseki'].author, '夏目漱石');
    assert.equal(records.size, 0);
    await saveLibrary(custom);
    assert.equal(desktop.get('db').books['book:saved'].title, '保存测试');
    assert.equal((await loadLibrary()).books['book:saved'].bookId, 'book:saved');
    assert.equal(fromDesktop.version, 2);
  } finally {
    cleanup();
  }
});

test('updateBookMetadata 支持自定义标题、作者（可清空）、简介、封面与配色', async () => {
  let db = await upsertBook(emptyLibraryDatabase(), {
    bookId: 'book:meta',
    title: '初始标题',
    author: '初始作者',
    description: '初始简介',
    coverUrl: 'https://i.pximg.net/cover.jpg',
    coverTheme: 'indigo',
    content: 'さっきから僕のこと見てますけど',
    now: 100,
  });
  db = updateBookMetadata(db, 'book:meta', {
    title: '新标题',
    author: '   ',
    description: '更新后的台本简介',
    coverUrl: 'data:image/jpeg;base64,abc',
    coverTheme: 'rose',
  });
  const updated = db.books['book:meta'];
  assert.equal(updated.title, '新标题');
  assert.equal(updated.author, '');
  assert.equal(updated.description, '更新后的台本简介');
  assert.equal(updated.coverUrl, 'data:image/jpeg;base64,abc');
  assert.equal(updated.coverTheme, 'rose');
});

test('pixivImporter 解析链接 ID、清理简介 HTML 与正文注音标签', () => {
  assert.equal(extractPixivNovelId('https://www.pixiv.net/novel/show.php?id=20200345'), '20200345');
  assert.equal(extractPixivNovelId('https://www.pixiv.net/en/novels/20200345'), '20200345');
  assert.equal(extractPixivNovelId('20200345'), '20200345');
  assert.equal(extractPixivNovelId('https://example.com/foo'), null);

  assert.equal(
    cleanPixivDescription('第一行<br />第二行<br><a href="https://pixiv.net">链接 &amp; 说明</a>'),
    '第一行\n第二行\n链接 & 说明'
  );

  const cleaned = cleanPixivContent('[[rb:私 > わたし]]は[chapter:第一幕]\r\n[newpage]元気です');
  assert.ok(cleaned.content.includes('私(わたし)'));
  assert.ok(cleaned.content.includes('【第一幕】'));
  assert.equal(cleaned.rubyOverrides['私'], 'わたし');

  assert.equal(
    toPixivMirrorCoverUrl('https://i.pximg.net/c/600x600/novel-cover-master/img/test.jpg'),
    'https://i.pixiv.re/c/600x600/novel-cover-master/img/test.jpg'
  );
});

test('导入文本默认分类为台本 (script)；旧版（v1）数据只迁移一次 other / Pixiv → script，v2 保留用户选择的分类', async () => {
  const db = await upsertBook(emptyLibraryDatabase(), {
    bookId: 'book:imported-docx',
    title: '新导入台本',
    content: '生徒A：こんにちは。',
    format: 'docx',
    now: 200,
  });
  assert.equal(db.version, 2);
  assert.equal(db.books['book:imported-docx'].category, 'script');

  // Legacy v1 data: `other` and Pixiv books are migrated to script; built-in books keep their category.
  const starters = await createStarterBooks(100);
  const legacyBooks = JSON.parse(exportLibraryBackup({ ...db, books: { ...db.books, ...starters.books } })).books;
  legacyBooks['book:imported-docx'].category = 'other';
  const legacy = { version: 1, books: legacyBooks };
  const normalized = validateLibraryDatabase(legacy);
  assert.equal(normalized.version, 2);
  assert.equal(normalized.books['book:imported-docx'].category, 'script');
  assert.equal(normalized.books['book:starter-soseki'].category, 'novel');

  const pixivRaw = structuredClone(legacy);
  pixivRaw.books['book:imported-docx'].category = 'novel';
  pixivRaw.books['book:imported-docx'].sourceUrl = 'https://www.pixiv.net/novel/show.php?id=20200345';
  const pixivNormalized = validateLibraryDatabase(pixivRaw);
  assert.equal(pixivNormalized.books['book:imported-docx'].category, 'script');

  // A v1 backup is migrated the same way on import.
  const legacyBackup = JSON.stringify({ kind: 'furigana-library', version: 1, books: pixivRaw.books });
  const fromLegacyBackup = importLibraryBackup(emptyLibraryDatabase(), legacyBackup);
  assert.equal(fromLegacyBackup.version, 2);
  assert.equal(fromLegacyBackup.books['book:imported-docx'].category, 'script');
  assert.equal(fromLegacyBackup.books['book:starter-soseki'].category, 'novel');

  // v2: a user-picked 其他, and a Pixiv book moved to 小说, survive save -> reload and a backup round trip.
  let picked = updateBookMetadata(normalized, 'book:imported-docx', { category: 'other' }, 300);
  picked = await upsertBook(picked, {
    bookId: 'book:pixiv', title: 'Pixiv 小说', content: 'Pixiv 本文', category: 'script',
    sourceUrl: 'https://www.pixiv.net/novel/show.php?id=1', now: 310,
  });
  picked = updateBookMetadata(picked, 'book:pixiv', { category: 'novel' }, 320);
  const reloaded = validateLibraryDatabase(JSON.parse(JSON.stringify(picked)));
  assert.deepEqual(reloaded, picked);
  assert.equal(reloaded.books['book:imported-docx'].category, 'other');
  assert.equal(reloaded.books['book:pixiv'].category, 'novel');
  const backup = exportLibraryBackup(reloaded);
  assert.equal(JSON.parse(backup).version, 2);
  assert.deepEqual(importLibraryBackup(emptyLibraryDatabase(), backup), reloaded);
  assert.equal(importLibraryBackup(db, backup).books['book:imported-docx'].category, 'other');
});

test('书库存储：v1 数据加载时迁移一次并以 v2 保存，之后用户选择的「其他」在重新加载后保留', async () => {
  const { loadLibrary, saveLibrary } = loadTypescript('../app/utils/libraryStorage.ts');
  const { records, idb, cleanup } = installStorageShims();
  try {
    const saved = await upsertBook(emptyLibraryDatabase(), { bookId: 'book:legacy', title: '旧台本', content: '旧の本文', now: 10 });
    const legacy = JSON.parse(JSON.stringify({ ...saved, version: 1 }));
    legacy.books['book:legacy'].category = 'other';
    for (const store of ['indexedDB', 'localStorage']) {
      records.clear();
      idb.clear();
      if (store === 'indexedDB') idb.set('database', structuredClone(legacy));
      else records.set('furigana-library-v1', JSON.stringify(legacy));
      const loaded = await loadLibrary();
      assert.equal(loaded.version, 2, store);
      assert.equal(loaded.books['book:legacy'].category, 'script', store);

      await saveLibrary(updateBookMetadata(loaded, 'book:legacy', { category: 'other' }, 20));
      assert.equal(idb.get('database').version, 2, store);
      assert.equal(JSON.parse(records.get('furigana-library-v1')).version, 2, store);
      const reloaded = await loadLibrary();
      assert.equal(reloaded.books['book:legacy'].category, 'other', store);
      records.clear();
      assert.equal((await loadLibrary()).books['book:legacy'].category, 'other', store);
    }
  } finally {
    cleanup();
  }
});

test('native Pixiv bridge is detected only when the shell injects it', () => {
  const {
    normalizeNativePixivNovel, hasNativePixivBridge, getNativePixivBridge, fetchNativePixivNovel,
  } = loadTypescript('../app/utils/pixivNativeBridge.ts');

  // Web / desktop: no injected bridge, so the /api + direct-AJAX cascade stays in charge.
  assert.equal(hasNativePixivBridge(), false);
  assert.equal(getNativePixivBridge(), null);
  assert.equal(normalizeNativePixivNovel(null, '1'), null);

  const normalized = normalizeNativePixivNovel({
    id: '',
    title: '  ',
    author: ' 作者 ',
    content: '本文',
    rubyOverrides: { ' 私 ': ' わたし ', broken: 1 },
    coverUrl: 'data:image/jpeg;base64,abc',
    sourceUrl: '',
  }, '20200345');
  assert.equal(normalized.id, '20200345');
  assert.equal(normalized.title, 'Pixiv #20200345');
  assert.equal(normalized.author, '作者');
  assert.deepEqual(normalized.rubyOverrides, { '私': 'わたし' });
  assert.equal(normalized.sourceUrl, 'https://www.pixiv.net/novel/show.php?id=20200345');

  // An empty body must be rejected rather than stored as a blank book.
  assert.equal(normalizeNativePixivNovel({ content: '' }, '1'), null);

  // The Swift shell injects window.furiganaPixiv; the TS side must prefer it.
  globalThis.window = { furiganaPixiv: { isNative: true, novel: async () => ({}) } };
  try {
    assert.equal(hasNativePixivBridge(), true);
    assert.equal(typeof fetchNativePixivNovel, 'function');
  } finally {
    delete globalThis.window;
  }
});

test('native Pixiv bridge rejects an empty native payload instead of importing a blank book', async () => {
  const { fetchNativePixivNovel } = loadTypescript('../app/utils/pixivNativeBridge.ts');
  globalThis.window = { furiganaPixiv: { novel: async () => ({ content: '' }) } };
  try {
    await assert.rejects(() => fetchNativePixivNovel('20200345'), /正文为空/);
  } finally {
    delete globalThis.window;
  }
});

test('EPUB/PDF books keep their table of contents through save and reload; other formats stay one chapter', async () => {
  const content = '序\n一行\n第一章\n二行\n第二章\n三行';
  const toc = [{ title: '第二章', startLine: 4 }, { title: '序', startLine: 0 }, { title: '第一章', startLine: 2 }, { title: '重复', startLine: 2 }, { title: '越界', startLine: 99 }];
  let db = await upsertBook(emptyLibraryDatabase(), { title: 'こころ', content, format: 'epub', category: 'novel', chapters: toc, now: 1 });
  const [book] = Object.values(db.books);
  assert.deepEqual(book.chapters, [
    { id: 'chapter:1', title: '序', startLine: 0, endLine: 1 },
    { id: 'chapter:2', title: '第一章', startLine: 2, endLine: 3 },
    { id: 'chapter:3', title: '第二章', startLine: 4, endLine: 5 },
  ]);
  const reloaded = validateLibraryDatabase(JSON.parse(JSON.stringify(db)));
  assert.deepEqual(reloaded.books[book.bookId].chapters, book.chapters);
  // Updating metadata or re-saving the same text keeps the chapters.
  db = await upsertBook(db, { bookId: book.bookId, title: 'こころ', content, now: 2 });
  assert.equal(db.books[book.bookId].chapters.length, 3);

  const script = await upsertBook(emptyLibraryDatabase(), { title: '台本', content, format: 'txt', chapters: toc, now: 1 });
  assert.equal(Object.values(script.books)[0].chapters.length, 1);
});
