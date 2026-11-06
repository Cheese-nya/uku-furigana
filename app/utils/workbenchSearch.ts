import { katakanaToHiragana, type ScriptLine, type Token } from './furigana';

export type WorkbenchSearchMode = 'text' | 'reading';

export interface WorkbenchSearchHit {
  id: string;
  lineIndex: number;
  lineId: string;
  start: number;
  end: number;
  surface: string;
  reading: string;
  tokenIndex: number;
  tokenEndIndex: number;
  /** The hit covers only part of a larger token (e.g. 人 inside 人生). */
  insideLongerToken: boolean;
  mode: WorkbenchSearchMode;
}

function tokenOffsets(tokens: Token[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const token of tokens) {
    offsets.push(offset);
    offset += token.surface.length;
  }
  return offsets;
}

function tokensAt(tokens: Token[], offsets: number[], start: number, end: number) {
  let first = -1;
  let last = -1;
  for (let index = 0; index < tokens.length; index++) {
    const tokenStart = offsets[index];
    const tokenEnd = tokenStart + tokens[index].surface.length;
    if (tokenEnd <= start || tokenStart >= end) continue;
    if (first < 0) first = index;
    last = index;
  }
  return { first, last };
}

export function normalizeSearchReading(value: string): string {
  return katakanaToHiragana(value.normalize('NFKC').trim());
}

/**
 * Literal, document-wide search used by the workbench. Text matches may fall inside a longer
 * token; the hit keeps the exact character range so editing it cannot silently rewrite the
 * whole word. Reading search is hiragana/katakana insensitive.
 */
export function searchWorkbench(
  lines: ScriptLine[],
  query: string,
  mode: WorkbenchSearchMode,
): WorkbenchSearchHit[] {
  const needle = query.normalize('NFKC');
  if (!needle) return [];
  const readingNeedle = normalizeSearchReading(needle);
  const hits: WorkbenchSearchHit[] = [];

  lines.forEach((line, lineIndex) => {
    const offsets = tokenOffsets(line.tokens);
    if (mode === 'reading') {
      if (!readingNeedle) return;
      line.tokens.forEach((token, tokenIndex) => {
        if (!token.ruby || normalizeSearchReading(token.ruby) !== readingNeedle) return;
        const start = offsets[tokenIndex];
        const end = start + token.surface.length;
        hits.push({
          id: `${lineIndex}:${start}:${end}:reading`,
          lineIndex,
          lineId: line.id,
          start,
          end,
          surface: token.surface,
          reading: token.ruby,
          tokenIndex,
          tokenEndIndex: tokenIndex,
          insideLongerToken: false,
          mode,
        });
      });
      return;
    }

    for (let at = line.cleanText.indexOf(needle); at >= 0; at = line.cleanText.indexOf(needle, at + 1)) {
      const end = at + needle.length;
      const { first, last } = tokensAt(line.tokens, offsets, at, end);
      if (first < 0) continue;
      const tokenStart = offsets[first];
      const tokenEnd = offsets[last] + line.tokens[last].surface.length;
      const exactSingleToken = first === last && tokenStart === at && tokenEnd === end;
      const reading = exactSingleToken ? line.tokens[first].ruby || '' : '';
      hits.push({
        id: `${lineIndex}:${at}:${end}:text`,
        lineIndex,
        lineId: line.id,
        start: at,
        end,
        surface: line.cleanText.slice(at, end),
        reading,
        tokenIndex: first,
        tokenEndIndex: last,
        insideLongerToken: tokenStart < at || tokenEnd > end,
        mode,
      });
    }
  });
  return hits;
}

/** Index of the first hit strictly after (direction 1) or before (direction -1) the cursor. */
export function nextSearchHit(hits: WorkbenchSearchHit[], currentId: string | null, direction: 1 | -1): number {
  if (!hits.length) return -1;
  if (!currentId) return direction === 1 ? 0 : hits.length - 1;
  const index = hits.findIndex(hit => hit.id === currentId);
  if (index < 0) return direction === 1 ? 0 : hits.length - 1;
  return (index + direction + hits.length) % hits.length;
}

export interface SearchTarget {
  line: string;
  lineOccurrence: number;
  start: number;
  surface: string;
}

/** Translate visual hits into correction targets, preserving duplicate-line occurrence. */
export function searchHitTarget(line: ScriptLine, hit: WorkbenchSearchHit, lineOccurrence: number): SearchTarget {
  return { line: line.cleanText, lineOccurrence, start: hit.start, surface: line.cleanText.slice(hit.start, hit.end) };
}
