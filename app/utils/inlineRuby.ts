import { katakanaToHiragana } from './furigana';
import type { BookFormat } from './libraryDatabase';
import type { RubyOverride } from './rubyOverrides';
import { parseSRT, parseVTT, type ParsedSrt, type SrtCue } from './srt';
import { sanitizeText } from './textSanitize';

// TXT/SRT export writes readings on the kanji only, `辛(つら)い` (inlineRubyText in srt.ts). Read back
// verbatim, those readings become script text and the next annotation doubles them:
// 山田(やまだ)(やまだ). An app-exported reading is pure kana directly after a kanji. A full-width
// parenthetical may be a legacy exported reading only when it spells out a whole kanji word;
// stage directions such as 鈴木（くしゃみ） remain script text.

const KANJI = /^[㐀-䶿一-鿿豈-﫿\u{20000}-\u{3FFFF}々〆〇ヶヵ]$/u;
const HIRAGANA = /^[ぁ-ゖ]$/u;
const INLINE_READING = /\(([ぁ-ゖゝゞァ-ヺー-ヾ]+)\)/gu;
const FULL_WIDTH_INLINE_READING = /（([ぁ-ゖゝゞァ-ヺー-ヾ]+)）/gu;
/** Common action/direction endings are never a kanji reading, even when the whole parenthetical is kana. */
const FULL_WIDTH_STAGE_DIRECTION = /(?:くしゃみ|ため息|泣き|笑い|小声|大声|独白|つぶやき|ふきだし|感嘆|驚き|叫び|囁き|ささやき|沈黙|間|そう|わめき|咳|せき|あくび|苦笑|照れ|怒り|焦り|安堵|動揺)$/u;

export interface InlineRuby {
  start: number;
  surface: string;
  reading: string;
}

export interface InlineRubyImport {
  text: string;
  overrides: RubyOverride[];
}

export interface TextScriptImport extends InlineRubyImport {
  cues: SrtCue[];
}

/** The character (one code point) ending at `index`, so supplementary-plane kanji stay whole. */
function charBefore(text: string, index: number): string {
  const low = text.charCodeAt(index - 1);
  if (index >= 2 && low >= 0xDC00 && low <= 0xDFFF) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xD800 && high <= 0xDBFF) return text.slice(index - 2, index);
  }
  return text.charAt(index - 1);
}

/** Walk left from `index` over characters matching `pattern`, never past `floor`. */
function scanBack(text: string, index: number, floor: number, pattern: RegExp): number {
  let position = index;
  while (position > floor) {
    const char = charBefore(text, position);
    if (position - char.length < floor || !pattern.test(char)) break;
    position -= char.length;
  }
  return position;
}

/** Each kanji group reads as one or more kana; the okurigana between groups must appear verbatim. */
function alignsWithReading(surface: string, reading: string): boolean {
  const pattern = surface.replace(/([ぁ-ゖ]+)|[^ぁ-ゖ]+/gu, (_, kana: string | undefined) => kana ?? '(.+)');
  return new RegExp(`^${pattern}$`, 'u').test(reading);
}

/** Remove app-exported inline readings from one line and report where each one was attached. */
export function stripInlineRuby(line: string): { text: string; rubies: InlineRuby[] } {
  if (!line.includes('(') && !line.includes('（')) return { text: line, rubies: [] };
  const rubies: InlineRuby[] = [];
  let text = '';
  let cursor = 0;
  const matches = [...line.matchAll(INLINE_READING), ...line.matchAll(FULL_WIDTH_INLINE_READING)]
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  for (const match of matches) {
    const open = match.index ?? 0;
    if (open < cursor) continue;
    // Full-width parentheses normally mean a stage direction. Only a whole, kanji-only word
    // whose reading spells it out is treated as a legacy bracketed reading; くしゃみ stays prose.
    if (line[open] === '（' && !/^[\p{Script=Han}々〆〇ヶヵ]+$/u.test(line.slice(cursor, open))) continue;
    const runStart = scanBack(line, open, cursor, KANJI);
    if (runStart === open) continue;
    const reading = katakanaToHiragana(match[1]);
    if (line[open] === '（' && (!alignsWithReading(line.slice(runStart, open), reading) ||
        FULL_WIDTH_STAGE_DIRECTION.test(reading))) continue;
    // A corrected word is exported as one token and may hold okurigana: 読み方(よみかた) belongs to
    // 読み方, not to 方. Extend over kana + kanji groups only while the reading spells them out.
    let start = runStart;
    for (let edge = runStart; ;) {
      const kanaStart = scanBack(line, edge, cursor, HIRAGANA);
      if (kanaStart === edge) break;
      const kanjiStart = scanBack(line, kanaStart, cursor, KANJI);
      if (kanjiStart === kanaStart) break;
      edge = kanjiStart;
      if (alignsWithReading(line.slice(edge, open), reading)) start = edge;
    }
    text += line.slice(cursor, open);
    const surface = line.slice(start, open);
    rubies.push({ start: text.length - surface.length, surface, reading });
    cursor = open + match[0].length;
  }
  return rubies.length ? { text: text + line.slice(cursor), rubies } : { text: line, rubies };
}

/**
 * Strip inline readings from a whole script and return them as source overrides - the channel
 * DOCX ruby already uses - anchored to the stripped line. Lines are split on '\n' only, exactly as
 * the annotator splits them, so a CRLF file keys its overrides by the same `line\r` text it annotates.
 */
export function extractInlineRuby(source: string): InlineRubyImport {
  const clean = sanitizeText(source);
  if (!clean.includes('(') && !clean.includes('（')) return { text: clean, overrides: [] };
  const overrides: RubyOverride[] = [];
  const byLine = new Map<string, RubyOverride[]>();
  const text = clean.split('\n').map(row => {
    const { text: line, rubies } = stripInlineRuby(row);
    const taken = byLine.get(line) || [];
    for (const ruby of rubies) {
      // Identical lines share one override key; the first reading of a range wins, as in applyRubyOverrides.
      if (taken.some(other => other.start < ruby.start + ruby.surface.length && ruby.start < other.start + other.surface.length)) continue;
      const entry: RubyOverride = { line, start: ruby.start, surface: ruby.surface, reading: ruby.reading, type: 'hiragana' };
      taken.push(entry);
      overrides.push(entry);
    }
    byLine.set(line, taken);
    return line;
  }).join('\n');
  return { text, overrides };
}

/** Same as extractInlineRuby for parsed subtitles; cue rows are stripped too so they still match the text. */
export function extractSubtitleInlineRuby(parsed: ParsedSrt): ParsedSrt & InlineRubyImport {
  const { text, overrides } = extractInlineRuby(parsed.text);
  const cues = overrides.length
    ? parsed.cues.map(cue => ({ ...cue, lines: cue.lines.map(row => stripInlineRuby(row).text) }))
    : parsed.cues;
  return { text, cues, overrides };
}

/**
 * Text-format import shared by the editor, the library and the batch queue: SRT / VTT cues when the
 * file has any, plus inline readings as source overrides. A subtitle file without a single valid cue
 * falls back to plain text; callers that require timings check `cues` themselves.
 */
export function importTextScript(fileName: string, source: string): TextScriptImport {
  const clean = sanitizeText(source);
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.srt') || lower.endsWith('.vtt')) {
    const parsed = lower.endsWith('.vtt') ? parseVTT(clean) : parseSRT(clean);
    if (parsed.cues.length) return extractSubtitleInlineRuby(parsed);
  }
  return { ...extractInlineRuby(clean), cues: [] };
}

/** Library format of an imported file, judged by the source file: .docx, .srt/.vtt, everything else txt. */
export function scriptSourceFormat(fileName: string): BookFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  return lower.endsWith('.srt') || lower.endsWith('.vtt') ? 'srt' : 'txt';
}

/** Library books store LF-only text (upsertBook); re-key overrides taken from a CRLF file to match. */
export function withLfLineKeys(entries: RubyOverride[]): RubyOverride[] {
  if (!entries.some(entry => entry.line.endsWith('\r'))) return entries;
  return entries.map(entry => entry.line.endsWith('\r') ? { ...entry, line: entry.line.slice(0, -1) } : entry);
}
