'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyReadingReviewResults, reviewReadings } from '../utils/aiReadingReview';
import { AnnotationClient, type EngineState } from '../utils/annotationClient';
import { sameAnnotationDocument } from '../utils/annotationSnapshot';
import type { AnnotationInput } from '../utils/annotationTask';
import { logEvent } from '../utils/appLog';
import type { ScriptLine } from '../utils/furigana';
import { plainScriptLines } from '../utils/plainScript';
import { llmNeedsApiKey, loadTranslationSettings } from '../utils/translation';

export interface AiReviewState {
  status: 'idle' | 'running' | 'done' | 'error';
  completed: number;
  total: number;
  error: string;
}

export interface UseFuriganaWorkerOptions {
  aiLineRange?: { start: number; end: number };
  skipAutoAi?: boolean;
}

export function useFuriganaWorker(input: AnnotationInput, options?: UseFuriganaWorkerOptions) {
  const [engine, setEngine] = useState<EngineState>({ status: 'loading', mode: 'worker' });
  const clientRef = useRef<AnnotationClient | null>(null);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ input: AnnotationInput | null; revision: number; lines: ScriptLine[]; loadedCount: number; done: boolean; error: string }>({ input: null, revision: -1, lines: [], loadedCount: 0, done: false, error: '' });
  const [aiReview, setAiReview] = useState<AiReviewState>({ status: 'idle', completed: 0, total: 0, error: '' });
  const aiAbortRef = useRef<AbortController | null>(null);
  // Last finished result for the same document. A correction re-runs annotation, but the
  // workbench keeps showing this snapshot until the replacement is complete instead of
  // unmounting the page and snapping the reader back to the first line.
  const [stableSnapshot, setStableSnapshot] = useState<{ input: AnnotationInput; lines: ScriptLine[] } | null>(null);
  const stableRef = useRef(stableSnapshot);
  useEffect(() => {
    stableRef.current = stableSnapshot;
  }, [stableSnapshot]);

  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const totalLines = useMemo(() => {
    let count = 1;
    for (let i = 0; i < input.text.length; i++) {
      if (input.text.charCodeAt(i) === 10) count++;
    }
    return count;
  }, [input.text]);

  useEffect(() => {
    // Kuromoji joins paths with path.join; URL schemes would lose a slash.
    const path = new URL('./dict', window.location.href.split('?')[0]).pathname;
    let active = true;
    const instance = new AnnotationClient(path, state => {
      queueMicrotask(() => { if (active) setEngine(state); });
    });
    clientRef.current = instance;
    return () => { active = false; clientRef.current = null; instance.dispose(); };
  }, [revision]);

  const runAiReview = useCallback((
    baseLines: ScriptLine[],
    taskInput: AnnotationInput,
    taskRevision: number,
    lineRange?: { start: number; end: number },
    parentSignal?: AbortSignal,
  ) => {
    const settings = loadTranslationSettings();
    const canCall = Boolean(settings.llm.apiKey.trim()) || !llmNeedsApiKey(settings.llm);
    if (!canCall || baseLines.length === 0) return;

    aiAbortRef.current?.abort();
    const aiController = new AbortController();
    aiAbortRef.current = aiController;
    const abortListener = () => aiController.abort();
    parentSignal?.addEventListener('abort', abortListener, { once: true });

    let latestLines = baseLines;
    setAiReview({ status: 'running', completed: 0, total: 0, error: '' });

    void reviewReadings(baseLines, settings.llm, aiController.signal, fetch, {
      lineRange,
      glossary: taskInput.glossary,
      includeMultiReading: true,
      includeUnread: true,
      richContext: true,
      useCache: true,
      onProgress: ({ completed, total }) => {
        if (aiController.signal.aborted) return;
        setAiReview({ status: 'running', completed, total, error: '' });
      },
      onBatch: batchResults => {
        if (aiController.signal.aborted || batchResults.length === 0) return;
        latestLines = applyReadingReviewResults(latestLines, batchResults, taskInput.rubyType);
        const applied = latestLines;
        setStableSnapshot(prevStable => (prevStable?.input === taskInput ? { input: taskInput, lines: applied } : prevStable));
        setSnapshot(previous => (previous.input === taskInput && previous.revision === taskRevision ? { ...previous, lines: applied } : previous));
      },
    })
      .then(() => {
        if (aiController.signal.aborted) return;
        setAiReview(prev => ({ status: 'done', completed: prev.total || prev.completed, total: prev.total, error: '' }));
      })
      .catch(err => {
        if (aiController.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        const message = err instanceof Error ? err.message : String(err);
        logEvent('warn', 'reading-review', message);
        setAiReview(prev => ({ ...prev, status: 'error', error: message }));
      })
      .finally(() => {
        parentSignal?.removeEventListener('abort', abortListener);
      });
  }, []);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const controller = new AbortController();
    const accumulated: ScriptLine[] = [];
    let prefilled = false;
    let loadedCount = 0;
    let rafId: number | null = null;
    setAiReview({ status: 'idle', completed: 0, total: 0, error: '' });

    const flushChunk = () => {
      rafId = null;
      if (controller.signal.aborted) return;
      const hasRetained = Boolean(stableRef.current && sameAnnotationDocument(stableRef.current.input, input) && stableRef.current.lines.length > 0);
      setSnapshot({
        input,
        revision,
        lines: hasRetained ? [] : accumulated.slice(),
        loadedCount,
        done: false,
        error: '',
      });
    };

    // Debounce typing; cancellation filters queued chunks before they reach React.
    const timer = setTimeout(() => {
      client.annotate(input, chunk => {
        if (controller.signal.aborted) return;
        if (!prefilled && chunk.offset > 0) {
          prefilled = true;
          const plain = plainScriptLines(input.text);
          for (let i = 0; i < plain.length; i++) {
            if (!accumulated[i]) accumulated[i] = plain[i];
          }
        }
        for (let i = 0; i < chunk.lines.length; i++) {
          accumulated[chunk.offset + i] = chunk.lines[i];
        }
        loadedCount += chunk.lines.length;
        if (chunk.offset === 0 || loadedCount === chunk.lines.length) {
          flushChunk();
        } else if (rafId === null) {
          rafId = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame(flushChunk)
            : (setTimeout(flushChunk, 16) as unknown as number);
        }
      }, controller.signal).then(lines => {
        if (rafId !== null) {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
          else clearTimeout(rafId);
          rafId = null;
        }
        if (controller.signal.aborted) return;
        setStableSnapshot({ input, lines });
        setSnapshot({ input, revision, lines, loadedCount: lines.length, done: true, error: '' });
        const settings = loadTranslationSettings();
        if (!optionsRef.current?.skipAutoAi && settings.aiReadingReview) {
          runAiReview(lines, input, revision, optionsRef.current?.aiLineRange, controller.signal);
        }
      }).catch(error => {
        if (rafId !== null) {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
          else clearTimeout(rafId);
          rafId = null;
        }
        if (!controller.signal.aborted) setSnapshot({ input, revision, lines: [], loadedCount: 0, done: true, error: String(error) });
      });
    }, 120);
    return () => {
      clearTimeout(timer);
      if (rafId !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
        else clearTimeout(rafId);
      }
      aiAbortRef.current?.abort();
      controller.abort();
    };
  }, [revision, input, runAiReview]);

  const annotate = useCallback((task: AnnotationInput, signal?: AbortSignal) => {
    const client = clientRef.current;
    if (!client) return Promise.reject(new Error('注音引擎尚未就绪'));
    return client.annotate(task, undefined, signal);
  }, []);

  const analyze = useCallback((text: string) => {
    const client = clientRef.current;
    if (!client) return Promise.reject(new Error('注音引擎尚未就绪'));
    return client.analyze(text);
  }, []);

  const triggerAiReview = useCallback((lineRange?: { start: number; end: number }) => {
    const curSnap = snapshotRef.current;
    const curInput = inputRef.current;
    const baseLines = curSnap.input === curInput && curSnap.lines.length > 0
      ? curSnap.lines
      : (stableRef.current && sameAnnotationDocument(stableRef.current.input, curInput) ? stableRef.current.lines : []);
    if (baseLines.length === 0) return;
    runAiReview(baseLines, curInput, revision, lineRange);
  }, [revision, runAiReview]);

  const cancelAiReview = useCallback(() => {
    aiAbortRef.current?.abort();
    setAiReview(prev => (prev.status === 'running' ? { ...prev, status: 'idle' } : prev));
  }, []);

  const current = snapshot.input === input && snapshot.revision === revision;
  const retained = stableSnapshot && sameAnnotationDocument(stableSnapshot.input, input) ? stableSnapshot.lines : [];
  // Once a same-document snapshot exists, keep showing all of it while the replacement streams
  // in. Exposing the new run's first 50-line chunk would shrink the page list and throw the
  // reader back to the first page until the rest arrived.
  // Keep it too if the replacement run fails: clearing the preview on a transient worker error
  // would recreate the jump-to-top this hook prevents.
  const showSnapshot = current && !snapshot.error && (snapshot.done || retained.length === 0);
  const lines = showSnapshot ? snapshot.lines : retained;
  const busy = !current || !snapshot.done;
  const progressCount = current ? snapshot.loadedCount : 0;
  return { lines, busy, engine, error: current ? snapshot.error : '',
    progress: busy ? Math.min(99, Math.round(progressCount / Math.max(1, totalLines) * 100)) : 100,
    aiReview, triggerAiReview, cancelAiReview,
    annotate, analyze, retry: () => setRevision(value => value + 1) };
}
