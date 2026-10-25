'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ScriptLine } from '../utils/furigana';
import type { Translations } from '../utils/i18n';
import type { BookItem } from '../utils/libraryDatabase';
import { TypographyPopover } from './TypographyPopover';
import { GlassButton } from './glass/GlassButton';
import { useGlass } from './glass/hooks';
import { IconChevronLeft, IconList, IconRead, IconRuby, IconTextFormat, IconTranslate } from './glass/icons';
import { TocCard } from './TocCard';
import { logEvent } from '../utils/appLog';
import { LookupCard, type LookupState } from './LookupCard';
import { ReaderLine, bilingualSignature } from './ReaderLine';
import { useBilingual } from '../hooks/useBilingual';
import type { ReaderTools } from '../utils/readingTools';

type RubyMode = 'hiragana' | 'katakana' | 'romaji';
export type ReaderFontFamily = 'serif' | 'sans';
export type ReaderWritingMode = 'horizontal' | 'vertical';

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
}

interface ReaderPrefs {
  fontFamily: ReaderFontFamily;
  fontSize: number;
  showRuby: boolean;
  writingMode: ReaderWritingMode;
  bilingual: boolean;
}

const PREFS_KEY = 'furigana_reader_prefs_v3';
const DEFAULT_PREFS: ReaderPrefs = { fontFamily: 'serif', fontSize: 19, showRuby: true, writingMode: 'horizontal', bilingual: false };
const FONT_STACK: Record<ReaderFontFamily, string> = {
  serif: 'var(--font-mincho)',
  sans: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif',
};

function loadPrefs(): ReaderPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}') as Partial<ReaderPrefs>;
    return {
      fontFamily: parsed.fontFamily === 'sans' ? 'sans' : 'serif',
      fontSize: typeof parsed.fontSize === 'number' ? Math.min(26, Math.max(14, parsed.fontSize)) : DEFAULT_PREFS.fontSize,
      showRuby: typeof parsed.showRuby === 'boolean' ? parsed.showRuby : true,
      writingMode: parsed.writingMode === 'vertical' ? 'vertical' : 'horizontal',
      bilingual: parsed.bilingual === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

/**
 * Immersive reader (mockup): the text fills the screen, one glass capsule at
 * the bottom (back, title + progress, ruby toggle, Aa). Scrolling down hides
 * the capsule — judged by distance travelled in one direction, because touch
 * and trackpads deliver many tiny deltas — and a 2px progress line takes its
 * place; scrolling up, reaching the top/bottom or tapping the page brings it back.
 */
export function ReaderPanel({ t, book, annotatedLines, isProcessing, rubyType, onRubyTypeChange, onUpdateProgress, onGoToLibrary, tools, dictTitles, locale }: ReaderPanelProps) {
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs);
  const [hudVisible, setHudVisible] = useState(true);
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
  const frameRef = useRef<number | null>(null);
  const [capsuleNode, setCapsuleNode] = useState<HTMLDivElement | null>(null);
  const capsuleRef = useGlass<HTMLDivElement>();
  const setCapsule = useCallback((node: HTMLDivElement | null) => { capsuleRef(node); setCapsuleNode(node); }, [capsuleRef]);
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
  const lineTexts = React.useMemo(() => annotatedLines.map(line => line.tokens.map(token => token.surface).join('')), [annotatedLines]);
  // Books with a table of contents (EPUB/PDF) are read one chapter at a time: only that chapter is rendered.
  const chapters = React.useMemo(() => book?.chapters ?? [], [book?.chapters]);
  const chaptered = chapters.length > 1;
  const chapterOf = useCallback((line: number) => {
    let found = 0;
    chapters.forEach((chapter, index) => { if (chapter.startLine <= line) found = index; });
    return found;
  }, [chapters]);
  const [chapter, setChapter] = useState(() => chapterOf(book?.readingProgress.lineIndex ?? 0));
  const [tocOpen, setTocOpen] = useState(false);
  const range = chaptered && chapters[chapter]
    ? { start: chapters[chapter].startLine, end: chapters[chapter].endLine }
    : { start: 0, end: annotatedLines.length - 1 };
  const bilingual = useBilingual({
    enabled: prefs.bilingual, wantCount: aaOpen, bookId: book?.bookId ?? null, content: book?.content ?? '', lineTexts, articleRef, tools,
  });

  const updatePrefs = (patch: Partial<ReaderPrefs>) => {
    setPrefs(previous => {
      const next = { ...previous, ...patch };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage write failures
      }
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
  }

  const processScroll = useCallback(() => {
    const article = articleRef.current;
    const scroller = scrollerRef.current;
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
      onUpdateProgress(chapterOf(index), index, annotatedLines.length);
    }
  }, [isVertical, onUpdateProgress, chapterOf, annotatedLines.length]);

  const handleScroll = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      processScroll();
    });
  }, [processScroll]);

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
  const lineTotal = annotatedLines.length;
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

  const goToChapter = (index: number) => {
    const target = chapters[index];
    if (!target) return;
    setTocOpen(false);
    setChapter(index);
    setLookup(null);
    resumeLineRef.current = null;
    placedLineRef.current = null;
    lastLineRef.current = target.startLine;
    setScrollPercent(0);
    onUpdateProgress(index, target.startLine, annotatedLines.length);
    // The new chapter renders on the next frame; start it from the top.
    requestAnimationFrame(() => {
      if (articleRef.current) articleRef.current.scrollLeft = 0;
      if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
      setHudVisible(true);
    });
  };

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
    if (target.closest('button, a, input')) return;
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

  const lineCount = annotatedLines.length;

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col">
      <div className="scroll-edge fixed inset-x-0 top-0 z-10 h-[76px]" aria-hidden />

      <div ref={scrollerRef} onScroll={isVertical ? undefined : handleScroll} onClick={handleCanvasClick} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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

          {annotatedLines.slice(range.start, range.end + 1).map((line, offset) => {
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
              <button type="button" className="btn" disabled={chapter === 0} onClick={() => goToChapter(chapter - 1)}>{t.readerPrevChapter}</button>
              {chapter + 1 < chapters.length && (
                <button type="button" className="btn btn-ink" onClick={() => goToChapter(chapter + 1)}>
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
        className={`glass fixed bottom-[max(22px,env(safe-area-inset-bottom))] left-1/2 z-40 flex h-[52px] w-[min(470px,calc(100%-32px))] -translate-x-1/2 items-center gap-0.5 rounded-full px-2 ${
          hudVisible || aaOpen || tocOpen
            ? 'transition-[translate,opacity] duration-[620ms,220ms] [transition-timing-function:var(--spring-bouncy),ease]'
            : 'pointer-events-none translate-y-[calc(100%+40px)] opacity-0 transition-[translate,opacity] duration-[340ms,260ms] [transition-timing-function:cubic-bezier(.4,0,.7,.2),ease]'
        }`}
      >
        <GlassButton icon aria-label={t.readerBackToLibrary} onClick={onGoToLibrary}>
          <IconChevronLeft />
        </GlassButton>
        {chaptered && (
          <GlassButton icon aria-label={t.readerToc} aria-expanded={tocOpen} onClick={() => setTocOpen(open => !open)}>
            <IconList />
          </GlassButton>
        )}
        {chaptered ? (
          <button type="button" aria-label={t.readerToc} onClick={() => setTocOpen(open => !open)} className="min-w-0 flex-1 rounded-[14px] px-1.5 py-1 text-center transition-colors hover:bg-[var(--item-hover)]">
            <b className="block truncate text-[13px]">{book.title} · {chapters[chapter]?.title}</b>
            <span className="text-[11px] tabular-nums text-[var(--label-2)]">{fill(t.readerChapterPercent, { current: chapter + 1, total: chapters.length, percent: scrollPercent })}</span>
          </button>
        ) : (
          <div className="min-w-0 flex-1 text-center">
            <b className="block truncate text-[13px]">{book.title}</b>
            <span className="text-[11px] tabular-nums text-[var(--label-2)]">{fill(t.libraryBookProgress, { percent: scrollPercent })}</span>
          </div>
        )}
        <GlassButton icon aria-label={t.showRubyLabel} aria-pressed={prefs.showRuby} onClick={() => updatePrefs({ showRuby: !prefs.showRuby })}>
          <IconRuby />
        </GlassButton>
        <GlassButton
          icon
          aria-label={t.bilingualLabel}
          aria-pressed={prefs.bilingual}
          className={prefs.bilingual ? 'gbtn-on' : ''}
          onClick={() => updatePrefs({ bilingual: !prefs.bilingual })}
        >
          <IconTranslate />
        </GlassButton>
        <GlassButton ref={setAaAnchor} icon aria-label={t.typographyShort} aria-expanded={aaOpen} onClick={() => setAaOpen(open => !open)}>
          <IconTextFormat />
        </GlassButton>
      </div>

      {/* 2px progress line while the capsule is away */}
      <div
        aria-hidden
        className={`pointer-events-none fixed bottom-1 left-[22px] right-[22px] z-30 h-[2px] overflow-hidden rounded-[1px] bg-[var(--fill-2)] transition-opacity duration-300 ${
          hudVisible || aaOpen ? 'opacity-0' : 'opacity-100 delay-[120ms]'
        }`}
      >
        <i className="block h-full rounded-[1px] bg-[var(--label)] opacity-[0.38]" style={{ width: `${scrollPercent}%` }} />
      </div>

      <TypographyPopover
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
        onFontSizeChange={fontSize => updatePrefs({ fontSize })}
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
          onSelect={goToChapter}
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
