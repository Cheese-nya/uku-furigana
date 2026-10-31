import JSZip from 'jszip';
import { katakanaToHiragana } from './furigana';
import type { RubyOverride } from './rubyOverrides';
import { sanitizeText } from './textSanitize';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface ImportedScript {
  text: string;
  overrides: RubyOverride[];
}

/** Hidden bookmark on the exporter's title paragraph; re-imports keep only script lines. */
export const EXPORT_TITLE_BOOKMARK = '_FuriganaTitle';

const EXPORT_WATERMARK = /^(?:由\s*Furigana Dubbing Studio\s*自动生成.*|Furigana Dubbing Studio\s*自动注音导出)\s*$/u;

/** Drop exporter subtitle/footer lines and the blank separators they leave behind. */
export function stripExportWatermark(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const kept = lines.filter(line => !EXPORT_WATERMARK.test(line.trim()));
  let start = 0;
  let end = kept.length;
  while (start < end && kept[start].trim() === '') start += 1;
  while (end > start && kept[end - 1].trim() === '') end -= 1;
  return kept.slice(start, end).join('\n');
}

/** Strip file extensions, Android content:// document-id placeholders, and trailing `_dubbing` / `-dubbing` suffixes. */
export function cleanScriptTitle(title: string): string {
  let cleaned = title.trim().replace(/\.(?:docx|txt|srt|vtt|epub|pdf|md)$/i, '');
  cleaned = cleaned.replace(/(?:[_-]dubbing)+$/i, '');
  if (/^(?:document|msf|primary|raw|image|video|audio|downloads?):\d+$/i.test(cleaned)) return '';
  return cleaned.replace(/[\\/:*?"<>|]+/g, '_').trim();
}

/** Read body text and phonetic guides, including legacy paragraph-level ruby.
 * Ruby base text belongs to the script; ruby readings must never be duplicated
 * into the body text. DOMParser is native in the browser and Windows WebView2.
 */
export async function importDocx(arrayBuffer: ArrayBuffer): Promise<ImportedScript> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('Word document.xml is missing');
  return parseDocxXml(await file.async('string'));
}

export function parseDocxXml(source: string): ImportedScript {
  const doc = new DOMParser().parseFromString(sanitizeText(source), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid Word XML');
  const body = doc.getElementsByTagNameNS(WORD_NS, 'body')[0];
  if (!body) throw new Error('Word document body is missing');
  const paragraphs: string[] = [];
  const overrides: RubyOverride[] = [];
  for (const paragraph of Array.from(body.getElementsByTagNameNS(WORD_NS, 'p'))) {
    if (Array.from(paragraph.getElementsByTagNameNS(WORD_NS, 'bookmarkStart'))
      .some(mark => mark.getAttributeNS(WORD_NS, 'name') === EXPORT_TITLE_BOOKMARK)) continue;
    let text = '';
    const rubies: { start: number; surface: string; reading: string }[] = [];
    const plainText = (node: Element): string => Array.from(node.getElementsByTagNameNS(WORD_NS, 't')).map(value => value.textContent || '').join('');
    const walk = (node: Element) => {
      if (node.namespaceURI !== WORD_NS) {
        for (const child of Array.from(node.childNodes)) if (child.nodeType === 1) walk(child as Element);
        return;
      }
      if (node.localName === 'ruby') {
        const base = node.getElementsByTagNameNS(WORD_NS, 'rubyBase')[0];
        const rt = node.getElementsByTagNameNS(WORD_NS, 'rt')[0];
        const surface = base ? plainText(base) : '';
        if (surface && rt) rubies.push({ start: text.length, surface, reading: katakanaToHiragana(plainText(rt)) });
        text += surface;
        return;
      }
      if (node.localName === 't') { text += node.textContent || ''; return; }
      if (node.localName === 'tab') { text += '\t'; return; }
      if (node.localName === 'br' || node.localName === 'cr') { text += '\n'; return; }
      if (['rt', 'del', 'pPr', 'rPr'].includes(node.localName)) return;
      if (node !== paragraph && node.localName === 'p') return;
      for (const child of Array.from(node.childNodes)) if (child.nodeType === 1) walk(child as Element);
    };
    walk(paragraph);
    if (EXPORT_WATERMARK.test(text.trim())) continue;
    paragraphs.push(text);
    for (const ruby of rubies) {
      const before = text.slice(0, ruby.start);
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineEnd = text.indexOf('\n', ruby.start);
      overrides.push({ ...ruby, line: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd),
        start: ruby.start - lineStart, type: 'hiragana' });
    }
  }
  return { text: stripExportWatermark(paragraphs.join('\n')), overrides };
}
