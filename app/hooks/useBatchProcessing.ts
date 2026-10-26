'use client';

import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { BatchFileItem, ExportFormat } from '../components/BatchProcessingPanel';
import type { useFuriganaWorker } from './useFuriganaWorker';
import type { ScriptLine } from '../utils/furigana';
import { generateSRT, type SrtCue } from '../utils/srt';
import { importTextScript, scriptSourceFormat, withLfLineKeys } from '../utils/inlineRuby';
import { cleanScriptTitle, importDocx } from '../utils/docxImporter';
import type { RubyOverride } from '../utils/rubyOverrides';
import { fingerprintText, resolveScript, type CorrectionDatabaseV2, type ProperNounEntry } from '../utils/correctionDatabase';
import { upsertBook, type BookItem, type LibraryDatabaseV1 } from '../utils/libraryDatabase';
import { buildDocxBlob } from '../utils/docxExporter';
import { buildEpubBlob } from '../utils/epubExporter';
import { buildPdfBlob } from '../utils/pdfExporter';
import { isBookFile, parseBookFile } from '../utils/bookImport';
import { withoutImageLines } from '../utils/bookAssets';
import { buildBatchZipBlob, pickBatchDirectory, saveBlob, saveBlobToDirectory, type BatchSaveMode } from '../utils/fileSave';
import type { Translations } from '../utils/i18n';

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
  generateTextContent: (lines: ScriptLine[], format: 'srt' | 'txt') => string;
  isKuromojiLoading: boolean;
  correctionsReady: boolean;
}

/** Batch page queue: file intake, sequential annotate + export, optional library save and the completion summary. */
export function useBatchProcessing({
  t, database, setDatabase, libraryDbRef, setLibraryDb, annotate, rubyType, glossaryEntries,
  fontSize, rubyFontSize, lineSpacing, generateTextContent, isKuromojiLoading, correctionsReady,
}: BatchProcessingOptions) {
  // Batch File Processing State
  const [batchFiles, setBatchFiles] = useState<BatchFileItem[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [batchTargetFormat, setBatchTargetFormat] = useState<ExportFormat>('docx');
  const [batchSaveMode, setBatchSaveMode] = useState<BatchSaveMode>('zip');
  const [alsoSaveToLibrary, setAlsoSaveToLibrary] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Completion summary modal
  const [isBatchDoneModalOpen, setIsBatchDoneModalOpen] = useState(false);
  const [batchDoneResults, setBatchDoneResults] = useState<{ total: number; success: number; failed: number; cancelled: number; filenames: string[] }>({ total: 0, success: 0, failed: 0, cancelled: 0, filenames: [] });

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
    const validExts = ['.txt', '.srt', '.docx', '.epub', '.pdf'];
    const newItems: BatchFileItem[] = files
      .filter(f => validExts.some(ext => f.name.toLowerCase().endsWith(ext)))
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

    setIsBatchProcessing(true);
    let successCount = 0;
    let failCount = 0;
    let cancelCount = 0;
    const exportedNames: string[] = [];
    const zipOutputs: Array<{ filename: string; blob: Blob }> = [];
    let batchDatabase = database;
    let librarySnapshot = libraryDbRef.current;
    let libraryWritten = false;

    for (let i = 0; i < batchFiles.length; i++) {
      const item = batchFiles[i];

      setBatchFiles(prev =>
        prev.map(f => f.id === item.id ? { ...f, status: 'processing', progress: 30, error: undefined } : f)
      );

      try {
        let textContent = '';
        let importedOverrides: RubyOverride[] = [];
        let importedCues: SrtCue[] = [];
        // A queued library book is already parsed: read its text, overrides and cues straight from the library.
        const libraryBook = item.bookId ? libraryDbRef.current.books[item.bookId] : undefined;
        if (item.bookId) {
          if (!libraryBook) throw new Error('台本库里已经找不到这本书');
          textContent = libraryBook.content;
          // Library overrides are keyed with LF line endings, which is what the book content uses.
          importedOverrides = libraryBook.sourceOverrides;
          importedCues = libraryBook.srtCues || [];
        } else if (!item.file) {
          throw new Error('未找到待处理的文件');
        } else if (isBookFile(item.name)) {
          const parsed = await parseBookFile(item.file);
          textContent = withoutImageLines(parsed.content);
          importedOverrides = parsed.sourceOverrides;
        } else if (item.name.toLowerCase().endsWith('.docx')) {
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
        const itemTitle = item.bookId
          ? (libraryBook?.title || item.name.replace(/\.[^/.]+$/, ''))
          : item.name.replace(/\.[^/.]+$/, "") || '日语假名配音台本';
        const fingerprint = await fingerprintText(textContent);
        const resolved = resolveScript(batchDatabase, itemTitle, textContent, fingerprint);
        batchDatabase = resolved.database;
        setDatabase(previous => resolveScript(previous, itemTitle, textContent, fingerprint, resolved.scriptId).database);
        const parsedLines = await annotate({ text: textContent, rubyType, glossary: glossaryEntries,
          sourceOverrides: importedOverrides, overrides: batchDatabase.scripts[resolved.scriptId].overrides,
          learned: batchDatabase.scripts[resolved.scriptId]?.learned || [] });

        // Generate output based on target format
        let outputBlob: Blob;
        if (format === 'docx') {
          outputBlob = await buildDocxBlob(parsedLines, { title: itemTitle, baseFontSize: fontSize, rubyFontSize, lineSpacing });
        } else if (format === 'epub') {
          outputBlob = await buildEpubBlob(parsedLines, { title: itemTitle, baseFontSize: fontSize, rubyFontSize, lineSpacing });
        } else if (format === 'pdf') {
          outputBlob = await buildPdfBlob(parsedLines, { title: itemTitle, baseFontSize: fontSize, rubyFontSize, lineSpacing });
        } else {
          const textOutput = format === 'srt' ? generateSRT(parsedLines, importedCues) : generateTextContent(parsedLines, 'txt');
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
          librarySnapshot = await upsertBook(librarySnapshot, {
            title: cleanScriptTitle(itemTitle) || t.untitledScript,
            content: textContent,
            fingerprint,
            format: scriptSourceFormat(item.name),
            sourceOverrides: withLfLineKeys(importedOverrides),
            srtCues: importedCues,
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
          const saveRes = await saveBlob(outputBlob, outName, { skipFilePicker: true });
          if (saveRes.success) {
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
          setBatchFiles(prev =>
            prev.map(f => f.id === item.id ? { ...f, status: 'done', progress: 100, lineCount: parsedLines.length } : f)
          );
          exportedNames.push(outName);
          successCount++;
        }
      } catch (err) {
        setBatchFiles(prev =>
          prev.map(f => f.id === item.id ? { ...f, status: 'error', progress: 0, error: err instanceof Error ? err.message : String(err) } : f)
        );
        failCount++;
      }
    }

    if (libraryWritten) setLibraryDb(librarySnapshot);

    if (effectiveMode === 'zip' && zipOutputs.length > 0) {
      try {
        const zipBlob = await buildBatchZipBlob(zipOutputs);
        const zipSave = await saveBlob(zipBlob, '台本批量导出.zip');
        if (!zipSave.success) {
          cancelCount += zipOutputs.length;
          successCount = Math.max(0, successCount - zipOutputs.length);
          const zipped = new Set(zipOutputs.map(file => file.filename));
          for (let index = exportedNames.length - 1; index >= 0; index -= 1) {
            if (zipped.has(exportedNames[index])) exportedNames.splice(index, 1);
          }
        }
      } catch (error) {
        failCount += zipOutputs.length;
        successCount = Math.max(0, successCount - zipOutputs.length);
        console.error('[batch] zip save failed', error);
      }
    }

    setIsBatchProcessing(false);

    // Show completion notification
    setBatchDoneResults({
      total: batchFiles.length,
      success: successCount,
      failed: failCount,
      cancelled: cancelCount,
      filenames: exportedNames,
    });
    setIsBatchDoneModalOpen(true);
  };

  return {
    batchFiles, isBatchProcessing, batchTargetFormat, setBatchTargetFormat, batchSaveMode, setBatchSaveMode,
    alsoSaveToLibrary, setAlsoSaveToLibrary, fileInputRef, handleFileSelect, handleDrop, removeBatchFile,
    clearBatchFiles, addBooksToQueue, processBatchQueue, isBatchDoneModalOpen, setIsBatchDoneModalOpen, batchDoneResults,
  };
}
