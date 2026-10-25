'use client';

import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { AppTab } from '../components/MobileNavBar';
import type { EditingTokenState } from '../components/RubyCorrectionModal';
import type { SrtCue } from '../utils/srt';
import { withLfLineKeys } from '../utils/inlineRuby';
import { parseBookFile } from '../utils/bookImport';
import { deleteBookAssets, downscaleCover, putBookAssets } from '../utils/assetStore';
import type { ToastState } from '../components/GlassToast';
import { upsertRubyOverride, type RubyOverride } from '../utils/rubyOverrides';
import { saveCorrections } from '../utils/correctionStorage';
import { fingerprintText, resolveScript, type CorrectionDatabaseV2 } from '../utils/correctionDatabase';
import {
  addBookmark,
  createStarterBooks,
  deleteBook,
  emptyLibraryDatabase,
  exportLibraryBackup,
  importLibraryBackup,
  listBooks,
  removeBookmark,
  toggleBookFavorite,
  updateBookMetadata,
  updateReadingProgress,
  lineProgressPercent,
  upsertBook,
  type BookCategory,
  type BookCoverTheme,
  type BookFormat,
  type BookItem,
  type BookMetadataPatch,
  type LibraryDatabaseV1,
} from '../utils/libraryDatabase';
import { fetchPixivNovel } from '../utils/pixivImporter';
import { loadLibraryWithFallback, saveLibraryWithFallback } from '../utils/libraryStorage';
import { saveBlob } from '../utils/fileSave';
import type { Translations } from '../utils/i18n';

function buildPixivRubyOverrides(
  content: string,
  rubyMap: Record<string, string>,
  rubyType: 'hiragana' | 'katakana' | 'romaji',
): RubyOverride[] {
  const entries = Object.entries(rubyMap).filter(([surface, reading]) => surface.trim() && reading.trim());
  if (entries.length === 0) return [];
  let overrides: RubyOverride[] = [];
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  for (const line of lines) {
    if (!line) continue;
    for (const [surface, reading] of entries) {
      let idx = line.indexOf(surface);
      while (idx !== -1) {
        overrides = upsertRubyOverride(overrides, {
          line,
          start: idx,
          surface,
          reading,
          type: rubyType,
        });
        idx = line.indexOf(surface, idx + surface.length);
      }
    }
  }
  return overrides;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

type Setter<T> = Dispatch<SetStateAction<T>>;

/** Editor workspace state (owned by app/page.tsx) that the library integration reads and writes. */
export interface LibraryControllerOptions {
  t: Translations;
  rubyType: 'hiragana' | 'katakana' | 'romaji';
  docTitle: string;
  rawText: string;
  sourceOverrides: RubyOverride[];
  srtCues: SrtCue[];
  documentId: string;
  databaseRef: RefObject<CorrectionDatabaseV2>;
  setDatabase: Setter<CorrectionDatabaseV2>;
  setDocumentId: Setter<string>;
  setDocTitle: Setter<string>;
  setRawText: Setter<string>;
  setSourceOverrides: Setter<RubyOverride[]>;
  setSrtCues: Setter<SrtCue[]>;
  setEditingToken: Setter<EditingTokenState | null>;
  setActiveTab: Setter<AppTab>;
  setImportError: Setter<string>;
}

/**
 * Built-in library state (loaded once, persisted with a debounced save) plus every handler
 * that moves scripts between the library, the Editor workspace and the Reader.
 */
export function useLibraryController({
  t, rubyType, docTitle, rawText, sourceOverrides, srtCues, documentId, databaseRef, setDatabase, setDocumentId,
  setDocTitle, setRawText, setSourceOverrides, setSrtCues, setEditingToken, setActiveTab, setImportError,
}: LibraryControllerOptions) {
  // Editor-side Pixiv import controls (handleImportPixivNovel resets them on success).
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [editorPixivUrl, setEditorPixivUrl] = useState('');
  const [isPixivImporting, setIsPixivImporting] = useState(false);

  // Built-in library state
  const [libraryDb, setLibraryDb] = useState<LibraryDatabaseV1>(() => emptyLibraryDatabase());
  const updateLibraryDb = setLibraryDb;
  const [libraryReady, setLibraryReady] = useState(false);
  // The Reader follows the most recently opened book; the Editor keeps its own linked book so
  // standalone scratch scripts never overwrite a library book the Reader is showing.
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [editorBookId, setEditorBookId] = useState<string | null>(null);
  const [libraryToast, setLibraryToast] = useState<string | null>(null);
  const [importToast, setImportToast] = useState<ToastState | null>(null);
  // Source format of the script in the Editor, recorded on import / load for that script id. Any
  // other script (the default demo, a cleared or pasted one) is plain text.
  const [editorSource, setEditorSource] = useState<{ documentId: string; format: BookFormat } | null>(null);
  const markEditorSource = (scriptId: string, format: BookFormat) => setEditorSource({ documentId: scriptId, format });
  const editorFormat: BookFormat = editorSource?.documentId === documentId ? editorSource.format : srtCues.length ? 'srt' : 'txt';
  const libraryDbRef = useRef(libraryDb);
  useEffect(() => { libraryDbRef.current = libraryDb; }, [libraryDb]);
  const activeBook = activeBookId ? libraryDb.books[activeBookId] ?? null : null;
  const editorBook = editorBookId ? libraryDb.books[editorBookId] ?? null : null;
  const libraryBooks = useMemo(() => Object.values(libraryDb.books), [libraryDb.books]);

  // Load the persisted library once on mount and default to the most recent book.
  useEffect(() => {
    let active = true;
    loadLibraryWithFallback().then(db => {
      if (!active) return;
      setLibraryDb(db);
      setActiveBookId(current => current ?? listBooks(db)[0]?.bookId ?? null);
      setLibraryReady(true);
    });
    return () => { active = false; };
  }, []);

  // Persist library mutations (debounced). Guarded until the initial load completes.
  useEffect(() => {
    if (!libraryReady) return;
    const timer = setTimeout(() => { void saveLibraryWithFallback(libraryDb); }, 250);
    return () => clearTimeout(timer);
  }, [libraryDb, libraryReady]);

  useEffect(() => {
    if (!libraryToast) return;
    const timer = setTimeout(() => setLibraryToast(null), 2600);
    return () => clearTimeout(timer);
  }, [libraryToast]);

  useEffect(() => {
    if (!importToast || importToast.kind === 'progress') return;
    const timer = setTimeout(() => setImportToast(null), importToast.kind === 'error' ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [importToast]);

  const locateBook = (db: LibraryDatabaseV1, bookId: string | null, fingerprint: string): BookItem | null => {
    if (bookId && db.books[bookId]) return db.books[bookId];
    return Object.values(db.books).find(book => book.fingerprint === fingerprint) ?? null;
  };

  /** Load a library book into the shared workspace so Editor and Reader stay in sync. */
  const loadBookIntoWorkspace = (book: BookItem, targetTab: 'reader' | 'editor') => {
    setActiveBookId(book.bookId);
    setEditorBookId(book.bookId);
    setDocTitle(book.title);
    setRawText(book.content);
    setSourceOverrides(book.sourceOverrides ?? []);
    setSrtCues(book.srtCues ?? []);
    setEditingToken(null);
    const resolved = resolveScript(databaseRef.current, book.title, book.content, book.fingerprint);
    databaseRef.current = resolved.database;
    setDatabase(resolved.database);
    setDocumentId(resolved.scriptId);
    markEditorSource(resolved.scriptId, book.format);
    void saveCorrections(resolved.database).catch(() => undefined);
    setLibraryDb(previous => updateReadingProgress(previous, book.bookId, {
      chapterIndex: book.readingProgress.chapterIndex,
      lineIndex: book.readingProgress.lineIndex,
      percentage: book.readingProgress.percentage,
    }));
    setActiveTab(targetTab);
  };

  const upsertEditorIntoLibrary = async (): Promise<BookItem | null> => {
    const content = rawText.replace(/\r\n?/g, '\n');
    const title = docTitle.trim() || t.untitledScript;
    const fingerprint = await fingerprintText(content);
    // Only update the linked editor book; a standalone scratch script (editorBookId === null)
    // must create a new book instead of silently overwriting whichever book the Reader shows.
    const next = await upsertBook(libraryDbRef.current, {
      bookId: editorBookId ?? undefined,
      title,
      content,
      fingerprint,
      sourceOverrides: withLfLineKeys(sourceOverrides),
      srtCues,
      format: editorFormat,
    });
    const book = locateBook(next, editorBookId ?? null, fingerprint);
    setLibraryDb(next);
    if (book) {
      setActiveBookId(book.bookId);
      setEditorBookId(book.bookId);
    }
    return book;
  };

  const handleSaveToLibrary = async () => {
    const book = await upsertEditorIntoLibrary();
    if (book) setLibraryToast(t.savedToLibraryToast);
  };

  const handleOpenInReader = async () => {
    const book = await upsertEditorIntoLibrary();
    if (!book) return;
    loadBookIntoWorkspace(book, 'reader');
  };

  const importLibraryFiles = async (files: FileList) => {
    const list = Array.from(files);
    let lastBook: BookItem | null = null;
    let lastDetail = '';
    for (const file of list) {
      setImportToast({ kind: 'progress', title: fill(t.importingFile, { name: file.name }) });
      try {
        const parsed = await parseBookFile(file);
        const fingerprint = await fingerprintText(parsed.content);
        const coverUrl = parsed.cover ? await downscaleCover(parsed.cover).catch(() => undefined) : undefined;
        const next = await upsertBook(libraryDbRef.current, {
          title: parsed.title,
          author: parsed.author,
          content: parsed.content,
          fingerprint,
          category: parsed.category,
          format: parsed.format,
          sourceOverrides: parsed.sourceOverrides,
          srtCues: parsed.srtCues,
          chapters: parsed.chapters,
          ...(coverUrl ? { coverUrl } : {}),
        });
        const book = locateBook(next, null, fingerprint);
        if (book && parsed.images.length) await putBookAssets(book.bookId, parsed.images);
        libraryDbRef.current = next;
        setLibraryDb(next);
        if (book) lastBook = book;
        lastDetail = [
          parsed.chapters && parsed.chapters.length > 1 ? fill(t.importChapters, { count: parsed.chapters.length }) : '',
          parsed.images.length ? fill(t.importImages, { count: parsed.images.length }) : '',
          parsed.format === 'epub' && parsed.sourceOverrides.length ? fill(t.importRubies, { count: parsed.sourceOverrides.length }) : '',
        ].filter(Boolean).join(' · ');
      } catch (error) {
        console.error('[library] import failed', error);
        setImportToast({
          kind: 'error',
          title: fill(t.importFailed, { name: file.name }),
          detail: error instanceof Error ? error.message : String(error),
          action: { label: t.importOk, onClick: () => undefined },
        });
        return;
      }
    }
    if (!lastBook) { setImportToast(null); return; }
    const book = lastBook;
    setActiveBookId(book.bookId);
    setImportToast({
      kind: 'done',
      title: fill(t.importDone, { title: book.title }),
      detail: lastDetail || undefined,
      action: { label: t.importRead, onClick: () => loadBookIntoWorkspace(book, 'reader') },
    });
  };

  const createOrUpdateBook = async (input: { bookId?: string; title: string; author?: string; category?: BookCategory; coverTheme?: BookCoverTheme; content: string }) => {
    const content = input.content.replace(/\r\n?/g, '\n');
    const fingerprint = await fingerprintText(content);
    const next = await upsertBook(libraryDbRef.current, { ...input, content, fingerprint });
    const book = locateBook(next, input.bookId ?? null, fingerprint);
    setLibraryDb(next);
    if (book) setActiveBookId(book.bookId);
  };

  const exportLibraryJson = async () => {
    const json = exportLibraryBackup(libraryDbRef.current);
    await saveBlob(new Blob([json], { type: 'application/json' }), `furigana-library-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const importLibraryJson = async (file: File) => {
    try {
      const merged = importLibraryBackup(libraryDbRef.current, await file.text());
      setLibraryDb(merged);
      setLibraryToast(t.libraryBackupImportedNotice);
    } catch (error) {
      console.error('[library] backup import failed', error);
      // Rethrow so the library panel can surface the failure inline (role="alert").
      throw error;
    }
  };

  const restoreStarterBooks = async () => {
    const starters = await createStarterBooks();
    let next = libraryDbRef.current;
    for (const book of Object.values(starters.books)) {
      next = await upsertBook(next, {
        bookId: book.bookId,
        title: book.title,
        author: book.author,
        category: book.category,
        format: book.format,
        coverTheme: book.coverTheme,
        content: book.content,
        fingerprint: book.fingerprint,
        sourceOverrides: book.sourceOverrides,
        srtCues: book.srtCues,
        favorite: book.favorite,
      });
    }
    setLibraryDb(next);
    setLibraryToast(t.libraryBackupImportedNotice);
  };

  const handleToggleFavorite = (bookId: string) => {
    setLibraryDb(previous => toggleBookFavorite(previous, bookId));
  };

  const handleUpdateBookMetadata = (bookId: string, patch: BookMetadataPatch) => {
    updateLibraryDb(prev => updateBookMetadata(prev, bookId, patch));
    if ((activeBookId === bookId || editorBookId === bookId) && patch.title?.trim()) {
      setDocTitle(patch.title.trim());
    }
  };

  const handleImportPixivNovel = async (urlOrId: string) => {
    const trimmed = urlOrId.trim();
    if (!trimmed) return;
    setIsPixivImporting(true);
    setImportError('');
    try {
      const pixiv = await fetchPixivNovel(trimmed);
      const pixivOverrides = buildPixivRubyOverrides(pixiv.content, pixiv.rubyOverrides, rubyType);
      const fingerprint = await fingerprintText(pixiv.content);
      const next = await upsertBook(libraryDbRef.current, {
        title: pixiv.title,
        author: pixiv.author,
        description: pixiv.description,
        coverUrl: pixiv.coverUrl,
        sourceUrl: pixiv.sourceUrl,
        category: 'script',
        format: 'txt',
        content: pixiv.content,
        fingerprint,
        sourceOverrides: pixivOverrides,
      });
      const book = locateBook(next, null, fingerprint);
      updateLibraryDb(next);
      setSourceOverrides(prev => {
        let merged = [...prev];
        for (const item of pixivOverrides) {
          merged = upsertRubyOverride(merged, item);
        }
        return merged;
      });
      setSrtCues([]);
      setEditingToken(null);
      setDocTitle(pixiv.title);
      setRawText(pixiv.content);
      if (book) {
        setActiveBookId(book.bookId);
        setEditorBookId(book.bookId);
      }
      const resolved = resolveScript(databaseRef.current, pixiv.title, pixiv.content, fingerprint);
      databaseRef.current = resolved.database;
      setDatabase(resolved.database);
      setDocumentId(resolved.scriptId);
      markEditorSource(resolved.scriptId, 'txt');
      void saveCorrections(resolved.database).catch(() => undefined);
      setLibraryToast(`${t.libPixivImportSuccess}：${pixiv.title}`);
      setEditorPixivUrl('');
      setShowImportMenu(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setImportError(`${t.libPixivImportError}：${message}`);
      throw err;
    } finally {
      setIsPixivImporting(false);
    }
  };

  const handleDeleteBook = (bookId: string) => {
    void deleteBookAssets(bookId).catch(() => undefined);
    setLibraryDb(previous => deleteBook(previous, bookId));
    if (activeBookId === bookId) setActiveBookId(null);
    if (editorBookId === bookId) setEditorBookId(null);
  };

  const handleReaderProgress = (chapterIndex: number, lineIndex: number, totalLines?: number) => {
    if (!activeBookId) return;
    setLibraryDb(previous => {
      const book = previous.books[activeBookId];
      if (!book) return previous;
      const total = Math.max(1, book.chapters.length - 1);
      const percentage = totalLines !== undefined
        ? lineProgressPercent(lineIndex, totalLines)
        : book.chapters.length <= 1 ? 100 : Math.round((chapterIndex / total) * 100);
      return updateReadingProgress(previous, activeBookId, { chapterIndex, lineIndex, percentage });
    });
  };

  const handleAddBookmark = (lineIndex: number, label?: string) => {
    const book = activeBook;
    if (!activeBookId || !book) return;
    const sourceLines = book.content.replace(/\r\n?/g, '\n').split('\n');
    const snippet = (sourceLines[lineIndex] || '').trim().slice(0, 80);
    const chapterIndex = Math.max(0, book.chapters.findIndex(chapter => lineIndex >= chapter.startLine && lineIndex <= chapter.endLine));
    setLibraryDb(previous => addBookmark(previous, activeBookId, { chapterIndex, lineIndex, label: label ?? '', snippet }));
  };

  const handleRemoveBookmark = (bookmarkId: string) => {
    if (!activeBookId) return;
    setLibraryDb(previous => removeBookmark(previous, activeBookId, bookmarkId));
  };

  return {
    libraryDb, setLibraryDb, libraryDbRef, activeBookId, activeBook, editorBook, setEditorBookId, markEditorSource, libraryBooks,
    libraryToast, setLibraryToast, importToast, setImportToast, showImportMenu, setShowImportMenu, editorPixivUrl, setEditorPixivUrl, isPixivImporting,
    loadBookIntoWorkspace, handleSaveToLibrary, handleOpenInReader, importLibraryFiles, createOrUpdateBook,
    exportLibraryJson, importLibraryJson, restoreStarterBooks, handleToggleFavorite, handleUpdateBookMetadata,
    handleImportPixivNovel, handleDeleteBook, handleReaderProgress, handleAddBookmark, handleRemoveBookmark,
  };
}
