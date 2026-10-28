import { fingerprintText } from './correctionDatabase';
import { cleanScriptTitle, stripExportWatermark } from './docxImporter';
import type { RubyOverride } from './rubyOverrides';
import { validateRubyOverrides } from './rubyOverrides';
import type { SrtCue } from './srt';

export type BookCategory = 'script' | 'novel' | 'subtitle' | 'other';
export type BookFormat = 'txt' | 'srt' | 'docx' | 'epub' | 'pdf';
export type BookCoverTheme = 'indigo' | 'emerald' | 'amber' | 'rose' | 'slate';

/**
 * Page geometry and text direction of the PDF a book was imported from, so a batch PDF export can
 * reproduce the source layout. Declared here (not in `pdfExporter`) because that module pulls pdf-lib.
 */
export interface PdfLayout {
  pageWidth: number;
  pageHeight: number;
  vertical: boolean;
  fontSize: number;
}

export interface BookChapter {
  id: string;
  title: string;
  startLine: number;
  endLine: number;
}

export interface ReadingProgress {
  chapterIndex: number;
  lineIndex: number;
  percentage: number;
  updatedAt: number;
}

export interface BookmarkItem {
  id: string;
  chapterIndex: number;
  lineIndex: number;
  label: string;
  snippet: string;
  createdAt: number;
}

/** A user-made shelf folder; a book sits in at most one (`BookItem.folderId`). */
export interface LibraryFolder {
  folderId: string;
  name: string;
  createdAt: number;
}

export interface BookItem {
  bookId: string;
  title: string;
  author: string;
  description?: string;
  coverUrl?: string;
  sourceUrl?: string;
  category: BookCategory;
  /** The user's own shelf folder; absent when the book sits at the top level. */
  folderId?: string;
  format: BookFormat;
  coverTheme: BookCoverTheme;
  content: string;
  fingerprint: string;
  sourceOverrides: RubyOverride[];
  srtCues?: SrtCue[];
  /** Only present for books imported from a PDF that exposed a usable page layout. */
  pdfLayout?: PdfLayout;
  chapters: BookChapter[];
  readingProgress: ReadingProgress;
  bookmarks: BookmarkItem[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  lastReadAt: number;
}

/**
 * Version 1 rewrote `other` (and Pixiv books) to `script` on every load, so a picked
 * 其他 never stuck. Version 2 keeps every stored category: version 1 data is migrated
 * once when it is loaded or imported, and is saved back as version 2.
 */
export const LIBRARY_VERSION = 2;

export interface LibraryDatabase {
  version: typeof LIBRARY_VERSION;
  books: Record<string, BookItem>;
  /** User-made folders. Older libraries have none; folders are additive, so the version stays 2. */
  folders: Record<string, LibraryFolder>;
}

/** @deprecated Former name of {@link LibraryDatabase}; it now always holds version 2 data. */
export type LibraryDatabaseV1 = LibraryDatabase;

const CATEGORIES: readonly BookCategory[] = ['script', 'novel', 'subtitle', 'other'];
const FORMATS: readonly BookFormat[] = ['txt', 'srt', 'docx', 'epub', 'pdf'];
const THEMES: readonly BookCoverTheme[] = ['indigo', 'emerald', 'amber', 'rose', 'slate'];
const VALID_THEMES = THEMES;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;


export function emptyLibraryDatabase(): LibraryDatabase {
  return { version: LIBRARY_VERSION, books: {}, folders: {} };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Scripts stay one piece: never split a 台本 into chapters, even when headings are present. */
export function extractChapters(text: string, fallbackTitle = '全文'): BookChapter[] {
  const lines = textLines(text);
  return [{
    id: 'chapter:1',
    title: cleanScriptTitle(fallbackTitle) || '全文',
    startLine: 0,
    endLine: Math.max(0, lines.length - 1),
  }];
}

/** EPUB and PDF bring their own table of contents; every other format stays one piece. */
function hasOwnChapters(format: BookFormat): boolean {
  return format === 'epub' || format === 'pdf';
}

function toBookChapters(text: string, chapters: { title: string; startLine: number }[], fallbackTitle: string): BookChapter[] {
  const lastLine = Math.max(0, textLines(text).length - 1);
  const starts = chapters
    .filter(chapter => Number.isInteger(chapter.startLine) && chapter.startLine >= 0 && chapter.startLine <= lastLine)
    .sort((a, b) => a.startLine - b.startLine)
    .filter((chapter, index, list) => index === 0 || chapter.startLine !== list[index - 1].startLine);
  if (!starts.length) return extractChapters(text, fallbackTitle);
  // Front matter before the first TOC entry (title page, preface) would belong to no chapter and be unreachable.
  if (starts[0].startLine > 0) starts.unshift({ title: cleanScriptTitle(fallbackTitle) || '全文', startLine: 0 });
  return starts.map((chapter, index) => ({
    id: `chapter:${index + 1}`,
    title: chapter.title.trim() || `${index + 1}`,
    startLine: chapter.startLine,
    endLine: index + 1 < starts.length ? starts[index + 1].startLine - 1 : lastLine,
  }));
}

function themeForIndex(index: number): BookCoverTheme {
  return THEMES[index % THEMES.length];
}

function emptyProgress(now = Date.now()): ReadingProgress {
  return { chapterIndex: 0, lineIndex: 0, percentage: 0, updatedAt: now };
}

function findByFingerprint(db: LibraryDatabase, fingerprint: string): BookItem | undefined {
  return Object.values(db.books).find(book => book.fingerprint === fingerprint);
}

export interface UpsertBookInput {
  bookId?: string;
  title: string;
  author?: string;
  description?: string;
  coverUrl?: string;
  sourceUrl?: string;
  category?: BookCategory;
  /** Folder to file the book in; `null` moves it to the top level, omitted keeps its current folder. */
  folderId?: string | null;
  format?: BookFormat;
  coverTheme?: BookCoverTheme;
  content: string;
  fingerprint?: string;
  sourceOverrides?: RubyOverride[];
  srtCues?: SrtCue[];
  /** Source PDF layout; an existing value is kept when the input omits it. */
  pdfLayout?: PdfLayout;
  /** Table of contents of an EPUB or PDF; ignored for other formats. */
  chapters?: { title: string; startLine: number }[];
  favorite?: boolean;
  now?: number;
}

export async function upsertBook(db: LibraryDatabase, input: UpsertBookInput): Promise<LibraryDatabase> {
  const content = stripExportWatermark(input.content);
  const title = cleanScriptTitle(input.title) || '未命名台本';
  const fingerprint = input.fingerprint || await fingerprintText(content);
  const now = input.now ?? Date.now();
  const existing = (input.bookId && db.books[input.bookId]) || findByFingerprint(db, fingerprint);
  const bookId = existing?.bookId || input.bookId || `book:${crypto.randomUUID()}`;
  const readingProgress = existing?.readingProgress ?? emptyProgress(now);
  const author = existing
    ? (input.author !== undefined ? input.author.trim() : existing.author)
    : (input.author?.trim() ?? '');
  const description = existing
    ? (input.description !== undefined ? input.description.trim() : existing.description)
    : (input.description?.trim() || undefined);
  const coverUrl = existing
    ? (input.coverUrl !== undefined ? input.coverUrl.trim() : existing.coverUrl)
    : (input.coverUrl?.trim() || undefined);
  const sourceUrl = existing
    ? (input.sourceUrl !== undefined ? input.sourceUrl.trim() : existing.sourceUrl)
    : (input.sourceUrl?.trim() || undefined);
  // A later save without a layout (e.g. an editor save) must not drop the imported PDF geometry.
  const pdfLayout = input.pdfLayout ?? existing?.pdfLayout;
  const requestedFolder = input.folderId === undefined ? existing?.folderId : input.folderId;
  const folderId = requestedFolder && db.folders[requestedFolder] ? requestedFolder : undefined;
  const book: BookItem = {
    bookId,
    title,
    author,
    ...(description !== undefined ? { description } : {}),
    ...(coverUrl !== undefined ? { coverUrl } : {}),
    ...(sourceUrl !== undefined ? { sourceUrl } : {}),
    category: input.category ?? existing?.category ?? 'script',
    ...(folderId ? { folderId } : {}),
    format: input.format ?? existing?.format ?? 'txt',
    coverTheme: input.coverTheme ?? existing?.coverTheme ?? themeForIndex(Object.keys(db.books).length),
    content,
    fingerprint,
    sourceOverrides: input.sourceOverrides ?? existing?.sourceOverrides ?? [],
    ...(input.srtCues || existing?.srtCues ? { srtCues: input.srtCues ?? existing?.srtCues } : {}),
    ...(pdfLayout !== undefined ? { pdfLayout } : {}),
    chapters: chaptersFor(input.format ?? existing?.format ?? 'txt', content, title, input.chapters ?? (existing?.content === content ? existing.chapters : undefined)),
    readingProgress: { ...readingProgress, chapterIndex: 0 },
    bookmarks: existing?.bookmarks ?? [],
    favorite: input.favorite ?? existing?.favorite ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastReadAt: existing?.lastReadAt ?? 0,
  };
  const books = { ...db.books };
  if (existing && existing.bookId !== bookId) delete books[existing.bookId];
  books[bookId] = book;
  return { ...db, version: LIBRARY_VERSION, books };
}

export interface BookMetadataPatch {
  title?: string;
  author?: string;
  description?: string;
  coverUrl?: string;
  coverTheme?: BookCoverTheme;
  category?: BookCategory;
}

export function updateBookMetadata(
  db: LibraryDatabase,
  bookId: string,
  patch: BookMetadataPatch,
  now = Date.now(),
): LibraryDatabase {
  const book = db.books[bookId];
  if (!book) return db;
  const title = patch.title !== undefined && patch.title.trim() ? patch.title.trim() : book.title;
  const author = patch.author !== undefined ? patch.author.trim() : book.author;
  const description = patch.description !== undefined ? patch.description.trim() : book.description;
  const coverUrl = patch.coverUrl !== undefined ? patch.coverUrl.trim() : book.coverUrl;
  const coverTheme = patch.coverTheme && VALID_THEMES.includes(patch.coverTheme) ? patch.coverTheme : book.coverTheme;
  const category = patch.category && CATEGORIES.includes(patch.category) ? patch.category : book.category;
  const updated: BookItem = {
    ...book,
    title,
    author,
    ...(description !== undefined ? { description } : {}),
    ...(coverUrl !== undefined ? { coverUrl } : {}),
    coverTheme,
    category,
    updatedAt: now,
  };
  return { ...db, books: { ...db.books, [bookId]: updated } };
}

const MAX_FOLDER_NAME = 40;

function withoutFolder(book: BookItem): BookItem {
  const copy = { ...book };
  delete copy.folderId;
  return copy;
}

function cleanFolderName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME);
}

function folderNameTaken(db: LibraryDatabase, name: string, exceptId?: string): boolean {
  const key = name.toLowerCase();
  return Object.values(db.folders).some(folder => folder.folderId !== exceptId && folder.name.toLowerCase() === key);
}

/** Add a folder. A blank name is rejected; a name already in use returns the existing folder instead of a twin. */
export function createFolder(db: LibraryDatabase, name: string, now = Date.now()): { db: LibraryDatabase; folder: LibraryFolder | null } {
  const clean = cleanFolderName(name);
  if (!clean) return { db, folder: null };
  const same = Object.values(db.folders).find(folder => folder.name.toLowerCase() === clean.toLowerCase());
  if (same) return { db, folder: same };
  const folder: LibraryFolder = { folderId: `folder:${crypto.randomUUID()}`, name: clean, createdAt: now };
  return { db: { ...db, folders: { ...db.folders, [folder.folderId]: folder } }, folder };
}

export function renameFolder(db: LibraryDatabase, folderId: string, name: string): LibraryDatabase {
  const folder = db.folders[folderId];
  const clean = cleanFolderName(name);
  if (!folder || !clean || clean === folder.name || folderNameTaken(db, clean, folderId)) return db;
  return { ...db, folders: { ...db.folders, [folderId]: { ...folder, name: clean } } };
}

/** Delete a folder only; its books are kept and return to the top level. */
export function deleteFolder(db: LibraryDatabase, folderId: string): LibraryDatabase {
  if (!db.folders[folderId]) return db;
  const folders = { ...db.folders };
  delete folders[folderId];
  const books = Object.fromEntries(Object.entries(db.books).map(([id, book]) => {
    return [id, book.folderId === folderId ? withoutFolder(book) : book];
  }));
  return { ...db, books, folders };
}

/** File a book in a folder, or at the top level with `null`. An unknown folder is ignored. */
export function moveBookToFolder(db: LibraryDatabase, bookId: string, folderId: string | null): LibraryDatabase {
  const book = db.books[bookId];
  if (!book || (folderId !== null && !db.folders[folderId])) return db;
  if ((book.folderId ?? null) === folderId) return db;
  const moved = withoutFolder(book);
  return { ...db, books: { ...db.books, [bookId]: folderId ? { ...moved, folderId } : moved } };
}

/** Return all books ordered by last read time descending, falling back to update time. */
export function listBooks(db: LibraryDatabase): BookItem[] {
  return Object.values(db.books).sort((a, b) => (b.lastReadAt || b.updatedAt) - (a.lastReadAt || a.updatedAt));
}

export function deleteBook(db: LibraryDatabase, bookId: string): LibraryDatabase {
  if (!db.books[bookId]) return db;
  const books = { ...db.books };
  delete books[bookId];
  return { ...db, books };
}

export function toggleBookFavorite(db: LibraryDatabase, bookId: string, now = Date.now()): LibraryDatabase {
  const book = db.books[bookId];
  if (!book) return db;
  return { ...db, books: { ...db.books, [bookId]: { ...book, favorite: !book.favorite, updatedAt: now } } };
}

/** How far into a script a reader is, by line (a single-chapter book used to read 100% after one scroll). */
export function lineProgressPercent(lineIndex: number, totalLines: number): number {
  if (!Number.isFinite(lineIndex) || !Number.isFinite(totalLines) || totalLines <= 1) return totalLines === 1 ? 100 : 0;
  return Math.round(Math.min(1, Math.max(0, lineIndex / (totalLines - 1))) * 100);
}

export function updateReadingProgress(db: LibraryDatabase, bookId: string, progress: Omit<ReadingProgress, 'updatedAt'> & { updatedAt?: number }, now = Date.now()): LibraryDatabase {
  const book = db.books[bookId];
  if (!book) return db;
  const updatedAt = progress.updatedAt ?? now;
  return { ...db, books: { ...db.books, [bookId]: {
    ...book,
    readingProgress: { chapterIndex: progress.chapterIndex, lineIndex: progress.lineIndex, percentage: progress.percentage, updatedAt },
    lastReadAt: updatedAt,
    updatedAt,
  } } };
}

export function addBookmark(db: LibraryDatabase, bookId: string, bookmark: Omit<BookmarkItem, 'id' | 'createdAt'> & { id?: string; createdAt?: number }, now = Date.now()): LibraryDatabase {
  const book = db.books[bookId];
  if (!book) return db;
  const item: BookmarkItem = {
    id: bookmark.id || `bookmark:${crypto.randomUUID()}`,
    chapterIndex: bookmark.chapterIndex,
    lineIndex: bookmark.lineIndex,
    label: bookmark.label,
    snippet: bookmark.snippet,
    createdAt: bookmark.createdAt ?? now,
  };
  const bookmarks = [...book.bookmarks.filter(value => value.id !== item.id), item];
  return { ...db, books: { ...db.books, [bookId]: { ...book, bookmarks, updatedAt: item.createdAt } } };
}

export function removeBookmark(db: LibraryDatabase, bookId: string, bookmarkId: string, now = Date.now()): LibraryDatabase {
  const book = db.books[bookId];
  if (!book) return db;
  return { ...db, books: { ...db.books, [bookId]: { ...book, bookmarks: book.bookmarks.filter(item => item.id !== bookmarkId), updatedAt: now } } };
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}无效`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label}无效`);
  return number;
}

function validateProgress(value: unknown): ReadingProgress {
  if (!object(value)) throw new Error('阅读进度格式无效');
  return {
    chapterIndex: nonNegativeInteger(value.chapterIndex, '阅读章节'),
    lineIndex: nonNegativeInteger(value.lineIndex, '阅读行号'),
    percentage: finiteNumber(value.percentage, '阅读百分比'),
    updatedAt: finiteNumber(value.updatedAt, '阅读进度时间'),
  };
}

function validateBookmark(value: unknown): BookmarkItem {
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.label !== 'string' || typeof value.snippet !== 'string') {
    throw new Error('书签格式无效');
  }
  return {
    id: value.id,
    chapterIndex: nonNegativeInteger(value.chapterIndex, '书签章节'),
    lineIndex: nonNegativeInteger(value.lineIndex, '书签行号'),
    label: value.label,
    snippet: value.snippet,
    createdAt: finiteNumber(value.createdAt, '书签时间'),
  };
}

function validateCue(value: unknown): SrtCue {
  if (!object(value) || typeof value.index !== 'string' || typeof value.start !== 'string' || typeof value.end !== 'string' ||
    !Array.isArray(value.lines) || !value.lines.every(line => typeof line === 'string')) throw new Error('字幕时间轴格式无效');
  return { index: value.index, start: value.start, end: value.end, lines: value.lines as string[] };
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** A stored layout is optional: an incomplete one is dropped instead of failing the whole library. */
function validatePdfLayout(value: unknown): PdfLayout | undefined {
  if (!object(value) || typeof value.vertical !== 'boolean') return undefined;
  if (!isPositiveNumber(value.pageWidth) || !isPositiveNumber(value.pageHeight) || !isPositiveNumber(value.fontSize)) {
    return undefined;
  }
  return {
    pageWidth: value.pageWidth as number,
    pageHeight: value.pageHeight as number,
    vertical: value.vertical as boolean,
    fontSize: value.fontSize as number,
  };
}

function chaptersFor(format: BookFormat, text: string, title: string, chapters?: { title: string; startLine: number }[]): BookChapter[] {
  return hasOwnChapters(format) && chapters?.length ? toBookChapters(text, chapters, title) : extractChapters(text, title);
}

function validChapter(value: unknown): value is { title: string; startLine: number } {
  return object(value) && typeof value.title === 'string' && Number.isInteger(value.startLine) && (value.startLine as number) >= 0;
}

function validateBook(id: string, value: unknown, version: number): BookItem {
  if (!object(value) || value.bookId !== id || typeof value.title !== 'string' || typeof value.author !== 'string' ||
    typeof value.content !== 'string' || typeof value.fingerprint !== 'string' || !FINGERPRINT.test(value.fingerprint) ||
    !CATEGORIES.includes(value.category as BookCategory) || !FORMATS.includes(value.format as BookFormat) ||
    !THEMES.includes(value.coverTheme as BookCoverTheme) || typeof value.favorite !== 'boolean' || !Array.isArray(value.chapters) ||
    !Array.isArray(value.bookmarks)) throw new Error(`台本记录无效：${id}`);
  const sourceOverrides = validateRubyOverrides(value.sourceOverrides);
  if (!Array.isArray(value.sourceOverrides) || sourceOverrides.length !== value.sourceOverrides.length) throw new Error(`台本注音损坏：${id}`);
  const content = stripExportWatermark(value.content);
  const title = cleanScriptTitle(value.title) || '未命名台本';
  const readingProgress = validateProgress(value.readingProgress);
  const description = typeof value.description === 'string' ? value.description : undefined;
  const coverUrl = typeof value.coverUrl === 'string' ? value.coverUrl : undefined;
  const sourceUrl = typeof value.sourceUrl === 'string' ? value.sourceUrl : undefined;
  const folderId = typeof value.folderId === 'string' && value.folderId ? value.folderId : undefined;
  const category = version === 1 ? legacyCategory(id, value.category as BookCategory, sourceUrl) : value.category as BookCategory;
  const book: BookItem = {
    bookId: id,
    title,
    author: value.author,
    ...(description !== undefined ? { description } : {}),
    ...(coverUrl !== undefined ? { coverUrl } : {}),
    ...(sourceUrl !== undefined ? { sourceUrl } : {}),
    category,
    ...(folderId ? { folderId } : {}),
    format: value.format as BookFormat,
    coverTheme: value.coverTheme as BookCoverTheme,
    content,
    fingerprint: value.fingerprint,
    sourceOverrides,
    chapters: chaptersFor(value.format as BookFormat, content, title, value.chapters.filter(validChapter)),
    readingProgress: { ...readingProgress, chapterIndex: 0 },
    bookmarks: value.bookmarks.map(validateBookmark),
    favorite: value.favorite,
    createdAt: finiteNumber(value.createdAt, '创建时间'),
    updatedAt: finiteNumber(value.updatedAt, '更新时间'),
    lastReadAt: finiteNumber(value.lastReadAt, '最近阅读时间'),
  };
  if (value.srtCues !== undefined) {
    if (!Array.isArray(value.srtCues)) throw new Error(`字幕时间轴格式无效：${id}`);
    book.srtCues = value.srtCues.map(validateCue);
  }
  const pdfLayout = validatePdfLayout(value.pdfLayout);
  if (pdfLayout) book.pdfLayout = pdfLayout;
  return book;
}

/** Folders are optional and cosmetic: a malformed entry is dropped rather than failing the whole library. */
function validateFolders(value: unknown): Record<string, LibraryFolder> {
  if (!object(value)) return {};
  const folders: Record<string, LibraryFolder> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!object(raw) || raw.folderId !== id || typeof raw.name !== 'string') continue;
    const name = cleanFolderName(raw.name);
    if (!name) continue;
    folders[id] = { folderId: id, name, createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0 };
  }
  return folders;
}

/** The version 1 normalization, applied once: `other` and Pixiv books become `script`, built-in books keep theirs. */
function legacyCategory(id: string, category: BookCategory, sourceUrl: string | undefined): BookCategory {
  if (id.startsWith('book:starter-')) return category;
  return category === 'other' || sourceUrl?.includes('pixiv.net') ? 'script' : category;
}

/**
 * Strict validation: corrupted libraries must fail instead of being rewritten as empty.
 * Accepts version 1 (migrated once, see {@link LIBRARY_VERSION}) and version 2; always returns version 2.
 */
export function validateLibraryDatabase(value: unknown): LibraryDatabase {
  if (!object(value)) throw new Error('书库格式无效');
  const version = value.version;
  if (version !== 1 && version !== LIBRARY_VERSION) throw new Error(`不支持书库版本：${String(version)}`);
  if (!object(value.books)) throw new Error('书库台本格式无效');
  const folders = validateFolders(value.folders);
  return {
    version: LIBRARY_VERSION,
    // A book pointing at a folder that no longer exists goes back to the top level instead of vanishing.
    books: Object.fromEntries(Object.entries(value.books).map(([id, raw]) => {
      const { folderId, ...book } = validateBook(id, raw, version);
      return [id, folderId && folders[folderId] ? { ...book, folderId } : book];
    })),
    folders,
  };
}

const DUBBING_SCRIPT = `第1話　放課後の約束
生徒A：今日は一本だけお願いがある。
生徒B：二人で帰ろう。三分だけ待って。
生徒A：このラーメン、辛い？　それとも甘い？
生徒B：風が強いから、コートを着たほうがいいよ。
生徒A：わかった。校門の前で。

第2話　夕暮れの教室
生徒B：昨日の約束、覚えてる？
生徒A：もちろん。一本の鉛筆を貸してくれた人だよ。
生徒B：二人分のパンを買ってきた。三分で食べられるかな。
生徒A：辛い話じゃないよ。風の音を聞きながら帰ろう。
`;

const SOSEKI_DREAM = `こんな夢を見た。

腕組をして枕元に坐っていると、仰向に寝た女が、静かな声で、もう死にますと云う。女は長い髪を枕に敷いて、輪郭の柔らかな瓜実顔をその中に横たえている。真白な頬の底に温かい血の色が薄く差して、唇の色は無論赤い。

死にますなんて、そんな嘘を云うものじゃないよ、と私は笑って返した。すると女は黒い眼を眠そうに開けて、死ぬんですもの、仕方がないわと云う。

本当に死ぬのかい。

ええ、死にますとも。

女の顔には少しも死にそうな様子はなかった。私はまた、死ぬんなら、今のうちに死ぬがいい、と冗談を云った。

女は静かに眼を開いて、私の顔を見ながら、もう死にます、と繰り返した。私は黙って女の顔を見ていた。

こんな夢を見た。
`;

const MIYAZAWA_NIGHT = `午後の授業が終わると、ジョバンニは町を通って家へ帰って来ました。

今日は銀河のお祭りの前の日です。ジョバンニは黒い鞄を固く胸に押えて、口を大きく結んで、一直線に家の方へ急いでいました。

家へ帰ると、お母さんはやっぱり今朝のとおり、暗い台所の前にぼんやりと座っていました。ジョバンニは鞄を置いて、お母さんに「今日は銀河のお祭りなんだよ」と云いました。

お母さんは少し笑って、「そう。じゃあ、カムパネルラも行くんでしょう」と云いました。

ジョバンニは窓の外の青い夕暮れを見ながら、今夜こそ本当の銀河鉄道に乗れるかもしれないと思いました。
`;

export async function createStarterBooks(now = Date.now()): Promise<LibraryDatabase> {
  const specs: Array<Omit<UpsertBookInput, 'fingerprint'> & { bookId: string; coverTheme: BookCoverTheme }> = [
    {
      bookId: 'book:starter-dubbing',
      title: '声優アフレコ練習台本：放課後の約束',
      author: '浮く',
      category: 'script',
      format: 'txt',
      coverTheme: 'indigo',
      content: DUBBING_SCRIPT.trim(),
    },
    {
      bookId: 'book:starter-soseki',
      title: '夢十夜（第一夜）',
      author: '夏目漱石',
      category: 'novel',
      format: 'txt',
      coverTheme: 'emerald',
      content: SOSEKI_DREAM.trim(),
    },
    {
      bookId: 'book:starter-miyazawa',
      title: '銀河鉄道の夜（序章）',
      author: '宮沢賢治',
      category: 'novel',
      format: 'txt',
      coverTheme: 'amber',
      content: MIYAZAWA_NIGHT.trim(),
    },
  ];
  let db = emptyLibraryDatabase();
  for (const spec of specs) db = await upsertBook(db, { ...spec, now });
  return db;
}

export function exportLibraryBackup(db: LibraryDatabase): string {
  const valid = validateLibraryDatabase(db);
  return JSON.stringify({ kind: 'furigana-library', version: valid.version, books: valid.books, folders: valid.folders });
}

/** Version 1 backups are migrated like version 1 libraries; version 2 backups keep their categories. */
export function importLibraryBackup(db: LibraryDatabase, rawJson: string): LibraryDatabase {
  let parsed: unknown;
  try { parsed = JSON.parse(rawJson); }
  catch { throw new Error('书库备份不是有效的 JSON'); }
  if (!object(parsed) || parsed.kind !== 'furigana-library' || (parsed.version !== 1 && parsed.version !== LIBRARY_VERSION) ||
    !object(parsed.books)) {
    throw new Error('书库备份格式无效');
  }
  const incoming = validateLibraryDatabase({ version: parsed.version, books: parsed.books, folders: parsed.folders });
  const current = validateLibraryDatabase(db);
  const books = { ...current.books };
  // Same-named folders merge; incoming books follow their folder to the surviving id.
  const folders = { ...current.folders };
  const folderIdMap = new Map<string, string>();
  for (const folder of Object.values(incoming.folders)) {
    const same = folders[folder.folderId] ?? Object.values(folders).find(f => f.name.toLowerCase() === folder.name.toLowerCase());
    if (same) folderIdMap.set(folder.folderId, same.folderId);
    else { folders[folder.folderId] = folder; folderIdMap.set(folder.folderId, folder.folderId); }
  }
  const remap = (book: BookItem): BookItem => {
    if (!book.folderId) return book;
    const target = folderIdMap.get(book.folderId);
    const moved = withoutFolder(book);
    return target ? { ...moved, folderId: target } : moved;
  };
  for (const original of Object.values(incoming.books)) {
    const book = remap(original);
    const existing = books[book.bookId] || findByFingerprint({ ...current, books }, book.fingerprint);
    if (!existing) {
      books[book.bookId] = book;
      continue;
    }
    const preferIncoming = book.updatedAt >= existing.updatedAt;
    books[existing.bookId] = preferIncoming
      ? { ...book, bookId: existing.bookId, readingProgress: book.readingProgress.updatedAt >= existing.readingProgress.updatedAt ? book.readingProgress : existing.readingProgress,
        bookmarks: book.bookmarks.length >= existing.bookmarks.length ? book.bookmarks : existing.bookmarks, favorite: book.favorite || existing.favorite,
        createdAt: Math.min(book.createdAt, existing.createdAt), lastReadAt: Math.max(book.lastReadAt, existing.lastReadAt) }
      : { ...existing, favorite: existing.favorite || book.favorite, bookmarks: existing.bookmarks.length >= book.bookmarks.length ? existing.bookmarks : book.bookmarks,
        readingProgress: existing.readingProgress.updatedAt >= book.readingProgress.updatedAt ? existing.readingProgress : book.readingProgress,
        lastReadAt: Math.max(existing.lastReadAt, book.lastReadAt) };
    if (existing.bookId !== book.bookId && books[book.bookId] && books[book.bookId] !== books[existing.bookId]) delete books[book.bookId];
  }
  return validateLibraryDatabase({ version: LIBRARY_VERSION, books, folders });
}
