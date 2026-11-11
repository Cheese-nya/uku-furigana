'use client';

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { anchorDelta, fullyVisible, intersectsView, visibleParagraphRange, ReaderMotionGate, TranslationPublishQueue, type AnchorRect } from '../utils/readerTranslationAnchor';

export interface ReaderTranslationAnchor {
  prepareChange: () => void;
  /** Keep this guard in BOTH the scroll handler and its deferred progress/HUD callback. */
  isAdjusting: RefObject<boolean>;
  /** owner identifies a replaceable batch; cancel on book/settings changes and unmount. */
  schedulePublish: (owner: object, publish: () => void) => void;
  cancelPublish: (owner: object) => void;
}
interface Anchor { line: string; offset: number; rect: AnchorRect }

/** A base-text character range never includes <rt>, translated text, or speaker labels. */
function character(article: HTMLElement, line: string, offset: number): Range | null {
  const paragraph = article.querySelector<HTMLElement>(`[data-line="${line}"]`);
  if (!paragraph) return null;
  for (const piece of paragraph.querySelectorAll<HTMLElement>('[data-o]')) {
    const text = piece.firstChild;
    if (text?.nodeType !== Node.TEXT_NODE) continue;
    const local = offset - Number(piece.dataset.o);
    if (local < 0 || local >= (text.textContent?.length ?? 0)) continue;
    const range = document.createRange();
    range.setStart(text, local);
    // Do not split a supplementary Unicode character.
    range.setEnd(text, local + ((text.textContent!.codePointAt(local) ?? 0) > 0xffff ? 2 : 1));
    return range;
  }
  return null;
}

export function useReaderTranslationAnchor({ articleRef, scrollerRef, isVertical, resetKey, insetStart = 70, idleMs = 180 }: {
  articleRef: RefObject<HTMLElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  isVertical: boolean;
  /** Include book and rendered chapter identity. Changing this discards old coordinates; useBilingual cancels obsolete request batches. */
  resetKey: string | number;
  /** Area covered by the top chrome (right chrome in vertical mode), relative to the scroller. */
  insetStart?: number;
  idleMs?: number;
}): ReaderTranslationAnchor {
  const isAdjusting = useRef(false);
  const anchor = useRef<Anchor | null>(null);
  const pending = useRef(false);
  const queue = useRef(new TranslationPublishQueue());
  const gestureMotion = useRef(new ReaderMotionGate(idleMs));
  const anchorOwner = useRef(resetKey);
  const runtime = useRef<{ wake: () => void }>({ wake: () => {} });
  const capture = useCallback(() => {
    const article = articleRef.current;
    const scroller = isVertical ? article : scrollerRef.current;
    if (!article || !scroller) return null;
    const box = scroller.getBoundingClientRect();
    const view = { top: Math.max(0, box.top), bottom: Math.min(window.innerHeight, box.bottom), left: Math.max(0, box.left), right: Math.min(window.innerWidth, box.right) };
    if (isVertical) view.right -= insetStart; else view.top += insetStart;
    let fallback: Anchor | null = null;
    const paragraphs = article.querySelectorAll<HTMLElement>('[data-line]');
    const [from, to] = visibleParagraphRange(paragraphs.length, index => paragraphs[index].getBoundingClientRect(), view, isVertical);
    for (let index = from; index < to; index++) {
      const paragraph = paragraphs[index];
      if (!intersectsView(paragraph.getBoundingClientRect(), view)) continue;
      const line = paragraph.dataset.line!;
      for (const sentence of paragraph.querySelectorAll<HTMLElement>('[data-reader-sentence]')) {
        const rects = [...sentence.getClientRects()].filter(r => r.width > 0 && r.height > 0);
        if (!rects.some(r => intersectsView(r, view))) continue;
        const complete = fullyVisible(rects, view);
        for (const piece of sentence.querySelectorAll<HTMLElement>('[data-o]')) {
          if (!intersectsView(piece.getBoundingClientRect(), view)) continue;
          const value = piece.firstChild?.textContent ?? '';
          for (let local = 0; local < value.length;) {
            const offset = Number(piece.dataset.o) + local;
            const textNode = piece.firstChild;
            if (textNode?.nodeType !== Node.TEXT_NODE) break;
            const range = document.createRange();
            range.setStart(textNode, local);
            range.setEnd(textNode, local + ((value.codePointAt(local) ?? 0) > 0xffff ? 2 : 1));
            const rect = range.getBoundingClientRect();
            if (rect && intersectsView(rect, view)) {
              const candidate = { line, offset, rect };
              if (complete) return candidate;
              fallback ??= candidate;
              break;
            }
            local += (value.codePointAt(local) ?? 0) > 0xffff ? 2 : 1;
          }
          if (fallback && !complete) break;
        }
      }
    }
    return fallback;
  }, [articleRef, scrollerRef, isVertical, insetStart]);

  const prepareChange = useCallback(() => {
    anchor.current = capture();
    pending.current = anchor.current !== null;
  }, [capture]);
  const schedulePublish = useCallback((owner: object, publish: () => void) => {
    queue.current.enqueue(owner, publish);
    runtime.current.wake();
  }, []);
  const cancelPublish = useCallback((owner: object) => { queue.current.cancel(owner); }, []);
  const restore = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const article = articleRef.current;
    const scroller = isVertical ? article : scrollerRef.current;
    if (!article || !scroller) return;
    const publications = queue.current;
    const sameOwner = anchorOwner.current === resetKey;
    anchorOwner.current = resetKey;
    if (!sameOwner || !pending.current) {
      anchor.current = null;
      pending.current = false;
    }
    let disposed = false;
    // Layout reattachment is not the end of a held touch or momentum sequence.
    const motion = gestureMotion.current;
    motion.setQuietPeriod(idleMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let releaseFrame = 0;
    let releaseFrame2 = 0;
    let publishFrame = 0;
    const busy = () => motion.busy(performance.now());
    const release = () => {
      cancelAnimationFrame(releaseFrame);
      cancelAnimationFrame(releaseFrame2);
      releaseFrame = requestAnimationFrame(() => {
        releaseFrame2 = requestAnimationFrame(() => { isAdjusting.current = false; });
      });
    };
    const adjust = () => {
      if (disposed || (busy() && !pending.current)) return;
      const saved = anchor.current;
      const rect = saved && character(article, saved.line, saved.offset)?.getBoundingClientRect();
      if (saved && rect) {
        const delta = anchorDelta(saved.rect, rect, isVertical);
        if (Math.abs(delta) > .5) {
          isAdjusting.current = true;
          // Synchronous compensation, never smooth (including scroll-behavior inherited from CSS).
          scroller.scrollTo({ left: scroller.scrollLeft + (isVertical ? delta : 0), top: scroller.scrollTop + (isVertical ? 0 : delta), behavior: 'instant' });
          release();
        }
      }
      pending.current = false;
      anchor.current = capture();
    };
    restore.current = adjust;
    const wake = () => {
      if (disposed) return;
      clearTimeout(timer);
      cancelAnimationFrame(publishFrame);
      if (busy()) {
        timer = setTimeout(wake, idleMs);
        return;
      }
      publishFrame = requestAnimationFrame(() => {
        if (busy()) { wake(); return; }
        if (queue.current.size) {
          if (!pending.current) prepareChange();
          // One commit for all results accumulated during a gesture/momentum sequence.
          flushSync(() => queue.current.drain());
          adjust();
        } else if (pending.current) {
          adjust();
        } else {
          anchor.current = capture();
        }
      });
    };
    runtime.current = { wake };
    const moved = () => {
      if (isAdjusting.current) return;
      motion.move(performance.now());
      pending.current = false;
      anchor.current = capture();
      wake();
    };
    const input = () => { isAdjusting.current = false; moved(); };
    const touchStart = () => { motion.touchStart(performance.now()); input(); };
    const touchEnd = () => { if (motion.touchEnd(performance.now())) wake(); };
    const key = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) input();
    };
    scroller.addEventListener('scroll', moved, { passive: true });
    scroller.addEventListener('wheel', input, { passive: true });
    scroller.addEventListener('pointerdown', input, { passive: true });
    scroller.addEventListener('touchstart', touchStart, { passive: true });
    window.addEventListener('touchend', touchEnd, { passive: true });
    window.addEventListener('touchcancel', touchEnd, { passive: true });
    scroller.addEventListener('keydown', key);
    const previousOverflowAnchor = scroller.style.overflowAnchor;
    scroller.style.overflowAnchor = 'none';
    const observer = new ResizeObserver(() => {
      if (busy()) return;
      adjust();
    });
    // The vertical article itself has fixed dimensions; observe paragraphs as well.
    observer.observe(article);
    article.querySelectorAll('[data-line]').forEach(node => observer.observe(node));
    const mutation = new MutationObserver(() => {
      article.querySelectorAll('[data-line]').forEach(node => observer.observe(node));
    });
    mutation.observe(article, { childList: true, subtree: true });
    if (!pending.current) anchor.current = capture();
    if (publications.size || pending.current) wake();
    return () => {
      disposed = true;
      clearTimeout(timer);
      cancelAnimationFrame(publishFrame);
      cancelAnimationFrame(releaseFrame);
      cancelAnimationFrame(releaseFrame2);
      observer.disconnect();
      mutation.disconnect();
      scroller.style.overflowAnchor = previousOverflowAnchor;
      scroller.removeEventListener('scroll', moved);
      scroller.removeEventListener('wheel', input);
      scroller.removeEventListener('pointerdown', input);
      scroller.removeEventListener('touchstart', touchStart);
      window.removeEventListener('touchend', touchEnd);
      window.removeEventListener('touchcancel', touchEnd);
      scroller.removeEventListener('keydown', key);
      runtime.current = { wake: () => {} };
      restore.current = () => {};
      isAdjusting.current = false;
    };
  }, [articleRef, scrollerRef, isVertical, resetKey, capture, prepareChange, idleMs]);

  // Runs after the Panel's preference commit, before paint. Async publication also comes through here.
  useLayoutEffect(() => { if (pending.current) restore.current(); });
  return { prepareChange, isAdjusting, schedulePublish, cancelPublish };
}
