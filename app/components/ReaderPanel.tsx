'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ScriptLine } from '../utils/furigana';
import type { Translations } from '../utils/i18n';
import { sourcePageLabel, type BookItem } from '../utils/libraryDatabase';
import {
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  clampReaderFontSize,
  clampReaderLineHeight,
  loadReaderPrefs,
  saveReaderPrefs,
  type ReaderContentWidth,
  type ReaderFontFamily,
  type ReaderPrefs,
} from '../utils/readerPreferences';
import { TypographyPopover, type TypographyPopoverProps } from './TypographyPopover';
import { FloatingTranslationButton, useFloatingTranslation } from './FloatingTranslationButton';
import { GlassButton } from './glass/GlassButton';
import { useGlass } from './glass/hooks';
import { IconBookmark, IconChevronLeft, IconList, IconRead, IconRuby, IconTextFormat } from './glass/icons';
import { TocCard, type TocCardTab } from './TocCard';
import { logEvent } from '../utils/appLog';
import { LookupCard, type LookupState } from './LookupCard';
import { ReaderLine, bilingualSignature } from './ReaderLine';
import { useBilingual } from '../hooks/useBilingual';
import { useReaderTranslationAnchor } from '../hooks/useReaderTranslationAnchor';
import { plainScriptLines } from '../utils/plainScript';
import type { ReaderTools } from '../utils/readingTools';
import { useReaderNavigation } from '../hooks/useReaderNavigation';
import { ReaderTapGesture, sidePageDirection } from '../utils/readerNavigation';

type RubyMode = 'hiragana' | 'katakana' | 'romaji';
export type { ReaderFontFamily, ReaderWritingMode } from '../utils/readerPreferences';

export interface ReaderPanelProps {
  t: Translations;
  book: BookItem | null;
  annotatedLines: ScriptLine[];
  isProcessing: boolean;
  rubyType: RubyMode;
  onRubyTypeChange: (mode: RubyMode) => void;
  onUpdateProgress: (chapterIndex: number, lineIndex: number, totalLines?: number) => void;
  onGoToLibrary: () => void;
  /** Word lookup and translation; null until the engines are set up. */
  tools: ReaderTools | null;
  dictTitles: Record<string, string>;
  locale: string;
  /** Annotation failure message; the reader then falls back to the book's plain text. */
  error?: string;
  onAddBookmark?: (lineIndex: number, label?: string) => void;
  onRemoveBookmark?: (bookmarkId: string) => void;
  onEditToken?: (lineId: string, tokenIndex: number) => void;
  onActiveChapterRangeChange?: (range: { start: number; end: number } | null) => void;
  aiReview?: TypographyPopoverProps['aiReview'];
}

const FONT_STACK: Record<ReaderFontFamily, string> = {
  serif: 'var(--font-mincho)',
  sans: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif',
};

const CONTENT_WIDTH_CLASS: Record<ReaderContentWidth, string> = {
  narrow: 'max-w-[28em]',
  medium: 'max-w-[34em]',
  wide: 'max-w-[44em]',
};

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

/**
 * Immersive reader (mockup): the text fills the screen, one glass capsule at
 * the bottom (back, auto-read, bookmark, navigation, title + progress, ruby toggle, Aa).
 */
export function ReaderPanel({
  t, book, annotatedLines, isProcessing, rubyType, onRubyTypeChange, onUpdateProgress, onGoToLibrary,
  tools, dictTitles, locale, error, onAddBookmark, onRemoveBookmark, onEditToken, onActiveChapterRangeChange, aiReview,
}: ReaderPanelProps) {
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadReaderPrefs);
  const [hudVisible, setHudVisible] = useState(true);
  const [translationDragging, setTranslationDragging] = useState(false);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [aaAnchor, setAaAnchor] = useState<HTMLButtonElement | null>(null);
  const [aaOpen, setAaOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const lastYRef = useRef(0);
  const travelRef = useRef(0);
  const lastLineRef = useRef(-1);
  // Line to bring back to the top once it has been rendered.
  const resumeLineRef = useRef<number | null>(null);
  const bookRef = useRef(book);
  // The line we put back, until the reader moves it themselves; re-placed once the layout settles.
  const placedLineRef = useRef<number | null>(null);
  const userMovedRef = useRef(false);
  const settleTimersRef = useRef<number[]>([]);
  const placeLineRef = useRef<(line: number) => boolean>(() => false);
  // While the size slider is being dragged, keep one line fixed instead of letting each reflow
  // rewrite the current line from a half-finished layout.
  const fontAnchorRef = useRef<number | null>(null);
  const fontAnchorTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const [capsuleNode, setCapsuleNode] = useState<HTMLDivElement | null>(null);
  const capsuleRef = useGlass<HTMLDivElement>();
  const setCapsule = useCallback((node: HTMLDivElement | null) => { capsuleRef(node); setCapsuleNode(node); }, [capsuleRef]);
  const floatingTranslation = useFloatingTranslation();
  const isVertical = prefs.writingMode === 'vertical';
  const [lookup, setLookup] = useState<{ state: LookupState; line: number; start: number; end: number; anchor: HTMLElement | null } | null>(null);
  const [searchHighlight, setSearchHighlight] = useState<{ line: number; start: number; end: number } | null>(null);
  const lookupSeq = useRef(0);
  const lookupClosedAt = useRef(0);
  const popoverClosedAt = useRef(0);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // When annotation has failed OR while the very first annotation chunks of a newly opened
  // book are still being computed, fall back to plainScriptLines so large books open immediately.
  const failed = Boolean(error) && !isProcessing && annotatedLines.length === 0;
  const plainLines = useMemo(
    () => (book && (failed || annotatedLines.length === 0) ? plainScriptLines(book.content) : []),
    [failed, book, annotatedLines.length],
  );
  const lines = annotatedLines.length > 0 ? annotatedLines : plainLines;
  const lineTexts = useMemo(() => lines.map(line => line.tokens.map(token => token.surface).join('')), [lines]);

  // Books with a table of contents (EPUB/PDF) are read one chapter at a time: only that chapter is rendered.
  const chapters = useMemo(() => book?.chapters ?? [], [book?.chapters]);
  const chaptered = chapters.length > 1;
  const chapterStarts = useMemo(() => new Set(chapters.map(c => c.startLine)), [chapters]);
  const chapterOf = useCallback((line: number) => {
    let found = 0;
    chapters.forEach((chapterItem, index) => { if (chapterItem.startLine <= line) found = index; });
    return found;
  }, [chapters]);
  const [chapter, setChapter] = useState(() => chapterOf(book?.readingProgress.lineIndex ?? 0));
  const [currentLine, setCurrentLine] = useState(() => book?.readingProgress.lineIndex ?? 0);
  const [tocOpen, setTocOpen] = useState(false);
  const [tocInitialTab, setTocInitialTab] = useState<TocCardTab>('toc');
  const sourcePage = sourcePageLabel(book?.pageStarts, book?.pageLabels, currentLine);
  const range = chaptered && chapters[chapter]
    ? { start: chapters[chapter].startLine, end: Math.min(Math.max(0, lines.length - 1), chapters[chapter].endLine) }
    : { start: 0, end: Math.max(0, lines.length - 1) };

  useEffect(() => {
    if (!onActiveChapterRangeChange) return;
    if (!chaptered || !chapters[chapter]) {
      onActiveChapterRangeChange(null);
    } else {
      onActiveChapterRangeChange({ start: chapters[chapter].startLine, end: chapters[chapter].endLine + 1 });
    }
  }, [onActiveChapterRangeChange, chaptered, chapters, chapter]);

  const translationAnchor = useReaderTranslationAnchor({
    articleRef, scrollerRef, isVertical, resetKey: `${book?.bookId ?? ''}:${chapter}`,
  });
  const bilingual = useBilingual({
    enabled: prefs.bilingual, wantCount: aaOpen, bookId: book?.bookId ?? null, content: book?.content ?? '', lineTexts, articleRef, tools, translationAnchor,
  });

  const updatePrefs = (patch: Partial<ReaderPrefs>) => {
    if (patch.bilingual !== undefined && patch.bilingual !== prefs.bilingual) {
      // A translation reflow supersedes the old book-open line restore.
      settleTimersRef.current.forEach(clearTimeout);
      placedLineRef.current = null;
      translationAnchor.prepareChange();
    }
    setPrefs(previous => {
      const next = {
        ...previous,
        ...patch,
        fontSize: clampReaderFontSize(patch.fontSize ?? previous.fontSize),
        lineHeight: clampReaderLineHeight(patch.lineHeight ?? previous.lineHeight),
      };
      saveReaderPrefs(next);
      return next;
    });
  };

  const [prevBookId, setPrevBookId] = useState(book?.bookId ?? null);
  if ((book?.bookId ?? null) !== prevBookId) {
    setPrevBookId(book?.bookId ?? null);
    setHudVisible(true);
    setScrollPercent(0);
    setAaOpen(false);
    setTocOpen(false);
    setSearchHighlight(null);
    setChapter(chapterOf(book?.readingProgress.lineIndex ?? 0));
    setCurrentLine(book?.readingProgress.lineIndex ?? 0);
  }

  const processScroll = useCallback(() => {
    const article = articleRef.current;
    const scroller = scrollerRef.current;
    if (translationAnchor.isAdjusting.current) {
      lastYRef.current = isVertical && article ? Math.abs(article.scrollLeft) : scroller?.scrollTop ?? 0;
      return;
    }
    let y: number;
    let max: number;
    if (isVertical && article) {
      // vertical-rl scrolls horizontally (scrollLeft runs negative toward the end)
      y = Math.abs(article.scrollLeft);
      max = Math.max(0, article.scrollWidth - article.clientWidth);
    } else if (scroller) {
      y = scroller.scrollTop;
      max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    } else {
      return;
    }
    if (max > 0) setScrollPercent(Math.round(Math.min(100, Math.max(0, (y / max) * 100))));

    const dy = y - lastYRef.current;
    lastYRef.current = y;
    if (dy !== 0) {
      const travel = Math.sign(dy) === Math.sign(travelRef.current) ? travelRef.current + dy : dy;
      travelRef.current = travel;
      if (y >= max - 4 || y < 40) setHudVisible(true);
      else if (travel > 24) setHudVisible(false);
      else if (travel < -12) setHudVisible(true);
    }

    if (!article) return;
    const nodes = article.querySelectorAll<HTMLElement>('[data-line]');
    if (nodes.length === 0) return;
    if (fontAnchorRef.current !== null) return;
    const passed = (node: HTMLElement) => {
      const rect = node.getBoundingClientRect();
      return isVertical ? rect.right >= window.innerWidth - 72 : rect.top <= 72;
    };
    let low = 0;
    let high = nodes.length - 1;
    let found = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (passed(nodes[middle])) { found = middle; low = middle + 1; } else high = middle - 1;
    }
    const index = Number(nodes[found].dataset.line) || 0;
    if (placedLineRef.current !== null && !userMovedRef.current) return;
    if (index !== lastLineRef.current) {
      lastLineRef.current = index;
      setCurrentLine(index);
      onUpdateProgress(chapterOf(index), index, lines.length);
    }
  }, [isVertical, onUpdateProgress, chapterOf, lines.length, translationAnchor.isAdjusting]);

  const handleScroll = useCallback(() => {
    if (translationAnchor.isAdjusting.current) {
      lastYRef.current = isVertical ? Math.abs(articleRef.current?.scrollLeft ?? 0) : scrollerRef.current?.scrollTop ?? 0;
      return;
    }
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      processScroll();
    });
  }, [processScroll, isVertical, translationAnchor.isAdjusting]);

  useEffect(() => {
    lastYRef.current = 0;
    travelRef.current = 0;
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [handleScroll]);

  useEffect(() => { bookRef.current = book; });

  // A book opened (or changed): the place to return to is the one saved with it.
  const bookId = book?.bookId ?? null;
  useEffect(() => {
    const saved = bookRef.current?.readingProgress.lineIndex ?? 0;
    resumeLineRef.current = saved > 0 ? saved : null;
    lastLineRef.current = -1;
    placedLineRef.current = null;
    userMovedRef.current = false;
  }, [bookId]);

  // Any hand on the page means the reader has taken over: stop re-placing.
  useEffect(() => {
    const markMoved = () => { userMovedRef.current = true; };
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    events.forEach(name => window.addEventListener(name, markMoved, { passive: true, capture: true }));
    return () => events.forEach(name => window.removeEventListener(name, markMoved, true));
  }, []);

  // The lines were emptied by a re-annotation: remember where the reader was so they land back there.
  const lineTotal = lines.length;
  useEffect(() => {
    if (lineTotal === 0 && lastLineRef.current > 0) resumeLineRef.current = lastLineRef.current;
  }, [lineTotal]);

  // Switching between horizontal and vertical lays the page out again: keep the place across it.
  useEffect(() => {
    if (lastLineRef.current > 0) resumeLineRef.current = lastLineRef.current;
  }, [isVertical]);

  const placeLine = useCallback((line: number): boolean => {
    const article = articleRef.current;
    const node = article?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (!article || !node) return false;
    const rect = node.getBoundingClientRect();
    if (isVertical) {
      article.scrollLeft += rect.right - (window.innerWidth - 56);
    } else {
      const scroller = scrollerRef.current;
      if (scroller) scroller.scrollTop += rect.top - 70;
    }
    return true;
  }, [isVertical]);

  const changeFontSize = (value: number) => {
    if (fontAnchorRef.current === null) {
      fontAnchorRef.current = lastLineRef.current >= 0 ? lastLineRef.current : currentLine;
    }
    if (fontAnchorTimerRef.current !== null) window.clearTimeout(fontAnchorTimerRef.current);
    fontAnchorTimerRef.current = window.setTimeout(() => {
      fontAnchorRef.current = null;
      fontAnchorTimerRef.current = null;
    }, 650);
    updatePrefs({ fontSize: value });
  };

  // Keep the line the reader was on at the top while the whole page is laid out again at a new size.
  useLayoutEffect(() => {
    const line = fontAnchorRef.current;
    if (line === null) return;
    if (!placeLine(line)) return;
    placedLineRef.current = line;
    lastLineRef.current = line;
  }, [prefs.fontSize, prefs.lineHeight, prefs.contentWidth, placeLine]);

  useEffect(() => () => {
    if (fontAnchorTimerRef.current !== null) window.clearTimeout(fontAnchorTimerRef.current);
  }, []);

  // Bring the remembered line back as soon as it exists in the page.
  useEffect(() => {
    const target = resumeLineRef.current;
    if (target === null || lineTotal <= target) return;
    if (!placeLine(target)) return;
    resumeLineRef.current = null;
    placedLineRef.current = target;
    lastLineRef.current = target;
    settleTimersRef.current.forEach(clearTimeout);
    const again = () => { if (placedLineRef.current === target && !userMovedRef.current) placeLineRef.current(target); };
    settleTimersRef.current = [250, 700, 1500].map(ms => window.setTimeout(again, ms));
    void document.fonts?.ready.then(again);
  }, [lineTotal, bookId, chapter, placeLine]);

  useEffect(() => { placeLineRef.current = placeLine; }, [placeLine]);
  useEffect(() => () => settleTimersRef.current.forEach(clearTimeout), []);

  // Once annotation settles, re-anchor the placed line if the user hasn't scrolled manually.
  useEffect(() => {
    const line = placedLineRef.current;
    if (isProcessing || line === null || userMovedRef.current) return;
    placeLine(line);
  }, [isProcessing, placeLine]);

  const pendingChapterEdge = useRef<'start' | 'end' | null>(null);
  const prepareMotion = useCallback(() => {
    userMovedRef.current = true;
    placedLineRef.current = null;
    resumeLineRef.current = null;
    settleTimersRef.current.forEach(clearTimeout);
    settleTimersRef.current = [];
  }, []);
  const goToChapter = useCallback((index: number, edge: 'start' | 'end' = 'start') => {
    const target = chapters[index];
    if (!target) return;
    prepareMotion();
    pendingChapterEdge.current = edge;
    setTocOpen(false);
    setChapter(index);
    const line = edge === 'end' ? target.endLine : target.startLine;
    setCurrentLine(line);
    setLookup(null);
    lastLineRef.current = line;
    setScrollPercent(edge === 'end' ? 100 : 0);
    onUpdateProgress(index, line, lines.length);
    setHudVisible(true);
  }, [chapters, lines.length, onUpdateProgress, prepareMotion]);

  const jumpToLine = useCallback((targetLineIndex: number, searchMatch?: { start: number; end: number }) => {
    const clamped = Math.max(0, Math.min(Math.max(0, lines.length - 1), targetLineIndex));
    const targetChapter = chaptered ? chapterOf(clamped) : 0;
    setTocOpen(false);
    setLookup(null);
    if (searchMatch) setSearchHighlight({ line: clamped, start: searchMatch.start, end: searchMatch.end });
    setCurrentLine(clamped);
    lastLineRef.current = clamped;
    onUpdateProgress(targetChapter, clamped, lines.length);
    setHudVisible(true);
    if (targetChapter !== chapter) {
      pendingChapterEdge.current = null;
      resumeLineRef.current = clamped;
      userMovedRef.current = false;
      setChapter(targetChapter);
    } else {
      prepareMotion();
      requestAnimationFrame(() => {
        placeLine(clamped);
      });
    }
  }, [chapter, chapterOf, chaptered, lines.length, onUpdateProgress, placeLine, prepareMotion]);

  useLayoutEffect(() => {
    const edge = pendingChapterEdge.current;
    if (!edge) return;
    pendingChapterEdge.current = null;
    const article = articleRef.current;
    const scroller = scrollerRef.current;
    if (article) article.scrollLeft = edge === 'end' && isVertical ? -(article.scrollWidth - article.clientWidth) : 0;
    if (scroller) scroller.scrollTop = edge === 'end' && !isVertical ? scroller.scrollHeight - scroller.clientHeight : 0;
    lastYRef.current = edge === 'end' ? isVertical ? Math.abs(article?.scrollLeft ?? 0) : scroller?.scrollTop ?? 0 : 0;
    travelRef.current = 0;
    translationAnchor.prepareChange();
  });

  const navigation = useReaderNavigation({
    bookId, chapter, chapterCount: chaptered ? chapters.length : 1,
    ready: Boolean(bookId) && lines.length > 0,
    suspended: aaOpen || tocOpen || lookup !== null || translationDragging,
    prefs, scrollerRef, articleRef,
    isAdjusting: () => translationAnchor.isAdjusting.current || fontAnchorRef.current !== null || pendingChapterEdge.current !== null || resumeLineRef.current !== null,
    prepareMotion, goToChapter, reveal: () => setHudVisible(true),
  });
  const tapGesture = useRef(new ReaderTapGesture());
  const validTap = useRef(false);

  const bookBookmarks = book?.bookmarks;
  const activeBookmark = useMemo(() => {
    if (!bookBookmarks?.length) return undefined;
    return bookBookmarks.find(bm => Math.abs(bm.lineIndex - currentLine) <= 2);
  }, [bookBookmarks, currentLine]);

  const toggleBookmarkAtCurrent = useCallback(() => {
    if (!book) return;
    if (activeBookmark) {
      onRemoveBookmark?.(activeBookmark.id);
    } else {
      const label = chaptered ? chapters[chapter]?.title : book.title;
      onAddBookmark?.(currentLine, label);
    }
  }, [activeBookmark, book, chapter, chaptered, chapters, currentLine, onAddBookmark, onRemoveBookmark]);

  // Keyboard shortcuts for desktop reading (arrow/Space page turn, b bookmark, t TOC, / search)
  useEffect(() => {
    if (!bookId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && target.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [aria-modal="true"]:not([aria-hidden="true"])')) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setTocInitialTab('search');
        setTocOpen(true);
        return;
      }
      if (navigation.blocked) return;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setTocInitialTab('search');
        setTocOpen(true);
      } else if ((event.key === 'b' || event.key === 'B') && !event.ctrlKey && !event.metaKey && (onAddBookmark || onRemoveBookmark)) {
        event.preventDefault();
        toggleBookmarkAtCurrent();
      } else if ((event.key === 't' || event.key === 'T') && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setTocInitialTab(chaptered ? 'toc' : 'bookmarks');
        setTocOpen(open => !open);
      } else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
        event.preventDefault();
        void navigation.turnPage(1);
      } else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) {
        event.preventDefault();
        void navigation.turnPage(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        void navigation.turnPage(isVertical ? -1 : 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void navigation.turnPage(isVertical ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bookId, chaptered, isVertical, navigation, onAddBookmark, onRemoveBookmark, toggleBookmarkAtCurrent]);

  const closeLookup = useCallback(() => {
    lookupSeq.current += 1;
    lookupClosedAt.current = Date.now();
    setLookup(null);
  }, []);

  const lookUp = (lineIndex: number, text: string, offset: number, anchor: HTMLElement) => {
    if (!tools) return;
    const seq = ++lookupSeq.current;
    const query = text.slice(offset, offset + 1);
    setLookup({ state: { status: 'loading', query }, line: lineIndex, start: offset, end: offset + 1, anchor });
    const still = () => seq === lookupSeq.current;
    tools.lookup(text, offset, progress => {
      if (still()) setLookup(current => current && { ...current, state: { status: 'loading', query, progress } });
    }).then(result => {
      if (!still()) return;
      if (!result) { setLookup(current => current && { ...current, state: { status: 'missing', query } }); return; }
      setLookup(current => current && { ...current, start: result.start, end: result.end, state: { status: 'done', result } });
    }).catch((errorValue: unknown) => {
      logEvent('error', 'lookup', `lookup failed: ${errorValue instanceof Error ? errorValue.message : String(errorValue)}`);
      if (still()) setLookup(current => current && { ...current, state: { status: 'error', query, error: errorValue instanceof Error ? errorValue.message : String(errorValue) } });
    });
  };

  // Resolve matching token index inside lookup line for in-reader ruby correction.
  const lookupEditHandler = useMemo(() => {
    if (!lookup || !onEditToken) return undefined;
    const line = lines[lookup.line];
    if (!line) return undefined;
    let offset = 0;
    let tokenIdx = -1;
    for (let i = 0; i < line.tokens.length; i += 1) {
      const len = line.tokens[i].surface.length;
      if (offset + len > lookup.start) {
        tokenIdx = i;
        break;
      }
      offset += len;
    }
    if (tokenIdx < 0) return undefined;
    const tok = line.tokens[tokenIdx];
    if (!tok || (!tok.hasKanji && !tok.ruby)) return undefined;
    return () => {
      closeLookup();
      onEditToken(line.id, tokenIdx);
    };
  }, [lookup, lines, onEditToken, closeLookup]);

  // A tap on a word looks it up; a tap elsewhere toggles the capsule — or only closes the dictionary when it was open.
  const handleCanvasClick = (event: React.MouseEvent) => {
    if (String(window.getSelection() || '')) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [role="dialog"]')) return;
    if (aaOpen || tocOpen || translationDragging) return;
    if (event.detail !== 0 && !validTap.current) return;
    validTap.current = false;
    if (lookup || Date.now() - lookupClosedAt.current < 350) { if (lookup) closeLookup(); return; }
    if (navigation.blocked) return;
    if (prefs.sidePageTurn && event.detail !== 0) {
      const rect = event.currentTarget.getBoundingClientRect();
      const direction = sidePageDirection(event.clientX, rect.left, rect.width, isVertical);
      if (direction !== null) { void navigation.turnPage(direction); return; }
    }
    const piece = target.closest<HTMLElement>('[data-o]');
    const lineNode = piece?.closest<HTMLElement>('[data-line]');
    if (piece && lineNode && tools && !target.closest('rt')) {
      const lineIndex = Number(lineNode.dataset.line);
      let offset = Number(piece.dataset.o);
      const caret = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null })
        .caretPositionFromPoint?.(event.clientX, event.clientY);
      const caretRange = caret ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
      const node = caret?.offsetNode ?? caretRange?.startContainer;
      const within = caret?.offset ?? caretRange?.startOffset ?? 0;
      if (node && node.nodeType === Node.TEXT_NODE && node.parentElement === piece && piece.tagName !== 'RUBY') {
        offset += Math.min(within, Math.max(0, (node.textContent?.length ?? 1) - 1));
      }
      lookUp(lineIndex, lineTexts[lineIndex] ?? '', offset, piece);
      return;
    }
    if (lookup || Date.now() - lookupClosedAt.current < 350) { if (lookup) closeLookup(); return; }
    if (aaOpen || tocOpen || Date.now() - popoverClosedAt.current < 350) return;
    setHudVisible(prev => !prev);
  };

  // Keep the looked-up word visible above the phone card.
  useEffect(() => {
    if (!phone || !lookup?.anchor || !scrollerRef.current || isVertical) return;
    const rect = lookup.anchor.getBoundingClientRect();
    const cardTop = window.innerHeight * 0.54 - 8;
    if (rect.bottom > cardTop - 16) scrollerRef.current.scrollBy({ top: rect.bottom - cardTop + 48, behavior: 'smooth' });
  }, [phone, lookup?.anchor, isVertical]);

  if (!book) {
    return (
      <section className="grid min-h-0 flex-1 place-items-center px-6 text-center">
        <div className="max-w-sm rounded-[18px] bg-[var(--surface)] p-8 shadow-[var(--card-shadow)]">
          <IconRead size={46} className="mx-auto text-[var(--label-3)]" />
          <h3 className="mb-1.5 mt-3.5 text-xl font-semibold">{t.readerEmptyTitle}</h3>
          <p className="mb-[18px] text-sm leading-relaxed text-[var(--label-2)]">{t.readerEmptyDesc}</p>
          <button type="button" className="btn btn-ink" onClick={onGoToLibrary}>{t.readerBackToLibrary}</button>
        </div>
      </section>
    );
  }

  const lineCount = lines.length;
  const themeAttr = prefs.readerTheme !== 'system' ? prefs.readerTheme : undefined;

  return (
    <section data-auto-reading={navigation.state} data-reader-theme={themeAttr} className="relative flex h-full min-h-0 flex-1 flex-col transition-colors">
      {!isVertical && <div className="scroll-edge fixed inset-x-0 top-0 z-10 h-[76px]" aria-hidden />}

      <div ref={scrollerRef} onPointerDown={event => {
          navigation.pause();
          validTap.current = false;
          if (event.isPrimary && event.button === 0) tapGesture.current.begin(event.clientX, event.clientY, event.timeStamp);
          else tapGesture.current.cancel();
        }}
        onPointerMove={event => tapGesture.current.move(event.clientX, event.clientY)}
        onPointerUp={event => { validTap.current = tapGesture.current.finish(event.timeStamp); }}
        onPointerCancel={() => { tapGesture.current.cancel(); validTap.current = false; }}
        onContextMenu={() => { tapGesture.current.cancel(); validTap.current = false; }}
        onWheel={navigation.pause} onKeyDown={navigation.pause} onScroll={isVertical ? undefined : handleScroll} onClick={handleCanvasClick} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <article
          ref={articleRef}
          lang="ja"
          data-testid="reader-script-canvas"
          data-writing-mode={prefs.writingMode}
          onScroll={isVertical ? handleScroll : undefined}
          className={
            isVertical
              ? 'vertical-script-flow h-full w-full overflow-x-auto px-6 pb-[110px] pt-[70px] md:px-12'
              : `mx-auto w-full ${CONTENT_WIDTH_CLASS[prefs.contentWidth]} px-6 pb-[140px] pt-[70px]`
          }
          style={{
            fontFamily: FONT_STACK[prefs.fontFamily],
            fontSize: `${prefs.fontSize}px`,
            lineHeight: prefs.lineHeight,
            letterSpacing: '0.02em',
          }}
        >
          <header className={isVertical ? 'ml-9' : 'mb-9'}>
            <h2 className="text-[26px] font-semibold leading-snug">{book.title}</h2>
            <p className="mt-1 font-sans text-[13px] tracking-normal text-[var(--label-2)]">
              {book.author?.trim() ? `${book.author.trim()} · ` : ''}{fill(t.libraryBookLines, { count: lineCount })}
            </p>
          </header>

          {isProcessing && <p className="mb-4 font-sans text-xs text-[var(--label-2)]">{t.annotatingProgress}</p>}
          {failed && (
            <p className="mb-4 font-sans text-xs text-[var(--label-2)]">{t.readerPlainTextNote}</p>
          )}

          {lines.slice(range.start, range.end + 1).map((line, offset) => {
            const lineIndex = range.start + offset;
            return (
              <ReaderLine
                key={`${line.id}-${lineIndex}`}
                line={line}
                lineIndex={lineIndex}
                bookId={book.bookId}
                vertical={isVertical}
                showRuby={prefs.showRuby}
                isHeading={chaptered && chapterStarts.has(lineIndex)}
                bilingual={prefs.bilingual ? bilingual.retryBundle : undefined}
                bilingualSig={prefs.bilingual ? bilingualSignature(lineTexts[lineIndex] ?? '', bilingual.retryBundle.translations, bilingual.retryBundle.failed) : undefined}
                hit={lookup?.line === lineIndex ? lookup : null}
                searchHit={searchHighlight?.line === lineIndex ? searchHighlight : null}
                t={t}
              />
            );
          })}

          {chaptered && (
            <nav className="reader-chapnav">
              <button type="button" className="btn" disabled={chapter === 0} onClick={() => { navigation.pause(); goToChapter(chapter - 1); }}>{t.readerPrevChapter}</button>
              {chapter + 1 < chapters.length && (
                <button type="button" className="btn btn-ink" onClick={() => { navigation.pause(); goToChapter(chapter + 1); }}>
                  {t.readerNextChapter}<small>{chapters[chapter + 1].title}</small>
                </button>
              )}
            </nav>
          )}
        </article>
      </div>

      {/* Slim progress scrubber docked above capsule while HUD is visible */}
      {lines.length > 1 && !aaOpen && !tocOpen && !lookup && (
        <div
          className={`glass fixed bottom-[max(82px,calc(env(safe-area-inset-bottom)+60px))] left-1/2 z-30 flex w-[min(360px,calc(100%-48px))] -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1 transition-opacity duration-200 ${
            hudVisible && !navigation.running ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <input
            type="range"
            min={0}
            max={Math.max(1, lines.length - 1)}
            value={Math.min(Math.max(currentLine, 0), Math.max(1, lines.length - 1))}
            aria-label={t.readerScrubberLabel}
            onChange={event => jumpToLine(Number(event.target.value))}
            className="h-1.5 w-full cursor-pointer accent-[var(--label)]"
          />
        </div>
      )}

      {/* Bottom glass capsule */}
      <div
        ref={setCapsule}
        className={`reader-capsule glass glass-solid fixed bottom-[max(22px,env(safe-area-inset-bottom))] left-1/2 z-40 flex h-[52px] w-[min(470px,calc(100%-32px))] -translate-x-1/2 items-center gap-0.5 rounded-full px-2 ${
          hudVisible || navigation.running || translationDragging || aaOpen || tocOpen
            ? 'transition-[translate,opacity] duration-[620ms,220ms] [transition-timing-function:var(--spring-bouncy),ease]'
            : 'pointer-events-none translate-y-[calc(100%+40px)] opacity-0 transition-[translate,opacity] duration-[340ms,260ms] [transition-timing-function:cubic-bezier(.4,0,.7,.2),ease]'
        }`}
      >
        <div className="reader-tools-left" style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <GlassButton icon aria-label={t.readerBackToLibrary} onClick={onGoToLibrary}>
          <IconChevronLeft />
        </GlassButton>
        <GlassButton icon aria-label={navigation.running ? t.readerAutoPause : t.readerAutoStart} title={navigation.running ? t.readerAutoPause : t.readerAutoStart}
          aria-pressed={navigation.running} disabled={!lines.length}
          onClick={navigation.toggle}>
          {navigation.running ? <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="3" height="12" rx="1" /><rect x="12" y="4" width="3" height="12" rx="1" /></svg>
            : <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6 3.5a1 1 0 0 1 1.5-.86l9 6.5a1 1 0 0 1 0 1.72l-9 6.5A1 1 0 0 1 6 16.5z" /></svg>}
        </GlassButton>
        <GlassButton
          icon
          aria-label={t.readerToc}
          aria-expanded={tocOpen}
          onClick={() => {
            setTocInitialTab(chaptered ? 'toc' : 'bookmarks');
            setTocOpen(open => !open);
          }}
        >
          <IconList />
        </GlassButton>
        </div>
        {chaptered ? (
          <button
            type="button"
            aria-label={t.readerToc}
            onClick={() => { setTocInitialTab('toc'); setTocOpen(open => !open); }}
            className="reader-capsule-title rounded-[14px] px-1.5 py-1 text-center transition-colors hover:bg-[var(--item-hover)]"
          >
            <b className="block truncate text-[13px]">{book.title} · {chapters[chapter]?.title}</b>
            <span className="whitespace-nowrap text-[11px] tabular-nums text-[var(--label-2)]">
              {fill(t.readerChapterPercent, { current: chapter + 1, total: chapters.length, percent: scrollPercent })}
              {sourcePage ? ` · ${fill(t.readerSourcePage, { page: sourcePage })}` : ''}
            </span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={t.readerTabBookmarks}
            onClick={() => { setTocInitialTab('bookmarks'); setTocOpen(open => !open); }}
            className="reader-capsule-title rounded-[14px] px-1.5 py-1 text-center transition-colors hover:bg-[var(--item-hover)]"
          >
            <b className="block truncate text-[13px]">{book.title}</b>
            <span className="whitespace-nowrap text-[11px] tabular-nums text-[var(--label-2)]">
              {fill(t.libraryBookProgress, { percent: scrollPercent })}
              {sourcePage ? ` · ${fill(t.readerSourcePage, { page: sourcePage })}` : ''}
            </span>
          </button>
        )}
        <div className="reader-tools-right" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginLeft: 'auto', gap: 2, flexShrink: 0 }}>
        {(onAddBookmark || onRemoveBookmark) && (
          <GlassButton
            icon
            aria-label={activeBookmark ? t.readerBookmarkRemove : t.readerBookmarkAdd}
            aria-pressed={Boolean(activeBookmark)}
            onClick={toggleBookmarkAtCurrent}
          >
            <IconBookmark className={activeBookmark ? 'fill-current' : ''} />
          </GlassButton>
        )}
        <GlassButton icon aria-label={t.showRubyLabel} aria-pressed={prefs.showRuby} onClick={() => updatePrefs({ showRuby: !prefs.showRuby })}>
          <IconRuby />
        </GlassButton>
        <FloatingTranslationButton
          t={t}
          hudVisible={hudVisible || navigation.running}
          onDragActiveChange={setTranslationDragging}
          enabled={prefs.bilingual}
          onToggle={() => updatePrefs({ bilingual: !prefs.bilingual })}
          locale={locale}
          hidden={aaOpen || tocOpen || lookup !== null}
        />
        <GlassButton ref={setAaAnchor} icon aria-label={t.typographyShort} aria-expanded={aaOpen} onClick={() => setAaOpen(open => !open)}>
          <IconTextFormat />
        </GlassButton>
        </div>
      </div>

      {/* 2px progress line while the capsule is away */}
      <div
        aria-hidden
        className={`pointer-events-none fixed bottom-1 left-[22px] right-[22px] z-30 h-[2px] overflow-hidden rounded-[1px] bg-[var(--fill-2)] transition-opacity duration-300 ${
          hudVisible || navigation.running || aaOpen || tocOpen ? 'opacity-0' : 'opacity-100 delay-[120ms]'
        }`}
      >
        <i className="block h-full rounded-[1px] bg-[var(--label)] opacity-[0.38]" style={{ width: `${scrollPercent}%` }} />
      </div>

      <TypographyPopover
        autoReading={{
          mode: prefs.autoMode, speed: prefs.autoSpeed, interval: prefs.autoInterval,
          onChange: updatePrefs, sidePageTurn: prefs.sidePageTurn,
          volumePageTurn: prefs.volumePageTurn, nativeAvailable: navigation.nativeAvailable,
        }}
        open={aaOpen}
        onClose={() => { popoverClosedAt.current = Date.now(); setAaOpen(false); }}
        anchor={aaAnchor}
        placement="above"
        rubyType={rubyType}
        onRubyTypeChange={onRubyTypeChange}
        writingMode={prefs.writingMode}
        onWritingModeChange={writingMode => updatePrefs({ writingMode })}
        readerTheme={prefs.readerTheme}
        onReaderThemeChange={readerTheme => updatePrefs({ readerTheme })}
        fontFamily={prefs.fontFamily}
        onFontFamilyChange={fontFamily => updatePrefs({ fontFamily })}
        fontSize={prefs.fontSize}
        minFontSize={READER_FONT_SIZE_MIN}
        maxFontSize={READER_FONT_SIZE_MAX}
        onFontSizeChange={changeFontSize}
        lineHeight={prefs.lineHeight}
        onLineHeightChange={lineHeight => updatePrefs({ lineHeight })}
        contentWidth={prefs.contentWidth}
        onContentWidthChange={contentWidth => updatePrefs({ contentWidth })}
        showRuby={prefs.showRuby}
        onShowRubyChange={showRuby => updatePrefs({ showRuby })}
        aiReview={aiReview}
        bilingual={tools ? {
          on: prefs.bilingual,
          onChange: value => updatePrefs({ bilingual: value }),
          pretranslate: bilingual.pretranslate,
          engineLabel: tools.engineLabel,
          onStart: bilingual.startPretranslate,
          onPause: bilingual.pausePretranslate,
        } : undefined}
        floatingTranslation={{ floating: floatingTranslation.floating, onFloat: floatingTranslation.float, onDock: floatingTranslation.dock }}
        t={t}
      />

      <TocCard
        open={tocOpen}
        onClose={() => { popoverClosedAt.current = Date.now(); setTocOpen(false); }}
        anchor={capsuleNode}
        phone={phone}
        chapters={chapters}
        current={chapter}
        percent={scrollPercent}
        onSelect={index => { navigation.pause(); goToChapter(index); }}
        bookmarks={book.bookmarks}
        onJumpLine={(lineIndex, match) => { navigation.pause(); jumpToLine(lineIndex, match); }}
        onDeleteBookmark={onRemoveBookmark}
        pageStarts={book.pageStarts}
        pageLabels={book.pageLabels}
        lineTexts={lineTexts}
        initialTab={tocInitialTab}
        onActiveSearchChange={q => { if (!q) setSearchHighlight(null); }}
        t={t}
      />

      <LookupCard
        state={lookup?.state ?? null}
        anchor={lookup?.anchor ?? null}
        phone={phone}
        onClose={closeLookup}
        dictTitles={dictTitles}
        locale={locale}
        onEditReading={lookupEditHandler}
        t={t}
      />
    </section>
  );
}
