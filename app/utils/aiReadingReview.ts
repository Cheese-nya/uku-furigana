import { formatRuby, KANJI_REGEX, katakanaToHiragana, parseCompoundToTokens, type RubyType, type ScriptLine } from './furigana';
import { normalizeReading, selectReviewWord } from './review';
import { chat, cleanLlmReply, type LlmSettings } from './translation';
import {
  computeAiReviewCacheKey,
  hashGlossaryForReview,
  readAiReviewCache,
  writeAiReviewCache,
  type AiReviewCacheEntry,
} from './aiReviewCache';

export interface ReadingReviewResult {
  lineIndex: number;
  tokenIndex: number;
  reading: string;
}

export interface AiReadingReviewOptions {
  /** Optional 0-based line slice `[start, end)` to review instead of the whole document. */
  lineRange?: { start: number; end: number };
  /** Proper noun glossary hints passed to the model so character/place readings stay consistent. */
  glossary?: Array<{ surface: string; reading: string }>;
  /** Include non-flagged words that carry multiple reading candidates. */
  includeMultiReading?: boolean;
  /** Also ask the model to infer kana readings for unread kanji words (`!token.ruby`). */
  includeUnread?: boolean;
  /** Include surrounding lines and mark target spans (`【...】`). */
  richContext?: boolean;
  /** Persistent IndexedDB/in-memory cache for unchanged contexts. */
  useCache?: boolean;
  onProgress?: (progress: { completed: number; total: number }) => void;
  onBatch?: (results: ReadingReviewResult[]) => void;
}

interface ReadingCandidate {
  id: string;
  mode: 'choose' | 'infer';
  prevSentence: string;
  sentence: string;
  markedSentence: string;
  nextSentence: string;
  word: string;
  options: string[];
  cacheKey: string;
  targets: Array<{ lineIndex: number; tokenIndex: number }>;
}

const DEFAULT_BATCH_SIZE = 30;
const RICH_BATCH_SIZE = 25;
const PURE_HIRAGANA_RE = /^[\u3041-\u3096ー]+$/;

function parseReviewReply(reply: string): Record<string, unknown> | null {
  const cleaned = cleanLlmReply(reply)
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function formatCandidateOption(value: string): string {
  const trimmed = value.normalize('NFKC').trim();
  return /[a-z]/i.test(trimmed) ? trimmed : katakanaToHiragana(trimmed);
}

function matchChoice(choice: string, options: string[]): string | undefined {
  if (options.includes(choice)) return choice;
  const normalized = normalizeReading(choice);
  return options.find(option => normalizeReading(option) === normalized);
}

export function isValidInferredReading(surface: string, rawReading: string): string | null {
  const normalized = katakanaToHiragana(rawReading.normalize('NFKC').trim());
  if (!normalized || !PURE_HIRAGANA_RE.test(normalized)) return null;
  if (normalized.length > surface.length * 6 + 4) return null;
  const leading = surface.match(/^[\u3041-\u3096]+/)?.[0];
  if (leading && (!normalized.startsWith(leading) || normalized.length <= leading.length)) return null;
  const trailing = surface.match(/[\u3041-\u3096]+$/)?.[0];
  if (trailing && (!normalized.endsWith(trailing) || normalized.length <= trailing.length)) return null;
  return normalized;
}

function adjacentContext(lines: ScriptLine[], lineIndex: number, delta: -1 | 1): string {
  for (let i = lineIndex + delta; i >= 0 && i < lines.length; i += delta) {
    const text = (lines[i]?.cleanText || lines[i]?.rawText || '').trim();
    if (!text) continue;
    return delta < 0 ? text.slice(-60) : text.slice(0, 60);
  }
  return '';
}

function buildMarkedSentence(sentence: string, start: number, length: number): string {
  if (start < 0 || start + length > sentence.length) return sentence;
  return `${sentence.slice(0, start)}【${sentence.slice(start, start + length)}】${sentence.slice(start + length)}`;
}

function buildSystemPrompt(
  hasInfer: boolean,
  glossary?: Array<{ surface: string; reading: string }>,
): string {
  const base = hasInfer
    ? 'You are a Japanese reading (furigana) expert. Given a JSON array of items, target spans marked by 【...】 with optional prev/next context, return a JSON object mapping each id to its exact reading. When "options" is provided, choose one string strictly from "options". When "mode" is "infer" (or no options), return the natural contextual reading in pure hiragana (preserving leading/trailing okurigana). Reply strictly with a JSON object (e.g. {"0": "..."}).'
    : 'You are a Japanese reading (furigana) expert. Given a JSON array of items with {id, sentence, word, options}, choose the single best reading from options for each word in its sentence context. Reply strictly with a JSON object mapping each id to the chosen option string (e.g. {"0": "..."}). Do not invent readings outside options.';
  if (!glossary || glossary.length === 0) return base;
  const hints = glossary
    .slice(0, 80)
    .map(entry => `${entry.surface}=${entry.reading}`)
    .join(', ');
  return `${base}\nPreferred glossary readings: ${hints}`;
}

function fanoutResults(candidate: ReadingCandidate, reading: string): ReadingReviewResult[] {
  return candidate.targets.map(target => ({
    lineIndex: target.lineIndex,
    tokenIndex: target.tokenIndex,
    reading,
  }));
}

export async function reviewReadings(
  lines: ScriptLine[],
  llm: LlmSettings,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  options?: AiReadingReviewOptions,
): Promise<ReadingReviewResult[]> {
  const candidates: ReadingCandidate[] = [];
  const dedupMap = new Map<string, ReadingCandidate>();
  const includeMulti = Boolean(options?.includeMultiReading);
  const includeUnread = Boolean(options?.includeUnread);
  const useRich = Boolean(
    options?.richContext || includeMulti || includeUnread || options?.glossary?.length,
  );
  const useCache = Boolean(options?.useCache);
  const glossaryHash = hashGlossaryForReview(options?.glossary);

  const rangeStart = Math.max(0, options?.lineRange?.start ?? 0);
  const rangeEnd = Math.min(lines.length, options?.lineRange?.end ?? lines.length);

  for (let lineIndex = rangeStart; lineIndex < rangeEnd; lineIndex++) {
    const line = lines[lineIndex];
    if (!line) continue;
    const sentence = line.cleanText || line.rawText;
    const prevSentence = useRich ? adjacentContext(lines, lineIndex, -1) : '';
    const nextSentence = useRich ? adjacentContext(lines, lineIndex, 1) : '';
    const visitedStarts = new Set<number>();
    const perSentenceCounts = new Map<string, number>();

    line.tokens.forEach((token, tokenIndex) => {
      if (token.annotationSuppressed) return;
      if (token.readingSource && token.readingSource !== 'automatic') return;

      const rawOptions = token.word?.alternatives ?? token.alternatives ?? [];
      const isUnread = includeUnread && token.hasKanji && !token.ruby;
      const isMulti = includeMulti && rawOptions.length > 1;
      const eligible = Boolean(token.needsReview) || isMulti || isUnread;
      if (!eligible) return;

      const selection = selectReviewWord(line, tokenIndex);
      if (visitedStarts.has(selection.start)) return;
      visitedStarts.add(selection.start);

      const candidateOptions: string[] = [];
      const seenOptions = new Set<string>();
      for (const alt of rawOptions.length ? rawOptions : selection.alternatives) {
        const formatted = formatCandidateOption(alt);
        const normKey = normalizeReading(formatted);
        if (!formatted || seenOptions.has(normKey)) continue;
        seenOptions.add(normKey);
        candidateOptions.push(formatted);
      }

      let mode: 'choose' | 'infer';
      if (candidateOptions.length > 1) {
        mode = 'choose';
      } else if (isUnread) {
        mode = 'infer';
      } else {
        return;
      }

      const baseSignature = `${mode}\0${selection.surface}\0${candidateOptions.join('\0')}`;
      const occIndex = perSentenceCounts.get(baseSignature) ?? 0;
      perSentenceCounts.set(baseSignature, occIndex + 1);

      const dedupKey = `${prevSentence}\0${sentence}\0${nextSentence}\0${occIndex}\0${baseSignature}`;
      const existing = dedupMap.get(dedupKey);
      if (existing) {
        existing.targets.push({ lineIndex, tokenIndex: selection.tokenIndex });
        return;
      }

      const markedSentence = buildMarkedSentence(sentence, selection.start, selection.surface.length);
      const cacheKey = computeAiReviewCacheKey({
        model: llm.model || '',
        surface: selection.surface,
        prevSentence,
        sentence,
        nextSentence,
        mode,
        optionsKey: candidateOptions.join(','),
        glossaryHash,
      });

      const candidate: ReadingCandidate = {
        id: String(candidates.length),
        mode,
        prevSentence,
        sentence,
        markedSentence,
        nextSentence,
        word: selection.surface,
        options: mode === 'choose' ? candidateOptions : [],
        cacheKey,
        targets: [{ lineIndex, tokenIndex: selection.tokenIndex }],
      };
      dedupMap.set(dedupKey, candidate);
      candidates.push(candidate);
    });
  }

  if (candidates.length === 0) {
    options?.onProgress?.({ completed: 0, total: 0 });
    return [];
  }

  const results: ReadingReviewResult[] = [];
  const totalCandidates = candidates.length;
  let completedCandidates = 0;
  let pending: ReadingCandidate[] = candidates;

  if (useCache) {
    const cached = await readAiReviewCache(candidates.map(c => c.cacheKey));
    if (cached.size > 0) {
      const cacheBatchResults: ReadingReviewResult[] = [];
      const remaining: ReadingCandidate[] = [];
      for (const candidate of candidates) {
        const hit = cached.get(candidate.cacheKey);
        if (hit) {
          const valid = candidate.mode === 'choose'
            ? matchChoice(hit, candidate.options)
            : isValidInferredReading(candidate.word, hit);
          if (valid) {
            const expanded = fanoutResults(candidate, valid);
            results.push(...expanded);
            cacheBatchResults.push(...expanded);
            completedCandidates += 1;
            continue;
          }
        }
        remaining.push(candidate);
      }
      pending = remaining;
      if (cacheBatchResults.length > 0) {
        options?.onBatch?.(cacheBatchResults);
      }
      options?.onProgress?.({ completed: completedCandidates, total: totalCandidates });
    }
  }

  if (pending.length === 0) return results;

  const batchSize = useRich ? RICH_BATCH_SIZE : DEFAULT_BATCH_SIZE;
  const batches: ReadingCandidate[][] = [];
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    batches.push(pending.slice(offset, offset + batchSize));
  }

  const url = `${llm.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const hasInfer = pending.some(item => item.mode === 'infer');
  const systemPrompt = buildSystemPrompt(hasInfer, options?.glossary);

  const runBatch = async (batch: ReadingCandidate[]): Promise<boolean> => {
    if (signal?.aborted) return false;
    const payload = batch.map(item => (
      useRich
        ? {
            id: item.id,
            ...(item.prevSentence ? { prev: item.prevSentence } : {}),
            sentence: item.markedSentence,
            ...(item.nextSentence ? { next: item.nextSentence } : {}),
            word: item.word,
            ...(item.mode === 'infer' ? { mode: 'infer' as const } : { options: item.options }),
          }
        : {
            id: item.id,
            sentence: item.sentence,
            word: item.word,
            options: item.options,
          }
    ));

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(payload) },
    ];

    const reply = await chat(url, llm, messages, fetchImpl, signal);
    const parsed = parseReviewReply(reply);
    const batchResults: ReadingReviewResult[] = [];
    const newCacheEntries: AiReviewCacheEntry[] = [];
    const now = Date.now();

    if (parsed) {
      for (const item of batch) {
        const rawChoice = parsed[item.id];
        if (typeof rawChoice !== 'string') continue;
        const resolved = item.mode === 'choose'
          ? matchChoice(rawChoice, item.options)
          : isValidInferredReading(item.word, rawChoice);
        if (!resolved) continue;
        batchResults.push(...fanoutResults(item, resolved));
        if (useCache) {
          newCacheEntries.push({ key: item.cacheKey, reading: resolved, updatedAt: now });
        }
      }
    }

    if (newCacheEntries.length > 0) {
      void writeAiReviewCache(newCacheEntries);
    }
    if (batchResults.length > 0) {
      results.push(...batchResults);
      options?.onBatch?.(batchResults);
    }
    completedCandidates += batch.length;
    options?.onProgress?.({ completed: Math.min(completedCandidates, totalCandidates), total: totalCandidates });
    return true;
  };

  if (!useRich || batches.length === 1) {
    for (const batch of batches) {
      if (signal?.aborted) break;
      try {
        await runBatch(batch);
      } catch (error) {
        if (results.length > 0 && !(error instanceof Error && error.name === 'AbortError')) break;
        throw error;
      }
    }
    return results;
  }

  let nextBatchIndex = 0;
  let firstError: unknown = null;
  let succeededBatches = 0;
  const concurrency = Math.min(2, batches.length);

  const worker = async () => {
    while (!signal?.aborted) {
      const idx = nextBatchIndex++;
      if (idx >= batches.length) break;
      try {
        const ok = await runBatch(batches[idx]);
        if (ok) succeededBatches += 1;
      } catch (error) {
        if (!firstError) firstError = error;
        if (error instanceof Error && error.name === 'AbortError') break;
        if (succeededBatches === 0 && results.length === 0) break;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (firstError && succeededBatches === 0 && results.length === 0) {
    throw firstError;
  }

  return results;
}

/**
 * Applies AI-selected full-word readings across whole morphological spans
 * (updating okurigana alignment, `token.word.reading`, marking `readingSource: 'ai'`,
 * and clearing `needsReview`).
 */
export function applyReadingReviewResults(
  lines: ScriptLine[],
  results: ReadingReviewResult[],
  rubyType: RubyType,
): ScriptLine[] {
  if (results.length === 0) return lines;
  const byLine = new Map<number, ReadingReviewResult[]>();
  for (const item of results) {
    let list = byLine.get(item.lineIndex);
    if (!list) byLine.set(item.lineIndex, (list = []));
    list.push(item);
  }

  return lines.map((line, lineIndex) => {
    const lineResults = byLine.get(lineIndex);
    if (!lineResults || lineResults.length === 0) return line;
    const nextTokens = [...line.tokens];
    // Apply from right to left so token counts changing inside a word never shift earlier indices.
    const ordered = [...lineResults].sort((a, b) => b.tokenIndex - a.tokenIndex);
    for (const { tokenIndex, reading } of ordered) {
      const anchor = nextTokens[tokenIndex];
      if (!anchor) continue;
      const selection = selectReviewWord({ ...line, tokens: nextTokens }, tokenIndex);
      const isRomaji = rubyType === 'romaji' && /[a-z]/i.test(reading);
      const formattedWordReading = isRomaji ? reading.trim() : formatRuby(reading, rubyType);
      const mergedAlts = Array.from(
        new Set([formattedWordReading, ...selection.alternatives].filter(Boolean)),
      );
      const replacement = isRomaji
        ? [{
            surface: selection.surface,
            ruby: formattedWordReading,
            hasKanji: KANJI_REGEX.test(selection.surface),
            readingSource: 'ai' as const,
            needsReview: false,
            word: {
              surface: selection.surface,
              reading: formattedWordReading,
              alternatives: mergedAlts,
              offset: 0,
            },
          }]
        : parseCompoundToTokens(selection.surface, reading, rubyType, mergedAlts).map(tok => ({
            ...tok,
            readingSource: 'ai' as const,
            needsReview: false,
          }));
      const spanLength = selection.tokenEndIndex - selection.tokenIndex + 1;
      nextTokens.splice(selection.tokenIndex, spanLength, ...replacement);
    }
    return { ...line, tokens: nextTokens };
  });
}
