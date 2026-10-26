// app/utils/pdfExporter.ts
/**
 * Generate a printable A4 PDF (.pdf) file with embedded NotoSansJP subset font
 * and furigana (ruby) annotations positioned directly above kanji tokens.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { subsetFont } from './fontSubset';
import type { ScriptLine } from './furigana';
import { cleanScriptTitle } from './docxImporter';
import { extractChapters, type BookChapter } from './libraryDatabase';

export interface PdfExportOptions {
  title?: string;
  baseFontSize?: number;
  rubyFontSize?: number;
  lineSpacing?: number;
}

interface LayoutUnit {
  baseText: string;
  rubyText?: string;
  baseWidth: number;
  rubyWidth: number;
  unitWidth: number;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

let cachedFontBytesPromise: Promise<ArrayBuffer> | null = null;

function getNotoSansJpBytes(): Promise<ArrayBuffer> {
  if (!cachedFontBytesPromise) {
    cachedFontBytesPromise = fetch('/fonts/NotoSansJP-Regular.ttf')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch font: ${res.status} ${res.statusText}`);
        }
        return res.arrayBuffer();
      })
      .catch((err: unknown) => {
        cachedFontBytesPromise = null;
        throw err;
      });
  }
  return cachedFontBytesPromise;
}

function sanitizePdfText(text: string): string {
  return text.replace(/[\r\n]+/g, '');
}

function buildLineUnits(
  line: ScriptLine,
  font: PDFFont,
  baseFontSize: number,
  rubyFontSize: number
): LayoutUnit[] {
  const units: LayoutUnit[] = [];

  const pushPlainChars = (text: string) => {
    for (const ch of Array.from(sanitizePdfText(text))) {
      const baseWidth = font.widthOfTextAtSize(ch, baseFontSize);
      units.push({
        baseText: ch,
        baseWidth,
        rubyWidth: 0,
        unitWidth: baseWidth,
      });
    }
  };

  if (line.speaker) {
    pushPlainChars(`${line.speaker}：`);
  }

  for (const token of line.tokens) {
    const surface = sanitizePdfText(token.surface);
    if (!surface) continue;

    if (token.ruby && !token.annotationSuppressed) {
      const rubyText = sanitizePdfText(token.ruby);
      const baseWidth = font.widthOfTextAtSize(surface, baseFontSize);
      const rubyWidth = rubyText ? font.widthOfTextAtSize(rubyText, rubyFontSize) : 0;
      units.push({
        baseText: surface,
        rubyText: rubyText || undefined,
        baseWidth,
        rubyWidth,
        unitWidth: Math.max(baseWidth, rubyWidth),
      });
    } else {
      pushPlainChars(surface);
    }
  }

  return units;
}

function wrapUnits(units: LayoutUnit[], maxWidth: number): LayoutUnit[][] {
  if (units.length === 0) return [];

  const rows: LayoutUnit[][] = [];
  let currentRow: LayoutUnit[] = [];
  let currentWidth = 0;

  for (const unit of units) {
    if (currentRow.length > 0 && currentWidth + unit.unitWidth > maxWidth) {
      rows.push(currentRow);
      currentRow = [unit];
      currentWidth = unit.unitWidth;
    } else {
      currentRow.push(unit);
      currentWidth += unit.unitWidth;
    }
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Build an A4 portrait PDF Blob with furigana annotations centered above kanji tokens.
 */
export async function buildPdfBlob(
  lines: ScriptLine[],
  opts?: PdfExportOptions
): Promise<Blob> {
  const title = cleanScriptTitle(opts?.title || '') || '日语假名配音台本';
  const baseFontSize = opts?.baseFontSize ?? 16;
  const rubyFontSize = opts?.rubyFontSize ?? 10;
  const lineSpacing = opts?.lineSpacing ?? 1.8;

  const rubyReserve = rubyFontSize + 2;
  const lineAdvance = baseFontSize * lineSpacing + rubyFontSize;
  const titleFontSize = Math.round(baseFontSize * 1.5);
  const chapterFontSize = Math.round(baseFontSize * 1.25);

  const rawJoined = lines.map((l) => l.rawText).join('\n');
  const chapters: BookChapter[] = extractChapters(rawJoined, title);

  const fontBytes = await getNotoSansJpBytes();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);

  // Every string drawn below comes from these: title, chapter titles, speakers, token surfaces and rubies.
  const usedText = [title, '：', ' ', ...chapters.map(c => c.title),
    ...lines.flatMap(l => [l.speaker ?? '', ...l.tokens.flatMap(t => [t.surface, t.ruby ?? ''])])].join('');
  const font = await doc.embedFont(await subsetFont(fontBytes, usedText), { subset: false });

  const baseColor = rgb(0.1, 0.1, 0.1);
  const rubyColor = rgb(0.145, 0.388, 0.922);
  const headingColor = rgb(0.08, 0.08, 0.08);

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY - requiredHeight < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursorY = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawPlainHeading = (headingText: string, fontSize: number, extraAfter: number) => {
    const chars = Array.from(sanitizePdfText(headingText));
    const units: LayoutUnit[] = chars.map((ch) => {
      const w = font.widthOfTextAtSize(ch, fontSize);
      return { baseText: ch, baseWidth: w, rubyWidth: 0, unitWidth: w };
    });
    const rows = wrapUnits(units, CONTENT_WIDTH);
    for (const row of rows) {
      ensureSpace(fontSize);
      const baselineY = cursorY - fontSize;
      let x = MARGIN;
      for (const unit of row) {
        page.drawText(unit.baseText, {
          x,
          y: baselineY,
          size: fontSize,
          font,
          color: headingColor,
        });
        x += unit.unitWidth;
      }
      cursorY -= fontSize * 1.4;
    }
    cursorY -= extraAfter;
  };

  // Document title on first page
  drawPlainHeading(title, titleFontSize, baseFontSize * 0.5);

  // Render each chapter
  for (const chapter of chapters) {
    drawPlainHeading(chapter.title, chapterFontSize, baseFontSize * 0.3);

    const chapterLines =
      lines.length > 0 ? lines.slice(chapter.startLine, chapter.endLine + 1) : [];

    for (const line of chapterLines) {
      const units = buildLineUnits(line, font, baseFontSize, rubyFontSize);

      // Empty line -> blank vertical gap
      if (units.length === 0) {
        cursorY -= lineAdvance;
        if (cursorY < MARGIN) {
          page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          cursorY = PAGE_HEIGHT - MARGIN;
        }
        continue;
      }

      const rows = wrapUnits(units, CONTENT_WIDTH);
      const rowBlockHeight = rubyReserve + baseFontSize;

      for (const row of rows) {
        ensureSpace(rowBlockHeight);
        const baseY = cursorY - rubyReserve - baseFontSize;
        const rubyY = baseY + baseFontSize + 2;

        let x = MARGIN;
        for (const unit of row) {
          const baseX = x + (unit.unitWidth - unit.baseWidth) / 2;
          page.drawText(unit.baseText, {
            x: baseX,
            y: baseY,
            size: baseFontSize,
            font,
            color: baseColor,
          });

          if (unit.rubyText) {
            const rubyX = x + (unit.unitWidth - unit.rubyWidth) / 2;
            page.drawText(unit.rubyText, {
              x: rubyX,
              y: rubyY,
              size: rubyFontSize,
              font,
              color: rubyColor,
            });
          }

          x += unit.unitWidth;
        }

        cursorY -= lineAdvance;
      }
    }
  }

  return new Blob([(await doc.save()) as BlobPart], { type: 'application/pdf' });
}
