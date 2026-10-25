'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { IMAGE_LINE } from '../utils/bookAssets';
import { logEvent } from '../utils/appLog';
import type { ReaderTools } from '../utils/readingTools';
import { splitSentences } from '../utils/sentences';

export interface PretranslateState {
  status: 'idle' | 'running' | 'paused' | 'done' | 'error';
  done: number;
  total: number;
  error?: string;
}

/** The nearest ancestor that scrolls, which is what "near the viewport" has to be measured against. */
function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let current = node; current; current = current.parentElement) {
    const { overflowY, overflowX } = getComputedStyle(current);
    if (/(auto|scroll)/.test(overflowY + overflowX)) return current;
  }
  return null;
}

/** Every sentence of a book, in reading order: what the whole-book translation works through. */
export function bookSentences(content: string): string[] {
  return content.replace(/\r\n?/g, '\n').split('\n')
    .filter(line => !IMAGE_LINE.test(line))
    .flatMap(line => splitSentences(line).map(sentence => sentence.text));
}

/**
 * Per-sentence translations for the reader: sentences of the lines near the viewport are translated
 * (and cached) as they come into view; the whole book can also be translated in the background.
 */
export function useBilingual({ enabled, wantCount, bookId, content, lineTexts, articleRef, tools }: {
  enabled: boolean;
  /** The Aa popover is open: it shows how much of the book is translated. */
  wantCount: boolean;
  bookId: string | null;
  content: string;
  lineTexts: string[];
  articleRef: RefObject<HTMLElement | null>;
  tools: ReaderTools | null;
}) {
  const [translations, setTranslations] = useState<Map<string, string>>(() => new Map());
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [pretranslate, setPretranslate] = useState<PretranslateState>({ status: 'idle', done: 0, total: 0 });
  const visible = useRef(new Set<number>());
  const requested = useRef(new Set<string>());
  const timer = useRef<number | null>(null);
  const pretranslateAbort = useRef<AbortController | null>(null);
  const settingsKey = tools?.settingsKey ?? '';

  // A different book, engine or target language starts from a clean slate (the cache still answers instantly).
  const key = `${bookId}|${settingsKey}`;
  const [shownKey, setShownKey] = useState(key);
  if (key !== shownKey) {
    setShownKey(key);
    setTranslations(new Map());
    setFailed(new Set());
    setPretranslate({ status: 'idle', done: 0, total: 0 });
  }
  useEffect(() => {
    requested.current = new Set();
    pretranslateAbort.current?.abort();
  }, [key]);

  const request = useCallback((texts: string[], onScreen = texts.length) => {
    if (!tools || !bookId) return;
    const leading = texts.slice(0, onScreen).filter(text => !requested.current.has(text)).length;
    const fresh = texts.filter(text => !requested.current.has(text));
    if (!fresh.length) return;
    fresh.forEach(text => requested.current.add(text));
    // Lines appear batch by batch; only what never arrived is marked failed.
    const arrived = new Set<string>();
    const show = (found: Map<string, string>) => {
      if (!found.size) return;
      found.forEach((_, text) => arrived.add(text));
      setTranslations(previous => { const next = new Map(previous); found.forEach((value, text) => next.set(text, value)); return next; });
      setFailed(previous => {
        if (![...found.keys()].some(text => previous.has(text))) return previous;
        const next = new Set(previous); found.forEach((_, text) => next.delete(text)); return next;
      });
    };
    const markMissing = () => setFailed(previous => {
      const missing = fresh.filter(text => !arrived.has(text));
      if (!missing.length) return previous;
      const next = new Set(previous); missing.forEach(text => next.add(text)); return next;
    });
    tools.translate(bookId, fresh, { onPartial: show, leading }).then(found => { show(found); markMissing(); }, markMissing);
  }, [tools, bookId]);

  // What is on screen goes first, then the lines below (where reading goes next), then the ones above.
  const flush = useCallback(() => {
    timer.current = null;
    const article = articleRef.current;
    const view = scrollParent(article)?.getBoundingClientRect();
    const groups: number[][] = [[], [], []];
    for (const index of [...visible.current].sort((a, b) => a - b)) {
      const box = view && article?.querySelector(`[data-line="${index}"]`)?.getBoundingClientRect();
      groups[!box || !view || (box.bottom > view.top && box.top < view.bottom) ? 0 : box.top >= view.bottom ? 1 : 2].push(index);
    }
    const texts: string[] = [];
    let onScreen = 0;
    groups.forEach((group, rank) => {
      for (const index of group) {
        const line = lineTexts[index];
        if (line && !IMAGE_LINE.test(line)) for (const sentence of splitSentences(line)) texts.push(sentence.text);
      }
      if (rank === 0) onScreen = texts.length;
    });
    request(texts, onScreen);
  }, [lineTexts, request, articleRef]);

  useEffect(() => {
    const article = articleRef.current;
    if (!enabled || !article || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.line);
        if (entry.isIntersecting) visible.current.add(index); else visible.current.delete(index);
      }
      // Scrolling is debounced; the first screen after turning translation on goes out at once.
      if (timer.current === null) timer.current = window.setTimeout(flush, requested.current.size ? 250 : 0);
      // The reader scrolls inside its own box: with the page as root, the margin never reached past that box.
    }, { root: scrollParent(article), rootMargin: '800px' });
    article.querySelectorAll('[data-line]').forEach(node => observer.observe(node));
    return () => {
      observer.disconnect();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [enabled, articleRef, flush, lineTexts.length]);

  const retry = useCallback((text: string) => {
    requested.current.delete(text);
    setFailed(previous => { const next = new Set(previous); next.delete(text); return next; });
    request([text]);
  }, [request]);

  // How much of the book is already translated, for the Aa row.
  useEffect(() => {
    if (!wantCount || !tools || !bookId) return;
    const all = bookSentences(content);
    let active = true;
    void tools.countTranslated(bookId, all).then(done => {
      if (!active) return;
      setPretranslate(previous => previous.status === 'running' ? previous : { status: done >= all.length && all.length ? 'done' : 'idle', done, total: all.length });
    });
    return () => { active = false; };
  }, [wantCount, tools, bookId, content]);

  const startPretranslate = useCallback(() => {
    if (!tools || !bookId) return;
    pretranslateAbort.current?.abort();
    const controller = new AbortController();
    pretranslateAbort.current = controller;
    const all = bookSentences(content);
    setPretranslate({ status: 'running', done: 0, total: all.length });
    tools.pretranslate(bookId, all, (done, total) => {
      if (!controller.signal.aborted) setPretranslate({ status: 'running', done, total });
    }, controller.signal).then(() => {
      if (!controller.signal.aborted) setPretranslate({ status: 'done', done: all.length, total: all.length });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      logEvent('error', 'translate', `whole-book translation stopped: ${error instanceof Error ? error.message : String(error)}`);
      setPretranslate(previous => ({ ...previous, status: 'error', error: error instanceof Error ? error.message : String(error) }));
    });
  }, [tools, bookId, content]);

  const pausePretranslate = useCallback(() => {
    pretranslateAbort.current?.abort();
    setPretranslate(previous => ({ ...previous, status: 'paused' }));
  }, []);

  useEffect(() => () => pretranslateAbort.current?.abort(), []);

  // One stable object for the memoised reader lines.
  const retryBundle = useMemo(() => ({ translations, failed, onRetry: retry }), [translations, failed, retry]);

  return { retryBundle, pretranslate, startPretranslate, pausePretranslate };
}
