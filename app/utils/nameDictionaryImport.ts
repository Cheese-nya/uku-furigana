import JSZip from 'jszip';
import {
  isValidNameReading,
  normalizeNameKey,
  normalizeNameReading,
  splitNameReadingSegments,
  type ImportedNameDictionary,
  type SavedNameReadingRow,
  type SavedReadingRow,
} from './nameReadings';
import { KANJI_REGEX } from './furigana';
import { HETERONYM_READINGS } from './furigana';

/** Error codes keep user-facing copy in i18n while the parser stays locale-independent. */
export type NameDictionaryImportErrorCode =
  | 'nameDictInvalidZip'
  | 'nameDictUnsupportedFormat'
  | 'nameDictNoBanks'
  | 'nameDictNoReadings';

export class NameDictionaryImportError extends Error {
  readonly code: NameDictionaryImportErrorCode;

  constructor(code: NameDictionaryImportErrorCode) {
    super(code);
    this.name = 'NameDictionaryImportError';
    this.code = code;
  }
}

export interface NameDictionaryImportResult {
  library: ImportedNameDictionary;
  kind: 'name' | 'reading';
  rows: number;
}

const NAME_TYPES = /^(?:surname|place|person|given|fem|masc|fullname|name|unclass|organization|company|product|work|station|railway|char|fictional|given name|family|surname|given|place|person)/iu;
const COMMON_SURFACES = new Set([...Object.keys(HETERONYM_READINGS), '人気', '何で', '何時']);
const KANA = /^[\u3041-\u3096\u30A1-\u30FA\u30FC\u309D\u309E]+$/u;

export function isNameDictionary(index: Record<string, unknown>): boolean {
  const title = typeof index.title === 'string' ? index.title.toLowerCase() : '';
  const description = typeof index.description === 'string' ? index.description.toLowerCase() : '';
  return /jmnedict|proper noun|名前|人名|專名|专名/.test(`${title} ${description}`);
}

function kanaValues(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string' && KANA.test(value.normalize('NFKC').trim()));
}

/** Pixiv and similar dictionaries sometimes combine two kana readings in one field. */
function readingCandidates(value: string): string[] {
  return value.replace(/または|あるいは/gu, ' ').split(/[\s・/]+/u).map(part => part.trim()).filter(Boolean);
}

/** Yomitan v3 rows keep a reading in row[1]; JMnedict keeps kana readings in row[5]. */
export function extractNameRows(rows: unknown[], nameDictionary: boolean): {
  names: SavedNameReadingRow[];
  readings: SavedReadingRow[];
  scanned: number;
} {
  interface Candidate { surface: string; values: string[]; score: number; named: boolean }
  const collected = new Map<string, Candidate>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6 || typeof row[0] !== 'string') continue;
    const surface = row[0].trim();
    const key = normalizeNameKey(surface);
    if (key.length < 2 || key.length > 24 || !KANJI_REGEX.test(key) || COMMON_SURFACES.has(key) || /\s/u.test(surface)) continue;
    const direct = typeof row[1] === 'string' ? row[1].normalize('NFKC').trim() : '';
    const score = typeof row[4] === 'number' && Number.isFinite(row[4]) ? row[4] : 0;
    const candidates = nameDictionary
      ? [...readingCandidates(direct), ...kanaValues(row[5])]
      : readingCandidates(direct);
    const unique = [...new Set(candidates.map(value => normalizeNameReading(value)).filter(value => isValidNameReading(value) && !value.includes('または')))];
    if (!unique.length) continue;
    const type = typeof row[2] === 'string' ? row[2].trim() : '';
    const named = nameDictionary && (!type || NAME_TYPES.test(type));
    const previous = collected.get(key);
    const values = mergeReadings(previous?.values || [], unique);
    collected.set(key, { surface: previous?.surface || surface, values,
      score: Math.max(previous?.score || 0, score), named: Boolean(previous?.named || named) });
  }
  const names: SavedNameReadingRow[] = [];
  const readings: SavedReadingRow[] = [];
  for (const [key, candidate] of collected) {
    // Only one unambiguous reading is safe to apply automatically; ambiguous names become
    // alternatives in the dictionary-checked reading pass instead of a forced replacement.
    if (candidate.named && candidate.values.length === 1) {
      names.push({ surface: candidate.surface, reading: candidate.values[0], alternatives: [], score: candidate.score });
    } else if (!COMMON_SURFACES.has(key)) {
      readings.push({ surface: candidate.surface, readings: candidate.values });
    }
  }
  return { names, readings, scanned: rows.length };
}

function mergeReadings(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map(value => splitNameReadingSegments(value).join('')));
  const result = [...current];
  for (const value of incoming) {
    const normalized = splitNameReadingSegments(value).join('');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

/** Parse raw term banks without glosses; the user's zip never leaves this device. */
export async function readNameDictionaryZip(
  data: ArrayBuffer,
  onProgress?: (fraction: number) => void,
): Promise<NameDictionaryImportResult> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new NameDictionaryImportError('nameDictInvalidZip'); }
  const indexFile = zip.file('index.json') ?? zip.file(/(?:^|\/)index\.json$/)[0];
  if (!indexFile) throw new NameDictionaryImportError('nameDictInvalidZip');
  let index: Record<string, unknown>;
  try { index = JSON.parse(await indexFile.async('string')) as Record<string, unknown>; }
  catch { throw new NameDictionaryImportError('nameDictInvalidZip'); }
  const format = index.format ?? index.version;
  if (typeof format !== 'number' || format < 1 || format > 3) throw new NameDictionaryImportError('nameDictUnsupportedFormat');
  const files = zip.file(/(?:^|\/)term_bank_\d+\.json$/u)
    .sort((a, b) => Number(a.name.match(/_(\d+)\.json$/u)?.[1] || 0) - Number(b.name.match(/_(\d+)\.json$/u)?.[1] || 0));
  if (!files.length) throw new NameDictionaryImportError('nameDictNoBanks');
  const nameDictionary = isNameDictionary(index);
  const names = new Map<string, SavedNameReadingRow>();
  const readings = new Map<string, SavedReadingRow>();
  const seenKeys = new Set<string>();
  let scanned = 0;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    let rows: unknown[];
    try { rows = JSON.parse(await files[fileIndex].async('string')) as unknown[]; }
    catch { throw new NameDictionaryImportError('nameDictInvalidZip'); }
    const result = extractNameRows(Array.isArray(rows) ? rows : [], nameDictionary);
    scanned += result.scanned;
    // Yield between large term banks so the file picker and progress UI stay responsive.
    await new Promise(resolve => setTimeout(resolve, 0));
    for (const row of result.names) seenKeys.add(normalizeNameKey(row.surface));
    for (const row of result.readings) seenKeys.add(normalizeNameKey(row.surface));
    for (const row of result.names) {
      const key = normalizeNameKey(row.surface);
      const existing = names.get(key);
      if (existing) {
        const values = mergeReadings([existing.reading, ...existing.alternatives], [row.reading, ...row.alternatives]);
        existing.reading = values[0];
        existing.alternatives = values.slice(1);
        existing.score = Math.max(existing.score, row.score);
      } else names.set(key, { ...row, alternatives: [...row.alternatives] });
    }
    for (const row of result.readings) {
      const key = normalizeNameKey(row.surface);
      const existing = readings.get(key) || names.get(key);
      if (existing) {
        const current = 'readings' in existing ? existing.readings : [existing.reading, ...existing.alternatives];
        const values = mergeReadings(current, row.readings);
        names.delete(key);
        readings.set(key, { surface: existing.surface, readings: values });
      } else readings.set(key, { ...row, readings: [...row.readings] });
    }
    onProgress?.(Math.min(0.95, (fileIndex + 1) / files.length * 0.95));
  }
  if (!seenKeys.size) throw new NameDictionaryImportError('nameDictNoReadings');
  const title = typeof index.title === 'string' ? index.title : 'Yomitan 词典';
  const revision = typeof index.revision === 'string' ? index.revision : '';
  const library: ImportedNameDictionary = {
    id: `${title}:${revision}`, title, revision, names: [...names.values()], readings: [...readings.values()], updatedAt: Date.now(),
  };
  onProgress?.(1);
  return { library, kind: nameDictionary ? 'name' : 'reading', rows: scanned };
}

export function isValidImportedNameDictionary(value: unknown): value is ImportedNameDictionary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<ImportedNameDictionary>;
  const namesValid = Array.isArray(item.names) && item.names.every(row =>
    typeof row.surface === 'string' && typeof row.reading === 'string' &&
    (row.rubyType === undefined || ['hiragana', 'katakana', 'romaji'].includes(row.rubyType)) &&
    Array.isArray(row.alternatives) && row.alternatives.every(reading => typeof reading === 'string'));
  const readingsValid = Array.isArray(item.readings) && item.readings.every(row =>
    typeof row.surface === 'string' && Array.isArray(row.readings) && row.readings.every(reading => typeof reading === 'string'));
  return typeof item.id === 'string' && typeof item.title === 'string' && typeof item.revision === 'string' &&
    typeof item.updatedAt === 'number' && namesValid && readingsValid;
}
