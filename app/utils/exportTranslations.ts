import { IMAGE_LINE } from './bookAssets';
import type { ScriptLine } from './furigana';
import { splitSentences } from './sentences';
import {
  llmNeedsApiKey,
  needsTranslation,
  translationCacheKey,
  TranslationError,
  Translator,
  usableCachedTranslation,
  type TranslationGlossaryEntry,
  type TranslationSettings,
  type TranslationTarget,
} from './translation';
import { defaultTranslationStore, type TranslationCache } from './translationStore';

export type ExportMissingPolicy = 'translate-missing' | 'cached-only';

export interface ExportTranslationPrefs {
  enabled: boolean;
  missingPolicy: ExportMissingPolicy;
}

export const DEFAULT_EXPORT_TRANSLATION_PREFS: ExportTranslationPrefs = {
  enabled: false,
  missingPolicy: 'translate-missing',
};

const EXPORT_PREFS_KEY = 'uku-export-translation-prefs-v1';
const TRANSLATE_CHUNK_SIZE = 120;
const CONTEXT_LINES = 3;
const SCENE_DIVIDER = /^[-—─―=*~・\s]{2,}$/;

function createAbortError(): Error {
  if (typeof DOMException === 'function') return new DOMException('导出已取消', 'AbortError');
  const error = new Error('导出已取消');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError');
}

export function validateExportTranslationPrefs(value: unknown): ExportTranslationPrefs {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Partial<ExportTranslationPrefs>;
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_EXPORT_TRANSLATION_PREFS.enabled,
    missingPolicy: source.missingPolicy === 'cached-only' ? 'cached-only' : 'translate-missing',
  };
}

export function loadExportTranslationPrefs(): ExportTranslationPrefs {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(EXPORT_PREFS_KEY);
    return raw ? validateExportTranslationPrefs(JSON.parse(raw)) : { ...DEFAULT_EXPORT_TRANSLATION_PREFS };
  } catch {
    return { ...DEFAULT_EXPORT_TRANSLATION_PREFS };
  }
}

export function saveExportTranslationPrefs(prefs: ExportTranslationPrefs): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(
      EXPORT_PREFS_KEY,
      JSON.stringify(validateExportTranslationPrefs(prefs)),
    );
  } catch {
    // Ignore storage errors so export continues smoothly.
  }
}

export function exportLineSourceText(line: ScriptLine): string {
  if (line.rawText) return line.rawText;
  const body = line.tokens.map(token => token.surface).join('');
  return line.speaker ? `${line.speaker}：${body}` : body;
}

export function isExportSkippableLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (IMAGE_LINE.test(trimmed)) return true;
  if (SCENE_DIVIDER.test(trimmed)) return true;
  return !needsTranslation(trimmed);
}

/** Splits an export line identically to the Reader (`splitSentences`), so cache keys match 1:1. */
export function extractLineSentences(line: ScriptLine): string[] {
  const raw = exportLineSourceText(line);
  if (isExportSkippableLine(raw)) return [];
  return splitSentences(raw)
    .map(sentence => sentence.text)
    .filter(needsTranslation);
}

export function joinSentenceTranslations(
  sentences: readonly string[],
  map: ReadonlyMap<string, string>,
  target: TranslationTarget,
): string | undefined {
  if (sentences.length === 0) return undefined;
  const parts: string[] = [];
  for (const sentence of sentences) {
    const translated = map.get(sentence)?.trim();
    if (translated) parts.push(translated);
  }
  if (parts.length === 0) return undefined;
  if (target === 'en') {
    return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
  }
  return parts.join('').trim();
}

export interface ExportTranslationSummary {
  totalSentences: number;
  cachedSentences: number;
  missingSentences: number;
}

export async function countCachedExportTranslations(
  lines: readonly ScriptLine[],
  options: {
    bookId: string;
    settings: TranslationSettings;
    store?: TranslationCache;
  },
): Promise<ExportTranslationSummary> {
  const allSentences = lines.flatMap(extractLineSentences);
  if (allSentences.length === 0) {
    return { totalSentences: 0, cachedSentences: 0, missingSentences: 0 };
  }
  const store = options.store ?? defaultTranslationStore();
  const slot = translationCacheKey(options.settings);
  const cached = await store.get(options.bookId, slot, allSentences);
  let cachedSentences = 0;
  for (const sentence of allSentences) {
    const raw = cached.get(sentence);
    if (raw !== undefined && usableCachedTranslation(options.settings.engine, raw) !== undefined) {
      cachedSentences += 1;
    }
  }
  return {
    totalSentences: allSentences.length,
    cachedSentences,
    missingSentences: allSentences.length - cachedSentences,
  };
}

export interface ExportTranslationProgress {
  done: number;
  total: number;
  cached: number;
  translated: number;
}

export interface ResolveExportTranslationsOptions {
  bookId: string;
  missingPolicy: ExportMissingPolicy;
  settings: TranslationSettings;
  glossary?: TranslationGlossaryEntry[];
  store?: TranslationCache;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (progress: ExportTranslationProgress) => void;
}

export interface ResolveExportTranslationsResult {
  translations: (string | undefined)[];
  totalSentences: number;
  cachedCount: number;
  translatedCount: number;
  missingCount: number;
  failedError?: string;
}

/**
 * Resolve line-by-line translations aligned 1:1 with `lines`.
 * Always reads existing Reader translations from `TranslationStore` first; when `missingPolicy`
 * is `'translate-missing'`, automatically translates uncached sentences and writes them back.
 */
export async function resolveExportTranslations(
  lines: readonly ScriptLine[],
  options: ResolveExportTranslationsOptions,
): Promise<ResolveExportTranslationsResult> {
  if (options.signal?.aborted) throw createAbortError();

  const perLineSentences = lines.map(extractLineSentences);
  const allSentences = perLineSentences.flat();
  const totalSentences = allSentences.length;

  if (totalSentences === 0) {
    options.onProgress?.({ done: 0, total: 0, cached: 0, translated: 0 });
    return {
      translations: lines.map(() => undefined),
      totalSentences: 0,
      cachedCount: 0,
      translatedCount: 0,
      missingCount: 0,
    };
  }

  const store = options.store ?? defaultTranslationStore();
  const slot = translationCacheKey(options.settings);
  const uniqueSentences = [...new Set(allSentences)];
  const cachedRaw = await store.get(options.bookId, slot, uniqueSentences);
  if (options.signal?.aborted) throw createAbortError();

  const resolvedMap = new Map<string, string>();
  for (const sentence of uniqueSentences) {
    const raw = cachedRaw.get(sentence);
    if (raw === undefined) continue;
    const usable = usableCachedTranslation(options.settings.engine, raw);
    if (usable !== undefined) resolvedMap.set(sentence, usable);
  }

  const countDone = () => allSentences.reduce((sum, s) => sum + (resolvedMap.has(s) ? 1 : 0), 0);
  const cachedCount = countDone();
  options.onProgress?.({
    done: cachedCount,
    total: totalSentences,
    cached: cachedCount,
    translated: 0,
  });

  let failedError: string | undefined;

  if (options.missingPolicy === 'translate-missing' && cachedCount < totalSentences) {
    if (
      options.settings.engine === 'llm' &&
      !options.settings.llm.apiKey.trim() &&
      llmNeedsApiKey(options.settings.llm)
    ) {
      throw new TranslationError('请先在设置里填写 API Key', false);
    }

    const translator = new Translator({
      store,
      settings: () => options.settings,
      fetchImpl: options.fetchImpl,
      glossary: options.glossary ? () => options.glossary! : undefined,
    });

    const reportProgress = () => {
      const done = countDone();
      options.onProgress?.({
        done,
        total: totalSentences,
        cached: cachedCount,
        translated: Math.max(0, done - cachedCount),
      });
    };

    let prevContext: string[] = [];
    for (let start = 0; start < totalSentences; start += TRANSLATE_CHUNK_SIZE) {
      if (options.signal?.aborted) throw createAbortError();
      const chunk = allSentences.slice(start, start + TRANSLATE_CHUNK_SIZE);
      const hasUncached = chunk.some(sentence => !resolvedMap.has(sentence));
      if (!hasUncached) {
        prevContext = chunk.slice(-CONTEXT_LINES);
        continue;
      }

      try {
        const chunkResult = await translator.translate(options.bookId, chunk, options.signal, {
          background: true,
          context: prevContext,
          onPartial: (found) => {
            let changed = false;
            found.forEach((value, key) => {
              if (!resolvedMap.has(key) && value.trim()) {
                resolvedMap.set(key, value);
                changed = true;
              }
            });
            if (changed) reportProgress();
          },
        });
        if (options.signal?.aborted) throw createAbortError();
        chunkResult.forEach((value, key) => {
          if (value.trim()) resolvedMap.set(key, value);
        });
        reportProgress();
        prevContext = chunk.slice(-CONTEXT_LINES);
      } catch (error) {
        if (isAbortError(error, options.signal)) throw error;
        failedError = error instanceof Error ? error.message : String(error);
        // If nothing at all has succeeded/cached, surface the error directly instead of exporting empty translations.
        if (resolvedMap.size === 0) throw error;
        break;
      }
    }
  }

  const finalDone = countDone();
  const translatedCount = Math.max(0, finalDone - cachedCount);
  const missingCount = Math.max(0, totalSentences - finalDone);
  const translations = perLineSentences.map(sentences =>
    joinSentenceTranslations(sentences, resolvedMap, options.settings.target),
  );

  return {
    translations,
    totalSentences,
    cachedCount,
    translatedCount,
    missingCount,
    ...(failedError ? { failedError } : {}),
  };
}
