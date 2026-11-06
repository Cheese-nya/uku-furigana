import { formatRuby, KANJI_REGEX, katakanaToHiragana, type ReadingSource, type RubyType, type ScriptLine, type Token } from './furigana';

// Anchored to the exact line and character range: the same word can have different
// readings elsewhere. A changed line must be checked again, rather than guessed.
export interface RubyOverride {
  line: string;
  start: number;
  surface: string;
  reading: string;
  type: RubyType;
  /**
   * Index of this line among identical lines in the document. Older records omit it and keep
   * their documented "every identical line" behaviour; new manual edits always set it so
   * "this occurrence only" really means one occurrence.
   */
  lineOccurrence?: number;
}

// Adjacent ranges (one ends exactly where the other starts) are not an overlap: the
// invariant is that a line never holds two entries covering the same character. It is
// enforced when entries are written (upsertRubyOverride) and when they are applied
// (applyRubyOverrides), not when a stored list is read: a stored overlap is a display
// problem, never a reason to reject the whole file.
function rangesOverlap(left: RubyOverride, right: RubyOverride): boolean {
  return left.start < right.start + right.surface.length && right.start < left.start + left.surface.length;
}

export function upsertRubyOverride(entries: RubyOverride[], entry: RubyOverride): RubyOverride[] {
  // A legacy (unscoped) write replaces every overlapping entry on that line. An
  // occurrence-scoped write only replaces other writes for the same occurrence: the same text
  // may exist on another line, and that line must not change.
  return [...entries.filter(value => {
    if (value.line !== entry.line || !rangesOverlap(value, entry)) return true;
    return entry.lineOccurrence === undefined ? false : value.lineOccurrence !== entry.lineOccurrence;
  }), entry];
}

export function applyRubyOverrides(
  line: ScriptLine,
  overrides: RubyOverride[],
  type: RubyType,
  source: ReadingSource = 'manual',
  lineOccurrence = 0,
): ScriptLine {
  let tokens = line.tokens;
  const applied: RubyOverride[] = [];
  // Occurrence-scoped entries win over legacy entries for the same range, even when the
  // legacy entry starts earlier. Within one specificity the first entry of a range wins.
  const candidates = overrides
    .filter(value => value.line === line.cleanText &&
      (value.lineOccurrence === undefined || value.lineOccurrence === lineOccurrence))
    .sort((a, b) => Number(a.lineOccurrence === undefined) - Number(b.lineOccurrence === undefined) || a.start - b.start);
  for (const entry of candidates) {
    const end = entry.start + entry.surface.length;
    if (!entry.surface || line.cleanText.slice(entry.start, end) !== entry.surface) continue;
    // A stored list may still hold overlapping entries: an older build wrote them, and a
    // hand-edited backup can too. Rewriting a range that an already-applied entry covers
    // would erase the earlier reading, so the first entry of a range wins - the same rule
    // upsertRubyOverride enforces when it writes.
    if (applied.some(other => rangesOverlap(other, entry))) continue;
    const replacement: Token[] = [];
    let offset = 0;
    let inserted = false;
    for (const token of tokens) {
      const tokenEnd = offset + token.surface.length;
      if (tokenEnd <= entry.start || offset >= end) {
        replacement.push(token);
      } else {
        if (offset < entry.start) {
          const surface = token.surface.slice(0, entry.start - offset);
          replacement.push({ surface, hasKanji: KANJI_REGEX.test(surface), needsReview: KANJI_REGEX.test(surface) });
        }
        if (!inserted) {
          replacement.push({ surface: entry.surface, hasKanji: KANJI_REGEX.test(entry.surface),
            ruby: entry.reading ? (entry.type === 'romaji' ? entry.reading : formatRuby(katakanaToHiragana(entry.reading), type)) : undefined,
            readingSource: source, needsReview: false, annotationSuppressed: !entry.reading });
          inserted = true;
        }
        if (tokenEnd > end) {
          const surface = token.surface.slice(end - offset);
          replacement.push({ surface, hasKanji: KANJI_REGEX.test(surface), needsReview: KANJI_REGEX.test(surface) });
        }
      }
      offset = tokenEnd;
    }
    tokens = replacement;
    // Only an entry that actually landed on a token blocks a later overlap.
    if (inserted) applied.push(entry);
  }
  return { ...line, tokens };
}

function isRubyOverride(entry: unknown): entry is RubyOverride {
  if (typeof entry !== 'object' || entry === null) return false;
  const item = entry as Partial<RubyOverride>;
  return typeof item.line === 'string' && Number.isInteger(item.start) && (item.start ?? -1) >= 0 &&
    typeof item.surface === 'string' && item.surface.length > 0 && typeof item.reading === 'string' &&
    ['hiragana', 'katakana', 'romaji'].includes(item.type || '') &&
    (item.lineOccurrence === undefined || (Number.isInteger(item.lineOccurrence) && item.lineOccurrence >= 0)) &&
    item.line.slice(item.start, (item.start ?? 0) + item.surface.length) === item.surface;
}

// Validation only drops entries that are malformed, never entries that merely overlap.
// Strict callers (correctionDatabase.validOverrides, libraryDatabase.validateBook) treat a
// shorter result as corruption and refuse to load the whole database, so a stored overlap
// must not turn a display glitch into an unreadable file. Overlaps are resolved where the
// annotations are actually applied, by applyRubyOverrides.
export function validateRubyOverrides(value: unknown): RubyOverride[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRubyOverride);
}
