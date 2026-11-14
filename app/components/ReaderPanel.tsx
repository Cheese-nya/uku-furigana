'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ScriptLine } from '../utils/furigana';
import type { Translations } from '../utils/i18n';
import { sourcePageLabel, type BookItem } from '../utils/libraryDatabase';
import {
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  clampReaderFontSize,
  loadReaderPrefs,
  saveReaderPrefs,
  type ReaderFontFamily,
  type ReaderPrefs,
} from '../utils/readerPreferences';
import { TypographyPopover } from './TypographyPopover';
import { FloatingTranslationButton, useFloatingTranslation } from './FloatingTranslationButton';
import { GlassButton } from './glass/GlassButton';
import { useGlass } from './glass/hooks';
import { IconChevronLeft, IconList, IconRead, IconRuby, IconTextFormat } from './glass/icons';
import { TocCard } from './TocCard';
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
}

const FONT_STACK: Record<ReaderFontFamily, string> = {
  serif: 'var(--font-mincho)',
  sans: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif',
};

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

/**
 * Immersive reader (mockup): the text fills the screen, one glass capsule at
 * the bottom (back, title + progress, ruby toggle, Aa). Scrolling down hides
 * the capsule — judged by distance travelled in one direction, because touch
 * and trackpads deliver many tiny deltas — and a 2px progress line takes its
 * place; scrolling up, reaching the top/bottom or tapping the page brings it back.
 */
export function ReaderPanel({ t, book, annotatedLines, isProcessing, rubyType, onRubyTypeChange, onUpdateProgress, onGoToLibrary, tools, dictTitles, locale, error }: ReaderPanelProps) {
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
  // Line to bring back to the top once it has been rendered: the saved place when a book opens, or the
  // current place when a re-annotation empties the page and the lines stream back in.
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
  const lookupSeq = useRef(0);
  const lookupClosedAt = useRef(0);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  // Annotation failed: read the stored text, so a book opened from the shelf is never a blank
  // page. Only on failure: while annotation runs, the lines must stay empty and then grow back
  // chunk by chunk, which is what brings the reader back to their place after a re-annotation.
  const failed = Boolean(error) && !isProcessing && annotatedLines.length === 0;
  const plainLines = React.useMemo(
    () => (failed && book ? plainScriptLines(book.content) : []),
    [failed, book],
  );
  const lines = failed ? plainLines : annotatedLines;
  const lineTexts = React.useMemo(() => lines.map(line => line.tokens.map(token => token.surface).join('')), [lines]);
  // Books with a table of contents (EPUB/PDF) are read one chapter at a time: only that chapter is rendered.
  const chapters = React.useMemo(() => book?.chapters ?? [], [book?.chapters]);
  const chaptered = chapters.length > 1;
  const chapterOf = useCallback((line: number) => {
    let found = 0;
    chapters.forEach((chapter, index) => { if (chapter.startLine <= line) found = index; });
    return found;
  }, [chapters]);
  const [chapter, setChapter] = useState(() => chapterOf(book?.readingProgress.lineIndex ?? 0));
  const [currentLine, setCurrentLine] = useState(() => book?.readingProgress.lineIndex ?? 0);
  const [tocOpen, setTocOpen] = useState(false);
  const sourcePage = sourcePageLabel(book?.pageStarts, book?.pageLabels, currentLine);
  const range = chaptered && chapters[chapter]
    ? { start: chapters[chapter].startLine, end: chapters[chapter].endLine }
    : { start: 0, end: lines.length - 1 };
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
    // An emptied page (re-annotating) clamps the scroll to 0; that is not the reader's place, so keep the saved one.
    if (nodes.length === 0) return;
    // A size change reflows the page before the anchored line has been put back; do not save that transient position.
    if (fontAnchorRef.current !== null) return;
    // The current line is the last one that has crossed the top (right edge when vertical). Lines are in order,
    // so a binary search measures a handful of them per frame instead of every line of the book.
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
    // Right after a restore, layout drift must not rewrite the saved place; only the reader's own scrolling may.
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
      // vertical-rl: lines run right to left, and the saved line is the one crossing the right-hand edge;
      // land it well inside the 72px band the progress check uses, so layout drift cannot pick the neighbour
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
  }, [prefs.fontSize, placeLine]);

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
    // Web fonts and ruby settle a moment later and can nudge the layout; put the line back until they have.
    settleTimersRef.current.forEach(clearTimeout);
    const again = () => { if (placedLineRef.current === target && !userMovedRef.current) placeLineRef.current(target); };
    settleTimersRef.current = [250, 700, 1500].map(ms => window.setTimeout(again, ms));
    void document.fonts?.ready.then(again);
  }, [lineTotal, bookId, placeLine]);

  useEffect(() => { placeLineRef.current = placeLine; }, [placeLine]);
  useEffect(() => () => settleTimersRef.current.forEach(clearTimeout), []);

  // Annotating adds and removes a status line above the text, which nudges the layout; once it is done,
  // put the line back exactly (unless the reader has already started scrolling).
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
    ready: Boolean(bookId) && !isProcessing && lines.length > 0,
    suspended: aaOpen || tocOpen || lookup !== null || translationDragging,
    prefs, scrollerRef, articleRef,
    isAdjusting: () => translationAnchor.isAdjusting.current || fontAnchorRef.current !== null || pendingChapterEdge.current !== null || resumeLineRef.current !== null,
    prepareMotion, goToChapter, reveal: () => setHudVisible(true),
  });
  const tapGesture = useRef(new ReaderTapGesture());
  const validTap = useRef(false);

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
    }).catch((error: unknown) => {
      logEvent('error', 'lookup', `lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      if (still()) setLookup(current => current && { ...current, state: { status: 'error', query, error: error instanceof Error ? error.message : String(error) } });
    });
  };

  // A tap on a word looks it up; a tap elsewhere toggles the capsule — or only closes the dictionary when it was open.
  const handleCanvasClick = (event: React.MouseEvent) => {
    if (String(window.getSelection() || '')) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [role="dialog"]')) return;
    if (aaOpen || tocOpen || translationDragging) return;
    // Keyboard clicks retain the existing word-accessibility behavior; physical clicks require a clean tap.
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
      // Find the character under the finger inside this piece (ruby words are looked up from their start).
      const caret = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null })
        .caretPositionFromPoint?.(event.clientX, event.clientY);
      const range = caret ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
      const node = caret?.offsetNode ?? range?.startContainer;
      const within = caret?.offset ?? range?.startOffset ?? 0;
      if (node && node.nodeType === Node.TEXT_NODE && node.parentElement === piece && piece.tagName !== 'RUBY') {
        offset += Math.min(within, Math.max(0, (node.textContent?.length ?? 1) - 1));
      }
      lookUp(lineIndex, lineTexts[lineIndex] ?? '', offset, piece);
      return;
    }
    if (lookup || Date.now() - lookupClosedAt.current < 350) { if (lookup) closeLookup(); return; }
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

  return (
    <section data-auto-reading={navigation.state} className="relative flex h-full min-h-0 flex-1 flex-col">
      <div className="scroll-edge fixed inset-x-0 top-0 z-10 h-[76px]" aria-hidden />

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
              : 'mx-auto w-full max-w-[34em] px-6 pb-[140px] pt-[70px]'
          }
          style={{
            fontFamily: FONT_STACK[prefs.fontFamily],
            fontSize: `${prefs.fontSize}px`,
            lineHeight: 2.35,
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
                bilingual={prefs.bilingual ? bilingual.retryBundle : undefined}
                bilingualSig={prefs.bilingual ? bilingualSignature(lineTexts[lineIndex] ?? '', bilingual.retryBundle.translations, bilingual.retryBundle.failed) : undefined}
                hit={lookup?.line === lineIndex ? lookup : null}
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
          aria-pressed={navigation.running} disabled={isProcessing || !lines.length}
          onClick={navigation.toggle}>
          {navigation.running ? <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="3" height="12" rx="1" /><rect x="12" y="4" width="3" height="12" rx="1" /></svg>
            : <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6 3.5a1 1 0 0 1 1.5-.86l9 6.5a1 1 0 0 1 0 1.72l-9 6.5A1 1 0 0 1 6 16.5z" /></svg>}
        </GlassButton>
        {chaptered && (
          <GlassButton icon aria-label={t.readerToc} aria-expanded={tocOpen} onClick={() => setTocOpen(open => !open)}>
            <IconList />
          </GlassButton>
        )}
        </div>
        {chaptered ? (
          <button type="button" aria-label={t.readerToc} onClick={() => setTocOpen(open => !open)} className="reader-capsule-title rounded-[14px] px-1.5 py-1 text-center transition-colors hover:bg-[var(--item-hover)]">
            <b className="block truncate text-[13px]">{book.title} · {chapters[chapter]?.title}</b>
            <span className="whitespace-nowrap text-[11px] tabular-nums text-[var(--label-2)]">
              {fill(t.readerChapterPercent, { current: chapter + 1, total: chapters.length, percent: scrollPercent })}
              {sourcePage ? ` · ${fill(t.readerSourcePage, { page: sourcePage })}` : ''}
            </span>
          </button>
        ) : (
          <div className="reader-capsule-title text-center">
            <b className="block truncate text-[13px]">{book.title}</b>
            <span className="whitespace-nowrap text-[11px] tabular-nums text-[var(--label-2)]">
              {fill(t.libraryBookProgress, { percent: scrollPercent })}
              {sourcePage ? ` · ${fill(t.readerSourcePage, { page: sourcePage })}` : ''}
            </span>
          </div>
        )}
        <div className="reader-tools-right" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginLeft: 'auto', gap: 2, flexShrink: 0 }}>
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
          hudVisible || navigation.running || aaOpen ? 'opacity-0' : 'opacity-100 delay-[120ms]'
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
        onClose={() => setAaOpen(false)}
        anchor={aaAnchor}
        placement="above"
        rubyType={rubyType}
        onRubyTypeChange={onRubyTypeChange}
        writingMode={prefs.writingMode}
        onWritingModeChange={writingMode => updatePrefs({ writingMode })}
        fontFamily={prefs.fontFamily}
        onFontFamilyChange={fontFamily => updatePrefs({ fontFamily })}
        fontSize={prefs.fontSize}
        minFontSize={READER_FONT_SIZE_MIN}
        maxFontSize={READER_FONT_SIZE_MAX}
        onFontSizeChange={changeFontSize}
        showRuby={prefs.showRuby}
        onShowRubyChange={showRuby => updatePrefs({ showRuby })}
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

      {chaptered && (
        <TocCard
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          anchor={capsuleNode}
          phone={phone}
          chapters={chapters}
          current={chapter}
          percent={scrollPercent}
          onSelect={index => { navigation.pause(); goToChapter(index); }}
          t={t}
        />
      )}

      <LookupCard
        state={lookup?.state ?? null}
        anchor={lookup?.anchor ?? null}
        phone={phone}
        onClose={closeLookup}
        dictTitles={dictTitles}
        locale={locale}
        t={t}
      />
    </section>
  );
}
