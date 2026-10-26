import { annotateLine, formatRuby, type RubyType, type ScriptLine } from './furigana';
import { applyRubyOverrides, type RubyOverride } from './rubyOverrides';
import { applyGlossary } from './glossary';
import type { LearnedReading, ProperNounEntry } from './correctionDatabase';
import { checkLine, type ReadingTable } from './readingCheck';
import { learnedOverrides } from './review';

export interface AnnotationInput {
  text: string;
  rubyType: RubyType;
  glossary: ProperNounEntry[];
  sourceOverrides: RubyOverride[];
  overrides: RubyOverride[];
  learned?: LearnedReading[];
}

export interface AnnotationChunk { offset: number; lines: ScriptLine[]; total: number }

export const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function groupOverrides(entries: RubyOverride[]) {
  const grouped = new Map<string, RubyOverride[]>();
  for (const entry of entries) grouped.set(entry.line, [...(grouped.get(entry.line) || []), entry]);
  return grouped;
}

function applyLearned(line: ScriptLine, entries: LearnedReading[] = [], type: RubyType): ScriptLine {
  if (!entries || !entries.length) return line;
  const overrides = learnedOverrides(line, entries, type);
  return applyRubyOverrides(line, overrides, type, 'learned');
}

/** Own one cache per execution environment; cache canonical readings, never overlays. */
export function createAnnotator(getTable?: () => ReadingTable | null) {
  const cache = new Map<string, { line: ScriptLine; checkedWithTable: boolean }>();
  return {
    clear: () => cache.clear(),
    async run(input: AnnotationInput, cancelled: () => boolean, onChunk: (chunk: AnnotationChunk) => void): Promise<void> {
      const texts = input.text.split('\n');
      const source = groupOverrides(input.sourceOverrides);
      const overrides = groupOverrides(input.overrides);
      for (let offset = 0; offset < texts.length; offset += 50) {
        if (cancelled()) throw new DOMException('注音任务已取消', 'AbortError');
        // The reading table arrives in the background; lines annotated before it did are
        // re-annotated (and cached) once it is there.
        const table = getTable?.() ?? null;
        const lines = texts.slice(offset, offset + 50).map((text, index) => {
          const entry = cache.get(text);
          let canonical = entry && entry.checkedWithTable === Boolean(table) ? entry.line : undefined;
          if (!canonical) {
            canonical = annotateLine(text, 'hiragana');
            if (table) canonical = checkLine(canonical, table);
            cache.set(text, { line: canonical, checkedWithTable: Boolean(table) });
            if (cache.size > 12000) cache.delete(cache.keys().next().value!);
          }
          const line: ScriptLine = { ...canonical, id: String(offset + index), tokens: canonical.tokens.map(token => ({ ...token,
            ...(token.ruby ? { ruby: formatRuby(token.ruby, input.rubyType) } : {}),
            ...(token.alternatives ? { alternatives: token.alternatives.map(value => formatRuby(value, input.rubyType)) } : {}),
          })) };
          return applyRubyOverrides(applyRubyOverrides(applyLearned(applyGlossary(line, input.glossary, input.rubyType), input.learned, input.rubyType),
            source.get(text) || [], input.rubyType, 'source'), overrides.get(text) || [], input.rubyType, 'manual');
        });
        onChunk({ offset, lines, total: texts.length });
        // Give CANCEL/ANNOTATE messages an opportunity to run between chunks.
        await yieldTask();
      }
      if (cancelled()) throw new DOMException('注音任务已取消', 'AbortError');
    },
  };
}
