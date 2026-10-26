'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { GlassToast } from './components/GlassToast';
import { ReadingToolsSheet } from './components/ReadingToolsSheet';
import { useReadingTools } from './hooks/useReadingTools';
import { isBookFile, parseBookFile } from './utils/bookImport';
import { withoutImageLines } from './utils/bookAssets';
import { Sidebar } from './components/Sidebar';
import { SettingsMenu } from './components/SettingsMenu';
import { MobileNavBar, type AppTab } from './components/MobileNavBar';
import { LibraryPanel } from './components/LibraryPanel';
import { ReaderPanel } from './components/ReaderPanel';
import { GlossaryModal } from './components/GlossaryModal';
import { ExportProgressModal } from './components/ExportProgressModal';
import { BatchDoneModal } from './components/BatchDoneModal';
import { LearnedReadingsModal } from './components/LearnedReadingsModal';
import { RubyCorrectionModal, type EditingTokenState } from './components/RubyCorrectionModal';
import { BatchProcessingPanel } from './components/BatchProcessingPanel';
import { EditorWorkspace } from './components/EditorWorkspace';
import type { ScriptLine } from './utils/furigana';
import { useFuriganaWorker } from './hooks/useFuriganaWorker';
import { useThemeMode } from './hooks/useThemeMode';
import { useLibraryController } from './hooks/useLibraryController';
import { useBatchProcessing } from './hooks/useBatchProcessing';
import { generateSRT, generateTXT, type SrtCue } from './utils/srt';
import { importTextScript, scriptSourceFormat } from './utils/inlineRuby';

import { cleanScriptTitle, importDocx } from './utils/docxImporter';
import { upsertRubyOverride, type RubyOverride } from './utils/rubyOverrides';
import { loadCorrections, saveCorrections } from './utils/correctionStorage';
import { emptyDatabase, fingerprintText, resolveScript, updateScript, setScriptOverrides, learnReading, deleteLearnedReading, type CorrectionDatabaseV2 } from './utils/correctionDatabase';
import { selectReviewWord, makeLearnedReading } from './utils/review';
import { buildDocxBlob } from './utils/docxExporter';
import { saveBlob } from './utils/fileSave';
import { installBackBridge, setNavigationBack } from './utils/backStack';
import { FeedbackModal } from './components/FeedbackModal';
import { useUpdater } from './hooks/useUpdater';
import { buildReport, installGlobalLogging } from './utils/appLog';
import { buildFeedbackPayload, submitFeedback } from './utils/feedback';
import { DISTRIBUTION } from './utils/appInfo';
import { QQ_GROUP, RELEASES_URL, type AndroidUpdateBridge, type FeedbackKind } from './utils/updateTypes';
import { translations, type Locale } from './utils/i18n';

const fillTemplate = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

export default function DubbingStudioApp() {
  // Locale & Theme State
  const [locale, setLocale] = useState<Locale>('zh-CN');
  const { themeMode, setThemeMode } = useThemeMode();

  useEffect(() => {
    try {
      const saved = localStorage.getItem('furigana_locale') as Locale | null;
      if (saved === 'zh-CN' || saved === 'en') {
        // Post-mount restore keeps the static-export prerender (default locale) hydration-safe.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLocale(saved);
      }
    } catch {}
  }, []);

  const handleLocaleChange = (newLocale: Locale) => {
    setLocale(newLocale);
    try {
      localStorage.setItem('furigana_locale', newLocale);
    } catch {}
  };

  const t = translations[locale];

  // Navigation & UI states
  const [isGlossaryOpen, setIsGlossaryOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('editor');
  useEffect(() => {
    try {
      const hashTab = window.location.hash.replace(/^#/, '');
      const savedTab = hashTab || localStorage.getItem('furigana_active_tab');
      if (savedTab === 'editor' || savedTab === 'library' || savedTab === 'reader' || savedTab === 'batch_files') {
        // Same post-mount, hydration-safe restore as the locale above.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveTab(savedTab);
      }
    } catch {}
  }, []);
  // Android back key: close the open sheet first, then step up one screen (reader -> library -> workbench);
  // only from the workbench does it fall through and let the shell exit.
  useEffect(() => installBackBridge(window as unknown as { __ukuBack?: () => boolean }), []);
  useEffect(() => {
    setNavigationBack(() => {
      if (activeTab === 'reader') { setActiveTab('library'); return true; }
      if (activeTab !== 'editor') { setActiveTab('editor'); return true; }
      return false;
    });
    return () => setNavigationBack(null);
  }, [activeTab]);
  // Phone portrait-only web orientation lock (best effort; browsers may reject without fullscreen).
  useEffect(() => {
    if (typeof window === 'undefined' || window.innerWidth >= 768) return;
    const orientationLock = screen?.orientation as unknown as { lock?: (orientation: string) => Promise<void> } | undefined;
    orientationLock?.lock?.('portrait')?.catch(() => {});
  }, []);

  // Options
  const [rubyType, setRubyType] = useState<'hiragana' | 'katakana' | 'romaji'>('hiragana');
  const [fontSize, setFontSize] = useState<number>(16); // 默认小四 (16px)
  const [rubyFontSize] = useState<number>(10); // 假名字号 (10px)，阅读器与导出使用
  const [lineSpacing] = useState<number>(1.8);  // 行距 (1.8x)
  const [previewFontFamily, setPreviewFontFamily] = useState<'sans' | 'serif'>('sans');
  const [previewShowRuby, setPreviewShowRuby] = useState(true);

  // Editor Input & Document Title State
  const [docTitle, setDocTitle] = useState<string>('日语假名配音台本');
  const [rawText, setRawText] = useState<string>(
    `山田先生：みなさん、こんにちは！今日の日本語アフレコ台本へようこそ。\n佐藤：先生、この漢字の読み方は何ですか？\n山田先生：これは「未来」と「希望」です。\n鈴木：声優の配音練習を始めましょう！`
  );
  const [sourceOverrides, setSourceOverrides] = useState<RubyOverride[]>([]);
  const [srtCues, setSrtCues] = useState<SrtCue[]>([]);
  const [database, setDatabase] = useState<CorrectionDatabaseV2>(emptyDatabase);
  const databaseRef = useRef(database);
  const [documentId, setDocumentId] = useState('');
  const [storageRetry, setStorageRetry] = useState(0);
  const initialDocumentRef = useRef({ title: docTitle, text: rawText });
  const [correctionsReady, setCorrectionsReady] = useState(false);
  const [correctionError, setCorrectionError] = useState('');
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<'docx' | 'srt' | 'txt'>('docx');

  const [exportOutcome, setExportOutcome] = useState<'processing' | 'saved' | 'download' | 'cancelled' | 'error'>('processing');
  const [exportError, setExportError] = useState('');
  const [importError, setImportError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const importSequenceRef = useRef(0);
  const [editingToken, setEditingToken] = useState<EditingTokenState | null>(null);

  // Built-in library state + integration. Called here so its effects keep their original
  // position (after the tab/orientation effects, before the correction-database effects).
  const {
    libraryDb, setLibraryDb, libraryDbRef, activeBook, setEditorBookId, markEditorSource, libraryBooks,
    libraryToast, setLibraryToast, importToast, setImportToast,
    loadBookIntoWorkspace, handleSaveToLibrary, importLibraryFiles, createOrUpdateBook,
    handleToggleFavorite, handleUpdateBookMetadata,
    handleImportPixivNovel, handleDeleteBook, handleReaderProgress,
  } = useLibraryController({
    t, rubyType, docTitle, rawText, sourceOverrides, srtCues, documentId, databaseRef, setDatabase, setDocumentId,
    setDocTitle, setRawText, setSourceOverrides, setSrtCues, setEditingToken, setActiveTab, setImportError,
  });
  useEffect(() => { databaseRef.current = database; }, [database]);

  // Bug feedback + online update (entries live in the settings menu).
  const updater = useUpdater();
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind | null>(null);
  useEffect(() => { installGlobalLogging(); }, []);
  const openExternal = (url: string) => { window.open(url, '_blank', 'noopener,noreferrer'); };
  const copyQqGroup = () => {
    const bridge = (window as unknown as { AndroidBridge?: Partial<AndroidUpdateBridge> }).AndroidBridge;
    try { bridge?.openQqGroup?.(QQ_GROUP); } catch { /* QQ not installed: the copied number is enough */ }
    void navigator.clipboard?.writeText(QQ_GROUP).catch(() => undefined);
    setLibraryToast(`${t.qqCopied}: ${QQ_GROUP}`);
  };

  const learnedReadings = useMemo(() => database.scripts[documentId]?.learned || [], [database.scripts, documentId]);
  const documentCorrections = useMemo(() => database.scripts[documentId]?.overrides || [], [database.scripts, documentId]);
  const glossaryEntries = useMemo(() => Object.values(database.glossary), [database.glossary]);
  const annotationInput = useMemo(() => ({ text: rawText, rubyType, glossary: glossaryEntries, sourceOverrides, overrides: documentCorrections, learned: learnedReadings }),
    [rawText, rubyType, glossaryEntries, sourceOverrides, documentCorrections, learnedReadings]);
  const { lines: annotatedLines, busy: isAnnotating, engine, error: annotationError,
    annotate, analyze, retry: retryEngine } = useFuriganaWorker(annotationInput);
  const dictionaryStatus = engine.status;
  const readingTools = useReadingTools({ analyze, t, engineReady: engine.status !== 'loading', readerOpen: activeTab === 'reader' });
  const isKuromojiLoading = dictionaryStatus === 'loading';

  const reviewTargets = annotatedLines.flatMap(line => {
    const targets: Array<{ lineId: string; tokenIndex: number; endIndex: number; token: typeof line.tokens[number]; surface: string; reading: string; alternatives: string[]; context: string }> = [];
    line.tokens.forEach((token, tokenIndex) => {
      if (!token.hasKanji || !token.needsReview || !token.word) return;
      const word = token.word;
      const previous = targets[targets.length - 1];
      if (previous && previous.surface === word.surface && previous.endIndex + 1 === tokenIndex) {
        previous.endIndex = tokenIndex;
        return;
      }
      const start = Math.max(0, tokenIndex - 12);
      targets.push({ lineId: line.id, tokenIndex, endIndex: tokenIndex, token, surface: word.surface,
        reading: word.reading, alternatives: word.alternatives, context: line.cleanText.slice(start, start + word.surface.length + 24) });
    });
    return targets;
  });
  const reviewCount = reviewTargets.length;
  const libraryBookCount = Object.keys(libraryDb.books).length;

  // File import ref for Editor
  const editorFileInputRef = useRef<HTMLInputElement>(null);

  // Interactive Click-to-Edit Ruby State
  const reviewCursorRef = useRef(0);
  const [previewPage, setPreviewPage] = useState(0);
  const [customRubyInput, setCustomRubyInput] = useState<string>('');
  const [correctionScope, setCorrectionScope] = useState<'occurrence' | 'document' | 'glossary'>('occurrence');
  const [isLearnedModalOpen, setIsLearnedModalOpen] = useState(false);
  const [reviewError, setReviewError] = useState('');

  const rubyCompositionRef = useRef(false);
  const advanceControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => { advanceControllerRef.current?.abort(); }, [rawText, rubyType, documentId]);

  // 仅此处 = this occurrence; 全文同词 = every occurrence of the word in this script;
  // 记住 = also remember it (proper-noun glossary + learned reading) for every script.
  const updateTokenRuby = (reading: string) => {
    if (!editingToken || isAnnotating || !correctionsReady) return;
    const line = annotatedLines.find(value => value.id === editingToken.lineId);
    if (!line) return;
    const start = line.tokens.slice(0, editingToken.tokenIndex).reduce((sum, token) => sum + token.surface.length, 0);
    const surface = editingToken.surface;
    const entries: RubyOverride[] = correctionScope === 'occurrence'
      ? [{ line: line.cleanText, start, surface, reading, type: rubyType }]
      : annotatedLines.flatMap(value => {
          const found: RubyOverride[] = [];
          for (let at = value.cleanText.indexOf(surface); at !== -1; at = value.cleanText.indexOf(surface, at + surface.length)) {
            found.push({ line: value.cleanText, start: at, surface, reading, type: rubyType });
          }
          return found;
        });
    const learned = makeLearnedReading(selectReviewWord(line, editingToken.tokenIndex), reading, rubyType);
    setDatabase(previous => {
      const overrides = entries.reduce((list, entry) => upsertRubyOverride(list, entry), previous.scripts[documentId]?.overrides || []);
      let updated = setScriptOverrides(previous, documentId, overrides);
      if (correctionScope === 'glossary' && reading) {
        updated = learnReading(updated, documentId, learned);
        updated = { ...updated, glossary: { ...updated.glossary,
          [surface]: { surface, reading, type: rubyType, createdAt: previous.glossary[surface]?.createdAt || Date.now() } } };
      }
      return updated;
    });
    setEditingToken(null);
  };

  const openTokenEditor = (lineId: string, tokenIndex: number, lines = annotatedLines, endIndex = tokenIndex) => {
    const line = lines.find(value => value.id === lineId);
    const token = line?.tokens[tokenIndex];
    if (!line || !token?.hasKanji || !correctionsReady) return;
    setCorrectionScope('occurrence');
    setReviewError('');
    rubyCompositionRef.current = false;
    setPreviewPage(Math.floor(Number(lineId) / 200));
    const selection = selectReviewWord(line, tokenIndex);
    const end = endIndex !== tokenIndex ? endIndex : selection.tokenEndIndex;
    const selected = line.tokens.slice(selection.tokenIndex, end + 1);
    const surface = selected.map(value => value.surface).join('');
    const currentRuby = selected.length === 1 ? (selected[0].ruby || '') : selection.currentRuby;
    setEditingToken({ lineId, tokenIndex: selection.tokenIndex, tokenEndIndex: end, surface,
      currentRuby, alternatives: selection.alternatives || (token.ruby ? [token.ruby] : []) });
    setCustomRubyInput(currentRuby);
    requestAnimationFrame(() => {
      document.getElementById(`ruby-token-${lineId}-${selection.tokenIndex}`)?.scrollIntoView({ block: 'nearest' });
    });
  };

  const saveTokenRuby = () => updateTokenRuby(customRubyInput.trim());
  const jumpToNextReview = () => {
    if (!reviewTargets.length || isAnnotating) return;
    const target = reviewTargets[reviewCursorRef.current % reviewTargets.length];
    reviewCursorRef.current++;
    openTokenEditor(target.lineId, target.tokenIndex, annotatedLines, target.endIndex);
  };


  const dictionaryLabel = dictionaryStatus === 'loading' ? t.dictLoading :
    dictionaryStatus === 'ready' ? t.dictReady : t.dictDegraded;

  useEffect(() => {
    let active = true;
    const initial = initialDocumentRef.current;
    Promise.all([loadCorrections(), fingerprintText(initial.text)]).then(([data, fingerprint]) => {
      if (!active) return;
      const resolved = resolveScript(data, initial.title, initial.text, fingerprint);
      setDatabase(resolved.database);
      setDocumentId(resolved.scriptId);
      setCorrectionError('');
      setCorrectionsReady(true);
    }).catch(error => {
      if (active) setCorrectionError(`校对记录读取失败：${String(error)}`);
    });
    return () => { active = false; };
  }, [storageRetry]);

  useEffect(() => {
    if (!correctionsReady || !documentId) return;
    let active = true;
    const timer = setTimeout(() => {
      fingerprintText(rawText).then(fingerprint => {
        if (active) setDatabase(previous => updateScript(previous, documentId, docTitle, fingerprint));
      }).catch(error => { if (active) setCorrectionError(`台本指纹更新失败：${String(error)}`); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [rawText, docTitle, documentId, correctionsReady]);

  useEffect(() => {
    if (!correctionsReady) return;
    let active = true;
    const timer = setTimeout(() => {
      saveCorrections(database).then(() => { if (active) setCorrectionError(''); })
        .catch(error => { if (active) setCorrectionError(`校对记录保存失败：${String(error)}`); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [database, correctionsReady]);

  const runDependencyRepair = async () => {
    retryEngine();
    await Promise.all([
      correctionsReady ? saveCorrections(database).then(() => setCorrectionError(''))
        .catch(error => setCorrectionError(`校对记录保存失败：${String(error)}`)) :
        Promise.resolve().then(() => setStorageRetry(value => value + 1)),
    ]);
  };

  // Handle single script export
  const handleExport = async (format: 'docx' | 'srt' | 'txt') => {
    if (isExporting || isKuromojiLoading || isAnnotating || annotationError || !correctionsReady) return;
    setExportFormat(format);
    setIsExporting(true);
    setExportOutcome('processing');
    setExportError('');
    setExportProgress(10);
    setIsExportModalOpen(true);

    try {
      const safeName = cleanScriptTitle(docTitle) || 'japanese_script';
      const filename = `${safeName}.${format}`;
      let blob: Blob;

      if (format === 'docx') {
        setExportProgress(50);
        blob = await buildDocxBlob(annotatedLines, { title: safeName, baseFontSize: fontSize, rubyFontSize, lineSpacing });
      } else {
        const content = generateTextContent(annotatedLines, format);
        const mime = format === 'srt' ? 'application/x-subrip' : 'text/plain';
        blob = new Blob([content], { type: mime });
      }

      setExportProgress(80);
      const result = await saveBlob(blob, filename);
      if (result.success) {
        setExportProgress(100);
        setExportOutcome(result.downloadStarted ? 'download' : 'saved');
      } else {
        setExportOutcome('cancelled');
      }
    } catch (err) {
      setExportOutcome('error');
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  };

  // Text content generator (for srt / txt only)
  const generateTextContent = (lines: ScriptLine[], format: 'srt' | 'txt', preserveSrtCues = true): string => {
    if (format === 'srt') {
      return generateSRT(lines, preserveSrtCues && srtCues.reduce((sum, cue) => sum + cue.lines.length, 0) === lines.length ? srtCues : undefined);
    } else {
      return generateTXT(lines);
    }
  };

  // File import for Editor
  const handleEditorFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !correctionsReady) return;
    const input = e.target;
    const request = ++importSequenceRef.current;
    setIsImporting(true);
    advanceControllerRef.current?.abort();
    const file = e.target.files[0];
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    setImportError('');

    try {
      let content = '';
      let importedRuby: RubyOverride[] = [];
      let importedCues: SrtCue[] = [];
      if (isBookFile(file.name)) {
        const parsed = await parseBookFile(file);
        content = withoutImageLines(parsed.content);
        importedRuby = parsed.sourceOverrides;
      } else if (file.name.toLowerCase().endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const imported = await importDocx(arrayBuffer);
        content = imported.text;
        importedRuby = imported.overrides;
      } else {
        // Inline 漢字(かな) readings from an earlier TXT/SRT export come back as source overrides.
        const imported = importTextScript(file.name, await file.text());
        if (file.name.toLowerCase().endsWith('.srt') && !imported.cues.length) throw new Error('未找到有效的 SRT 时间轴');
        content = imported.text;
        importedRuby = imported.overrides;
        importedCues = imported.cues;
      }
      const fingerprint = await fingerprintText(content);
      if (request !== importSequenceRef.current) return;
      // Reconcile with current state; metadata saves may finish while DOCX parses.
      const resolved = resolveScript(databaseRef.current, baseName, content, fingerprint);
      setDatabase(resolved.database);
      setDocumentId(resolved.scriptId);
      markEditorSource(resolved.scriptId, scriptSourceFormat(file.name));
      setEditingToken(null);
      setSourceOverrides(importedRuby);
      setSrtCues(importedCues);
      setDocTitle(baseName);
      setRawText(content);
      // An imported file is a fresh script: unlink it from the previous library book so
      // "Save to Library" creates a new book instead of overwriting the linked one.
      setEditorBookId(null);
    } catch (err) {
      if (request === importSequenceRef.current) setImportError(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (request === importSequenceRef.current) { setIsImporting(false); input.value = ''; }
    }
  };

  // Batch page queue (state, file intake and processing).
  const {
    batchFiles, isBatchProcessing, fileInputRef, handleFileSelect, handleDrop, removeBatchFile,
    addBooksToQueue, processBatchQueue, isBatchDoneModalOpen, setIsBatchDoneModalOpen, batchDoneResults,
  } = useBatchProcessing({
    t, database, setDatabase, libraryDbRef, setLibraryDb, annotate, rubyType, glossaryEntries,
    fontSize, rubyFontSize, lineSpacing, generateTextContent, isKuromojiLoading, correctionsReady,
  });

  /**
   * Unified tab switcher used by the Sidebar, desktop Navbar and MobileNavBar.
   * Clicking the Reader tab from any navigation surface immediately loads the active
   * book's saved content, so a scratch script from the Editor never leaks under the
   * active book's title in the Reader.
   */
  const handleSelectTab = (nextTab: AppTab) => {
    if (nextTab === 'reader') {
      const book = activeBook;
      if (book && rawText !== book.content) {
        loadBookIntoWorkspace(book, 'reader');
        return;
      }
    }
    setActiveTab(nextTab);
  };

  // Sidebar navigation items
  const renderSettings = (anchor: HTMLElement | null, open: boolean, close: () => void, extra?: React.ReactNode) => (
    <SettingsMenu
      open={open}
      onClose={close}
      anchor={anchor}
      locale={locale}
      onLocaleChange={handleLocaleChange}
      themeMode={themeMode}
      onThemeModeChange={setThemeMode}
      learnedCount={learnedReadings.length}
      glossaryCount={glossaryEntries.length}
      onOpenLearned={() => setIsLearnedModalOpen(true)}
      onOpenGlossary={() => { advanceControllerRef.current?.abort(); setIsGlossaryOpen(true); }}
      onOpenReadingTools={() => readingTools.setSheetOpen(true)}
      readingToolsDetail={fillTemplate(t.toolsMenuDetail, { engine: readingTools.settings.engine === 'llm' ? t.engineLlm : t.engineMicrosoft, count: readingTools.dictionaries.length })}
      dictionaryStatus={dictionaryStatus}
      dictionaryLabel={dictionaryLabel}
      extra={extra}
      t={t}
      update={updater.state}
      showUpdate={DISTRIBUTION === 'website'}
      onCheckUpdate={() => { void updater.check({ force: true }); }}
      onDownloadUpdate={() => { void updater.startDownload(); }}
      onApplyUpdate={() => { void updater.apply(); }}
      onOpenReleases={() => openExternal(RELEASES_URL)}
      onOpenFeedback={setFeedbackKind}
      onCopyQqGroup={copyQqGroup}
    />
  );

  return (
    <main className="fixed inset-0 overflow-hidden text-[var(--label)] transition-colors">
      <ReadingToolsSheet
        open={readingTools.sheetOpen}
        onClose={() => readingTools.setSheetOpen(false)}
        t={t}
        locale={locale}
        settings={readingTools.settings}
        onSettingsChange={readingTools.changeSettings}
        dictionaries={readingTools.dictionaries}
        onToggleDictionary={(id, enabled) => { void readingTools.toggleDictionary(id, enabled); }}
        onReorderDictionaries={ids => { void readingTools.reorderDictionaries(ids); }}
        onRemoveDictionary={id => { void readingTools.removeDictionary(id); }}
        onImportDictionary={file => { void readingTools.importDictionary(file); }}
        importProgress={readingTools.importProgress}
        importError={readingTools.importError}
        loginNotice={readingTools.loginNotice}
      />
      <GlassToast
        toast={importToast ?? (libraryToast ? { kind: 'info', title: libraryToast } : null)}
        onDismiss={() => { setImportToast(null); setLibraryToast(null); }}
      />
      <Sidebar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        libraryBookCount={libraryBookCount}
        batchCount={batchFiles.length}
        hidden={activeTab === 'reader'}
        renderSettings={renderSettings}
        updateDot={updater.state.hasUpdate}
        t={t}
      />

      <div className={`h-full min-h-0 flex flex-col max-w-7xl mx-auto px-3 sm:px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-[max(1rem,env(safe-area-inset-top))] md:pt-[max(10px,env(safe-area-inset-top))] transition-[padding] duration-[620ms] [transition-timing-function:var(--spring-smooth)] ${activeTab === 'reader' ? 'pb-0 md:px-6' : 'pb-[calc(76px+max(24px,env(safe-area-inset-bottom)))] md:pb-2.5 md:pl-[244px] md:pr-5'}`}>
        {/* PAGE VIEW 1: EDITOR PAGE */}
        {activeTab === 'editor' && (
          <EditorWorkspace
            t={t}
            rubyType={rubyType} setRubyType={setRubyType} setEditingToken={setEditingToken}
            fontSize={fontSize} setFontSize={setFontSize}
            previewFontFamily={previewFontFamily} setPreviewFontFamily={setPreviewFontFamily}
            previewShowRuby={previewShowRuby} setPreviewShowRuby={setPreviewShowRuby}
            docTitle={docTitle} setDocTitle={setDocTitle} rawText={rawText} setRawText={setRawText}
            correctionsReady={correctionsReady} correctionError={correctionError}
            advanceControllerRef={advanceControllerRef} setIsGlossaryOpen={setIsGlossaryOpen}
            editorFileInputRef={editorFileInputRef} handleEditorFileImport={handleEditorFileImport}
            isImporting={isImporting} importError={importError}
            libraryBooks={libraryBooks} onImportFromLibrary={book => loadBookIntoWorkspace(book, 'editor')}
            handleSaveToLibrary={handleSaveToLibrary}
            isExporting={isExporting} handleExport={handleExport}
            dictionaryStatus={dictionaryStatus} isKuromojiLoading={isKuromojiLoading} runDependencyRepair={runDependencyRepair}
            annotatedLines={annotatedLines} isAnnotating={isAnnotating} annotationError={annotationError}
            reviewCount={reviewCount} jumpToNextReview={jumpToNextReview} reviewError={reviewError}
            openTokenEditor={openTokenEditor} previewPage={previewPage} setPreviewPage={setPreviewPage}
            renderSettings={renderSettings}
            updateDot={updater.state.hasUpdate}
          />
        )}

        {/* PAGE VIEW 2: BUILT-IN LIBRARY */}
        {activeTab === 'library' && (
          <LibraryPanel
            t={t}
            books={libraryBooks}
            onOpenInReader={book => loadBookIntoWorkspace(book, 'reader')}
            onOpenInEditor={book => loadBookIntoWorkspace(book, 'editor')}
            onImportFiles={importLibraryFiles}
            onImportPixivNovel={handleImportPixivNovel}
            onCreateOrUpdateBook={input => { void createOrUpdateBook(input); }}
            onUpdateBookMetadata={handleUpdateBookMetadata}
            onToggleFavorite={handleToggleFavorite}
            onDeleteBook={handleDeleteBook}
          />
        )}

        {/* PAGE VIEW 3: IMMERSIVE FURIGANA READER */}
        {activeTab === 'reader' && (
          <ReaderPanel
            t={t}
            book={activeBook}
            annotatedLines={annotatedLines}
            isProcessing={isAnnotating}
            rubyType={rubyType}
            onRubyTypeChange={setRubyType}
            onUpdateProgress={handleReaderProgress}
            onGoToLibrary={() => setActiveTab('library')}
            tools={readingTools.tools}
            dictTitles={readingTools.dictTitles}
            locale={locale}
          />
        )}

        {/* PAGE VIEW 4: DEDICATED BATCH FILE PROCESSING PAGE */}
        {activeTab === 'batch_files' && (
          <BatchProcessingPanel
            fileInputRef={fileInputRef}
            handleFileSelect={handleFileSelect}
            handleDrop={handleDrop}
            batchFiles={batchFiles}
            removeBatchFile={removeBatchFile}
            processBatchQueue={format => { void processBatchQueue(format); }}
            isBatchProcessing={isBatchProcessing}
            isKuromojiLoading={isKuromojiLoading}
            correctionsReady={correctionsReady}
            books={libraryBooks}
            onAddBooks={addBooksToQueue}
            t={t}
          />
        )}
      </div>

      <GlossaryModal isOpen={isGlossaryOpen} onClose={() => setIsGlossaryOpen(false)} entries={database.glossary}
        onChange={glossary => { setEditingToken(null); setDatabase(previous => ({ ...previous, glossary })); }}
        t={t}
      />


      {/* Single Script Export Progress Modal */}
      <ExportProgressModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        isExporting={isExporting}
        exportFormat={exportFormat}
        exportProgress={exportProgress}
        exportOutcome={exportOutcome}
        exportError={exportError}
        t={t}
      />

      {/* Batch Processing Completion Modal */}
      <BatchDoneModal
        isOpen={isBatchDoneModalOpen}
        onClose={() => setIsBatchDoneModalOpen(false)}
        results={batchDoneResults}
        t={t}
      />

      {/* Interactive Modal for Editing / Disambiguating Ruby */}
      <RubyCorrectionModal
        editingToken={editingToken}
        context={(() => {
          if (!editingToken) return null;
          const line = annotatedLines.find(l => l.id === editingToken.lineId);
          if (!line) return null;
          const start = line.tokens.slice(0, editingToken.tokenIndex).reduce((sum, token) => sum + token.surface.length, 0);
          const word = editingToken.surface;
          return {
            before: line.cleanText.slice(0, start).slice(-40),
            word,
            after: line.cleanText.slice(start + word.length).slice(0, 40),
          };
        })()}
        onClose={() => setEditingToken(null)}
        needsReview={!!editingToken && !!annotatedLines.find(line => line.id === editingToken.lineId)?.tokens[editingToken.tokenIndex]?.needsReview}
        customRubyInput={customRubyInput}
        setCustomRubyInput={setCustomRubyInput}
        correctionScope={correctionScope}
        setCorrectionScope={setCorrectionScope}
        rubyCompositionRef={rubyCompositionRef}
        saveTokenRuby={saveTokenRuby}
        t={t}
      />

      {/* Modal for viewing and deleting learned readings */}
      <LearnedReadingsModal
        isOpen={isLearnedModalOpen}
        onClose={() => setIsLearnedModalOpen(false)}
        learnedReadings={learnedReadings}
        onDeleteLearnedReading={idx => setDatabase(prev => deleteLearnedReading(prev, documentId, idx))}
        t={t}
      />

      {/* Mobile bottom navigation */}
      <MobileNavBar
        activeTab={activeTab}
        onChange={handleSelectTab}
        bookCount={Object.keys(libraryDb.books).length}
        hidden={activeTab === 'reader'}
        t={t}
      />
      <FeedbackModal
        open={feedbackKind !== null}
        onClose={() => setFeedbackKind(null)}
        initialKind={feedbackKind ?? 'log'}
        buildReport={buildReport}
        submit={submitFeedback}
        buildPayload={buildFeedbackPayload}
        onOpenUrl={openExternal}
        t={t}
      />
    </main>
  );
}
