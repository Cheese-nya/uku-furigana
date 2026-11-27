import { katakanaToHiragana, type ScriptLine, type Token } from './furigana';

export interface SrtCue {
  index: string;
  start: string;
  end: string;
  lines: string[];
}

export interface ParsedSrt {
  text: string;
  cues: SrtCue[];
}

const TIMING = /^\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/;

function normalizeSrtTime(value: string): string {
  return value.replace('.', ',').replace(/^(\d):/, '0$1:');
}

export function parseSRT(source: string): ParsedSrt {
  const blocks = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const rows = block.split('\n');
    const timingIndex = rows.findIndex(row => TIMING.test(row));
    if (timingIndex < 0) continue;
    const match = rows[timingIndex].match(TIMING);
    if (!match) continue;
    const content = rows.slice(timingIndex + 1);
    // A single newline at the end of the file must not add an empty caption line.
    while (content.length && !content[content.length - 1].trim()) content.pop();
    if (!content.length) continue;
    cues.push({
      index: rows.slice(0, timingIndex).join(' ') || String(cues.length + 1),
      start: normalizeSrtTime(match[1]),
      end: normalizeSrtTime(match[2]),
      lines: content,
    });
  }
  return { cues, text: cues.map(cue => cue.lines.join('\n')).join('\n') };
}

const VTT_TIMESTAMP = /(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})/g;
const VTT_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  lrm: '\u200E',
  rlm: '\u200F',
};
const VTT_NON_CUE_BLOCK = /^(?:WEBVTT(?:\s|$|-)|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/;

function vttText(row: string): string {
  return row.replace(/^<v(?:\.[^\s>]*)?\s+([^>]+)>/, '$1：').replace(/<rt>[\s\S]*?<\/rt>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(?:39|x0*27);/gi, "'")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|lrm|rlm);/g, (_, name: string) => VTT_ENTITIES[name]);
}

/** WebVTT allows hour-less dotted timestamps, named cue ids and inline markup; map them onto SRT cues. */
export function parseVTT(source: string): ParsedSrt {
  const cueBlocks = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .filter(block => {
      const firstLine = block.split('\n').find(line => line.trim() !== '')?.trim() ?? '';
      return Boolean(firstLine) && !VTT_NON_CUE_BLOCK.test(firstLine);
    });
  const rows = cueBlocks.join('\n\n').split('\n').flatMap(row => {
    if (row.includes('-->')) {
      return [row.replace(VTT_TIMESTAMP, (_, hours: string | undefined, minutes: string, seconds: string, millis: string) =>
        `${(hours || '0').padStart(2, '0')}:${minutes}:${seconds},${millis}`)];
    }
    const text = vttText(row);
    // A row emptied by markup removal must not split its cue into two blocks.
    return text || !row ? [text] : [];
  });
  const parsed = parseSRT(rows.join('\n'));
  return { text: parsed.text, cues: parsed.cues.map((cue, index) => ({ ...cue, index: String(index + 1) })) };
}

// Same kanji class as the inline-ruby importer (inlineRuby.ts), which only takes a reading that
// directly follows a kanji run.
const KANJI_RUN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{3FFFF}々〆〇ヶヵ]+/u;
const INLINE_PARTS = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{3FFFF}々〆〇ヶヵ]+|[^㐀-䶿一-鿿豈-﫿\u{20000}-\u{3FFFF}々〆〇ヶヵ]+/gu;
const KANA_READING = /^[ぁ-ゖゝゞァ-ヺー-ヾ]+$/u;

/**
 * Inline ruby for one token, with the reading on the kanji only so the importer can read it back:
 * 辛い(つらい) -> 辛(つら)い, 読み方(よみかた) -> 読(よ)み方(かた). The kana between kanji runs must
 * appear verbatim in the reading and every kanji run must read as at least one kana; when that
 * alignment is impossible or ambiguous (or the reading is not kana, e.g. romaji) the whole word
 * keeps one reading, as before.
 */
export function inlineRubyText(token: Pick<Token, 'surface' | 'ruby'>): string {
  const { surface, ruby } = token;
  if (!ruby) return surface;
  const whole = `${surface}(${ruby})`;
  const parts = surface.match(INLINE_PARTS) || [];
  if (parts.length < 2 || !KANA_READING.test(ruby)) return whole;
  const hira = katakanaToHiragana(ruby);
  const solutions: string[] = [];
  const align = (index: number, offset: number, out: string) => {
    if (solutions.length > 1) return;
    if (index === parts.length) {
      if (offset === hira.length) solutions.push(out);
      return;
    }
    const part = parts[index];
    if (!KANJI_RUN.test(part)) {
      const literal = katakanaToHiragana(part);
      if (hira.startsWith(literal, offset)) align(index + 1, offset + literal.length, out + part);
      return;
    }
    const next = parts[index + 1];
    for (let end = offset + 1; end <= hira.length; end++) {
      if (next ? !hira.startsWith(katakanaToHiragana(next), end) : end !== hira.length) continue;
      align(index + 1, end, `${out}${part}(${ruby.slice(offset, end)})`);
    }
  };
  align(0, 0, '');
  return solutions.length === 1 ? solutions[0] : whole;
}

function annotatedText(line: ScriptLine): string {
  return line.tokens.map(inlineRubyText).join('');
}

function cleanTranslation(value?: string): string {
  return (value ?? '').replace(/\r\n?/g, '\n').trim();
}

/** TXT export: each annotated line as its own paragraph, with optional line-by-line translation below. */
export function generateTXT(lines: ScriptLine[], translations?: readonly (string | undefined)[]): string {
  return lines.map((line, index) => {
    const base = annotatedText(line);
    const translation = cleanTranslation(translations?.[index]);
    return translation ? `${base}\n${translation}` : base;
  }).join('\n\n');
}

/** Preserve imported cue timing and grouping when the user has not changed the cue layout. */
export function generateSRT(
  lines: ScriptLine[],
  cues?: SrtCue[],
  translations?: readonly (string | undefined)[],
): string {
  const cueLineCount = cues?.reduce((total, cue) => total + cue.lines.length, 0) || 0;
  if (cues?.length && cueLineCount === lines.length) {
    let lineIndex = 0;
    return cues.map(cue => {
      const sourceRows: string[] = [];
      const translationRows: string[] = [];
      for (let i = 0; i < cue.lines.length; i++) {
        const idx = lineIndex++;
        sourceRows.push(annotatedText(lines[idx] || { tokens: [], cleanText: '', id: '' }));
        const translation = cleanTranslation(translations?.[idx]);
        if (translation) translationRows.push(translation);
      }
      const content = [...sourceRows, ...translationRows].join('\n');
      return `${cue.index}\n${cue.start} --> ${cue.end}\n${content}`;
    }).join('\n\n') + '\n';
  }
  return lines.map((line, index) => {
    const startTime = formatSRTTime(index * 4);
    const endTime = formatSRTTime(index * 4 + 3);
    const translation = cleanTranslation(translations?.[index]);
    const body = translation ? `${annotatedText(line)}\n${translation}` : annotatedText(line);
    return `${index + 1}\n${startTime} --> ${endTime}\n${body}\n`;
  }).join('\n');
}

function formatSRTTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${hrs}:${mins}:${secs},000`;
}
