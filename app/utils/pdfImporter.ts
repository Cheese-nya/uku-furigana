import { ScannedPdfError, type ImportedBook } from './bookAssets';
import type { PdfLayout } from './libraryDatabase';
import { sanitizeText } from './textSanitize';

export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
  fontName?: string;
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

export interface PdfPageLike {
  getTextContent(): Promise<PdfTextContentLike> | PdfTextContentLike;
  /** Optional: fake loaders in tests only provide getTextContent, so a missing viewport skips the layout. */
  getViewport?(params: { scale: number }): PdfViewportLike;
}

export interface PdfOutlineItem {
  title: string;
  dest: unknown;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike> | PdfPageLike;
  getMetadata():
    | Promise<{ info?: { Title?: string; Author?: string } }>
    | { info?: { Title?: string; Author?: string } };
  getOutline(): Promise<PdfOutlineItem[] | null> | PdfOutlineItem[] | null;
  getPageIndex(ref: unknown): Promise<number> | number;
  getDestination(name: string): Promise<unknown[] | null> | unknown[] | null;
}

export type PdfLoader =
  | PdfDocumentLike
  | ((data: ArrayBuffer) => Promise<PdfDocumentLike> | PdfDocumentLike);

const PAGE_NUMBER_RE = /^\s*[-–—―]?\s*[\d\uFF10-\uFF19]{1,4}\s*[-–—―]?\s*$/u;
const PARA_START_RE = /^[\u3000「『（]/u;
const PARA_END_RE = /[。」』！？!?]$/u;
const ASCII_ALNUM_RE = /^[A-Za-z0-9]$/;

// Embedded CJK fonts often map glyphs to Kangxi radicals or compatibility ideographs (⼀ ⾒ ⼥) instead of
// the unified ideographs (一 見 女); NFKC folds exactly those back, and only those are touched here.
// The CJK Radicals Supplement (⻑ ⻄ ⻝ …) has no NFKC mapping; this is Unicode's EquivalentUnifiedIdeograph.txt for it.
const SUPPLEMENT_FROM = Array.from('⺁⺂⺃⺄⺅⺆⺇⺈⺉⺊⺋⺌⺍⺎⺏⺐⺑⺒⺓⺔⺕⺖⺗⺘⺙⺛⺜⺝⺞⺟⺠⺡⺢⺣⺤⺥⺦⺧⺨⺩⺪⺫⺬⺭⺮⺯⺰⺱⺲⺳⺴⺵⺶⺷⺸⺹⺺⺻⺼⺽⺾⺿⻀⻁⻂⻃⻄⻅⻆⻇⻈⻉⻊⻋⻌⻍⻎⻏⻐⻑⻒⻓⻔⻕⻖⻗⻘⻙⻚⻛⻜⻝⻞⻟⻠⻡⻢⻣⻤⻥⻦⻧⻨⻩⻪⻫⻬⻭⻮⻯⻰⻱⻲⻳');
const SUPPLEMENT_TO = Array.from('厂乛乚乙亻冂𠘨刀刂卜㔾小小兀尣尢𡯂巳幺彑𫜹忄心扌攵旡日月歺母民氵氺灬爫爫丬牛犭王𤴔目示礻𥫗糹纟罓罒㓁冗𦉫羊𦍌𦍋耂肀聿肉𦥑艹艹艹虎衤覀西见角𧢲讠贝𧾷车辶辶辶邑钅長镸长门𨸏阝雨青韦页风飞食𩙿飠饣𩠐马骨鬼鱼鸟卤麦黄黾斉齐歯齿竜龙龜亀龟');
const SUPPLEMENT = new Map(SUPPLEMENT_FROM.map((char, index) => [char, SUPPLEMENT_TO[index]]));
const RADICALS = /[\u2E80-\u2FDF\uF900-\uFAFF]/g;
function foldRadicals(text: string): string {
  return text.replace(RADICALS, char => SUPPLEMENT.get(char) ?? char.normalize('NFKC'));
}

function trimAscii(text: string): string {
  return text.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '');
}

function stripExtension(fileName: string): string {
  const base = fileName.replace(/^.*[/\\]/, '');
  return base.replace(/\.[^.]+$/, '').trim() || base;
}

function isLikelyFilePath(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) return true;
  if (/^[A-Za-z]:/.test(value)) return true;
  if (/\.(?:pdf|docx?|txt|indd?|epub|rtf|odt)$/i.test(value)) return true;
  return false;
}

async function defaultLoadPdf(data: ArrayBuffer): Promise<PdfDocumentLike> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Copied next to the page by scripts/vendor-assets.mjs; relative, so a build served under a sub-path works too.
  const base = new URL('./vendor/pdfjs/', window.location.href.split('?')[0]).href;
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.js`;
  const params: Record<string, unknown> = {
    data: new Uint8Array(data),
    cMapUrl: `${base}cmaps/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapPacked: true,
    isEvalSupported: false,
  };
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
  // Columns arrive as whole runs. A page of single glyphs is the per-glyph case, never this one.
  if (body.filter(line => glyphLength(line.text) === 1).length * 2 > body.length) return false;
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
  // Justified Japanese text stretches the gap between glyphs, sometimes past a full em at punctuation.
  const gapTolerance = Math.max(1, bodyHeight * 1.2);
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    const gap = previous ? line.x - lineEndX(previous, bodyHeight) : 0;
    const continues = previous !== undefined
      && previous.pageIndex === line.pageIndex
      && !previous.rotated
      && !line.rotated
      && Math.abs(previous.y - line.y) <= rowTolerance
      && gap >= -gapTolerance
      && gap <= gapTolerance;
    if (!continues) {
      merged.push(line);
      continue;
    }
    const previousText = previous.text;
    const joiner = ASCII_ALNUM_RE.test(previousText.slice(-1)) && ASCII_ALNUM_RE.test(line.text[0] ?? '') ? ' ' : '';
    merged[merged.length - 1] = {
      ...previous,
      text: previousText + joiner + line.text,
      endX: Math.max(lineEndX(previous, bodyHeight), lineEndX(line, bodyHeight)),
      height: Math.max(previous.height, line.height),
    };
  }
  return merged;
}

/** Rebuild tategaki columns from per-glyph items: glyphs sharing an x, read top to bottom. */
function glyphColumns(lines: VisualLine[], tolerance: number): VisualLine[] {
  const groups: { x: number; lines: VisualLine[] }[] = [];
  for (const line of lines) {
    let nearest: { x: number; lines: VisualLine[] } | null = null;
    let nearestDistance = Infinity;
    for (const group of groups) {
      const distance = Math.abs(group.x - line.x);
      if (distance <= tolerance && distance < nearestDistance) {
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
  return groups.sort((a, b) => b.x - a.x).map(group => {
    const glyphs = [...group.lines].sort((a, b) => b.y - a.y);
    let text = '';
    for (const glyph of glyphs) {
      const previous = text[text.length - 1] || '';
      const next = glyph.text[0] || '';
      text += `${ASCII_ALNUM_RE.test(previous) && ASCII_ALNUM_RE.test(next) ? ' ' : ''}${glyph.text}`;
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

export async function importPdf(
  data: ArrayBuffer,
  fileName: string,
  loader?: PdfLoader,
): Promise<ImportedBook> {
  const doc: PdfDocumentLike = !loader
    ? await defaultLoadPdf(data)
    : typeof loader === 'function'
      ? await loader(data)
      : loader;

  const visualLines: VisualLine[] = [];
  let nonWhitespaceCount = 0;
  // Source layout measures: the first page's size, plus how much of the text is set in vertical fonts.
  let pageSize: { width: number; height: number } | null = null;
  let verticalCharCount = 0;
  let textCharCount = 0;
  const verticalGlyphWidths: number[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const pageIndex = pageNum - 1;
    const page = await doc.getPage(pageNum);
    if (pageNum === 1) pageSize = readPageSize(page);
    const content = await page.getTextContent();
    const styles: Record<string, PdfTextStyleLike> = content.styles ?? {};
    let currentItems: PdfTextItem[] = [];

    const flushVisualLine = () => {
      if (currentItems.length === 0) return;
      const rawText = foldRadicals(currentItems.map(it => it.str).join(''));
      const text = trimAscii(rawText);
      const items = currentItems;
      currentItems = [];
      if (!text || text.trim().length === 0) return;
      if (PAGE_NUMBER_RE.test(text)) return;

      const x = items[0].transform?.[4] ?? 0;
      const y = items[0].transform?.[5] ?? 0;
      let height = 0;
      let endX = x;
      for (const it of items) {
        const h = it.height || Math.abs(it.transform?.[3] ?? it.transform?.[0] ?? 0);
        if (h > height) height = h;
        const width = typeof it.width === 'number' && it.width > 0 ? it.width : 0;
        const right = (it.transform?.[4] ?? 0) + width;
        if (right > endX) endX = right;
      }
      const rotated = items.some(it => (it.transform?.[1] ?? 0) !== 0);
      visualLines.push({ pageIndex, text, x, y, height, endX, rotated });
    };

    for (const item of content.items) {
      if (!item || typeof item.str !== 'string') continue;
      // pdf.js writes "\u0000" for glyphs whose font has no Unicode mapping (CID 0 / .notdef).
      // Those bytes are not text: they crash the tokenizer, count toward the scanned-PDF
      // threshold and would travel into the stored book, so they are dropped on extraction.
      const str = sanitizeText(item.str);
      if (str === '') {
        if (item.hasEOL) flushVisualLine();
        continue;
      }
      const charCount = str.replace(/\s+/g, '').length;
      nonWhitespaceCount += charCount;
      // Vertical detection is per font: a CJK vertical font renders glyphs rotated 90° via its own metrics.
      if (charCount > 0) {
        textCharCount += charCount;
        if (item.fontName && styles[item.fontName]?.vertical === true) {
          verticalCharCount += charCount;
          const glyphWidth = Math.abs(item.transform?.[0] ?? 0);
          if (glyphWidth > 0) verticalGlyphWidths.push(glyphWidth);
        }
      }
      currentItems.push({ ...item, str });
      if (item.hasEOL) {
        flushVisualLine();
      }
    }
    flushVisualLine();
  }

  const minChars = Math.max(30, doc.numPages * 15);
  if (nonWhitespaceCount < minChars) {
    throw new ScannedPdfError('这是扫描版 PDF，没有可提取的文字');
  }

  // A tategaki page drawn with a horizontal font arrives as one glyph per item, so the paragraph
  // joiner would otherwise turn every character into its own line. Rebuild the columns first:
  // glyphs at one x read top to bottom, columns right to left. A page pdf.js already reports
  // column by column only needs the reading order fixed.
  const logicalLines: VisualLine[] = [];
  const verticalTop = new Map<number, number>();
  const verticalStep = new Map<number, number>();
  for (const pageIndex of [...new Set(visualLines.map(line => line.pageIndex))]) {
    const pageLines = visualLines.filter(line => line.pageIndex === pageIndex);
    const pageHeights = pageLines.filter(line => !line.rotated && line.height > 0).map(line => line.height);
    const bodyHeight = bodyGlyphHeight(pageHeights);
    const tolerance = Math.max(1, bodyHeight * 0.25);
    // Source ruby is set much smaller than the body; the app annotates the text again, so those
    // glyphs are left out of the columns instead of being read as text.
    const bodyLines = pageLines.filter(line => !line.rotated && (bodyHeight <= 0 || line.height >= bodyHeight * 0.6));
    const rotatedLines = pageLines.filter(line => line.rotated);
    let columns: VisualLine[] | null = null;
    if (pageIsVertical(pageLines, bodyHeight)) columns = glyphColumns(bodyLines, tolerance);
    else if (isTopAlignedColumnPage(pageLines)) columns = bodyLines;
    if (!columns) {
      // A horizontal page split into one item per glyph: rejoin the runs that continue each
      // other along the baseline, then let the horizontal paragraph rules below do the rest.
      logicalLines.push(...mergeGlyphRuns(pageLines, bodyHeight));
      continue;
    }
    columns.sort((a, b) => b.x - a.x);
    const verticalColumns = columns.map(line => ({ ...line, vertical: true }));
    logicalLines.push(...verticalColumns, ...rotatedLines);
    verticalTop.set(pageIndex, Math.max(...verticalColumns.map(line => line.y)));
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
  const vertical = verticalByFont || (textCharCount > 0 && verticalChars * 2 > textCharCount);

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

  const paragraphs: string[] = [];
  const firstParaStartingOnPage = new Map<number, number>();
  const firstParaTouchingPage = new Map<number, number>();
  let prevLine: VisualLine | null = null;

  for (const line of logicalLines) {
    let startNewParagraph = false;
    if (!prevLine) {
      startNewParagraph = true;
    } else if (PARA_START_RE.test(line.text)) {
      startNewParagraph = true;
    } else if (PARA_END_RE.test(prevLine.text)) {
      startNewParagraph = true;
    } else if (line.vertical && prevLine.vertical && line.pageIndex === prevLine.pageIndex) {
      // Tategaki columns: a blank column is a paragraph gap, and a column that starts below the top
      // margin is an indented first line — the vertical counterparts of the two rules below.
      const columnStep = verticalStep.get(line.pageIndex) ?? 0;
      const top = verticalTop.get(line.pageIndex);
      if (columnStep > 0 && Math.abs(prevLine.x - line.x) > 1.5 * columnStep) {
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
      const sep = ASCII_ALNUM_RE.test(prevChar) && ASCII_ALNUM_RE.test(nextChar) ? ' ' : '';
      paragraphs[paraIndex] = currentPara + sep + line.text;
      if (!firstParaTouchingPage.has(line.pageIndex)) {
        firstParaTouchingPage.set(line.pageIndex, paraIndex);
      }
    }

    prevLine = line;
  }

  const fallbackTitle = stripExtension(fileName);
  let title = fallbackTitle;
  let author = '';
  try {
    const metadata = await doc.getMetadata();
    const rawTitle = sanitizeText(metadata?.info?.Title ?? '').trim();
    if (rawTitle && !isLikelyFilePath(rawTitle)) {
      title = rawTitle;
    }
    author = sanitizeText(metadata?.info?.Author ?? '').trim();
  } catch {
    // Ignore metadata failures and keep fallback title/author.
  }

  const chapters: { title: string; startLine: number }[] = [];
  try {
    const outline = await doc.getOutline();
    if (Array.isArray(outline)) {
      for (const item of outline) {
        const chapterTitle = sanitizeText(item?.title ?? '').trim();
        if (!chapterTitle) continue;
        try {
          let destArray: unknown[] | null = null;
          if (typeof item.dest === 'string') {
            destArray = await doc.getDestination(item.dest);
          } else if (Array.isArray(item.dest)) {
            destArray = item.dest;
          }
          if (!Array.isArray(destArray) || destArray.length === 0) continue;
          const pageIndex = await doc.getPageIndex(destArray[0]);
          const startLine =
            firstParaStartingOnPage.get(pageIndex) ?? firstParaTouchingPage.get(pageIndex);
          if (startLine === undefined) continue;
          chapters.push({ title: chapterTitle, startLine });
        } catch {
          // Ignore unresolvable outline destinations.
        }
      }
    }
  } catch {
    // Ignore outline failures.
  }

  return {
    title,
    author,
    text: paragraphs.join('\n'),
    overrides: [],
    chapters,
    images: [],
    ...(pdfLayout ? { pdfLayout } : {}),
  };
}
