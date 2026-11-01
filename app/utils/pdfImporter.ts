import {
  ScannedPdfError,
  imageLine,
  type ImportOptions,
  type ImportProgress,
  type ImportWarning,
  type ImportedBook,
  type ImportedChapter,
  type ImportedBookImage,
} from './bookAssets';
import { toImportError, throwIfAborted } from './importErrors';
import { installPdfJsCompat } from './pdfjsCompat';
import type { PdfLayout } from './libraryDatabase';
import {
  defaultCoverEncoder,
  extractPageImages,
  type EncodedImage,
  type PdfImageExtractionOptions,
  type PdfImageItem,
  type PdfImagePageLike,
} from './pdfImageExtractor';
import { sanitizeText } from './textSanitize';

export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
  fontName?: string;
  type?: string;
  actualText?: string | null;
}

/** Only `vertical` is used: it marks the fonts of a vertically set (tategaki) PDF. */
export interface PdfTextStyleLike {
  vertical?: boolean;
}

export interface PdfTextContentLike {
  items: PdfTextItem[];
  styles?: Record<string, PdfTextStyleLike>;
}

export interface PdfViewportLike {
  width: number;
  height: number;
}

export interface PdfPageLike extends PdfImagePageLike {
  getTextContent(params?: { includeMarkedContent?: boolean }): Promise<PdfTextContentLike> | PdfTextContentLike;
  /** Optional: fake loaders in tests only provide getTextContent, so a missing viewport skips the layout. */
  getViewport?(params: { scale: number }): PdfViewportLike;
  /** Release the page's decoded images once its text and illustrations are extracted. */
  cleanup?(): void;
}

export interface PdfOutlineItem {
  title: string;
  dest: unknown;
  items?: PdfOutlineItem[];
}

export interface PdfMetadataLike {
  info?: {
    Title?: string;
    Author?: string;
    Subject?: string;
    Keywords?: string;
    CreationDate?: string;
    Language?: string;
  };
  metadata?: {
    get?(name: string): unknown;
    getAll?(): Record<string, unknown>;
  } | null;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike> | PdfPageLike;
  getMetadata(): Promise<PdfMetadataLike> | PdfMetadataLike;
  getOutline(): Promise<PdfOutlineItem[] | null> | PdfOutlineItem[] | null;
  getPageIndex(ref: unknown): Promise<number> | number;
  getDestination(name: string): Promise<unknown[] | null> | unknown[] | null;
  getPageLabels?(): Promise<string[] | null> | string[] | null;
}

export type PdfLoader =
  | PdfDocumentLike
  | ((data: ArrayBuffer) => Promise<PdfDocumentLike> | PdfDocumentLike);

export interface PdfImportOptions extends ImportOptions {
  /** Test seam: render page 1 as a cover without a DOM canvas. */
  renderCover?: (page: PdfPageLike) => Promise<EncodedImage | null>;
  /** Test seam: encode one pdf.js image object without a DOM canvas. */
  encodeImage?: (image: unknown) => Promise<EncodedImage | null>;
  /** Test seam: pdf.js OPS constants (the browser extractor loads them itself). */
  ops?: PdfImageExtractionOptions['ops'];
}

const PAGE_NUMBER_RE = /^\s*[-–—―]?\s*[\d０-９]{1,4}\s*[-–—―]?\s*$/u;
const PARA_START_RE = /^[　「『（]/u;
const PARA_END_RE = /[。」』！？!?]$/u;
// ASCII lines wrap after words, sentence punctuation, or a closing bracket; CJK lines join directly.
// A trailing hyphen is deliberately absent: it is a word split, not a line break to be spaced.
const ASCII_WORD_END_RE = /[A-Za-z0-9.,!?;:%)}\]"'”’]/;
const ASCII_WORD_START_RE = /[A-Za-z0-9([{"'“‘]/;
function asciiJoin(previous: string, next: string): string {
  return ASCII_WORD_END_RE.test(previous) && ASCII_WORD_START_RE.test(next) ? ' ' : '';
}
const HEADING_PATTERN_RE =
  /^(?:第[0-9０-９一二三四五六七八九十百千]+[章話節篇部]|序章|終章|プロローグ|エピローグ|あとがき|後書き|目次|Chapter\b)/;

// Embedded CJK fonts often map glyphs to Kangxi radicals or compatibility ideographs (⼀ ⾒ ⼥) instead of
// the unified ideographs (一 見 女); NFKC folds exactly those back, and only those are touched here.
// The CJK Radicals Supplement (⻑ ⻄ ⻝ …) has no NFKC mapping; this is Unicode's EquivalentUnifiedIdeograph.txt for it.
const SUPPLEMENT_FROM = Array.from('⺁⺂⺃⺄⺅⺆⺇⺈⺉⺊⺋⺌⺍⺎⺏⺐⺑⺒⺓⺔⺕⺖⺗⺘⺙⺛⺜⺝⺞⺟⺠⺡⺢⺣⺤⺥⺦⺧⺨⺩⺪⺫⺬⺭⺮⺯⺰⺱⺲⺳⺴⺵⺶⺷⺸⺹⺺⺻⺼⺽⺾⺿⻀⻁⻂⻃⻄⻅⻆⻇⻈⻉⻊⻋⻌⻍⻎⻏⻐⻑⻒⻓⻔⻕⻖⻗⻘⻙⻚⻛⻜⻝⻞⻟⻠⻡⻢⻣⻤⻥⻦⻧⻨⻩⻪⻫⻬⻭⻮⻯⻰⻱⻲⻳');
const SUPPLEMENT_TO = Array.from('厂乛乚乙亻冂𠘨刀刂卜㔾小小兀尣尢𡯂巳幺彑𫜹忄心扌攵旡日月歺母民氵氺灬爫爫丬牛犭王𤴔目示礻𥫗糹纟罓罒㓁冗𦉫羊𦍌𦍋耂肀聿肉𦥑艹艹艹虎衤覀西见角𧢲讠贝𧾷车辶辶辶邑钅長镸长门𨸏阝雨青韦页风飞食𩙿飠饣𩠐马骨鬼鱼鸟卤麦黄黾斉齐歯齿竜龙龜亀龟');
const VERTICAL_PUNCTUATION_FROM = Array.from('︑︒︓︔︕︖︗︘︙︱︲︵︶︷︸︹︺︻︼︽︾︿﹀﹁﹂﹃﹄﹇﹈');
const VERTICAL_PUNCTUATION_TO = Array.from('、。：；！？〖〗…—―（）｛｝〔〕【】《》〈〉「」『』［］');
const SUPPLEMENT = new Map([
  ...SUPPLEMENT_FROM.map((char, index) => [char, SUPPLEMENT_TO[index]] as const),
  ...VERTICAL_PUNCTUATION_FROM.map((char, index) => [char, VERTICAL_PUNCTUATION_TO[index]] as const),
]);
const RADICALS = /[⺀-⿟豈-﫿︐-︙︰-﹏]/g;
function foldRadicals(text: string): string {
  return text.replace(RADICALS, char => SUPPLEMENT.get(char) ?? char.normalize('NFKC'));
}

function trimAscii(text: string): string {
  return text.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '');
}

function stripExtension(fileName: string): string {
  const base = fileName.replace(/^.*[/\\]/, '');
  const stripped = base.replace(/\.[^.]+$/, '').trim() || base;
  return /^(?:document|msf|primary|raw|image|video|audio|downloads?):\d+$/i.test(stripped) ? 'Untitled' : stripped;
}

/** Download-site tags in a file name are not part of the book title. */
const DOWNLOAD_SITE_TAG = /\s*\((?:[^()]*?(?:z-?lib(?:rary)?|1lib|libgen|annas-archive|b-ok)[^()]*)\)/gi;

function cleanDownloadTitle(value: string): string {
  const cleaned = value.replace(DOWNLOAD_SITE_TAG, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned || value.trim();
}

function isLikelyFilePath(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) return true;
  if (/^[A-Za-z]:/.test(value)) return true;
  if (/\.(?:pdf|docx?|txt|indd?|epub|rtf|odt)$/i.test(value)) return true;
  return false;
}

function report(options: ImportOptions, progress: ImportProgress): void {
  options.onProgress?.(progress);
}

async function defaultLoadPdf(data: ArrayBuffer, password?: string): Promise<PdfDocumentLike> {
  installPdfJsCompat();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Copied next to the page by scripts/vendor-assets.mjs; relative, so a build served under a sub-path works too.
  let base: string;
  if (typeof window !== 'undefined' && window.location?.href) {
    base = new URL('./vendor/pdfjs/', window.location.href.split(/[?#]/)[0]).href;
  } else {
    const { pathToFileURL } = await import('node:url');
    const { join } = await import('node:path');
    base = `${pathToFileURL(join(process.cwd(), 'public', 'vendor', 'pdfjs')).href}/`;
  }
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.js`;
  const params: Record<string, unknown> = {
    data: new Uint8Array(data),
    cMapUrl: `${base}cmaps/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapPacked: true,
    isEvalSupported: false,
  };
  if (password) params.password = password;
  const task = pdfjs.getDocument(params);
  return (await (task.promise ?? task)) as unknown as PdfDocumentLike;
}

interface VisualLine {
  pageIndex: number;
  text: string;
  x: number;
  y: number;
  height: number;
  /** Right edge of the line on the page, so the next item can be tested for continuing it. */
  endX?: number;
  rotated: boolean;
  /** A tategaki column rebuilt from the page, read down the column and right to left across columns. */
  vertical?: boolean;
}

interface HeadingLine {
  title: string;
  level: number;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Page size of the first page, or null when the loader exposes no usable viewport. */
function readPageSize(page: PdfPageLike): { width: number; height: number } | null {
  try {
    const viewport = page.getViewport?.({ scale: 1 });
    if (!viewport) return null;
    return positive(viewport.width) && positive(viewport.height)
      ? { width: viewport.width, height: viewport.height }
      : null;
  } catch {
    return null;
  }
}

/** Text characters in a line, ignoring whitespace. */
function glyphLength(text: string): number {
  return Array.from(text.replace(/\s+/g, '')).length;
}

/** The body size of a page: the median of the upper half, so source ruby (about half the body size) cannot pull it down. */
function bodyGlyphHeight(heights: number[]): number {
  const median = computeMedian(heights);
  if (median <= 0) return median;
  return computeMedian(heights.filter(height => height >= median)) || median;
}

/**
 * Whether a page reads in tategaki columns. A page whose font pdf.js does not report as vertical
 * arrives as one single-character item per glyph; those glyphs step down a column, never right
 * along a row. A page pdf.js already reports column by column (a vertical font) steps left from
 * column to column at the top margin instead. A horizontal page does neither — its glyphs step
 * right along a row — so its runs must never be rebuilt into columns.
 */
function pageIsVertical(lines: VisualLine[], bodyHeight: number): boolean {
  const step = Math.max(1, bodyHeight * 0.5);
  const textLines = lines.filter(line => !line.rotated && line.text.trim().length > 0);
  const singles = textLines.filter(line => glyphLength(line.text) === 1);
  let down = 0;
  let across = 0;
  for (let index = 1; index < singles.length; index += 1) {
    const dx = Math.abs(singles[index].x - singles[index - 1].x);
    const dy = Math.abs(singles[index].y - singles[index - 1].y);
    if (dy > step && dx <= step) down += 1;
    else if (dx > step && dy <= step) across += 1;
  }
  if (down >= 8 && down > across * 1.5) return true;
  // Whole columns as items: they step left at the same top margin, where horizontal lines step down.
  let columns = 0;
  let rows = 0;
  for (let index = 1; index < textLines.length; index += 1) {
    const dx = textLines[index].x - textLines[index - 1].x;
    const dy = textLines[index].y - textLines[index - 1].y;
    if (Math.abs(dy) <= step && dx < -step) columns += 1;
    else if (dy < -step) rows += 1;
  }
  return columns >= 3 && columns >= rows;
}

/**
 * A tategaki page pdf.js already reports column by column (a vertical font): the columns share the
 * top margin and spread across the page in x, the mirror image of horizontal lines, which share the
 * left margin and spread down the page in y.
 */
function isTopAlignedColumnPage(lines: VisualLine[]): boolean {
  const candidates = lines.filter(line => !line.rotated && line.text.trim().length > 0);
  if (candidates.length < 3) return false;
  const heights = candidates.map(line => line.height).filter(height => height > 0);
  const bodyHeight = bodyGlyphHeight(heights);
  // Source ruby is set much smaller than the body: its short runs start wherever their word is, not at the margin.
  const body = bodyHeight > 0 ? candidates.filter(line => line.height >= bodyHeight * 0.6) : candidates;
  if (body.length < 3) return false;
  // Columns arrive as whole runs, each one glyph wide horizontally. A page of single glyphs is the
  // per-glyph case, and a run whose horizontal span exceeds ~1.8 em is a horizontal line, never a column.
  if (body.filter(line => glyphLength(line.text) === 1).length * 2 > body.length) return false;
  if (bodyHeight > 0 && body.some(line => glyphLength(line.text) >= 2 && (line.endX ?? line.x) - line.x > bodyHeight * 1.8)) {
    return false;
  }
  const xs = body.map(line => line.x);
  const ys = body.map(line => line.y);
  const xSpread = Math.max(...xs) - Math.min(...xs);
  const ySpread = Math.max(...ys) - Math.min(...ys);
  if (xSpread <= 0 || ySpread >= xSpread) return false;
  // Columns begin at (or one indent below) the top margin; horizontal lines march down the page.
  // A short horizontal page can also spread further in x than in y (its last run ends far right),
  // so the page only counts as columns where nearly every line begins at the top.
  const top = Math.max(...ys);
  const aligned = body.filter(line => line.y >= top - Math.max(1, bodyHeight * 1.1)).length;
  if (aligned * 2 <= body.length) return false;
  return new Set(xs.map(x => Math.round(x / Math.max(1, bodyHeight * 0.5)))).size >= 2;
}

/** The right edge of a line, so the next item can be tested for continuing it. */
function lineEndX(line: VisualLine, bodyHeight: number): number {
  if (line.endX !== undefined && line.endX > line.x) return line.endX;
  return line.x + glyphLength(line.text) * (line.height || bodyHeight);
}

/**
 * pdf.js can split one horizontal line into one item per glyph, each ending its own "line" — the
 * mirror image of a tategaki page. Rejoin the items that continue each other along the baseline;
 * a wrapped line starts back at the margin, so the gap test leaves it alone.
 */
function mergeGlyphRuns(lines: VisualLine[], bodyHeight: number): VisualLine[] {
  const merged: VisualLine[] = [];
  const rowTolerance = Math.max(1, bodyHeight * 0.35);
  const inlineScriptTolerance = Math.max(1, bodyHeight * 0.65);
  // Justified Japanese text stretches the gap between glyphs, sometimes past a full em at punctuation.
  const gapTolerance = Math.max(1, bodyHeight * 1.2);
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    const gap = previous ? line.x - lineEndX(previous, bodyHeight) : 0;
    const dy = previous ? Math.abs(previous.y - line.y) : Infinity;
    const isInlineScript =
      previous !== undefined &&
      line.x >= previous.x &&
      (line.height < previous.height * 0.85 || previous.height < line.height * 0.85) &&
      dy <= inlineScriptTolerance;
    const continues = previous !== undefined
      && previous.pageIndex === line.pageIndex
      && !previous.rotated
      && !line.rotated
      && (dy <= rowTolerance || isInlineScript)
      && gap >= -gapTolerance
      && gap <= gapTolerance;
    if (!continues) {
      merged.push(line);
      continue;
    }
    const previousText = previous.text;
    const joiner = asciiJoin(previousText.slice(-1), line.text[0] ?? '');
    const keepPreviousBaseline = line.height < previous.height * 0.85;
    merged[merged.length - 1] = {
      ...previous,
      y: keepPreviousBaseline ? previous.y : (previous.height < line.height * 0.85 ? line.y : previous.y),
      text: previousText + joiner + line.text,
      endX: Math.max(lineEndX(previous, bodyHeight), lineEndX(line, bodyHeight)),
      height: Math.max(previous.height, line.height),
    };
  }
  return merged;
}

function itemGlyphHeight(item: PdfTextItem): number {
  const t = item.transform;
  if (Array.isArray(t) && (t[1] ?? 0) !== 0) {
    return Math.abs(t[3] || t[0] || t[2] || t[1] || 0) || (typeof item.height === 'number' && item.height > 0 ? item.height : 0);
  }
  if (typeof item.height === 'number' && item.height > 0) return item.height;
  if (!Array.isArray(t)) return 0;
  return Math.abs(t[3] || t[0] || t[2] || t[1] || 0);
}

/** Rebuild tategaki columns from per-glyph items: glyphs sharing an x, read top to bottom. */
function glyphColumns(lines: VisualLine[], tolerance: number, bodyHeight: number): VisualLine[] {
  const groups: { x: number; lines: VisualLine[] }[] = [];
  for (const line of lines) {
    const matchTolerance = line.rotated ? tolerance * 1.5 : tolerance;
    let nearest: { x: number; lines: VisualLine[] } | null = null;
    let nearestDistance = Infinity;
    for (const group of groups) {
      const distance = Math.abs(group.x - line.x);
      if (distance <= matchTolerance && distance < nearestDistance) {
        nearest = group;
        nearestDistance = distance;
      }
    }
    if (nearest) {
      // A column's x can jitter by a fraction of a point; track its mean so the group stays put.
      nearest.x = (nearest.x * nearest.lines.length + line.x) / (nearest.lines.length + 1);
      nearest.lines.push(line);
    } else {
      groups.push({ x: line.x, lines: [line] });
    }
  }
  return groups
    .sort((a, b) => b.x - a.x)
    .map(group => {
      const glyphs = [...group.lines].sort((a, b) => b.y - a.y);
      // If a bottom-margin folio (single item or per-digit glyphs) happens to align with a column's x,
      // drop the trailing cluster after the margin gap before joining the column.
      if (glyphs.length > 1 && bodyHeight > 0) {
        let splitIndex = -1;
        const minSplit = Math.max(1, glyphs.length - 6);
        for (let index = glyphs.length - 1; index >= minSplit; index -= 1) {
          if (glyphs[index - 1].y - glyphs[index].y > bodyHeight * 2.5) {
            splitIndex = index;
            break;
          }
        }
        if (splitIndex > 0) {
          const tailText = glyphs.slice(splitIndex).map(glyph => glyph.text).join('');
          if (PAGE_NUMBER_RE.test(tailText)) {
            glyphs.splice(splitIndex);
          }
        }
      }
      let text = '';
      for (const glyph of glyphs) {
        const previous = text[text.length - 1] || '';
        const next = glyph.text[0] || '';
        text += `${asciiJoin(previous, next)}${glyph.text}`;
      }
      return {
        pageIndex: glyphs[0].pageIndex,
        text,
        x: group.x,
        y: Math.max(...glyphs.map(glyph => glyph.y)),
        height: computeMedian(glyphs.map(glyph => glyph.height).filter(height => height > 0)),
        rotated: false,
        vertical: true,
      };
    });
}

/** Digits (ASCII or full-width) become `#` so "第 3 章 · 12" and "第 3 章 · 13" share a running-head key. */
function runningHeadKey(text: string): string {
  return text.replace(/[\d０-９]+/g, '#').replace(/\s+/g, '');
}

/**
 * Remove a line repeated in the top/bottom margin of at least three pages (book title, chapter name,
 * folio). Conservative by design: short line, small type, within the outer 6% of the page, and the
 * same normalised text on enough pages. Footnotes at the page bottom stay exactly where they are.
 */
function stripRunningHeads(
  lines: VisualLine[],
  pageSizes: Map<number, { width: number; height: number }>,
  bodyHeight: number,
): { lines: VisualLine[]; removed: number } {
  if (pageSizes.size < 3 || bodyHeight <= 0) return { lines, removed: 0 };
  const candidates = new Map<VisualLine, string>();
  for (const line of lines) {
    const size = pageSizes.get(line.pageIndex);
    if (!size || line.text.trim().length === 0) continue;
    if (glyphLength(line.text) > 40 || line.height > bodyHeight * 0.95) continue;
    const topBand = size.height * 0.94;
    const bottomBand = size.height * 0.06;
    if (line.y < topBand && line.y > bottomBand) continue;
    candidates.set(line, runningHeadKey(line.text));
  }
  if (candidates.size === 0) return { lines, removed: 0 };

  const pagesByKey = new Map<string, Set<number>>();
  for (const [line, key] of candidates) {
    const pages = pagesByKey.get(key) ?? new Set<number>();
    pages.add(line.pageIndex);
    pagesByKey.set(key, pages);
  }
  const threshold = Math.max(3, Math.ceil(pageSizes.size * 0.2));
  const drop = new Set<VisualLine>();
  for (const [line, key] of candidates) {
    if ((pagesByKey.get(key)?.size ?? 0) >= threshold) drop.add(line);
  }
  if (drop.size === 0) return { lines, removed: 0 };
  return { lines: lines.filter(line => !drop.has(line)), removed: drop.size };
}

/** Heading candidates for a PDF without an outline: larger type at a gap/page start, or a chapter pattern. */
function findHeadingLines(lines: VisualLine[], bodyHeight: number): Map<VisualLine, HeadingLine> {
  const headings = new Map<VisualLine, HeadingLine>();
  if (bodyHeight <= 0) return headings;
  let previous: VisualLine | null = null;
  for (const line of lines) {
    if (line.rotated || line.vertical) {
      previous = line;
      continue;
    }
    const text = line.text.trim();
    const length = glyphLength(text);
    if (!text || length === 0 || length > 40 || PAGE_NUMBER_RE.test(text)) {
      previous = line;
      continue;
    }
    const pattern = HEADING_PATTERN_RE.test(text);
    const large = line.height >= bodyHeight * 1.3;
    const firstOnPage = previous === null || previous.pageIndex !== line.pageIndex;
    const gapBefore = previous && previous.pageIndex === line.pageIndex ? Math.abs(previous.y - line.y) : Infinity;
    if (pattern || (large && (firstOnPage || gapBefore >= bodyHeight * 1.5))) {
      // A chapter-pattern line is a top-level chapter even at body size; type size only ranks
      // headings that have no recognisable chapter wording.
      const level = pattern ? 0 : line.height >= bodyHeight * 1.6 ? 0 : large ? 1 : 2;
      headings.set(line, { title: text, level });
    }
    previous = line;
  }
  return headings;
}

function parsePdfDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?/.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day] = match;
  return `${year}${month ? `-${month}` : ''}${day ? `-${day}` : ''}`;
}

function xmpValue(metadata: PdfMetadataLike['metadata'], name: string): string {
  try {
    const value = metadata?.get?.(name);
    return typeof value === 'string' ? sanitizeText(value).trim() : '';
  } catch {
    return '';
  }
}

/** Add image lines to paragraphs and return the final line array plus each paragraph's output line. */
function insertImages(
  paragraphs: string[],
  paragraphFirst: { pageIndex: number; y: number }[],
  images: PdfImageItem[],
): { lines: string[]; paragraphLine: number[]; imageLines: Map<string, number> } {
  const insertions = new Map<number, PdfImageItem[]>();
  for (const image of images) {
    let target = paragraphs.length;
    for (let index = 0; index < paragraphFirst.length; index += 1) {
      const first = paragraphFirst[index];
      if (first.pageIndex > image.pageIndex) {
        target = index;
        break;
      }
      if (first.pageIndex === image.pageIndex) {
        // Images sit at the head of their page: before the page's first paragraph.
        target = index;
        break;
      }
    }
    const list = insertions.get(target) ?? [];
    list.push(image);
    insertions.set(target, list);
  }

  const lines: string[] = [];
  const paragraphLine: number[] = [];
  const imageLines = new Map<string, number>();
  for (let index = 0; index <= paragraphs.length; index += 1) {
    for (const image of insertions.get(index) ?? []) {
      imageLines.set(image.id, lines.length);
      lines.push(imageLine(image.id));
    }
    if (index < paragraphs.length) {
      paragraphLine[index] = lines.length;
      lines.push(paragraphs[index]);
    }
  }
  return { lines, paragraphLine, imageLines };
}

function headingKey(value: string): string {
  return value
    .replace(/^[\s　]+|[\s　]+$/g, '')
    .replace(/^[○●◎◯■□◆◇▲△▼▽※・*＊#＃]+/, '')
    .replace(/[\s　]+/g, ' ')
    .trim();
}

/**
 * Some PDFs point several bookmarks at one page, collapsing a section into its neighbour. When the
 * chapter title appears as a short heading line near the mapped position, prefer that line so both
 * sections stay reachable in the reader.
 */
function refineChapterStarts(chapters: ImportedChapter[], lines: string[]): ImportedChapter[] {
  if (!chapters.length) return chapters;
  const keys = lines.map(headingKey);
  const refined = chapters.map(chapter => ({ ...chapter }));
  for (let index = 0; index < refined.length; index += 1) {
    const chapter = refined[index];
    const key = headingKey(chapter.title);
    if (!key) continue;
    const mapped = chapter.startLine;
    const previous = index > 0 ? refined[index - 1].startLine : -1;
    const next = index + 1 < refined.length ? chapters[index + 1].startLine : lines.length;
    const from = Math.max(previous + 1, mapped - 12, 0);
    const to = Math.min(next - 1, mapped + 12, lines.length - 1);
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let line = from; line <= to; line += 1) {
      if (keys[line] !== key) continue;
      const distance = Math.abs(line - mapped);
      if (distance < bestDistance) {
        best = line;
        bestDistance = distance;
      }
    }
    if (best >= 0) chapter.startLine = best;
  }
  return refined;
}

export async function importPdf(
  data: ArrayBuffer,
  fileName: string,
  loader?: PdfLoader,
  options: PdfImportOptions = {},
): Promise<ImportedBook> {
  report(options, { stage: 'reading', current: 0 });

  let doc: PdfDocumentLike;
  try {
    doc = !loader
      ? await defaultLoadPdf(data, options.password)
      : typeof loader === 'function'
        ? await loader(data)
        : loader;
  } catch (error) {
    throw toImportError(error);
  }

  const visualLines: VisualLine[] = [];
  let nonWhitespaceCount = 0;
  // Source layout measures: the first page's size, plus how much of the text is set in vertical fonts.
  let pageSize: { width: number; height: number } | null = null;
  const pageSizes = new Map<number, { width: number; height: number }>();
  let verticalCharCount = 0;
  let textCharCount = 0;
  const verticalGlyphWidths: number[] = [];
  let firstPage: PdfPageLike | null = null;
  const extractedImages: PdfImageItem[] = [];
  const seenImages = new Set<string>();
  let imagesFailed = 0;

  const canRenderCover = Boolean(options.renderCover)
    || (typeof document !== 'undefined');

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    throwIfAborted(options.signal);
    const pageIndex = pageNum - 1;
    report(options, { stage: 'text', current: pageNum, total: doc.numPages });
    const page = await doc.getPage(pageNum);
    if (pageNum === 1) {
      firstPage = page;
      pageSize = readPageSize(page);
    }
    const pageViewportSize = readPageSize(page);
    if (pageViewportSize) pageSizes.set(pageIndex, pageViewportSize);

    const content = await page.getTextContent({ includeMarkedContent: true });
    const styles: Record<string, PdfTextStyleLike> = content.styles ?? {};
    let currentItems: PdfTextItem[] = [];
    let pageChars = 0;
    const mcStack: { actualText: string | null; consumed: boolean }[] = [];

    const flushVisualLine = () => {
      if (currentItems.length === 0) return;
      const rawText = foldRadicals(currentItems.map(it => it.str).join(''));
      const text = trimAscii(rawText);
      const items = currentItems;
      currentItems = [];
      if (!text || text.trim().length === 0) return;

      const x = items[0].transform?.[4] ?? 0;
      const y = items[0].transform?.[5] ?? 0;
      let height = 0;
      let endX = x;
      for (const it of items) {
        const h = itemGlyphHeight(it);
        if (h > height) height = h;
        const width = typeof it.width === 'number' && it.width > 0 ? it.width : 0;
        const right = (it.transform?.[4] ?? 0) + width;
        if (right > endX) endX = right;
      }
      const rotated = items.some(it => (it.transform?.[1] ?? 0) !== 0);
      visualLines.push({ pageIndex, text, x, y, height, endX, rotated });
    };

    for (const item of content.items) {
      if (!item) continue;
      if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') {
        const sanitizedActual = typeof item.actualText === 'string' ? sanitizeText(item.actualText) : null;
        const actualText = sanitizedActual && sanitizedActual.length > 0 ? sanitizedActual : null;
        if (actualText !== null) flushVisualLine();
        mcStack.push({ actualText, consumed: false });
        continue;
      }
      if (item.type === 'endMarkedContent') {
        const popped = mcStack.pop();
        if (popped?.actualText !== null && popped?.actualText !== undefined) flushVisualLine();
        continue;
      }
      if (typeof item.str !== 'string') continue;

      const topSpan = mcStack.length > 0 ? mcStack[mcStack.length - 1] : null;
      const activeSpan = topSpan && topSpan.actualText !== null ? topSpan : null;
      // pdf.js can emit a synthetic whitespace/EOL item before the real glyph inside a
      // /Span <</ActualText ...>> BDC block; reserve actualText for the glyph itself.
      const isSyntheticSpace =
        item.str.trim() === '' &&
        (item.width === 0 || item.height === 0 || (activeSpan !== null && activeSpan.actualText?.trim() !== ''));
      let str = '';
      if (activeSpan && !isSyntheticSpace) {
        if (!activeSpan.consumed) {
          str = activeSpan.actualText ?? '';
          activeSpan.consumed = true;
        } else if (currentItems.length > 0) {
          currentItems.push({ ...item, str: '' });
          if (item.hasEOL) flushVisualLine();
          continue;
        }
      } else if (!activeSpan) {
        // pdf.js writes "\u0000" for glyphs whose font has no Unicode mapping (CID 0 / .notdef).
        // Those bytes are not text: they crash the tokenizer, count toward the scanned-PDF
        // threshold and would travel into the stored book, so they are dropped on extraction.
        str = sanitizeText(item.str);
      }
      if (str === '') {
        if (item.hasEOL) flushVisualLine();
        continue;
      }
      const charCount = str.replace(/\s+/g, '').length;
      nonWhitespaceCount += charCount;
      pageChars += charCount;
      // Vertical detection is per font: a CJK vertical font renders glyphs rotated 90° via its own metrics.
      const isVerticalFont = Boolean(item.fontName && styles[item.fontName]?.vertical === true);
      if (charCount > 0) {
        textCharCount += charCount;
        if (isVerticalFont) {
          verticalCharCount += charCount;
          const glyphWidth = Math.abs(item.transform?.[0] ?? 0);
          if (glyphWidth > 0) verticalGlyphWidths.push(glyphWidth);
        }
      }
      if (currentItems.length > 0) {
        const prev = currentItems[currentItems.length - 1];
        const prevRot = (prev.transform?.[1] ?? 0) !== 0;
        const currRot = (item.transform?.[1] ?? 0) !== 0;
        const prevH = itemGlyphHeight(prev);
        const currH = itemGlyphHeight(item);
        const refH = Math.max(prevH, currH, 1);
        const prevY = prev.transform?.[5] ?? 0;
        const currY = item.transform?.[5] ?? 0;
        const prevX = prev.transform?.[4] ?? 0;
        const currX = item.transform?.[4] ?? 0;
        if (
          prevRot !== currRot ||
          (prevH > 0 && currH > 0 && Math.abs(prevH - currH) > Math.min(prevH, currH) * 0.25) ||
          (!prevRot && !currRot && !isVerticalFont && (Math.abs(prevY - currY) > refH * 0.35 || currX < prevX - refH * 0.25))
        ) {
          flushVisualLine();
        }
      }
      currentItems.push({ ...item, str });
      if (item.hasEOL) {
        flushVisualLine();
      }
    }
    flushVisualLine();

    // Illustration pages are the ones with little or no text; a text-heavy page's figures are rare
    // enough that skipping operator-list work there keeps a 1000-page novel import quick.
    if (pageChars < 500 && !(pageIndex === 0 && canRenderCover)) {
      throwIfAborted(options.signal);
      report(options, { stage: 'images', current: pageIndex + 1, total: doc.numPages });
      const extracted = await extractPageImages(page, pageIndex, pageViewportSize, {
        signal: options.signal,
        encodeImage: options.encodeImage,
        ops: options.ops,
        pageTextChars: pageChars,
        seen: seenImages,
      });
      extractedImages.push(...extracted.images);
      imagesFailed += extracted.failed;
    }
    if (page !== firstPage) {
      try {
        page.cleanup?.();
      } catch {
        // A page that cannot release its resources must not fail the import.
      }
    }
  }

  const minChars = Math.max(30, doc.numPages * 15);
  if (nonWhitespaceCount < minChars) {
    throw new ScannedPdfError();
  }

  // Measure body type away from the outer margins: a short page can carry more running-head and
  // folio lines than body lines, and counting those would make the body look smaller than it is.
  const pageHeightForCleanup = bodyGlyphHeight(
    visualLines
      .filter(line => {
        if (line.rotated || line.height <= 0) return false;
        const size = pageSizes.get(line.pageIndex);
        if (!size) return true;
        return line.y <= size.height * 0.94 && line.y >= size.height * 0.06;
      })
      .map(line => line.height),
  );
  const cleaned = stripRunningHeads(visualLines, pageSizes, pageHeightForCleanup);
  const linesForAssembly = cleaned.lines;

  // A tategaki page drawn with a horizontal font arrives as one glyph per item, so the paragraph
  // joiner would otherwise turn every character into its own line. Rebuild the columns first:
  // glyphs at one x read top to bottom, columns right to left. A page pdf.js already reports
  // column by column only needs the reading order fixed.
  const logicalLines: VisualLine[] = [];
  const verticalTop = new Map<number, number>();
  const verticalStep = new Map<number, number>();
  for (const pageIndex of [...new Set(linesForAssembly.map(line => line.pageIndex))]) {
    const pageLines = linesForAssembly.filter(line => line.pageIndex === pageIndex);
    const pageHeights = pageLines.filter(line => !line.rotated && line.height > 0).map(line => line.height);
    const bodyHeight = bodyGlyphHeight(pageHeights);
    const tolerance = Math.max(1, bodyHeight * 0.25);
    // Source ruby is set much smaller than the body; the app annotates the text again, so those
    // glyphs are left out of the columns instead of being read as text.
    const bodyLines = pageLines.filter(line => !line.rotated && (bodyHeight <= 0 || line.height >= bodyHeight * 0.6));
    const rotatedLines = pageLines.filter(line => line.rotated);
    let columns: VisualLine[] | null = null;
    let remainingRotated: VisualLine[] = rotatedLines;
    if (pageIsVertical(pageLines, bodyHeight)) {
      const verticalBodyLines = pageLines.filter(line => bodyHeight <= 0 || line.height >= bodyHeight * 0.6);
      columns = glyphColumns(verticalBodyLines, tolerance, bodyHeight);
      remainingRotated = [];
    } else if (isTopAlignedColumnPage(pageLines)) {
      columns = bodyLines;
    }
    if (!columns) {
      // A horizontal page split into one item per glyph: rejoin the runs that continue each
      // other along the baseline, then let the horizontal paragraph rules below do the rest.
      logicalLines.push(
        ...mergeGlyphRuns(pageLines, bodyHeight).filter(line => !PAGE_NUMBER_RE.test(line.text)),
      );
      continue;
    }
    columns.sort((a, b) => b.x - a.x);
    const rawPageTop = columns.length > 0 ? Math.max(...columns.map(line => line.y)) : 0;
    const verticalColumns = columns
      .map(line => ({ ...line, vertical: true }))
      .filter(
        line =>
          !PAGE_NUMBER_RE.test(line.text) ||
          (columns.length > 1 && bodyHeight > 0 && rawPageTop - line.y <= bodyHeight * 3),
      );
    logicalLines.push(
      ...verticalColumns,
      ...remainingRotated.filter(line => !PAGE_NUMBER_RE.test(line.text)),
    );
    if (verticalColumns.length > 0) {
      verticalTop.set(pageIndex, Math.max(...verticalColumns.map(line => line.y)));
    }
    const steps: number[] = [];
    for (let index = 1; index < verticalColumns.length; index += 1) {
      steps.push(Math.abs(verticalColumns[index - 1].x - verticalColumns[index].x));
    }
    verticalStep.set(pageIndex, computeMedian(steps.filter(step => step > 0)));
  }

  // Source layout for batch export: page size from page 1, direction by character majority, and the
  // median glyph size (vertical glyphs are rotated, so their size lives in transform[0]).
  const verticalByFont = textCharCount > 0 && verticalCharCount * 2 > textCharCount;
  const verticalChars = logicalLines
    .filter(line => line.vertical)
    .reduce((sum, line) => sum + glyphLength(line.text), 0);
  const totalLogicalChars = logicalLines.reduce((sum, line) => sum + glyphLength(line.text), 0);
  const vertical = verticalByFont || (totalLogicalChars > 0 && verticalChars * 2 > totalLogicalChars);

  // Layout measures for horizontal text: the usual distance between baselines (a paragraph gap is clearly
  // more than that) and each page's left margin (a first line set in from it is a paragraph indent).
  const horizontalLines = logicalLines.filter(line => !line.rotated && !line.vertical && line.height > 0);
  const medianLineHeight = computeMedian(horizontalLines.map(line => line.height));
  const medianVerticalHeight = computeMedian(
    logicalLines.filter(line => line.vertical && line.height > 0).map(line => line.height),
  );
  // Indentation of a tategaki paragraph is measured against the same glyph size as a horizontal one.
  const paragraphHeight = medianLineHeight || medianVerticalHeight;
  const baselineSteps: number[] = [];
  const leftMargin = new Map<number, number>();
  let previousHorizontal: VisualLine | null = null;
  for (const line of logicalLines) {
    if (line.rotated || line.vertical) {
      previousHorizontal = null;
      continue;
    }
    leftMargin.set(line.pageIndex, Math.min(leftMargin.get(line.pageIndex) ?? Infinity, line.x));
    if (previousHorizontal && previousHorizontal.pageIndex === line.pageIndex) {
      baselineSteps.push(Math.abs(previousHorizontal.y - line.y));
    }
    previousHorizontal = line;
  }
  const medianStep = computeMedian(baselineSteps.filter(step => step > 0));

  // A layout is only worth storing when both the page size and a glyph size are known.
  // Horizontal text measures its size as the visual line height; vertical glyphs are rotated, so their
  // size lives in transform[0]. The fallback keeps a vertical page with no measured advance usable.
  const layoutFontSize = vertical
    ? (computeMedian(verticalGlyphWidths) || medianVerticalHeight || computeMedian(logicalLines.map(line => line.height).filter(height => height > 0)))
    : medianLineHeight;
  // Rounded to 0.1 so a stored layout survives a JSON round-trip without float noise.
  const pdfLayout: PdfLayout | undefined = pageSize && layoutFontSize > 0
    ? {
      pageWidth: roundTenth(pageSize.width),
      pageHeight: roundTenth(pageSize.height),
      vertical,
      fontSize: roundTenth(layoutFontSize),
    }
    : undefined;

  const headings = findHeadingLines(logicalLines, paragraphHeight);
  const paragraphs: string[] = [];
  const paragraphFirst: { pageIndex: number; y: number }[] = [];
  const firstParaStartingOnPage = new Map<number, number>();
  const firstParaTouchingPage = new Map<number, number>();
  const autoChapterStarts: ImportedChapter[] = [];
  let prevLine: VisualLine | null = null;

  for (const line of logicalLines) {
    const heading = headings.get(line);
    let startNewParagraph = false;
    if (!prevLine) {
      startNewParagraph = true;
    } else if (heading) {
      // A chapter title always starts its own line, even when the previous line has no closing punctuation.
      startNewParagraph = true;
    } else if (headings.has(prevLine)) {
      // Body text after a heading always starts a new paragraph, even without punctuation.
      startNewParagraph = true;
    } else if (PARA_START_RE.test(line.text)) {
      startNewParagraph = true;
    } else if (PARA_END_RE.test(prevLine.text)) {
      startNewParagraph = true;
    } else if (line.vertical !== prevLine.vertical || line.rotated !== prevLine.rotated) {
      // A horizontal title/author block and tategaki body text never share a paragraph. Joining them
      // used to glue a title-page author name onto the first column of the copyright page.
      startNewParagraph = true;
    } else if (line.vertical && prevLine.vertical) {
      // Tategaki columns: a blank column on the same page is a paragraph gap, and a column that
      // starts below the page's top margin is an indented first line — the vertical counterparts
      // of the two horizontal rules below.
      const columnStep = verticalStep.get(line.pageIndex) ?? 0;
      const top = verticalTop.get(line.pageIndex);
      if (line.pageIndex === prevLine.pageIndex && columnStep > 0 && Math.abs(prevLine.x - line.x) > 1.5 * columnStep) {
        startNewParagraph = true;
      } else if (top !== undefined && paragraphHeight > 0 && top - line.y > 0.5 * paragraphHeight) {
        startNewParagraph = true;
      }
    } else if (
      !prevLine.vertical &&
      !line.vertical &&
      prevLine.pageIndex === line.pageIndex &&
      !prevLine.rotated &&
      !line.rotated &&
      medianStep > 0 &&
      Math.abs(prevLine.y - line.y) > 1.5 * medianStep
    ) {
      startNewParagraph = true;
    } else if (
      !line.vertical &&
      !line.rotated &&
      medianLineHeight > 0 &&
      line.x - (leftMargin.get(line.pageIndex) ?? line.x) > 0.5 * medianLineHeight
    ) {
      startNewParagraph = true;
    }

    if (startNewParagraph) {
      const paraIndex = paragraphs.length;
      paragraphs.push(line.text);
      paragraphFirst.push({ pageIndex: line.pageIndex, y: line.y });
      if (heading) autoChapterStarts.push({ title: heading.title, startLine: paraIndex, level: heading.level, page: line.pageIndex + 1 });
      if (!firstParaStartingOnPage.has(line.pageIndex)) {
        firstParaStartingOnPage.set(line.pageIndex, paraIndex);
      }
      if (!firstParaTouchingPage.has(line.pageIndex)) {
        firstParaTouchingPage.set(line.pageIndex, paraIndex);
      }
    } else {
      const paraIndex = paragraphs.length - 1;
      const currentPara = paragraphs[paraIndex];
      const prevChar = currentPara[currentPara.length - 1] || '';
      const nextChar = line.text[0] || '';
      const sep = asciiJoin(prevChar, nextChar);
      paragraphs[paraIndex] = currentPara + sep + line.text;
      if (!firstParaTouchingPage.has(line.pageIndex)) {
        firstParaTouchingPage.set(line.pageIndex, paraIndex);
      }
    }

    prevLine = line;
  }

  const extractedChars = paragraphs.reduce((sum, para) => sum + para.replace(/\s+/g, '').length, 0);
  if (extractedChars < minChars) {
    throw new ScannedPdfError();
  }

  const fallbackTitle = cleanDownloadTitle(stripExtension(fileName));
  let title = fallbackTitle;
  let author = '';
  let description = '';
  let language = '';
  let publisher = '';
  let publishedAt = '';
  let identifier = '';
  try {
    const metadata = await doc.getMetadata();
    const rawTitle = cleanDownloadTitle(sanitizeText(metadata?.info?.Title ?? '').trim());
    if (rawTitle && !isLikelyFilePath(rawTitle)) {
      title = rawTitle;
    }
    author = sanitizeText(metadata?.info?.Author ?? '').trim();
    description = sanitizeText(metadata?.info?.Subject ?? '').trim();
    publishedAt = parsePdfDate(metadata?.info?.CreationDate) ?? '';
    language = xmpValue(metadata?.metadata, 'dc:language') || sanitizeText(metadata?.info?.Language ?? '').trim();
    publisher = xmpValue(metadata?.metadata, 'dc:publisher');
    identifier = xmpValue(metadata?.metadata, 'dc:identifier');
    if (!publishedAt) publishedAt = parsePdfDate(xmpValue(metadata?.metadata, 'dc:date')) ?? '';
    if (!description) description = xmpValue(metadata?.metadata, 'dc:description');
  } catch {
    // Ignore metadata failures and keep fallback title/author.
  }

  // Outline chapters, depth preserved. A parent without a destination promotes its children.
  const outlineChapters: ImportedChapter[] = [];
  try {
    const outline = await doc.getOutline();
    const collect = async (items: PdfOutlineItem[], level: number): Promise<void> => {
      for (const item of items) {
        const chapterTitle = sanitizeText(item?.title ?? '').trim();
        let pushed = false;
        if (chapterTitle) {
          try {
            let destArray: unknown[] | null = null;
            if (typeof item.dest === 'string') {
              destArray = await doc.getDestination(item.dest);
            } else if (Array.isArray(item.dest)) {
              destArray = item.dest;
            }
            if (Array.isArray(destArray) && destArray.length > 0) {
              const pageIndex = await doc.getPageIndex(destArray[0]);
              const startLine = firstParaStartingOnPage.get(pageIndex) ?? firstParaTouchingPage.get(pageIndex);
              if (startLine !== undefined) {
                outlineChapters.push({
                  title: chapterTitle,
                  startLine,
                  level: Math.min(2, level),
                  page: pageIndex + 1,
                });
                pushed = true;
              }
            }
          } catch {
            // Ignore unresolvable outline destinations.
          }
        }
        if (item.items?.length) {
          await collect(item.items, pushed ? Math.min(2, level + 1) : level);
        }
      }
    };
    if (Array.isArray(outline)) await collect(outline, 0);
  } catch {
    // Ignore outline failures.
  }

  report(options, { stage: 'chapters', current: 1, total: 1 });
  const warnings: ImportWarning[] = [];
  const chapters = outlineChapters.length > 0
    ? outlineChapters
    : autoChapterStarts.length >= 2
      ? autoChapterStarts
      : [];
  if (outlineChapters.length === 0 && autoChapterStarts.length >= 2) {
    warnings.push({ code: 'auto-chapters', count: autoChapterStarts.length });
  }
  if (cleaned.removed > 0) {
    warnings.push({ code: 'running-heads-removed', count: cleaned.removed });
  }

  // Cover: render page 1. A rendered cover replaces page-1 image extraction, so a full-page cover
  // scan is not stored twice.
  let cover: EncodedImage | undefined;
  if (firstPage) {
    report(options, { stage: 'cover', current: 1, total: 1 });
    try {
      const encoder = options.renderCover ?? defaultCoverEncoder;
      const rendered = await encoder(firstPage);
      if (rendered) cover = rendered;
    } catch {
      // A cover is nice to have; a render failure never fails the import.
    } finally {
      try {
        firstPage.cleanup?.();
      } catch {
        // Best effort: the page's bitmaps are already encoded or no longer needed.
      }
    }
  }
  if (!cover) warnings.push({ code: 'missing-cover' });

  // Image lines use the shared `￼img-N` shape, so ids are renumbered across pages.
  extractedImages.forEach((image, index) => {
    image.id = `img-${index + 1}`;
  });
  // Illustrations are inserted at the head of their page; chapter and page mappings shift by the
  // number of image lines that precede them.
  const images: ImportedBookImage[] = extractedImages.map(image => ({
    id: image.id,
    mime: image.mime,
    data: image.data,
  }));
  if (imagesFailed > 0) warnings.push({ code: 'images-skipped', count: imagesFailed });
  const inserted = insertImages(paragraphs, paragraphFirst, extractedImages);
  const text = inserted.lines.join('\n');
  const mappedChapters = chapters.map(chapter => ({
    ...chapter,
    startLine: inserted.paragraphLine[chapter.startLine] ?? chapter.startLine,
  }));
  const finalChapters = refineChapterStarts(mappedChapters, inserted.lines);

  // A page can open with an illustration and have no text of its own (cover, colour page, contents
  // scan). Mapping those pages to their first image line keeps the reader's original-page HUD correct
  // for image lines instead of showing nothing until the first text page.
  const firstImageLine = new Map<number, number>();
  for (const image of extractedImages) {
    const line = inserted.imageLines.get(image.id);
    if (line === undefined) continue;
    const current = firstImageLine.get(image.pageIndex);
    if (current === undefined || line < current) firstImageLine.set(image.pageIndex, line);
  }
  const pageStarts: number[] = [];
  let lastStart = -1;
  for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex += 1) {
    const paragraphIndex = firstParaTouchingPage.get(pageIndex);
    const textLine = paragraphIndex === undefined ? undefined : inserted.paragraphLine[paragraphIndex];
    const imageLine = firstImageLine.get(pageIndex);
    const raw = textLine === undefined
      ? imageLine
      : imageLine === undefined ? textLine : Math.min(textLine, imageLine);
    // A paragraph can span a page break; keep the mapping non-decreasing so it survives validation.
    const start = raw === undefined ? -1 : Math.max(raw, lastStart);
    if (start >= 0) lastStart = start;
    pageStarts.push(start);
  }

  let pageLabels: string[] | undefined;
  try {
    const labels = await doc.getPageLabels?.();
    if (Array.isArray(labels) && labels.length === doc.numPages) {
      pageLabels = labels.map(label => sanitizeText(String(label ?? '')).slice(0, 40));
    }
  } catch {
    // Page labels are optional.
  }

  report(options, { stage: 'done', current: 1, total: 1 });
  return {
    title,
    author,
    text,
    overrides: [],
    chapters: finalChapters,
    images,
    warnings,
    ...(description ? { description } : {}),
    ...(language ? { language } : {}),
    ...(publisher ? { publisher } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(identifier ? { identifier } : {}),
    ...(pdfLayout ? { pdfLayout } : {}),
    ...(pageStarts.length ? { pageStarts } : {}),
    ...(pageLabels ? { pageLabels } : {}),
    ...(cover ? { cover } : {}),
  };
}
