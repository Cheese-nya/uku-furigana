// Cross-checks the tokenizer's automatic readings against the bundled Jitendex dictionary.
// Kuromoji picks one reading and sometimes picks wrong (its lexicon is small); a reading the
// dictionary does not know is therefore worth a human look, and a word with several readings
// gets the others offered as alternatives without being flagged as suspicious.

import { brotliSibling, fetchCompressedBytes } from './compressedAsset';
import { readDictionaryAsset } from './dictionaryAssetCache';
import { katakanaToHiragana, type ScriptLine } from './furigana';

/** `term → readings`, commonest first. Built by tools/build-reading-table.mjs. */
export type ReadingTable = Map<string, string[]>;

const MAX_ALTERNATIVES = 5;

/** Readings as this module compares them: hiragana, no duplicates, order kept. */
function uniqueReadings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const reading = katakanaToHiragana(value.normalize('NFKC').trim());
    if (!reading || seen.has(reading)) continue;
    seen.add(reading);
    result.push(reading);
  }
  return result;
}

/**
 * Loads the reading table next to `basePath` (`${basePath}/readings.json.gz`). Throws on a
 * missing or malformed file; the caller decides whether that is fatal or only degraded.
 */
export async function loadReadingTable(basePath: string): Promise<ReadingTable> {
  const base = basePath.replace(/\/$/, '');
  const gzip = `${base}/readings.json.gz`;
  let bytes: ArrayBuffer | null = null;
  try {
    bytes = await readDictionaryAsset(base, 'readings.json.gz');
  } catch (error) {
    console.warn('读音对照表缓存读取失败，改用直接下载：', error);
  }
  const data: ArrayBuffer = bytes ?? await (async () => {
    try {
      const loaded = await fetchCompressedBytes({ brotli: brotliSibling(gzip), gzip });
      return loaded.buffer.slice(loaded.byteOffset, loaded.byteOffset + loaded.byteLength) as ArrayBuffer;
    } catch (error) {
      throw new Error(`注音对照表加载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  })();
  const text = new TextDecoder().decode(new Uint8Array(data));
  const table = JSON.parse(text) as Record<string, unknown>;
  const readings: ReadingTable = new Map();
  for (const [term, value] of Object.entries(table)) {
    if (!Array.isArray(value)) continue;
    readings.set(term, uniqueReadings(value.filter((reading): reading is string => typeof reading === 'string')));
  }
  return readings;
}

interface Verdict {
  needsReview: boolean;
  alternatives?: string[];
}

/**
 * Compares one reading with the table; null when the dictionary says nothing about the word.
 * At this stage the reading is canonical hiragana (the annotator annotates with 'hiragana').
 */
function verify(surface: string, reading: string, table: ReadingTable): Verdict | null {
  const dict = table.get(surface);
  if (!dict || !dict.length) return null;
  const current = katakanaToHiragana(reading.normalize('NFKC').trim());
  const alternatives = uniqueReadings([current, ...dict]).slice(0, MAX_ALTERNATIVES);
  // A reading the dictionary knows is never suspicious; it may still be one of several.
  if (dict.includes(current)) return dict.length > 1 ? { needsReview: false, alternatives } : null;
  return { needsReview: true, alternatives };
}

/**
 * Flags automatic readings the dictionary does not confirm and offers its alternatives.
 * Returns a new line; the input (and its tokens) is never mutated.
 */
export function checkLine(line: ScriptLine, table: ReadingTable): ScriptLine {
  const offsets: number[] = [];
  let offset = 0;
  for (const token of line.tokens) {
    offsets.push(offset);
    offset += token.surface.length;
  }
  // One verdict per word. A word split into 食 + べる carries mora slices rather than readings,
  // so only the word's own reading can be compared with the dictionary.
  const words = new Map<number, number[]>();
  line.tokens.forEach((token, index) => {
    const start = offsets[index] - (token.word?.offset ?? 0);
    const indices = words.get(start);
    if (indices) indices.push(index);
    else words.set(start, [index]);
  });

  const tokens = [...line.tokens];
  for (const indices of words.values()) {
    // Okurigana carry no reading of their own; the verdict is about the kanji tokens.
    const kanji = indices.filter(index => line.tokens[index].hasKanji);
    const anchor = kanji.length ? line.tokens[kanji[0]] : undefined;
    if (!anchor || !anchor.ruby || anchor.readingSource !== 'automatic') continue;
    if (kanji.some(index => line.tokens[index].annotationSuppressed)) continue;
    const verdict = verify(anchor.word?.surface ?? anchor.surface, anchor.word?.reading ?? anchor.ruby, table);
    if (!verdict) continue;
    for (const index of kanji) {
      const token = tokens[index];
      const standalone = !token.word || token.word.surface === token.surface;
      if (!verdict.needsReview) {
        // Only a valid reading with candidates has anything new to show.
        if (standalone && verdict.alternatives && !token.alternatives) tokens[index] = { ...token, alternatives: verdict.alternatives };
        continue;
      }
      // A flagged word passes the candidates on to the review queue, which reads them there.
      const word = token.word
        ? { ...token.word, alternatives: uniqueReadings([...(token.word.alternatives || []), ...(verdict.alternatives || [])]).slice(0, MAX_ALTERNATIVES) }
        : undefined;
      tokens[index] = { ...token, needsReview: true,
        ...(standalone && verdict.alternatives ? { alternatives: verdict.alternatives } : {}), ...(word ? { word } : {}) };
    }
  }
  return { ...line, tokens };
}
