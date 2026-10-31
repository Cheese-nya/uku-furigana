import type { ScriptLine } from './furigana';
import { sanitizeText } from './textSanitize';

/**
 * A book's stored text as unannotated reader lines, for when annotation failed. A book opened
 * from the shelf must never render as a blank page because the tokenizer threw.
 */
export function plainScriptLines(content: string): ScriptLine[] {
  return sanitizeText(content).replace(/\r\n?/g, '\n').split('\n').map((text, index) => ({
    id: `plain-${index}`,
    rawText: text,
    cleanText: text,
    tokens: text ? [{ surface: text, hasKanji: false }] : [],
  }));
}
