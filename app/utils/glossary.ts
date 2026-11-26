import type { ProperNounEntry } from './correctionDatabase';
import type { RubyType, ScriptLine } from './furigana';
import { applyRubyOverrides, type RubyOverride } from './rubyOverrides';

/** Literal longest-match first; explicit source/manual readings are applied later. */
export function glossaryOverrides(text: string, entries: ProperNounEntry[]): RubyOverride[] {
  if (!text || !entries.length) return [];
  const byFirst = new Map<string, ProperNounEntry[]>();
  for (const entry of entries) {
    if (!entry.surface) continue;
    const head = entry.surface[0];
    let bucket = byFirst.get(head);
    if (!bucket) {
      bucket = [];
      byFirst.set(head, bucket);
    }
    bucket.push(entry);
  }
  if (!byFirst.size) return [];
  for (const bucket of byFirst.values()) {
    if (bucket.length > 1) bucket.sort((a, b) => b.surface.length - a.surface.length);
  }
  const overrides: RubyOverride[] = [];
  for (let offset = 0; offset < text.length;) {
    const bucket = byFirst.get(text[offset]);
    const entry = bucket?.find(value => text.startsWith(value.surface, offset));
    if (entry) {
      overrides.push({ line: text, start: offset, surface: entry.surface, reading: entry.reading, type: entry.type });
      offset += entry.surface.length;
    } else offset++;
  }
  return overrides;
}

export function applyGlossary(line: ScriptLine, entries: ProperNounEntry[], type: RubyType): ScriptLine {
  return applyRubyOverrides(line, glossaryOverrides(line.cleanText, entries), type, 'glossary');
}
