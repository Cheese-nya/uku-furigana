'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { IMAGE_LINE } from '../utils/bookAssets';
import { logEvent } from '../utils/appLog';
import type { ReaderTools } from '../utils/readingTools';
import { splitSentences } from '../utils/sentences';
import type { ReaderTranslationAnchor } from './useReaderTranslationAnchor';
import { needsTranslation } from '../utils/translation';

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
export function useBilingual({ enabled, wantCount, bookId, content, lineTexts, articleRef, tools, translationAnchor }: {
  enabled: boolean;
  /** The Aa popover is open: it shows how much of the book is translated. */
  wantCount: boolean;
  bookId: string | null;
  content: string;
  lineTexts: string[];
  articleRef: RefObject<HTMLElement | null>;
  tools: ReaderTools | null;
  translationAnchor?: ReaderTranslationAnchor;
}) {
  const [translations, setTranslations] = useState<Map<string, string>>(() => new Map());
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [pretranslate, setPretranslate] = useState<PretranslateState>({ status: 'idle', done: 0, total: 0 });
  const visible = useRef(new Set<number>());
  const requested = useRef(new Set<string>());
  const failedKeys = useRef(new Set<string>());
  const timer = useRef<number | null>(null);
  const translateAbort = useRef<AbortController | null>(null);
  const pretranslateAbort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const settingsKey = tools?.settingsKey ?? '';
  const publication = useRef({ owner: {}, found: new Map<string, string>(), failures: new Set<string>(), cleared: new Set<string>() });
  const activeKey = useRef('');
  const mounted = useRef(true);
  const anchorRef = useRef(translationAnchor);
  useLayoutEffect(() => { anchorRef.current = translationAnchor; }, [translationAnchor]);
  const publishPending = useCallback(() => {
    const batch = publication.current;
    const found = batch.found, failures = batch.failures, cleared = batch.cleared;
    batch.found = new Map(); batch.failures = new Set(); batch.cleared = new Set();
    if (!mounted.current) return;
    if (found.size) setTranslations(previous => {
      const next = new Map(previous); found.forEach((value, text) => next.set(text, value)); return next;
    });
    if (found.size || failures.size || cleared.size) setFailed(previous => {
      const next = new Set(previous);
      cleared.forEach(text => next.delete(text));
      failures.forEach(text => next.add(text));
      found.forEach((_, text) => next.delete(text));
      return next;
    });
  }, []);
  const schedule = useCallback(() => {
    const anchor = anchorRef.current;
    if (anchor) anchor.schedulePublish(publication.current.owner, publishPending);
    else publishPending();
  }, [publishPending]);


  // A different book, engine or target language starts from a clean slate (the cache still answers instantly).
  const key = `${bookId}|${settingsKey}`;
  const [shownKey, setShownKey] = useState(key);
  if (key !== shownKey) {
    setShownKey(key);
    setTranslations(new Map());
    setFailed(new Set());
    setPretranslate({ status: 'idle', done: 0, total: 0 });
  }
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    if (enabled && failed.size) setFailed(new Set());
  }
  useLayoutEffect(() => {
    activeKey.current = key;
    generation.current += 1;
    anchorRef.current?.cancelPublish(publication.current.owner);
    publication.current = { owner: {}, found: new Map(), failures: new Set(), cleared: new Set() };
    requested.current = new Set();
    failedKeys.current = new Set();
    visible.current.clear();
    translateAbort.current?.abort();
    translateAbort.current = null;
    pretranslateAbort.current?.abort();
  }, [key]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      anchorRef.current?.cancelPublish(publication.current.owner);
    };
  }, []);

  const request = useCallback((texts: string[], onScreen = texts.length) => {
    if (!tools || !bookId) return;
    const requestGeneration = generation.current;
    const leading = texts.slice(0, onScreen).filter(text => !requested.current.has(text)).length;
    const fresh = texts.filter(text => !requested.current.has(text));
    if (!fresh.length) return;
    fresh.forEach(text => requested.current.add(text));
    if (!translateAbort.current || translateAbort.current.signal.aborted) {
      translateAbort.current = new AbortController();
    }
    const controller = translateAbort.current;
    const stale = () => !mounted.current || activeKey.current !== key || generation.current !== requestGeneration || controller.signal.aborted;
    // Lines appear batch by batch; only what never arrived is marked failed.
    const arrived = new Set<string>();
    const show = (found: Map<string, string>) => {
      if (stale() || !found.size) return;
      found.forEach((value, text) => {
        arrived.add(text);
        failedKeys.current.delete(text);
        publication.current.found.set(text, value);
        publication.current.failures.delete(text);
      });
      schedule();
    };
    const markMissing = (error?: unknown) => {
      const aborted = stale() || (error instanceof Error && error.name === 'AbortError');
      if (aborted) {
        // Cancelled requests were interrupted by navigation/toggle, not failed: let them run again later.
        for (const text of fresh) if (!arrived.has(text)) requested.current.delete(text);
        return;
      }
      const missing = fresh.filter(text => !arrived.has(text));
      if (!missing.length) return;
      missing.forEach(text => {
        failedKeys.current.add(text);
        publication.current.failures.add(text);
      });
      schedule();
    };
    tools.translate(bookId, fresh, { onPartial: show, leading }, controller.signal)
      .then(found => { show(found); markMissing(); }, markMissing);
  }, [tools, bookId, key, schedule]);

  // What is on screen goes first, then the lines below (where reading goes next), then the ones above.
  const flush = useCallback(() => {
    timer.current = null;
    const article = articleRef.current;
    const view = scrollParent(article)?.getBoundingClientRect();
    const groups: number[][] = [[], [], []];
    for (const index of [...visible.current].sort((a, b) => a - b)) {
      const box = view && article?.querySelector(`[data-line="${index}"]`)?.getBoundingClientRect();
      const vertical = article?.dataset.writingMode === 'vertical';
      const inView = box && view && (vertical ? box.right > view.left && box.left < view.right : box.bottom > view.top && box.top < view.bottom);
      const ahead = box && view && (vertical ? box.right <= view.left : box.top >= view.bottom);
      groups[!box || !view || inView ? 0 : ahead ? 1 : 2].push(index);
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
    const visibleSet = visible.current;
    if (!enabled || !article || typeof IntersectionObserver === 'undefined') {
      generation.current += 1;
      translateAbort.current?.abort();
      translateAbort.current = null;
      visibleSet.clear();
      return;
    }
    // Re-enabling bilingual retries lines that had previously failed.
    if (failedKeys.current.size) {
      for (const text of failedKeys.current) requested.current.delete(text);
      failedKeys.current.clear();
    }
    const scheduleFlush = () => {
      if (timer.current === null) timer.current = window.setTimeout(flush, requested.current.size ? 250 : 0);
    };
    let observer: IntersectionObserver | null = null;
    const observed = new Set<Element>();
    const observeLines = () => {
      const current = new Set(article.querySelectorAll('[data-line]'));
      for (const node of observed) if (!current.has(node)) {
        observer?.unobserve(node);
        visibleSet.delete(Number((node as HTMLElement).dataset.line));
        observed.delete(node);
      }
      for (const node of current) if (!observed.has(node)) {
        observer?.observe(node);
        observed.add(node);
      }
    };
    const connectObserver = () => {
      observer?.disconnect();
      observed.clear();
      visibleSet.clear();
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.line);
          if (entry.isIntersecting) visibleSet.add(index); else visibleSet.delete(index);
        }
        // Scrolling is debounced; the first screen after turning translation on goes out at once.
        scheduleFlush();
        // The reader scrolls inside its own box: with the page as root, the margin never reached past that box.
      }, { root: scrollParent(article), rootMargin: '800px' });
      observeLines();
    };
    connectObserver();

    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(mutations => {
        if (mutations.some(m => m.type === 'attributes')) {
          connectObserver();
          return;
        }
        observeLines();
      });
      // Chapter changes can replace nested paragraphs without changing the book's lineTexts length.
      mutationObserver.observe(article, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-writing-mode'] });
    }

    return () => {
      mutationObserver?.disconnect();
      observer?.disconnect();
      observed.clear();
      visibleSet.clear();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      generation.current += 1;
      translateAbort.current?.abort();
      translateAbort.current = null;
    };
  }, [enabled, articleRef, flush, key]);

  const retry = useCallback((text: string) => {
    requested.current.delete(text);
    failedKeys.current.delete(text);
    publication.current.failures.delete(text);
    publication.current.cleared.add(text);
    schedule();
    request([text]);
  }, [request, schedule]);

  // How much of the book is already translated, for the Aa row.
  useEffect(() => {
    if (!wantCount || !tools || !bookId) return;
    const all = bookSentences(content);
    const translatable = all.filter(needsTranslation);
    const skipped = all.length - translatable.length;
    let active = true;
    void tools.countTranslated(bookId, translatable).then(count => {
      if (!active) return;
      const done = count + skipped;
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
      if (!controller.signal.aborted) {
        setPretranslate({ status: 'done', done: all.length, total: all.length });
        if (failedKeys.current.size) {
          for (const text of failedKeys.current) requested.current.delete(text);
          failedKeys.current.clear();
          setFailed(new Set());
          if (enabled && visible.current.size) flush();
        }
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      logEvent('error', 'translate', `whole-book translation stopped: ${error instanceof Error ? error.message : String(error)}`);
      setPretranslate(previous => ({ ...previous, status: 'error', error: error instanceof Error ? error.message : String(error) }));
    });
  }, [tools, bookId, content, enabled, flush]);

  const pausePretranslate = useCallback(() => {
    pretranslateAbort.current?.abort();
    setPretranslate(previous => ({ ...previous, status: 'paused' }));
  }, []);

  useEffect(() => () => pretranslateAbort.current?.abort(), []);

  // One stable object for the memoised reader lines.
  const retryBundle = useMemo(() => ({ translations, failed, onRetry: retry }), [translations, failed, retry]);

  return { retryBundle, pretranslate, startPretranslate, pausePretranslate };
}
