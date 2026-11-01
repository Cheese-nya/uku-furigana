'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportOptions, ImportProgress, ImportStage } from '../utils/bookAssets';
import type { ParsedBookFile } from '../utils/bookImport';
import { isAbortError, toImportError, type ImportError } from '../utils/importErrors';
import {
  editFromPreview,
  type ImportDuplicateMode,
  type ImportEdit,
  type ImportPreview,
  type ImportReviewDecision,
  type ImportReviewState,
} from '../utils/importPreview';
import type { BookItem } from '../utils/libraryDatabase';

export type ImportItemStatus = 'pending' | 'parsing' | 'review' | 'importing' | 'done' | 'failed' | 'skipped' | 'cancelled';

export interface ImportQueueItem {
  id: string;
  file: File;
  status: ImportItemStatus;
  progress?: ImportProgress;
  error?: ImportError;
  parsed?: ParsedBookFile;
  fingerprint?: string;
  preview?: ImportPreview;
}

export interface ImportQueueProgress {
  index: number;
  total: number;
  fileName: string;
  stage: ImportStage;
  /** 0–100, or undefined while the stage cannot know its length. */
  percent?: number;
}

export interface ImportQueueSummary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  cancelled: number;
  failedNames: string[];
}

export interface ImportCommitArgs {
  itemId: string;
  parsed: ParsedBookFile;
  fingerprint: string;
  edit: ImportEdit;
  duplicate: BookItem | null;
  duplicateMode: ImportDuplicateMode;
  folderId: string | null;
}

export interface ImportQueueOptions {
  parse: (file: File, options?: ImportOptions) => Promise<ParsedBookFile>;
  fingerprint: (text: string) => Promise<string>;
  findDuplicate: (fingerprint: string) => BookItem | null;
  buildPreview: (file: File, parsed: ParsedBookFile, duplicate: BookItem | null, folderId: string | null) => ImportPreview;
  commit: (args: ImportCommitArgs) => Promise<BookItem>;
  onCommitted?: (book: BookItem, item: ImportQueueItem, single: boolean) => void;
  onFinished?: (summary: ImportQueueSummary) => void;
  /** Called as each parser stage advances, for the progress toast. */
  onProgress?: (progress: ImportQueueProgress) => void;
  /** Called when the sheet opens a review and when it closes; null means the queue resumed. */
  onReview?: (review: ImportReviewState | null) => void;
}

const newId = () => `import:${Math.random().toString(36).slice(2, 10)}`;

/**
 * Sequential import queue. A single file always stops at the preview; a batch imports normal files
 * directly and pauses only for duplicates or parse failures. Parsing is cancellable and reports
 * per-stage progress; a failed item can be retried without losing the rest of the queue.
 */
export function useImportQueue(options: ImportQueueOptions) {
  const [items, setItems] = useState<ImportQueueItem[]>([]);
  const [review, setReview] = useState<ImportReviewState | null>(null);
  const [progress, setProgress] = useState<ImportQueueProgress | null>(null);
  const [summary, setSummary] = useState<ImportQueueSummary | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; }, [options]);

  const itemsRef = useRef<ImportQueueItem[]>([]);
  const reviewRef = useRef<{ state: ImportReviewState; resolve: (decision: ImportReviewDecision) => void } | null>(null);
  const folderRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const runTokenRef = useRef(0);
  const lastProgressRef = useRef(new Map<string, string>());

  const replaceItems = useCallback((next: ImportQueueItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patchItem = useCallback((id: string, patch: Partial<ImportQueueItem>) => {
    setItems(previous => {
      const next = previous.map(item => (item.id === id ? { ...item, ...patch } : item));
      itemsRef.current = next;
      return next;
    });
  }, []);

  const waitReview = useCallback((state: ImportReviewState) => new Promise<ImportReviewDecision>(resolve => {
    reviewRef.current = { state, resolve };
    setReview(state);
    optionsRef.current.onReview?.(state);
  }), []);

  const resolveReview = useCallback((decision: ImportReviewDecision) => {
    const pending = reviewRef.current;
    if (!pending) return;
    reviewRef.current = null;
    setReview(null);
    optionsRef.current.onReview?.(null);
    pending.resolve(decision);
  }, []);

  const reportProgress = useCallback((
    id: string,
    index: number,
    total: number,
    fileName: string,
    next: ImportProgress,
  ) => {
    const percent = next.total && next.total > 0
      ? Math.round(Math.min(1, Math.max(0, next.current / next.total)) * 100)
      : undefined;
    // A 1000-page PDF reports every page; render at most once per 5% per stage.
    const bucket = `${next.stage}:${percent === undefined ? '' : Math.floor(percent / 5)}`;
    if (lastProgressRef.current.get(id) === bucket) return;
    lastProgressRef.current.set(id, bucket);
    patchItem(id, { progress: next });
    const state: ImportQueueProgress = { index, total, fileName, stage: next.stage, ...(percent !== undefined ? { percent } : {}) };
    setProgress(state);
    optionsRef.current.onProgress?.(state);
  }, [patchItem]);

  const markRemainingCancelled = useCallback((fromIndex: number) => {
    const next = itemsRef.current.map((item, index) => (
      index >= fromIndex && (item.status === 'pending' || item.status === 'parsing' || item.status === 'review')
        ? { ...item, status: 'cancelled' as const }
        : item
    ));
    replaceItems(next);
  }, [replaceItems]);

  const run = useCallback(async (token: number) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const total = itemsRef.current.length;
    const single = total === 1;
    const folderId = folderRef.current;
    let stopQueue = false;

    for (let index = 0; index < total && !stopQueue; index += 1) {
      if (token !== runTokenRef.current) return;
      const item = itemsRef.current[index];
      if (!item || item.status === 'done' || item.status === 'skipped' || item.status === 'cancelled') continue;
      if (controller.signal.aborted) {
        markRemainingCancelled(index);
        break;
      }

      patchItem(item.id, { status: 'parsing', error: undefined });

      // 1. Parse, retrying in place while the user supplies PDF passwords or asks to retry.
      let parsed: ParsedBookFile | null = null;
      let password: string | undefined;
      let skipItem = false;
      while (!parsed && !skipItem && !stopQueue) {
        try {
          parsed = await optionsRef.current.parse(item.file, {
            signal: controller.signal,
            ...(password !== undefined ? { password } : {}),
            onProgress: next => reportProgress(item.id, index + 1, total, item.file.name, next),
          });
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            patchItem(item.id, { status: 'cancelled' });
            markRemainingCancelled(index + 1);
            stopQueue = true;
            break;
          }
          const importError = toImportError(error);
          const passwordError = importError.code === 'password-required' || importError.code === 'password-wrong';
          patchItem(item.id, { status: 'review', error: importError });
          const decision = await waitReview({
            itemId: item.id,
            fileName: item.file.name,
            index: index + 1,
            total,
            single,
            preview: null,
            error: importError,
            ...(passwordError ? { wrongPassword: importError.code === 'password-wrong' } : {}),
          });
          if (decision.action === 'password' && passwordError) {
            password = decision.password;
            patchItem(item.id, { status: 'parsing' });
            continue;
          }
          if (decision.action === 'retry') {
            password = undefined;
            patchItem(item.id, { status: 'parsing' });
            continue;
          }
          if (decision.action === 'skip') {
            patchItem(item.id, { status: 'skipped' });
            skipItem = true;
            break;
          }
          if (decision.action === 'cancel') {
            controller.abort();
            patchItem(item.id, { status: 'cancelled' });
            markRemainingCancelled(index + 1);
            stopQueue = true;
            break;
          }
          patchItem(item.id, { status: 'failed', error: importError });
          skipItem = true;
          break;
        }
      }
      if (skipItem || stopQueue || !parsed) continue;

      // 2. Normalise and decide whether this file needs the preview (single files always do).
      let fingerprint: string;
      let duplicate: BookItem | null;
      let preview: ImportPreview;
      try {
        fingerprint = await optionsRef.current.fingerprint(parsed.content);
        duplicate = optionsRef.current.findDuplicate(fingerprint);
        preview = optionsRef.current.buildPreview(item.file, parsed, duplicate, folderId);
        patchItem(item.id, { parsed, fingerprint, preview });
      } catch (error) {
        patchItem(item.id, { status: 'failed', error: toImportError(error) });
        continue;
      }

      let edit = editFromPreview(preview);
      let duplicateMode: ImportDuplicateMode = 'keep-both';
      if (single || duplicate) {
        patchItem(item.id, { status: 'review' });
        const decision = await waitReview({
          itemId: item.id,
          fileName: item.file.name,
          index: index + 1,
          total,
          single,
          preview,
          error: null,
        });
        if (decision.action === 'cancel') {
          controller.abort();
          patchItem(item.id, { status: 'cancelled' });
          markRemainingCancelled(index + 1);
          break;
        }
        if (decision.action !== 'confirm') {
          patchItem(item.id, { status: 'skipped' });
          continue;
        }
        edit = decision.edit;
        duplicateMode = decision.duplicateMode;
      }

      // 3. Commit, letting a database failure be retried without reparsing.
      patchItem(item.id, { status: 'importing' });
      let committed = false;
      while (!committed && !stopQueue) {
        try {
          const book = await optionsRef.current.commit({
            itemId: item.id,
            parsed,
            fingerprint,
            edit,
            duplicate,
            duplicateMode,
            folderId,
          });
          patchItem(item.id, { status: 'done' });
          optionsRef.current.onCommitted?.(book, item, single);
          committed = true;
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            patchItem(item.id, { status: 'cancelled' });
            markRemainingCancelled(index + 1);
            stopQueue = true;
            break;
          }
          const importError = toImportError(error);
          patchItem(item.id, { status: 'review', error: importError });
          const decision = await waitReview({
            itemId: item.id,
            fileName: item.file.name,
            index: index + 1,
            total,
            single,
            preview,
            error: importError,
          });
          if (decision.action === 'retry') {
            patchItem(item.id, { status: 'importing' });
            continue;
          }
          if (decision.action === 'confirm') {
            edit = decision.edit;
            duplicateMode = decision.duplicateMode;
            patchItem(item.id, { status: 'importing' });
            continue;
          }
          if (decision.action === 'skip') {
            patchItem(item.id, { status: 'skipped' });
            committed = true;
            break;
          }
          patchItem(item.id, { status: 'failed', error: importError });
          if (decision.action === 'cancel') {
            controller.abort();
            markRemainingCancelled(index + 1);
            stopQueue = true;
          }
          committed = true;
        }
      }
    }

    if (token !== runTokenRef.current) return;
    const finalItems = itemsRef.current;
    const result: ImportQueueSummary = {
      total: finalItems.length,
      success: finalItems.filter(item => item.status === 'done').length,
      failed: finalItems.filter(item => item.status === 'failed').length,
      skipped: finalItems.filter(item => item.status === 'skipped').length,
      cancelled: finalItems.filter(item => item.status === 'cancelled').length,
      failedNames: finalItems.filter(item => item.status === 'failed').map(item => item.file.name),
    };
    runningRef.current = false;
    abortRef.current = null;
    setIsRunning(false);
    setProgress(null);
    setSummary(result);
    optionsRef.current.onFinished?.(result);
  }, [markRemainingCancelled, patchItem, reportProgress, waitReview]);

  const enqueue = useCallback((files: File[], folderId: string | null = null) => {
    if (runningRef.current || !files.length) return;
    const next: ImportQueueItem[] = files.map(file => ({ id: newId(), file, status: 'pending' }));
    folderRef.current = folderId;
    lastProgressRef.current.clear();
    runTokenRef.current += 1;
    runningRef.current = true;
    replaceItems(next);
    setReview(null);
    setSummary(null);
    setProgress(null);
    setIsRunning(true);
    void run(runTokenRef.current);
  }, [replaceItems, run]);

  const cancel = useCallback(() => {
    const pending = reviewRef.current;
    if (pending) {
      reviewRef.current = null;
      setReview(null);
      optionsRef.current.onReview?.(null);
      pending.resolve({ action: 'cancel' });
    }
    abortRef.current?.abort();
    if (!runningRef.current) {
      replaceItems(itemsRef.current.map(item => (
        item.status === 'done' || item.status === 'skipped' ? item : { ...item, status: 'cancelled' }
      )));
    }
  }, [replaceItems]);

  const retryFailed = useCallback(() => {
    if (runningRef.current) return;
    const failed = itemsRef.current.filter(item => item.status === 'failed');
    if (!failed.length) return;
    const next = itemsRef.current.map(item => (
      item.status === 'failed' ? { ...item, status: 'pending' as const, error: undefined, progress: undefined } : item
    ));
    lastProgressRef.current.clear();
    runTokenRef.current += 1;
    runningRef.current = true;
    replaceItems(next);
    setReview(null);
    setSummary(null);
    setProgress(null);
    setIsRunning(true);
    void run(runTokenRef.current);
  }, [replaceItems, run]);

  const dismissSummary = useCallback(() => setSummary(null), []);

  return {
    items, review, progress, summary, isRunning,
    enqueue, resolveReview, cancel, retryFailed, dismissSummary,
  };
}
