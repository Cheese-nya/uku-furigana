import { annotateLine, formatRuby, type RubyType, type ScriptLine } from './furigana';
import { applyRubyOverrides, type RubyOverride } from './rubyOverrides';
import { applyGlossary } from './glossary';
import type { LearnedReading, ProperNounEntry } from './correctionDatabase';
import { checkLine, type ReadingTable } from './readingCheck';
import { applyFlexibleGlossary, applyImportedReadingCompounds, applyNameReadings, builtInNameReadingTable, mergeReadingTables, type NameReadingTable } from './nameReadings';
import { learnedOverrides } from './review';
import { sanitizeText } from './textSanitize';

export interface AnnotationInput {
  text: string;
  rubyType: RubyType;
  glossary: ProperNounEntry[];
  sourceOverrides: RubyOverride[];
  overrides: RubyOverride[];
  learned?: LearnedReading[];
  /** Identity for display continuity only; the annotation engine itself does not need it. */
  documentId?: string;
  /** Optional 0-based line range `[start, end)` to annotate and emit before remaining chunks. */
  priorityRange?: { start: number; end: number };
}

export interface AnnotationChunk { offset: number; lines: ScriptLine[]; total: number }

export const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function sanitizeOverride(entry: RubyOverride): RubyOverride {
  const line = sanitizeText(entry.line);
  if (line === entry.line) return entry;
  return {
    ...entry,
    line,
    start: sanitizeText(entry.line.slice(0, entry.start)).length,
    surface: sanitizeText(entry.surface),
  };
}

function groupOverrides(entries: RubyOverride[]) {
  const grouped = new Map<string, RubyOverride[]>();
  for (const raw of entries) {
    const entry = sanitizeOverride(raw);
    let list = grouped.get(entry.line);
    if (!list) grouped.set(entry.line, (list = []));
    list.push(entry);
  }
  return grouped;
}

function applyLearned(line: ScriptLine, entries: LearnedReading[] = [], type: RubyType): ScriptLine {
  if (!entries || !entries.length) return line;
  const overrides = learnedOverrides(line, entries, type);
  return applyRubyOverrides(line, overrides, type, 'learned');
}

/** Own one cache per execution environment; cache canonical readings, never overlays. */
export interface AnnotationEngineData {
  table: ReadingTable | null;
  nameTable: NameReadingTable | null;
  importedTable: ReadingTable | null;
}

const CHUNK_SIZE = 50;

function orderedChunkOffsets(total: number, priorityRange?: { start: number; end: number }): number[] {
  const all: number[] = [];
  for (let offset = 0; offset < total; offset += CHUNK_SIZE) all.push(offset);
  if (!priorityRange || priorityRange.end <= priorityRange.start) return all;
  const start = Math.max(0, priorityRange.start);
  const end = Math.min(total, priorityRange.end);
  if (start >= end) return all;
  const firstPriorityChunk = Math.floor(start / CHUNK_SIZE) * CHUNK_SIZE;
  const priority: number[] = [];
  const rest: number[] = [];
  for (const offset of all) {
    if (offset >= firstPriorityChunk && offset < end) priority.push(offset);
    else rest.push(offset);
  }
  return [...priority, ...rest];
}

export function createAnnotator(
  getTable?: (() => ReadingTable | null) | (() => AnnotationEngineData),
  getNameTable?: () => NameReadingTable | null,
) {
  const cache = new Map<string, { line: ScriptLine; checkedWithTable: boolean; nameRevision: string }>();
  const defaultNameTable = builtInNameReadingTable();
  let cachedMergeKey: { table: ReadingTable | null; importedTable: ReadingTable | null; size: number; importedSize: number; checkedTable: ReadingTable } | null = null;
  const readData = (): AnnotationEngineData => {
    const value = getTable?.();
    if (value && 'table' in value) return value;
    return { table: (value as ReadingTable | null | undefined) ?? null,
      nameTable: getNameTable?.() ?? null, importedTable: null };
  };
  const resolveCheckedTable = (table: ReadingTable | null, importedTable: ReadingTable | null): ReadingTable => {
    const size = table?.size ?? 0;
    const importedSize = importedTable?.size ?? 0;
    if (
      cachedMergeKey
      && cachedMergeKey.table === table
      && cachedMergeKey.importedTable === importedTable
      && cachedMergeKey.size === size
      && cachedMergeKey.importedSize === importedSize
    ) {
      return cachedMergeKey.checkedTable;
    }
    const checkedTable = mergeReadingTables(table, importedTable);
    cachedMergeKey = { table, importedTable, size, importedSize, checkedTable };
    return checkedTable;
  };
  return {
    clear: () => { cache.clear(); cachedMergeKey = null; },
    async run(input: AnnotationInput, cancelled: () => boolean, onChunk: (chunk: AnnotationChunk) => void): Promise<void> {
      const texts = sanitizeText(input.text).split('\n');
      const source = groupOverrides(input.sourceOverrides);
      const overrides = groupOverrides(input.overrides);
      const seenLines = new Map<string, number>();
      const occurrences = texts.map(text => {
        const occurrence = seenLines.get(text) || 0;
        seenLines.set(text, occurrence + 1);
        return occurrence;
      });
      const offsets = orderedChunkOffsets(texts.length, input.priorityRange);
      for (const offset of offsets) {
        if (cancelled()) throw new DOMException('注音任务已取消', 'AbortError');
        // The reading table arrives in the background; lines annotated before it did are
        // re-annotated (and cached) once it is there.
        const { table, nameTable, importedTable } = readData();
        const checkedTable = resolveCheckedTable(table, importedTable);
        const names = nameTable || defaultNameTable;
        const nameRevision = `${names.revision}|${checkedTable.size}`;
        const lines = texts.slice(offset, offset + CHUNK_SIZE).map((text, index) => {
          const lineIndex = offset + index;
          const occurrence = occurrences[lineIndex];
          const entry = cache.get(text);
          let canonical = entry && entry.checkedWithTable === Boolean(table) &&
            entry.nameRevision === nameRevision ? entry.line : undefined;
          if (!canonical) {
            canonical = annotateLine(text, 'hiragana');
            if (importedTable) canonical = applyImportedReadingCompounds(canonical, importedTable);
            if (table) canonical = checkLine(canonical, checkedTable);
            canonical = applyNameReadings(canonical, names);
            cache.set(text, { line: canonical, checkedWithTable: Boolean(table), nameRevision });
            if (cache.size > 12000) cache.delete(cache.keys().next().value!);
          }
          const line: ScriptLine = { ...canonical, id: String(lineIndex), tokens: canonical.tokens.map(token => ({ ...token,
            ...(token.ruby ? { ruby: formatRuby(token.ruby, input.rubyType) } : {}),
            ...(token.alternatives ? { alternatives: token.alternatives.map(value => formatRuby(value, input.rubyType)) } : {}),
          })) };
          const glossed = applyFlexibleGlossary(applyGlossary(line, input.glossary, input.rubyType), input.glossary, input.rubyType);
          return applyRubyOverrides(applyRubyOverrides(applyLearned(glossed, input.learned, input.rubyType),
            source.get(line.cleanText) || [], input.rubyType, 'source', occurrence), overrides.get(line.cleanText) || [], input.rubyType, 'manual', occurrence);
        });
        onChunk({ offset, lines, total: texts.length });
        // Give CANCEL/ANNOTATE messages an opportunity to run between chunks.
        await yieldTask();
      }
      if (cancelled()) throw new DOMException('注音任务已取消', 'AbortError');
    },
  };
}
