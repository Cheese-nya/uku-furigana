import type { ScriptLine } from './furigana';

/**
 * A book's stored text as unannotated reader lines, for when annotation failed. A book opened
 * from the shelf must never render as a blank page because the tokenizer threw.
 */
export function plainScriptLines(content: string): ScriptLine[] {
  return content.split('\n').map((text, index) => ({
    id: `plain-${index}`,
    rawText: text,
    cleanText: text,
    tokens: text ? [{ surface: text, hasKanji: false }] : [],
  }));
}
