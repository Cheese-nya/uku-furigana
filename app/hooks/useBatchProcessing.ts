'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { BatchFileItem, ExportFormat } from '../components/BatchProcessingPanel';
import type { useFuriganaWorker } from './useFuriganaWorker';
import type { ScriptLine } from '../utils/furigana';
import { generateSRT, type SrtCue } from '../utils/srt';
import { importTextScript, scriptSourceFormat, withLfLineKeys } from '../utils/inlineRuby';
import { cleanScriptTitle, importDocx } from '../utils/docxImporter';
import type { RubyOverride } from '../utils/rubyOverrides';
import { fingerprintText, resolveScript, type CorrectionDatabaseV2, type ProperNounEntry } from '../utils/correctionDatabase';
import { upsertBook, type BookChapter, type BookItem, type LibraryDatabaseV1, type PdfLayout } from '../utils/libraryDatabase';
import { downscaleCover } from '../utils/assetStore';
import type { ExportCoverInput } from '../utils/exportCover';
import { buildDocxBlob } from '../utils/docxExporter';
import { buildEpubBlob } from '../utils/epubExporter';
import { buildPdfBlob } from '../utils/pdfExporter';
import { detectBookFormat, isImportableFile, parseBookFile, type ParsedBookFile } from '../utils/bookImport';
import { withoutImageLines } from '../utils/bookAssets';
import { buildBatchSaveOutput, pickBatchDirectory, saveBlob, saveBlobToDirectory, type BatchSaveMode } from '../utils/fileSave';
import type { BatchDoneResults } from '../components/BatchDoneModal';
import type { Translations } from '../utils/i18n';
import type { TranslationSettings } from '../utils/translation';
import { resolveExportTranslations, type ExportTranslationPrefs } from '../utils/exportTranslations';

type Setter<T> = Dispatch<SetStateAction<T>>;

/** Shared app state the batch queue reads (annotation engine, corrections, typography, library). */
export interface BatchProcessingOptions {
  t: Translations;
  database: CorrectionDatabaseV2;
  setDatabase: Setter<CorrectionDatabaseV2>;
  libraryDbRef: RefObject<LibraryDatabaseV1>;
  setLibraryDb: Setter<LibraryDatabaseV1>;
  annotate: ReturnType<typeof useFuriganaWorker>['annotate'];
  rubyType: 'hiragana' | 'katakana' | 'romaji';
  glossaryEntries: ProperNounEntry[];
  fontSize: number;
  rubyFontSize: number;
  lineSpacing: number;
  generateTextContent: (
    lines: ScriptLine[],
    format: 'srt' | 'txt',
    preserveSrtCues?: boolean,
    translations?: readonly (string | undefined)[],
  ) => string;
  isKuromojiLoading: boolean;
  correctionsReady: boolean;
  exportTranslationPrefs: ExportTranslationPrefs;
  translationSettings: TranslationSettings;
}

/** Batch page queue: file intake, sequential annotate + export, optional library save and the completion summary. */
export function useBatchProcessing({
  t, database, setDatabase, libraryDbRef, setLibraryDb, annotate, rubyType, glossaryEntries,
  fontSize, rubyFontSize, lineSpacing, generateTextContent, isKuromojiLoading, correctionsReady,
  exportTranslationPrefs, translationSettings,
}: BatchProcessingOptions) {
  // Batch File Processing State
  const [batchFiles, setBatchFiles] = useState<BatchFileItem[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [batchTargetFormat, setBatchTargetFormat] = useState<ExportFormat>('docx');
  const [batchSaveMode, setBatchSaveMode] = useState<BatchSaveMode>('zip');
  const [alsoSaveToLibrary, setAlsoSaveToLibrary] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { batchAbortRef.current?.abort(); }, []);
  // Completion summary modal
  const [isBatchDoneModalOpen, setIsBatchDoneModalOpen] = useState(false);
  const [batchDoneResults, setBatchDoneResults] = useState<BatchDoneResults>({ total: 0, success: 0, failed: 0, cancelled: 0, filenames: [] });
  const pendingSaveOutputRef = useRef<{ filename: string; blob: Blob } | null>(null);
  const saveBatchAgain = useCallback(() => {
    const output = pendingSaveOutputRef.current;
    if (!output) return;
    void saveBlob(output.blob, output.filename, { skipFilePicker: true, skipShare: true })
      .catch(error => console.error('[batch] save again failed', error));
  }, []);
  const setBatchDoneModalOpen = useCallback((open: boolean) => {
    if (!open) pendingSaveOutputRef.current = null;
    setIsBatchDoneModalOpen(open);
  }, []);

  // File Upload Handlers for Batch Page
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    addFilesToQueue(files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const files = Array.from(e.dataTransfer.files);
      addFilesToQueue(files);
    }
  };

  const addFilesToQueue = (files: File[]) => {
    // An Android content:// pick can arrive without an extension; its MIME type still names it.
    const newItems: BatchFileItem[] = files
      .filter(isImportableFile)
      .map(f => ({
        id: Math.random().toString(36).substring(2, 9),
        file: f,
        name: f.name,
        size: f.size,
        status: 'pending',
        progress: 0,
      }));

    setBatchFiles(prev => [...prev, ...newItems]);
  };

  const removeBatchFile = (id: string) => {
    setBatchFiles(prev => prev.filter(f => f.id !== id));
  };

  /** Queue library books without a file: the text and its overrides already live in the library. */
  const addBooksToQueue = (books: BookItem[]) => {
    setBatchFiles(prev => {
      const queuedBookIds = new Set(prev.map(item => item.bookId).filter((bookId): bookId is string => !!bookId));
      const newItems: BatchFileItem[] = books
        .filter(book => !queuedBookIds.has(book.bookId))
        .map(book => ({
          id: Math.random().toString(36).substring(2, 9),
          bookId: book.bookId,
          name: `${book.title}.${book.format}`,
          size: book.content.length,
          status: 'pending' as const,
          progress: 0,
        }));
      return [...prev, ...newItems];
    });
  };

  const clearBatchFiles = () => {
    batchAbortRef.current?.abort();
    setBatchFiles([]);
  };

  // Execute Batch Processing on Queue
  // 全部导出 picks the format at click time (no separate format setting in the UI).
  const processBatchQueue = async (format: ExportFormat = batchTargetFormat) => {
    if (batchFiles.length === 0 || isBatchProcessing || isKuromojiLoading || !correctionsReady) return;

    let effectiveMode: BatchSaveMode = batchSaveMode;
    let dirHandle: Awaited<ReturnType<typeof pickBatchDirectory>> = null;
    if (batchSaveMode === 'folder') {
      try {
        dirHandle = await pickBatchDirectory();
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        throw error;
      }
      if (!dirHandle) {
        effectiveMode = 'zip';
        setBatchSaveMode('zip');
      }
    }

    const controller = new AbortController();
    batchAbortRef.current = controller;
    setIsBatchProcessing(true);
    pendingSaveOutputRef.current = null;
    let successCount = 0;
    let failCount = 0;
    let cancelCount = 0;
    const exportedNames: string[] = [];
    const zipOutputs: Array<{ filename: string; blob: Blob }> = [];
    let finalSaveOutput: { filename: string; blob: Blob } | null = null;
    const zipItemIds = new Set<string>();
    let batchDatabase = database;
    let librarySnapshot = libraryDbRef.current;
    let libraryWritten = false;

    for (let i = 0; i < batchFiles.length; i++) {
      if (controller.signal.aborted) {
        cancelCount += batchFiles.length - i;
        break;
      }
      const item = batchFiles[i];

      setBatchFiles(prev =>
        prev.map(f => f.id === item.id ? { ...f, status: 'processing', progress: 30, error: undefined } : f)
      );

      try {
        let textContent = '';
        let importedOverrides: RubyOverride[] = [];
        let importedCues: SrtCue[] = [];
        // Source PDF layout, cover and chapters travel with the item: from the imported file, or from the library book.
        let pdfLayout: PdfLayout | undefined;
        let cover: ExportCoverInput;
        let coverBlob: Blob | undefined;
        let exportChapters: BookChapter[] | undefined;
        let exportAuthor: string | undefined;
        // Format detected from the bytes when the picked name carries no usable extension.
        let detectedFormat: 'epub' | 'pdf' | 'docx' | 'image' | null = null;
        let parsedBookMeta: Pick<ParsedBookFile, 'title' | 'author' | 'category' | 'chapters'> | undefined;
        // A queued library book is already parsed: read its text, overrides and cues straight from the library.
        const libraryBook = item.bookId ? libraryDbRef.current.books[item.bookId] : undefined;
        if (item.bookId) {
          if (!libraryBook) throw new Error('台本库里已经找不到这本书');
          textContent = libraryBook.content;
          // Library overrides are keyed with LF line endings, which is what the book content uses.
          importedOverrides = libraryBook.sourceOverrides;
          importedCues = libraryBook.srtCues || [];
          pdfLayout = libraryBook.pdfLayout;
          cover = libraryBook.coverUrl;
          exportChapters = libraryBook.chapters;
          exportAuthor = libraryBook.author;
        } else if (!item.file) {
          throw new Error('未找到待处理的文件');
        } else {
          // Same routing as the editor: the MIME type and magic bytes decide when the name has
          // no extension (an Android content:// pick).
          const format = await detectBookFormat(item.file);
          detectedFormat = format;
          if (format === 'epub' || format === 'pdf' || format === 'image') {
            const parsed = await parseBookFile(item.file, {
              signal: controller.signal,
              ocr: format === 'pdf' || format === 'image' ? 'force' : 'auto',
              onProgress: progress => {
                if (progress.stage === 'ocr' && progress.total && progress.total > 0) {
                  const pct = Math.min(60, Math.max(5, Math.round((progress.current / progress.total) * 60)));
                  setBatchFiles(prev => prev.map(f => f.id === item.id ? { ...f, progress: pct } : f));
                }
              },
            });
            textContent = withoutImageLines(parsed.content);
            importedOverrides = parsed.sourceOverrides;
            pdfLayout = parsed.pdfLayout;
            coverBlob = parsed.cover;
            cover = parsed.cover;
            exportAuthor = parsed.author;
            parsedBookMeta = { title: parsed.title, author: parsed.author, category: parsed.category, chapters: parsed.chapters };
          } else if (format === 'docx') {
            const arrayBuffer = await item.file.arrayBuffer();
            const imported = await importDocx(arrayBuffer);
            textContent = imported.text;
            importedOverrides = imported.overrides;
          } else {
            // Same text import as the editor: inline 漢字(かな) readings become source overrides.
            const imported = importTextScript(item.name, await item.file.text());
            if (item.name.toLowerCase().endsWith('.srt') && !imported.cues.length) throw new Error('未找到有效的 SRT 时间轴');
            textContent = imported.text;
            importedOverrides = imported.overrides;
            importedCues = imported.cues;
          }
        }
        const cleanedFileName = cleanScriptTitle(item.name.replace(/\.[^/.]+$/, ''));
        const itemTitle = item.bookId
          ? (libraryBook?.title || cleanedFileName)
          : (parsedBookMeta?.title && parsedBookMeta.title !== 'Untitled' ? parsedBookMeta.title : cleanedFileName) || '日语假名配音台本';
        const fingerprint = await fingerprintText(textContent);
        const resolved = resolveScript(batchDatabase, itemTitle, textContent, fingerprint);
        batchDatabase = resolved.database;
        setDatabase(previous => resolveScript(previous, itemTitle, textContent, fingerprint, resolved.scriptId).database);
        const parsedLines = await annotate({ text: textContent, rubyType, glossary: glossaryEntries,
          sourceOverrides: importedOverrides, overrides: batchDatabase.scripts[resolved.scriptId].overrides,
          learned: batchDatabase.scripts[resolved.scriptId]?.learned || [] }, controller.signal);

        let translations: (string | undefined)[] | undefined;
        if (exportTranslationPrefs.enabled) {
          const cacheBookId = item.bookId || resolved.scriptId;
          const res = await resolveExportTranslations(parsedLines, {
            bookId: cacheBookId,
            missingPolicy: exportTranslationPrefs.missingPolicy,
            settings: translationSettings,
            glossary: glossaryEntries.map(g => ({ surface: g.surface, reading: g.reading })),
            signal: controller.signal,
            onProgress: ({ done, total }) => {
              const pct = 30 + Math.round((done / Math.max(1, total)) * 45);
              setBatchFiles(prev =>
                prev.map(f => f.id === item.id ? { ...f, progress: pct } : f)
              );
            },
          });
          translations = res.translations;
        }

        // Generate output based on target format
        let outputBlob: Blob;
        if (format === 'docx') {
          outputBlob = await buildDocxBlob(parsedLines, { title: itemTitle, baseFontSize: fontSize, rubyFontSize, lineSpacing, translations, cover });
        } else if (format === 'epub') {
          outputBlob = await buildEpubBlob(parsedLines, { title: itemTitle, author: exportAuthor, baseFontSize: fontSize, rubyFontSize, lineSpacing, translations, translationLang: translationSettings.target, cover, chapters: exportChapters });
        } else if (format === 'pdf') {
          outputBlob = await buildPdfBlob(parsedLines, { title: itemTitle, baseFontSize: fontSize, rubyFontSize, lineSpacing, layout: pdfLayout, translations, cover, chapters: exportChapters });
        } else {
          const textOutput = format === 'srt'
            ? generateSRT(parsedLines, importedCues, translations)
            : generateTextContent(parsedLines, 'txt', true, translations);
          const mime = format === 'srt' ? 'application/x-subrip' : 'text/plain';
          outputBlob = new Blob([textOutput], { type: mime });
        }

        setBatchFiles(prev =>
          prev.map(f => f.id === item.id ? { ...f, progress: 80 } : f)
        );

        await new Promise(r => setTimeout(r, 200));

        const outExt = format;
        const outName = `${cleanScriptTitle(itemTitle) || 'japanese_script'}.${outExt}`;

        if (alsoSaveToLibrary && !item.bookId) {
          // A book taken from the library is already saved: never write it back.
          // The book's format describes its source file (as in the library importer), not the export.
          const coverUrl = coverBlob ? await downscaleCover(coverBlob).catch(() => undefined) : undefined;
          librarySnapshot = await upsertBook(librarySnapshot, {
            title: cleanScriptTitle(itemTitle) || t.untitledScript,
            ...(parsedBookMeta?.author ? { author: parsedBookMeta.author } : {}),
            ...(coverUrl ? { coverUrl } : {}),
            content: textContent,
            fingerprint,
            format: detectedFormat ?? scriptSourceFormat(item.name),
            ...(parsedBookMeta?.category ? { category: parsedBookMeta.category } : {}),
            ...(parsedBookMeta?.chapters ? { chapters: parsedBookMeta.chapters } : {}),
            sourceOverrides: withLfLineKeys(importedOverrides),
            srtCues: importedCues,
            ...(pdfLayout ? { pdfLayout } : {}),
          });
          libraryWritten = true;
        }

        if (effectiveMode === 'folder' && dirHandle) {
          await saveBlobToDirectory(dirHandle, outName, outputBlob);
          setBatchFiles(prev =>
            prev.map(f => f.id === item.id ? { ...f, status: 'done', progress: 100, lineCount: parsedLines.length } : f)
          );
          exportedNames.push(outName);
          successCount++;
        } else if (effectiveMode === 'direct') {
          // The annotation job can outlive Safari's transient user activation: prefer a plain download.
          const saveRes = await saveBlob(outputBlob, outName, { skipFilePicker: true, skipShare: true });
          if (saveRes.success) {
            finalSaveOutput = { filename: outName, blob: outputBlob };
            setBatchFiles(prev =>
              prev.map(f => f.id === item.id ? { ...f, status: 'done', progress: 100, lineCount: parsedLines.length } : f)
            );
            exportedNames.push(saveRes.path || outName);
            successCount++;
          } else {
            cancelCount++;
            setBatchFiles(prev =>
              prev.map(f => f.id === item.id ? { ...f, status: 'pending', progress: 0 } : f)
            );
          }
        } else {
          zipOutputs.push({ filename: outName, blob: outputBlob });
          zipItemIds.add(item.id);
          setBatchFiles(prev =>
            prev.map(f => f.id === item.id ? { ...f, status: 'done', progress: 100, lineCount: parsedLines.length } : f)
          );
          exportedNames.push(outName);
          successCount++;
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          cancelCount += batchFiles.length - i;
          setBatchFiles(prev =>
            prev.map(f => f.id === item.id ? { ...f, status: 'pending', progress: 0 } : f)
          );
          break;
        }
        setBatchFiles(prev =>
          prev.map(f => f.id === item.id ? { ...f, status: 'error', progress: 0, error: err instanceof Error ? err.message : String(err) } : f)
        );
        failCount++;
      }
    }

    if (libraryWritten) setLibraryDb(librarySnapshot);

    if (effectiveMode === 'zip' && zipOutputs.length > 0) {
      const dropZippedNames = () => {
        const zipped = new Set(zipOutputs.map(file => file.filename));
        for (let index = exportedNames.length - 1; index >= 0; index -= 1) {
          if (zipped.has(exportedNames[index])) exportedNames.splice(index, 1);
        }
      };
      if (controller.signal.aborted) {
        cancelCount += zipOutputs.length;
        successCount = Math.max(0, successCount - zipOutputs.length);
        dropZippedNames();
        setBatchFiles(prev =>
          prev.map(f => zipItemIds.has(f.id) ? { ...f, status: 'pending', progress: 0 } : f)
        );
      } else {
        try {
          const saveOutput = await buildBatchSaveOutput(zipOutputs);
          finalSaveOutput = saveOutput;
          const zipSave = await saveBlob(saveOutput.blob, saveOutput.filename, { skipFilePicker: true, skipShare: true });
          if (!zipSave.success) {
            finalSaveOutput = null;
            cancelCount += zipOutputs.length;
            successCount = Math.max(0, successCount - zipOutputs.length);
            dropZippedNames();
            setBatchFiles(prev =>
              prev.map(f => zipItemIds.has(f.id) ? { ...f, status: 'pending', progress: 0 } : f)
            );
          }
        } catch (error) {
          finalSaveOutput = null;
          failCount += zipOutputs.length;
          successCount = Math.max(0, successCount - zipOutputs.length);
          const zipMessage = error instanceof Error ? error.message : String(error);
          dropZippedNames();
          setBatchFiles(prev =>
            prev.map(f => zipItemIds.has(f.id) ? { ...f, status: 'error', progress: 0, error: zipMessage } : f)
          );
          console.error('[batch] zip save failed', error);
        }
      }
    }

    if (batchAbortRef.current === controller) batchAbortRef.current = null;
    setIsBatchProcessing(false);

    // Safari sometimes needs the download to start from a fresh gesture after a long annotation job.
    pendingSaveOutputRef.current = finalSaveOutput;

    if (!controller.signal.aborted) {
      // Show completion notification
      setBatchDoneResults({
        total: batchFiles.length,
        success: successCount,
        failed: failCount,
        cancelled: cancelCount,
        filenames: exportedNames,
      });
      setIsBatchDoneModalOpen(true);
    }
  };

  return {
    batchFiles, isBatchProcessing, batchTargetFormat, setBatchTargetFormat, batchSaveMode, setBatchSaveMode,
    alsoSaveToLibrary, setAlsoSaveToLibrary, fileInputRef, handleFileSelect, handleDrop, removeBatchFile,
    clearBatchFiles, addBooksToQueue, processBatchQueue, isBatchDoneModalOpen, setIsBatchDoneModalOpen: setBatchDoneModalOpen,
    batchDoneResults, saveBatchAgain,
  };
}
