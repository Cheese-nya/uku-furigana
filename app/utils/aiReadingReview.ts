import { formatRuby, KANJI_REGEX, katakanaToHiragana, parseCompoundToTokens, type RubyType, type ScriptLine } from './furigana';
import { normalizeReading, selectReviewWord } from './review';
import { chat, cleanLlmReply, type LlmSettings } from './translation';

export interface ReadingReviewResult {
  lineIndex: number;
  tokenIndex: number;
  reading: string;
}

interface ReadingCandidate {
  id: string;
  sentence: string;
  word: string;
  options: string[];
  targets: Array<{ lineIndex: number; tokenIndex: number }>;
}

const MAX_CANDIDATES_PER_REQUEST = 30;

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

export async function reviewReadings(
  lines: ScriptLine[],
  llm: LlmSettings,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadingReviewResult[]> {
  const candidates: ReadingCandidate[] = [];
  const dedupMap = new Map<string, ReadingCandidate>();

  lines.forEach((line, lineIndex) => {
    const sentence = line.cleanText || line.rawText;
    const visitedStarts = new Set<number>();
    const perSentenceCounts = new Map<string, number>();

    line.tokens.forEach((token, tokenIndex) => {
      if (!token.needsReview || token.annotationSuppressed || token.readingSource !== 'automatic') return;

      const selection = selectReviewWord(line, tokenIndex);
      if (visitedStarts.has(selection.start)) return;
      visitedStarts.add(selection.start);

      const rawOptions = token.word?.alternatives ?? token.alternatives ?? selection.alternatives;
      const options: string[] = [];
      const seenOptions = new Set<string>();
      for (const alt of rawOptions) {
        const formatted = formatCandidateOption(alt);
        const normKey = normalizeReading(formatted);
        if (!formatted || seenOptions.has(normKey)) continue;
        seenOptions.add(normKey);
        options.push(formatted);
      }
      if (options.length <= 1) return;

      const baseSignature = `${selection.surface}\0${options.join('\0')}`;
      const occIndex = perSentenceCounts.get(baseSignature) ?? 0;
      perSentenceCounts.set(baseSignature, occIndex + 1);

      const dedupKey = `${sentence}\0${occIndex}\0${baseSignature}`;
      const existing = dedupMap.get(dedupKey);
      if (existing) {
        existing.targets.push({ lineIndex, tokenIndex: selection.tokenIndex });
      } else {
        const candidate: ReadingCandidate = {
          id: String(candidates.length),
          sentence,
          word: selection.surface,
          options,
          targets: [{ lineIndex, tokenIndex: selection.tokenIndex }],
        };
        dedupMap.set(dedupKey, candidate);
        candidates.push(candidate);
      }
    });
  });

  if (candidates.length === 0) return [];

  const url = `${llm.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const results: ReadingReviewResult[] = [];

  for (let offset = 0; offset < candidates.length; offset += MAX_CANDIDATES_PER_REQUEST) {
    if (signal?.aborted) break;
    const batch = candidates.slice(offset, offset + MAX_CANDIDATES_PER_REQUEST);
    const payload = batch.map(({ id, sentence, word, options }) => ({
      id,
      sentence,
      word,
      options,
    }));
    const messages = [
      {
        role: 'system',
        content:
          'You are a Japanese reading (furigana) expert. Given a JSON array of items with {id, sentence, word, options}, choose the single best reading from options for each word in its sentence context. Reply strictly with a JSON object mapping each id to the chosen option string (e.g. {"0": "..."}). Do not invent readings outside options.',
      },
      {
        role: 'user',
        content: JSON.stringify(payload),
      },
    ];

    let reply: string;
    try {
      reply = await chat(url, llm, messages, fetchImpl, signal);
    } catch (error) {
      if (results.length > 0 && !(error instanceof Error && error.name === 'AbortError')) break;
      throw error;
    }
    const parsed = parseReviewReply(reply);
    if (!parsed) continue;

    for (const item of batch) {
      const choice = parsed[item.id];
      if (typeof choice !== 'string') continue;
      const matched = matchChoice(choice, item.options);
      if (!matched) continue;
      for (const target of item.targets) {
        results.push({
          lineIndex: target.lineIndex,
          tokenIndex: target.tokenIndex,
          reading: matched,
        });
      }
    }
  }

  return results;
}

/**
 * Applies AI-selected full-word readings across whole morphological spans
 * (updating okurigana alignment, `token.word.reading`, and clearing `needsReview`).
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
      const replacement = isRomaji
        ? [{
            surface: selection.surface,
            ruby: formattedWordReading,
            hasKanji: KANJI_REGEX.test(selection.surface),
            readingSource: 'automatic' as const,
            needsReview: false,
            word: {
              surface: selection.surface,
              reading: formattedWordReading,
              alternatives: selection.alternatives,
              offset: 0,
            },
          }]
        : parseCompoundToTokens(selection.surface, reading, rubyType, selection.alternatives).map(tok => ({
            ...tok,
            readingSource: 'automatic' as const,
            needsReview: false,
          }));
      const spanLength = selection.tokenEndIndex - selection.tokenIndex + 1;
      nextTokens.splice(selection.tokenIndex, spanLength, ...replacement);
    }
    return { ...line, tokens: nextTokens };
  });
}
