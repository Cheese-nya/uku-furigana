import { katakanaToHiragana, type ScriptLine } from './furigana';
import { chat, cleanLlmReply, type LlmSettings } from './translation';

export interface ReadingReviewResult {
  lineIndex: number;
  tokenIndex: number;
  reading: string;
}

interface ReadingCandidate {
  id: string;
  lineIndex: number;
  tokenIndex: number;
  sentence: string;
  word: string;
  options: string[];
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

export async function reviewReadings(
  lines: ScriptLine[],
  llm: LlmSettings,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Array<{ lineIndex: number; tokenIndex: number; reading: string }>> {
  const candidates: ReadingCandidate[] = [];
  lines.forEach((line, lineIndex) => {
    const sentence = line.cleanText || line.rawText;
    line.tokens.forEach((token, tokenIndex) => {
      if (
        token.needsReview &&
        Array.isArray(token.alternatives) &&
        token.alternatives.length > 1 &&
        token.readingSource === 'automatic'
      ) {
        const options = token.alternatives.map(alt => katakanaToHiragana(alt));
        candidates.push({
          id: String(candidates.length),
          lineIndex,
          tokenIndex,
          sentence,
          word: token.surface,
          options,
        });
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

    const reply = await chat(url, llm, messages, fetchImpl, signal);
    const parsed = parseReviewReply(reply);
    if (!parsed) continue;

    for (const item of batch) {
      const choice = parsed[item.id];
      if (typeof choice === 'string' && item.options.includes(choice)) {
        results.push({
          lineIndex: item.lineIndex,
          tokenIndex: item.tokenIndex,
          reading: choice,
        });
      }
    }
  }

  return results;
}
