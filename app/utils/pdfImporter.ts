import { ScannedPdfError, type ImportedBook } from './bookAssets';

export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

export interface PdfPageLike {
  getTextContent(): Promise<{ items: PdfTextItem[] }> | { items: PdfTextItem[] };
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
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
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
  rotated: boolean;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const pageIndex = pageNum - 1;
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
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
      for (const it of items) {
        const h = it.height || Math.abs(it.transform?.[3] ?? it.transform?.[0] ?? 0);
        if (h > height) height = h;
      }
      const rotated = items.some(it => (it.transform?.[1] ?? 0) !== 0);
      visualLines.push({ pageIndex, text, x, y, height, rotated });
    };

    for (const item of content.items) {
      if (!item || typeof item.str !== 'string') continue;
      if (item.str === '') {
        if (item.hasEOL) flushVisualLine();
        continue;
      }
      nonWhitespaceCount += item.str.replace(/\s+/g, '').length;
      currentItems.push(item);
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

  // Layout measures for horizontal text: the usual distance between baselines (a paragraph gap is clearly
  // more than that) and each page's left margin (a first line set in from it is a paragraph indent).
  const horizontalHeights = visualLines
    .filter(line => !line.rotated && line.height > 0)
    .map(line => line.height);
  const medianLineHeight = computeMedian(horizontalHeights);
  const baselineSteps: number[] = [];
  const leftMargin = new Map<number, number>();
  visualLines.forEach((line, index) => {
    if (line.rotated) return;
    leftMargin.set(line.pageIndex, Math.min(leftMargin.get(line.pageIndex) ?? Infinity, line.x));
    const previous = visualLines[index - 1];
    if (previous && previous.pageIndex === line.pageIndex && !previous.rotated) baselineSteps.push(Math.abs(previous.y - line.y));
  });
  const medianStep = computeMedian(baselineSteps.filter(step => step > 0));

  const paragraphs: string[] = [];
  const firstParaStartingOnPage = new Map<number, number>();
  const firstParaTouchingPage = new Map<number, number>();
  let prevLine: VisualLine | null = null;

  for (const line of visualLines) {
    let startNewParagraph = false;
    if (!prevLine) {
      startNewParagraph = true;
    } else if (PARA_START_RE.test(line.text)) {
      startNewParagraph = true;
    } else if (PARA_END_RE.test(prevLine.text)) {
      startNewParagraph = true;
    } else if (
      prevLine.pageIndex === line.pageIndex &&
      !prevLine.rotated &&
      !line.rotated &&
      medianStep > 0 &&
      Math.abs(prevLine.y - line.y) > 1.5 * medianStep
    ) {
      startNewParagraph = true;
    } else if (
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
    const rawTitle = metadata?.info?.Title?.trim() || '';
    if (rawTitle && !isLikelyFilePath(rawTitle)) {
      title = rawTitle;
    }
    author = metadata?.info?.Author?.trim() || '';
  } catch {
    // Ignore metadata failures and keep fallback title/author.
  }

  const chapters: { title: string; startLine: number }[] = [];
  try {
    const outline = await doc.getOutline();
    if (Array.isArray(outline)) {
      for (const item of outline) {
        const chapterTitle = item?.title?.trim() || '';
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
  };
}
