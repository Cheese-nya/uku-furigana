'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyReadingReviewResults, reviewReadings } from '../utils/aiReadingReview';
import { AnnotationClient, type EngineState } from '../utils/annotationClient';
import { sameAnnotationDocument } from '../utils/annotationSnapshot';
import type { AnnotationInput } from '../utils/annotationTask';
import { logEvent } from '../utils/appLog';
import type { ScriptLine } from '../utils/furigana';
import { llmNeedsApiKey, loadTranslationSettings } from '../utils/translation';

export function useFuriganaWorker(input: AnnotationInput) {
  const [engine, setEngine] = useState<EngineState>({ status: 'loading', mode: 'worker' });
  const clientRef = useRef<AnnotationClient | null>(null);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ input: AnnotationInput | null; revision: number; lines: ScriptLine[]; loadedCount: number; done: boolean; error: string }>({ input: null, revision: -1, lines: [], loadedCount: 0, done: false, error: '' });
  // Last finished result for the same document. A correction re-runs annotation, but the
  // workbench keeps showing this snapshot until the replacement is complete instead of
  // unmounting the page and snapping the reader back to the first line.
  const [stableSnapshot, setStableSnapshot] = useState<{ input: AnnotationInput; lines: ScriptLine[] } | null>(null);
  const stableRef = useRef(stableSnapshot);
  useEffect(() => {
    stableRef.current = stableSnapshot;
  }, [stableSnapshot]);

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

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const controller = new AbortController();
    const accumulated: ScriptLine[] = [];
    let loadedCount = 0;
    let rafId: number | null = null;

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
        for (let i = 0; i < chunk.lines.length; i++) {
          accumulated[chunk.offset + i] = chunk.lines[i];
        }
        loadedCount = Math.max(loadedCount, chunk.offset + chunk.lines.length);
        if (chunk.offset === 0) {
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
        if (settings.engine === 'llm' && settings.aiReadingReview && (settings.llm.apiKey.trim() || !llmNeedsApiKey(settings.llm))) {
          void reviewReadings(lines, settings.llm, controller.signal)
            .then(results => {
              if (controller.signal.aborted || results.length === 0) return;
              const nextLines = applyReadingReviewResults(lines, results, input.rubyType);
              setStableSnapshot(prevStable => (prevStable?.input === input ? { input, lines: nextLines } : prevStable));
              setSnapshot(previous => (previous.input === input && previous.revision === revision ? { ...previous, lines: nextLines } : previous));
            })
            .catch(err => {
              if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
              logEvent('warn', 'reading-review', err instanceof Error ? err.message : String(err));
            });
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
      controller.abort();
    };
  }, [revision, input]);

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
    annotate, analyze, retry: () => setRevision(value => value + 1) };
}
