'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { reviewReadings } from '../utils/aiReadingReview';
import { AnnotationClient, type EngineState } from '../utils/annotationClient';
import type { AnnotationInput } from '../utils/annotationTask';
import { logEvent } from '../utils/appLog';
import { formatRuby, type ScriptLine } from '../utils/furigana';
import { loadTranslationSettings } from '../utils/translation';

export function useFuriganaWorker(input: AnnotationInput) {
  const [engine, setEngine] = useState<EngineState>({ status: 'loading', mode: 'worker' });
  const clientRef = useRef<AnnotationClient | null>(null);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ input: AnnotationInput | null; revision: number; lines: ScriptLine[]; done: boolean; error: string }>({ input: null, revision: -1, lines: [], done: false, error: '' });
  // Last finished result for the same document. A correction re-runs annotation, but the
  // workbench keeps showing this snapshot until the replacement is complete instead of
  // unmounting the page and snapping the reader back to the first line.
  const [stableSnapshot, setStableSnapshot] = useState<{ input: AnnotationInput; lines: ScriptLine[] } | null>(null);

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
    // Debounce typing; cancellation filters queued chunks before they reach React.
    const timer = setTimeout(() => {
      client.annotate(input, chunk => {
        if (controller.signal.aborted) return;
        setSnapshot(previous => {
          const lines = previous.input === input && previous.revision === revision ? [...previous.lines] : [];
          lines.splice(chunk.offset, chunk.lines.length, ...chunk.lines);
          return { input, revision, lines, done: false, error: '' };
        });
      }, controller.signal).then(lines => {
        if (controller.signal.aborted) return;
        setStableSnapshot({ input, lines });
        setSnapshot({ input, revision, lines, done: true, error: '' });
        const settings = loadTranslationSettings();
        if (settings.engine === 'llm' && settings.aiReadingReview && settings.llm.apiKey.trim()) {
          void reviewReadings(lines, settings.llm, controller.signal)
            .then(results => {
              if (controller.signal.aborted || results.length === 0) return;
              setSnapshot(previous => {
                if (previous.input !== input || previous.revision !== revision) return previous;
                const nextLines = previous.lines.map(line => ({
                  ...line,
                  tokens: line.tokens.map(token => ({ ...token })),
                }));
                for (const { lineIndex, tokenIndex, reading } of results) {
                  const token = nextLines[lineIndex]?.tokens[tokenIndex];
                  if (!token) continue;
                  token.ruby = formatRuby(reading, input.rubyType);
                  token.needsReview = false;
                }
                return { ...previous, lines: nextLines };
              });
            })
            .catch(err => {
              if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
              logEvent('warn', 'reading-review', err instanceof Error ? err.message : String(err));
            });
        }
      }).catch(error => {
        if (!controller.signal.aborted) setSnapshot({ input, revision, lines: [], done: true, error: String(error) });
      });
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
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
  const sameDocument = (left: AnnotationInput, right: AnnotationInput) =>
    left.text === right.text && (left.documentId || '') === (right.documentId || '');
  const retained = stableSnapshot && sameDocument(stableSnapshot.input, input) ? stableSnapshot.lines : [];
  // Once a same-document snapshot exists, keep showing all of it while the replacement streams
  // in. Exposing the new run's first 50-line chunk would shrink the page list and throw the
  // reader back to the first page until the rest arrived.
  // Keep it too if the replacement run fails: clearing the preview on a transient worker error
  // would recreate the jump-to-top this hook prevents.
  const showSnapshot = current && !snapshot.error && (snapshot.done || retained.length === 0);
  const lines = showSnapshot ? snapshot.lines : retained;
  const busy = !current || !snapshot.done;
  return { lines, busy, engine, error: current ? snapshot.error : '',
    progress: busy ? Math.round(lines.length / Math.max(1, input.text.split('\n').length) * 100) : 100,
    annotate, analyze, retry: () => setRevision(value => value + 1) };
}
