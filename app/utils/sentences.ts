export interface Sentence {
  start: number;
  end: number;
  text: string;
}

// A sentence ends after a run of these (！？ / ……), so the run stays with the sentence.
const TERMINATORS = new Set(['。', '．', '！', '？', '!', '?', '…']);
const OPENERS = new Set(['「', '『', '（', '(', '【', '〈', '《', '“']);
const CLOSERS = new Set(['」', '』', '）', ')', '】', '〉', '》', '”']);

function isSpace(char: string): boolean {
  return /\s/.test(char);
}

/**
 * Split one line into sentences that tile it exactly: every `text` is `line.slice(start, end)`
 * and the concatenation gives the line back. Nothing splits inside brackets, so a quoted
 * question plus its reporting clause（「どうしたの？」と彼は言った。）stays one sentence, and
 * closing brackets or whitespace right after a terminator belong to the sentence they close.
 */
export function splitSentences(line: string): Sentence[] {
  if (!line.trim()) return [];
  const sentences: Sentence[] = [];
  let start = 0;
  let depth = 0;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (OPENERS.has(char)) {
      depth += 1;
      index += 1;
      continue;
    }
    if (CLOSERS.has(char)) {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth > 0 || !TERMINATORS.has(char)) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < line.length && TERMINATORS.has(line[end])) end += 1;
    while (end < line.length && (CLOSERS.has(line[end]) || isSpace(line[end]))) end += 1;
    sentences.push({ start, end, text: line.slice(start, end) });
    start = end;
    index = end;
  }
  // The remainder carries no terminator: it is a sentence only when it holds real text.
  if (start < line.length && line.slice(start).trim()) {
    sentences.push({ start, end: line.length, text: line.slice(start) });
  }
  return sentences;
}
