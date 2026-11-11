import { formatRuby, katakanaToHiragana, type RubyType, type ScriptLine } from './furigana';
import type { LearnedReading } from './correctionDatabase';

export function normalizeReading(reading: string): string {
  return katakanaToHiragana(reading.normalize('NFKC').trim());
}

export function uniqueReadings(readings: string[]): string[] {
  const seen = new Set<string>();
  return readings.filter(reading => {
    const key = normalizeReading(reading);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Full clause around the occurrence. Do not collapse different meanings by word alone. */
export function readingContext(text: string, start: number, length: number) {
  const boundary = /[。！？!?\n\r「」『』：:]/u;
  let left = start;
  let right = start + length;
  while (left > 0 && !boundary.test(text[left - 1])) left--;
  while (right < text.length && !boundary.test(text[right])) right++;
  return { before: text.slice(left, start).trimStart(), after: text.slice(start + length, right).trimEnd() };
}

export interface ReviewSelection {
  lineId: string;
  lineText: string;
  tokenIndex: number;
  tokenEndIndex: number;
  start: number;
  surface: string;
  currentRuby: string;
  alternatives: string[];
}

/** Recover the original morphological word after ruby/okurigana splitting. */
export function selectReviewWord(line: ScriptLine, index: number): ReviewSelection {
  const token = line.tokens[index];
  const offsets: number[] = [];
  let offset = 0;
  for (const part of line.tokens) { offsets.push(offset); offset += part.surface.length; }
  const word = token.word;
  let tokenIndex = index;
  let tokenEndIndex = index;
  if (word) {
    const start = offsets[index] - word.offset;
    const end = start + word.surface.length;
    const first = offsets.indexOf(start);
    const last = line.tokens.findIndex((part, i) => offsets[i] + part.surface.length === end);
    // A higher-priority override may have split the original word. Respect its range.
    if (first >= 0 && last >= first && line.tokens.slice(first, last + 1).every(part =>
      part.word?.surface === word.surface && part.word.offset === offsets[line.tokens.indexOf(part)] - start)) {
      tokenIndex = first;
      tokenEndIndex = last;
    }
  }
  const parts = line.tokens.slice(tokenIndex, tokenEndIndex + 1);
  const surface = parts.map(part => part.surface).join('');
  const intactWord = word && surface === word.surface;
  const currentRuby = intactWord ? word.reading : parts.map(part => part.ruby || (part.hasKanji ? '' : part.surface)).join('');
  return { lineId: line.id, lineText: line.cleanText, tokenIndex, tokenEndIndex, start: offsets[tokenIndex], surface, currentRuby,
    alternatives: uniqueReadings([currentRuby, ...(intactWord ? word.alternatives : token.alternatives || [])]) };
}

export function needsReview(token: ScriptLine['tokens'][number]): boolean {
  if (!token.hasKanji || token.annotationSuppressed || ['manual', 'source', 'learned'].includes(token.readingSource || '')) return false;
  // An ambiguous imported name reading is a review item even when it came from a glossary.
  if (token.readingSource === 'glossary' && !token.alternatives?.length) return false;
  if (!token.ruby) return true;
  const candidates = token.word?.alternatives || token.alternatives;
  if (candidates) return uniqueReadings(candidates).length > 1;
  return Boolean(token.needsReview);
}

export interface ReviewGroup extends ReviewSelection {
  occurrences: ReviewSelection[];
}

export function collectReviewGroups(lines: ScriptLine[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();
  for (const line of lines) {
    const visited = new Set<number>();
    line.tokens.forEach((token, index) => {
      if (!needsReview(token)) return;
      const selection = selectReviewWord(line, index);
      if (visited.has(selection.start)) return;
      visited.add(selection.start);
      const context = readingContext(line.cleanText, selection.start, selection.surface.length);
      const key = JSON.stringify([selection.surface, context.before, context.after,
        normalizeReading(selection.currentRuby), selection.alternatives.map(normalizeReading).sort()]);
      const group = groups.get(key);
      if (group) group.occurrences.push(selection);
      else groups.set(key, { ...selection, occurrences: [selection] });
    });
  }
  return [...groups.values()];
}

export function makeLearnedReading(selection: ReviewSelection, reading: string, type: RubyType): LearnedReading {
  const context = readingContext(selection.lineText, selection.start, selection.surface.length);
  const roman = type === 'romaji' && /[a-z]/i.test(reading);
  return { surface: selection.surface, reading: roman ? reading.trim() : normalizeReading(reading),
    alternatives: selection.alternatives.map(normalizeReading), type: roman ? 'romaji' : 'hiragana',
    ...context, createdAt: Date.now() };
}

export function sameLearnedContext(a: LearnedReading, b: LearnedReading): boolean {
  return a.surface === b.surface && a.before === b.before && a.after === b.after;
}

/** Apply only at complete token boundaries; never rewrite another word containing the surface. */
export function learnedOverrides(line: ScriptLine, entries: LearnedReading[], type: RubyType) {
  const matches: Array<{ line: string; start: number; surface: string; reading: string; type: RubyType }> = [];
  const visited = new Set<number>();
  line.tokens.forEach((token, index) => {
    if (!token.hasKanji || ['source', 'manual', 'glossary'].includes(token.readingSource || '')) return;
    const selection = selectReviewWord(line, index);
    if (visited.has(selection.start)) return;
    visited.add(selection.start);
    const context = readingContext(line.cleanText, selection.start, selection.surface.length);
    const learned = entries.find(entry => entry.surface === selection.surface && entry.before === context.before && entry.after === context.after);
    if (learned) matches.push({ line: line.cleanText, start: selection.start, surface: selection.surface,
      reading: learned.type === 'romaji' ? learned.reading : formatRuby(learned.reading, type), type: learned.type === 'romaji' ? 'romaji' : type });
  });
  return matches;
}
