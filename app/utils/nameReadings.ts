import {
  formatRuby,
  katakanaToHiragana,
  KANJI_REGEX,
  HETERONYM_READINGS,
  type ReadingSource,
  type RubyType,
  type ScriptLine,
} from './furigana';
import { glossaryOverrides } from './glossary';
import type { ProperNounEntry } from './correctionDatabase';
import { applyRubyOverrides, type RubyOverride } from './rubyOverrides';
import type { ReadingTable } from './readingCheck';

/** Stored shape of one imported Yomitan dictionary's contribution to ruby annotation. */
export interface SavedNameReadingRow {
  surface: string;
  reading: string;
  score: number;
  alternatives: string[];
  rubyType?: RubyType;
}

export interface SavedReadingRow {
  surface: string;
  readings: string[];
}

export interface ImportedNameDictionary {
  id: string;
  title: string;
  revision: string;
  names: SavedNameReadingRow[];
  readings: SavedReadingRow[];
  updatedAt: number;
}

export interface ImportedReadingData {
  nameTable: NameReadingTable;
  readingTable: ReadingTable;
  revision: string;
  count: number;
}

export interface NameReadingEntry {
  key: string;
  surface: string;
  reading: string;
  alternatives: string[];
  score: number;
  priority: number;
  rubyType: RubyType;
}

export type NameReadingTable = Map<string, NameReadingEntry> & { revision: string };

interface SkeletonChar {
  char: string;
  start: number;
  end: number;
}

interface Skeleton {
  text: string;
  chars: SkeletonChar[];
}

interface Segment {
  start: number;
  end: number;
  text: string;
  key: string;
}

interface NameOverride extends RubyOverride {
  alternatives?: string[];
}

interface NameMatch {
  start: number;
  end: number;
  key: string;
  entry: NameReadingEntry;
  readingSegments: string[];
  segments: Segment[];
}

const BUILTIN_PRIORITY = 100;
const IMPORTED_PRIORITY = 10;
const GLOSSARY_PRIORITY = 1000;
const READING_SEPARATOR = /[\s\u30FB]+/u;
const KANA_READING = /^[\u3041-\u3096\u30A1-\u30FA\u30FC\u309D\u309E\u30FB\s]+$/u;
const ROMAJI_READING = /^[A-Za-z\u0100-\u024F\u3041-\u3096\u30A1-\u30FA\u30FC\s'.-]+$/u;
const COMMON_SURFACES = new Set([...Object.keys(HETERONYM_READINGS), '人気', '何で', '何時']);

/** User-supplied reading for the reported name; parts let spaced forms keep separate ruby. */
const BUILTIN_NAME_READINGS: SavedNameReadingRow[] = [
  { surface: '峰岸美丘', reading: 'みねぎし　みおか', score: 1000, alternatives: [] },
  { surface: '峰岸', reading: 'みねぎし', score: 900, alternatives: [] },
  { surface: '美丘', reading: 'みおか', score: 900, alternatives: [] },
];

let builtinTable: NameReadingTable | null = null;

/**
 * NFKC skeleton for matching, with UTF-16 offsets back into the original string. Every
 * non-whitespace code point is retained; spaces are skipped so half-width, full-width and
 * repeated spaces do not break a name or word in two.
 */
export function nameReadingSkeleton(text: string): Skeleton {
  const chars: SkeletonChar[] = [];
  let offset = 0;
  for (const codePoint of text) {
    const end = offset + codePoint.length;
    for (const char of codePoint.normalize('NFKC')) {
      if (/\s/u.test(char)) continue;
      chars.push({ char, start: offset, end });
    }
    offset = end;
  }
  return { text: chars.map(value => value.char).join(''), chars };
}

export function normalizeNameKey(surface: string): string {
  return nameReadingSkeleton(surface).text;
}

export function normalizeNameReading(reading: string, rubyType: RubyType = 'hiragana'): string {
  const normalized = reading.normalize('NFKC').replace(/\u30FB/gu, ' ').trim();
  return rubyType === 'romaji' ? normalized : katakanaToHiragana(normalized);
}

export function isValidNameReading(reading: string, rubyType: RubyType = 'hiragana'): boolean {
  if (!reading.trim() || reading.includes('\n')) return false;
  return rubyType === 'romaji' ? ROMAJI_READING.test(reading) : KANA_READING.test(reading);
}

export function splitNameReadingSegments(reading: string): string[] {
  return reading.split(READING_SEPARATOR).map(value => value.trim()).filter(Boolean);
}

function compactReading(reading: string): string {
  return splitNameReadingSegments(reading).join('');
}

function uniqueByCompact(readings: string[]): string[] {
  const seen = new Set<string>();
  return readings.filter(reading => {
    const key = compactReading(reading);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeTable(revision: string): NameReadingTable {
  return Object.assign(new Map<string, NameReadingEntry>(), { revision });
}

function addNameReading(table: NameReadingTable, row: SavedNameReadingRow, priority: number): void {
  const key = normalizeNameKey(row.surface);
  if (key.length < 2 || !KANJI_REGEX.test(key) || COMMON_SURFACES.has(key)) return;
  const rubyType = row.rubyType || 'hiragana';
  const reading = normalizeNameReading(row.reading, rubyType);
  if (!isValidNameReading(reading, rubyType)) return;
  const alternatives = uniqueByCompact((row.alternatives || [])
    .map(value => normalizeNameReading(value, rubyType))
    .filter(value => isValidNameReading(value, rubyType)))
    .filter(value => compactReading(value) !== compactReading(reading));
  const score = Number.isFinite(row.score) ? row.score : 0;
  const existing = table.get(key);
  if (!existing) {
    table.set(key, { key, surface: row.surface, reading, alternatives, score, priority, rubyType });
    return;
  }
  if (priority > existing.priority || (priority === existing.priority && score > existing.score)) {
    table.set(key, { key, surface: row.surface, reading, score, priority, rubyType,
      alternatives: uniqueByCompact([existing.reading, ...existing.alternatives, ...alternatives])
        .filter(value => compactReading(value) !== compactReading(reading)) });
    return;
  }
  if (priority >= existing.priority) {
    existing.alternatives = uniqueByCompact([...existing.alternatives, reading, ...alternatives])
      .filter(value => compactReading(value) !== compactReading(existing.reading));
  }
}

/** Built-in and imported readings share one table; higher priority wins and supplies alternatives. */
export function buildNameReadingTable(rows: SavedNameReadingRow[] = [], revision = 'builtin'): NameReadingTable {
  const table = makeTable(revision);
  for (const row of BUILTIN_NAME_READINGS) addNameReading(table, row, BUILTIN_PRIORITY);
  for (const row of rows) addNameReading(table, row, IMPORTED_PRIORITY);
  return table;
}

export function builtInNameReadingTable(): NameReadingTable {
  if (!builtinTable) builtinTable = buildNameReadingTable();
  return builtinTable;
}

/** Imported general-dictionary readings join, rather than replace, the bundled cross-check table. */
export function mergeReadingTables(base: ReadingTable | null, imported: ReadingTable | null): ReadingTable {
  const merged: ReadingTable = new Map(base || []);
  for (const [surface, readings] of imported || []) {
    const normalized = normalizeNameKey(surface);
    if (COMMON_SURFACES.has(normalized)) continue;
    const existing = merged.get(surface) || [];
    const values = uniqueByCompact([...readings, ...existing].map(value => normalizeNameReading(value)));
    if (values.length) merged.set(surface, values);
    if (normalized && normalized !== surface && !merged.has(normalized)) merged.set(normalized, values);
  }
  return merged;
}

export function buildImportedReadingData(libraries: ImportedNameDictionary[]): ImportedReadingData {
  const rows: SavedNameReadingRow[] = [];
  const readingTable: ReadingTable = new Map();
  let count = 0;
  for (const library of libraries) {
    for (const row of library.names || []) rows.push(row);
    for (const row of library.readings || []) {
      const key = normalizeNameKey(row.surface);
      if (!key || COMMON_SURFACES.has(key)) continue;
      const values = uniqueByCompact((row.readings || []).map(value => normalizeNameReading(value)));
      if (!values.length) continue;
      const existing = readingTable.get(row.surface) || [];
      readingTable.set(row.surface, uniqueByCompact([...existing, ...values]));
      if (key !== row.surface) readingTable.set(key, readingTable.get(row.surface)!);
    }
    count += (library.names?.length || 0) + (library.readings?.length || 0);
  }
  const revision = libraries.map(library => `${library.id}:${library.updatedAt}`).join('|');
  return { nameTable: buildNameReadingTable(rows, revision || 'builtin'), readingTable, revision, count };
}

function skeletonSegments(skeleton: Skeleton, from: number, to: number, text: string): Segment[] {
  const segments: Segment[] = [];
  let current: SkeletonChar[] = [];
  const flush = () => {
    if (!current.length) return;
    const start = current[0].start;
    const end = current[current.length - 1].end;
    segments.push({ start, end, text: text.slice(start, end), key: current.map(value => value.char).join('') });
    current = [];
  };
  for (let index = from; index < to; index++) {
    const char = skeleton.chars[index];
    if (!char) continue;
    const previous = current[current.length - 1];
    // Any original gap is a visible space; keep the surrounding pieces as separate ruby ranges.
    if (previous && char.start > previous.end) flush();
    current.push(char);
  }
  flush();
  return segments;
}

function rangeFromSkeleton(skeleton: Skeleton, from: number, to: number): { start: number; end: number } | null {
  const first = skeleton.chars[from];
  const last = skeleton.chars[to - 1];
  return first && last ? { start: first.start, end: last.end } : null;
}

function protectedRanges(
  line: ScriptLine,
  extras: Array<{ start: number; surface: string }>,
  source: ReadingSource,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = source === 'glossary'
    ? extras.map(entry => [entry.start, entry.start + entry.surface.length]) : [];
  let offset = 0;
  for (const token of line.tokens) {
    if (token.readingSource && token.readingSource !== 'automatic' && token.readingSource !== 'glossary') {
      ranges.push([offset, offset + token.surface.length]);
    }
    offset += token.surface.length;
  }
  return ranges;
}

function overlaps(ranges: Array<[number, number]>, start: number, end: number): boolean {
  return ranges.some(([left, right]) => left < end && start < right);
}

function splitByKnownSubterms(
  skeleton: Skeleton,
  from: number,
  to: number,
  text: string,
  table: NameReadingTable,
  excludedKey: string,
  wanted: number,
): Segment[] | null {
  const known = new Map(builtInNameReadingTable());
  for (const [key, entry] of table) known.set(key, entry);
  const keys = [...known.keys()].filter(key => key !== excludedKey && key.length < to - from)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  const segments: Segment[] = [];
  let cursor = from;
  while (cursor < to && segments.length < wanted) {
    const key = keys.find(candidate => {
      if (!skeleton.text.startsWith(candidate, cursor) || cursor + candidate.length > to) return false;
      const entry = known.get(candidate);
      return entry ? splitNameReadingSegments(entry.reading).length === 1 : false;
    });
    if (!key) return null;
    const range = rangeFromSkeleton(skeleton, cursor, cursor + key.length);
    if (!range) return null;
    segments.push({ ...range, text: text.slice(range.start, range.end), key });
    cursor += key.length;
  }
  return cursor === to && segments.length === wanted ? segments : null;
}

function findNameMatches(
  line: ScriptLine,
  table: NameReadingTable,
  source: ReadingSource,
  excluded: Array<{ start: number; surface: string }> = [],
): NameMatch[] {
  const skeleton = nameReadingSkeleton(line.cleanText);
  const keys = [...table.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const blocked = protectedRanges(line, excluded, source);
  const matches: NameMatch[] = [];
  const used: Array<[number, number]> = [];
  for (let index = 0; index < skeleton.text.length;) {
    const key = keys.find(candidate => skeleton.text.startsWith(candidate, index));
    if (!key) { index++; continue; }
    const endIndex = index + key.length;
    const range = rangeFromSkeleton(skeleton, index, endIndex);
    if (!range || overlaps(blocked, range.start, range.end) || overlaps(used, range.start, range.end)) { index++; continue; }
    const entry = table.get(key)!;
    const readingSegments = splitNameReadingSegments(entry.reading);
    const visible = skeletonSegments(skeleton, index, endIndex, line.cleanText);
    let segments: Segment[] = [];
    if (readingSegments.length === 1) {
      segments = visible.length > 1 ? visible : [{ ...range, text: line.cleanText.slice(range.start, range.end), key }];
    } else if (visible.length === readingSegments.length) {
      segments = visible;
    } else {
      segments = splitByKnownSubterms(skeleton, index, endIndex, line.cleanText, table, key, readingSegments.length) || [];
      if (!segments.length) segments = [{ ...range, text: line.cleanText.slice(range.start, range.end), key }];
    }
    matches.push({ ...range, key, entry, readingSegments, segments });
    used.push([range.start, range.end]);
    index = endIndex;
  }
  return matches;
}

function matchOverrides(line: ScriptLine, matches: NameMatch[], type: RubyType, source: ReadingSource, excluded: Array<{ start: number; surface: string }> = []): NameOverride[] {
  const overrides: NameOverride[] = [];
  for (const match of matches) {
    const readings = match.readingSegments.length === match.segments.length
      ? match.readingSegments
      : match.segments.length === 1 ? [match.readingSegments.join('')]
        : [match.readingSegments[0], match.readingSegments.slice(1).join('')];
    match.segments.forEach((segment, index) => {
      const reading = readings[index];
      if (!reading || !segment.text || line.cleanText.slice(segment.start, segment.end) !== segment.text) return;
      if (source === 'glossary' && match.entry.priority >= GLOSSARY_PRIORITY && excluded.length) return;
      overrides.push({ line: line.cleanText, start: segment.start, surface: segment.text, reading,
        type: match.entry.rubyType === 'romaji' ? 'romaji' : type,
        ...(index === 0 && match.entry.alternatives.length && match.entry.priority < GLOSSARY_PRIORITY
          ? { alternatives: [match.entry.reading, ...match.entry.alternatives] } : {}) });
    });
  }
  return overrides;
}

function attachAlternatives(line: ScriptLine, overrides: NameOverride[], type: RubyType, source: ReadingSource): ScriptLine {
  const target = applyRubyOverrides(line, overrides, type, source);
  const offsets: number[] = [];
  let offset = 0;
  for (const token of target.tokens) { offsets.push(offset); offset += token.surface.length; }
  const tokens = [...target.tokens];
  let changed = false;
  for (const entry of overrides) {
    if (!entry.alternatives?.length) continue;
    let index = offsets.indexOf(entry.start);
    // A segment can start inside an existing kanji token after earlier replacements.
    if (index < 0) index = tokens.findIndex((token, i) => offsets[i] <= entry.start &&
      offsets[i] + token.surface.length > entry.start);
    if (index < 0) continue;
    const values = [...new Set(entry.alternatives.map(value =>
      entry.type === 'romaji' ? value : formatRuby(value, type)))].filter(Boolean);
    tokens[index] = { ...tokens[index], alternatives: values, needsReview: values.length > 1, readingSource: source };
    changed = true;
  }
  return changed ? { ...target, tokens } : target;
}

function applyNameReadingOverlay(
  line: ScriptLine,
  table: NameReadingTable,
  type: RubyType,
  source: ReadingSource,
  excluded: Array<{ start: number; surface: string }> = [],
): ScriptLine {
  const overrides = matchOverrides(line, findNameMatches(line, table, source, excluded), type, source, excluded);
  if (!overrides.length) return line;
  return attachAlternatives(line, overrides, type, source);
}

/** Canonical dictionary pass, after checkLine and before user overlays. */
export function applyNameReadings(line: ScriptLine, table: NameReadingTable): ScriptLine {
  return applyNameReadingOverlay(line, table, 'hiragana', 'automatic');
}

/**
 * Imported general dictionaries supply a whitespace-safe canonical pass. A name split by
 * spaces receives one ruby per visible part; ambiguous readings stay as review alternatives.
 */
export function applyImportedReadingCompounds(line: ScriptLine, table: ReadingTable): ScriptLine {
  const names = makeTable('imported');
  for (const [key, readings] of table) {
    if (key.length < 2 || key.length > 24 || !KANJI_REGEX.test(key) || COMMON_SURFACES.has(key)) continue;
    const values = uniqueByCompact(readings.map(value => normalizeNameReading(value)));
    if (!values.length || !values.every(value => isValidNameReading(value))) continue;
    names.set(key, { key, surface: key, reading: values[0], alternatives: values.slice(1),
      score: 0, priority: IMPORTED_PRIORITY, rubyType: 'hiragana' });
  }
  return applyNameReadingOverlay(line, names, 'hiragana', 'automatic');
}

function glossaryNameTable(entries: ProperNounEntry[]): NameReadingTable {
  const table = makeTable('glossary');
  for (const entry of entries) {
    const rubyType = entry.type || 'hiragana';
    const reading = normalizeNameReading(entry.reading, rubyType);
    if (!isValidNameReading(reading, rubyType)) continue;
    addNameReading(table, { surface: entry.surface, reading, score: 0, alternatives: [], rubyType }, GLOSSARY_PRIORITY);
  }
  return table;
}

/**
 * Literal glossary entries have already won. This second pass matches their whitespace-free
 * skeleton, so a name split by half/full-width or repeated spaces still receives ruby.
 */
export function applyFlexibleGlossary(line: ScriptLine, entries: ProperNounEntry[], type: RubyType): ScriptLine {
  if (!entries.length) return line;
  return applyNameReadingOverlay(line, glossaryNameTable(entries), type, 'glossary', glossaryOverrides(line.cleanText, entries));
}
