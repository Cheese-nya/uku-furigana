'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { startAutoReading, startTimedReading } from '../utils/autoReading';
import { pageDestination, type PageDirection } from '../utils/readerNavigation';
import type { ReaderPrefs } from '../utils/readerPreferences';

type NativeBridge = { setReaderVolumeKeysEnabled?: (enabled: boolean) => void };
function nativeBridge(): NativeBridge | undefined {
  return (window as Window & { AndroidBridge?: NativeBridge }).AndroidBridge;
}

export function useReaderNavigation(options: {
  bookId: string | null;
  chapter: number;
  chapterCount: number;
  ready: boolean;
  suspended: boolean;
  prefs: ReaderPrefs;
  scrollerRef: RefObject<HTMLDivElement | null>;
  articleRef: RefObject<HTMLElement | null>;
  isAdjusting: () => boolean;
  prepareMotion: () => void;
  goToChapter: (chapter: number, edge?: 'start' | 'end') => void;
  reveal: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const nativeAvailable = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => typeof nativeBridge()?.setReaderVolumeKeysEnabled === 'function',
    () => false,
  );
  const [previousBookId, setPreviousBookId] = useState(options.bookId);
  if (previousBookId !== options.bookId) {
    setPreviousBookId(options.bookId);
    setRunning(false);
  }
  const [foreground, setForeground] = useState(true);
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const turning = useRef(false);
  const motionFrame = useRef<number | null>(null);
  const finishMotion = useRef<((moved: boolean) => void) | null>(null);
  const pause = useCallback(() => setRunning(false), []);

  useEffect(() => {
    const update = () => {
      const editing = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') || window.getSelection()?.toString();
      setBlocked(Boolean(document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [aria-modal="true"]:not([aria-hidden="true"])') || editing));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'hidden'] });
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    document.addEventListener('selectionchange', update);
    return () => { observer.disconnect(); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update); document.removeEventListener('selectionchange', update); };
  }, []);

  const cancelMotion = useCallback(() => {
    if (motionFrame.current !== null) cancelAnimationFrame(motionFrame.current);
    motionFrame.current = null;
    turning.current = false;
    finishMotion.current?.(false);
    finishMotion.current = null;
  }, []);

  useEffect(() => {
    const update = () => {
      const active = !document.hidden && document.hasFocus();
      setForeground(active);
      if (!active) { pause(); cancelMotion(); nativeBridge()?.setReaderVolumeKeysEnabled?.(false); }
    };
    const nativeFocus = (event: Event) => {
      const active = Boolean((event as CustomEvent).detail?.active) && !document.hidden;
      setForeground(active);
      if (!active) { pause(); cancelMotion(); }
    };
    update();
    window.addEventListener('uku-reader-native-focus', nativeFocus);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => { window.removeEventListener('uku-reader-native-focus', nativeFocus); document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); window.removeEventListener('blur', update); };
  }, [pause, cancelMotion]);

  useEffect(() => {
    cancelMotion();
    return cancelMotion;
  }, [options.bookId, cancelMotion]);

  const suspended = options.suspended || blocked || !foreground || !options.ready;
  const turnPage = useCallback((direction: PageDirection, manual = true): Promise<boolean> => {
    if (manual) pause();
    const current = latest.current;
    if (!current.ready || current.suspended || turning.current || document.hidden ||
        document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [aria-modal="true"]:not([aria-hidden="true"])') || window.getSelection()?.toString()) return Promise.resolve(false);
    const vertical = current.prefs.writingMode === 'vertical';
    const node = vertical ? current.articleRef.current : current.scrollerRef.current;
    if (!node || current.isAdjusting()) return Promise.resolve(false);
    const position = vertical ? Math.abs(node.scrollLeft) : node.scrollTop;
    const maximum = Math.max(0, vertical ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight);
    const destination = pageDestination(position, maximum, vertical ? node.clientWidth : node.clientHeight, direction);
    const chapter = current.chapter + direction;
    if (destination.crossChapter && (chapter < 0 || chapter >= current.chapterCount)) return Promise.resolve(false);
    current.prepareMotion();
    if (manual) current.reveal();
    turning.current = true;
    if (destination.crossChapter) current.goToChapter(chapter, direction === 1 ? 'start' : 'end');
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200;
    return new Promise(resolve => {
      finishMotion.current = resolve;
      let start: number | null = null;
      const tick = (time: number) => {
        start ??= time;
        const progress = duration === 0 ? 1 : Math.min(1, (time - start) / duration);
        if (destination.crossChapter) {
          // content-visibility estimates change as the destination chapter is revealed.
          // Follow its boundary throughout the transition instead of retaining the first estimate.
          const end = direction === -1;
          if (vertical) node.scrollLeft = end ? -(node.scrollWidth - node.clientWidth) : 0;
          else node.scrollTop = end ? node.scrollHeight - node.clientHeight : 0;
        } else {
          const value = position + (destination.position - position) * (1 - Math.pow(1 - progress, 3));
          if (vertical) node.scrollLeft = -value;
          else node.scrollTop = value;
        }
        if (progress < 1) motionFrame.current = requestAnimationFrame(tick);
        else {
          turning.current = false;
          motionFrame.current = null;
          finishMotion.current = null;
          resolve(true);
        }
      };
      motionFrame.current = requestAnimationFrame(tick);
    });
  }, [pause]);

  useEffect(() => {
    const enabled = nativeAvailable && options.prefs.volumePageTurn && Boolean(options.bookId) && !suspended;
    nativeBridge()?.setReaderVolumeKeysEnabled?.(enabled);
    const listener = (event: Event) => {
      if (!enabled) return;
      const direction = (event as CustomEvent).detail?.direction;
      if (direction === 'previous' || direction === 'next') void turnPage(direction === 'next' ? 1 : -1);
    };
    window.addEventListener('uku-reader-page-turn', listener);
    return () => {
      nativeBridge()?.setReaderVolumeKeysEnabled?.(false);
      window.removeEventListener('uku-reader-page-turn', listener);
    };
  }, [nativeAvailable, options.prefs.volumePageTurn, options.bookId, suspended, turnPage]);

  useEffect(() => {
    if (!running || suspended || !options.bookId) return;
    const current = latest.current;
    const vertical = current.prefs.writingMode === 'vertical';
    const node = vertical ? current.articleRef.current : current.scrollerRef.current;
    if (!node) return;
    const isPaused = () => turning.current || latest.current.isAdjusting();
    const onEnd = () => { setRunning(false); latest.current.reveal(); };
    const scheduler = {
      requestFrame: (callback: (time: number) => void) => requestAnimationFrame(callback),
      cancelFrame: (id: number) => cancelAnimationFrame(id),
    };
    if (current.prefs.autoMode === 'page') return startTimedReading({
      ...scheduler, intervalSeconds: current.prefs.autoInterval, isPaused,
      turnPage: () => turnPage(1, false), onEnd,
    });
    let cancelled = false;
    const stop = startAutoReading({
      ...scheduler,
      getPosition: () => vertical ? Math.abs(node.scrollLeft) : node.scrollTop,
      getMaximum: () => vertical ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight,
      setPosition: position => {
        latest.current.prepareMotion();
        if (vertical) node.scrollLeft = -position;
        else node.scrollTop = position;
      },
      pixelsPerSecond: current.prefs.autoSpeed, isPaused,
      onEnd: () => { void turnPage(1, false).then(moved => { if (!cancelled && !moved) onEnd(); }); },
    });
    return () => { cancelled = true; stop(); };
  }, [running, suspended, options.bookId, options.chapter, options.prefs.autoMode, options.prefs.autoSpeed,
    options.prefs.autoInterval, options.prefs.writingMode, turnPage]);

  return {
    running, state: running ? suspended ? 'suspended' : 'running' : 'stopped',
    pause, turnPage, nativeAvailable, blocked,
    toggle: () => {
      if (!running) latest.current.prepareMotion();
      setRunning(value => !value);
      latest.current.reveal();
    },
  };
}
