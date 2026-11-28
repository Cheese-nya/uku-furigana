// app/utils/pdfExporter.ts
/**
 * Generate a printable A4 PDF (.pdf) file with embedded NotoSansJP subset font
 * and furigana (ruby) annotations positioned directly above kanji tokens.
 */

import { PDFDocument, degrees, rgb, type Color, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { resolveExportCover, type ExportCoverInput } from './exportCover';
import { subsetFont } from './fontSubset';
import type { ScriptLine } from './furigana';
import { cleanScriptTitle } from './docxImporter';
import { extractChapters, type BookChapter } from './libraryDatabase';
import { sanitizeText } from './textSanitize';

export interface PdfLayout {
  pageWidth: number;
  pageHeight: number;
  vertical: boolean;
  fontSize: number;
} // PDF points

export interface PdfExportOptions {
  title?: string;
  baseFontSize?: number;
  rubyFontSize?: number;
  lineSpacing?: number;
  layout?: PdfLayout;
  translations?: readonly (string | undefined)[];
  cover?: ExportCoverInput;
  chapters?: BookChapter[];
}

interface LayoutUnit {
  baseText: string;
  rubyText?: string;
  baseWidth: number;
  rubyWidth: number;
  unitWidth: number;
}

const DEFAULT_PAGE_WIDTH = 595.28;
const DEFAULT_PAGE_HEIGHT = 841.89;
const DEFAULT_MARGIN = 50;

const VERTICAL_UPPER_RIGHT_CHARS = new Set(Array.from('、。，．'));
const VERTICAL_ROTATE_CHARS = new Set(
  Array.from('ー－〜～—…‥（）「」『』【】〔〕［］《》〈〉()[]')
);
const VERTICAL_SMALL_KANA_CHARS = new Set(
  Array.from('ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ')
);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

let cachedFontBytesPromise: Promise<ArrayBuffer> | null = null;
let cachedScFontBytesPromise: Promise<ArrayBuffer> | null = null;

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

function getNotoSansScBytes(): Promise<ArrayBuffer> {
  if (!cachedScFontBytesPromise) {
    cachedScFontBytesPromise = fetch('/fonts/NotoSansSC-Regular.otf')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch font: ${res.status} ${res.statusText}`);
        }
        return res.arrayBuffer();
      })
      .catch((err: unknown) => {
        cachedScFontBytesPromise = null;
        throw err;
      });
  }
  return cachedScFontBytesPromise;
}

function sanitizePdfText(text: string): string {
  return sanitizeText(text).replace(/[\r\n]+/g, '').replace(/\t+/g, ' ');
}

function buildHeadingUnits(
  text: string,
  font: PDFFont,
  fontSize: number,
  vertical: boolean
): LayoutUnit[] {
  const chars = Array.from(sanitizePdfText(text));
  return chars.map((ch) => {
    const span = vertical ? fontSize : font.widthOfTextAtSize(ch, fontSize);
    return { baseText: ch, baseWidth: span, rubyWidth: 0, unitWidth: span };
  });
}

function buildLineUnits(
  line: ScriptLine,
  font: PDFFont,
  baseFontSize: number,
  rubyFontSize: number,
  vertical: boolean
): LayoutUnit[] {
  const units: LayoutUnit[] = [];

  const pushPlainChars = (text: string) => {
    for (const ch of Array.from(sanitizePdfText(text))) {
      const baseSpan = vertical ? baseFontSize : font.widthOfTextAtSize(ch, baseFontSize);
      units.push({
        baseText: ch,
        baseWidth: baseSpan,
        rubyWidth: 0,
        unitWidth: baseSpan,
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
      if (vertical) {
        const baseSpan = Array.from(surface).length * baseFontSize;
        const rubySpan = rubyText ? Array.from(rubyText).length * rubyFontSize : 0;
        units.push({
          baseText: surface,
          rubyText: rubyText || undefined,
          baseWidth: baseSpan,
          rubyWidth: rubySpan,
          unitWidth: Math.max(baseSpan, rubySpan),
        });
      } else {
        const baseWidth = font.widthOfTextAtSize(surface, baseFontSize);
        const rubyWidth = rubyText ? font.widthOfTextAtSize(rubyText, rubyFontSize) : 0;
        units.push({
          baseText: surface,
          rubyText: rubyText || undefined,
          baseWidth,
          rubyWidth,
          unitWidth: Math.max(baseWidth, rubyWidth),
        });
      }
    } else {
      pushPlainChars(surface);
    }
  }

  return units;
}

function wrapUnits(units: LayoutUnit[], maxSpan: number): LayoutUnit[][] {
  if (units.length === 0) return [];

  const rows: LayoutUnit[][] = [];
  let currentRow: LayoutUnit[] = [];
  let currentSpan = 0;

  for (const unit of units) {
    if (currentRow.length > 0 && currentSpan + unit.unitWidth > maxSpan) {
      rows.push(currentRow);
      currentRow = [unit];
      currentSpan = unit.unitWidth;
    } else {
      currentRow.push(unit);
      currentSpan += unit.unitWidth;
    }
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

function drawVerticalChar(
  page: PDFPage,
  font: PDFFont,
  ch: string,
  cellX: number,
  cellY: number,
  fontSize: number,
  color: Color
): void {
  const glyphWidth = font.widthOfTextAtSize(ch, fontSize);
  if (VERTICAL_ROTATE_CHARS.has(ch)) {
    const centerX = cellX + fontSize / 2;
    const centerY = cellY + fontSize / 2;
    page.drawText(ch, {
      x: centerX - fontSize * 0.38,
      y: centerY + glyphWidth / 2,
      size: fontSize,
      font,
      color,
      rotate: degrees(-90),
    });
    return;
  }

  const normalX = cellX + (fontSize - glyphWidth) / 2;
  let dx = 0;
  let dy = 0;
  if (VERTICAL_UPPER_RIGHT_CHARS.has(ch)) {
    dx = fontSize * 0.6;
    dy = fontSize * 0.6;
  } else if (VERTICAL_SMALL_KANA_CHARS.has(ch)) {
    dx = fontSize * 0.1;
    dy = fontSize * 0.1;
  }

  page.drawText(ch, {
    x: normalX + dx,
    y: cellY + dy,
    size: fontSize,
    font,
    color,
  });
}

/**
 * Build a PDF Blob with furigana annotations (horizontal or vertical tategaki).
 */
export async function buildPdfBlob(
  lines: ScriptLine[],
  opts?: PdfExportOptions
): Promise<Blob> {
  const title = sanitizePdfText(cleanScriptTitle(opts?.title || '')) || '日语假名配音台本';
  const layout = opts?.layout;
  const pageWidth = layout ? layout.pageWidth : DEFAULT_PAGE_WIDTH;
  const pageHeight = layout ? layout.pageHeight : DEFAULT_PAGE_HEIGHT;
  const margin = layout
    ? clamp(Math.min(pageWidth, pageHeight) * 0.08, 24, 72)
    : DEFAULT_MARGIN;
  const vertical = layout ? layout.vertical : false;
  const baseFontSize = layout ? layout.fontSize : (opts?.baseFontSize ?? 16);
  const rubyFontSize = layout
    ? Math.round(layout.fontSize * 0.5 * 10) / 10
    : (opts?.rubyFontSize ?? 10);
  const lineSpacing = opts?.lineSpacing ?? 1.8;

  const rubyReserve = rubyFontSize + 2;
  const lineAdvance = baseFontSize * lineSpacing + rubyFontSize;
  const titleFontSize = Math.round(baseFontSize * 1.5);
  const chapterFontSize = Math.round(baseFontSize * 1.25);

  const rawJoined = lines.map((l) => l.rawText).join('\n');
  const chapters: BookChapter[] = opts?.chapters && opts.chapters.length > 0 && lines.length > 0
    ? opts.chapters.map((ch, idx) => {
        const startLine = Math.max(0, Math.min(lines.length - 1, ch.startLine));
        const endLine = Math.max(startLine, Math.min(lines.length - 1, ch.endLine));
        return { ...ch, id: ch.id || `chapter:${idx + 1}`, title: sanitizePdfText(ch.title) || `Chapter ${idx + 1}`, startLine, endLine };
      })
    : extractChapters(rawJoined, title);

  const fontBytes = await getNotoSansJpBytes();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);

  // Optional cover page: embedded before text pages, scaled proportionally to fit page bounds.
  const resolvedCover = await resolveExportCover(opts?.cover);
  if (resolvedCover) {
    try {
      const embedded = resolvedCover.mime === 'image/png'
        ? await doc.embedPng(resolvedCover.data)
        : await doc.embedJpg(resolvedCover.data);
      const dims = embedded.scale(1);
      if (dims.width > 0 && dims.height > 0) {
        const coverPage = doc.addPage([pageWidth, pageHeight]);
        const scale = Math.min(pageWidth / dims.width, pageHeight / dims.height);
        const drawWidth = dims.width * scale;
        const drawHeight = dims.height * scale;
        coverPage.drawImage(embedded, {
          x: (pageWidth - drawWidth) / 2,
          y: (pageHeight - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight,
        });
      }
    } catch {
      // Corrupt or unsupported cover image bytes must never fail the PDF export.
    }
  }

  // Every string drawn below comes from these: title, chapter titles, speakers, token surfaces and rubies.
  const usedText = sanitizePdfText([title, '：', ' ', ...chapters.map(c => c.title),
    ...lines.flatMap(l => [l.speaker ?? '', ...l.tokens.flatMap(t => [t.surface, (!t.annotationSuppressed && t.ruby) || ''])])].join('')) || ' ';
  const font = await doc.embedFont(await subsetFont(fontBytes, usedText), { subset: false });

  const translationStrings = (opts?.translations ?? []).map(t => (t ? sanitizePdfText(t).trim() : ''));
  const hasTranslations = translationStrings.some(Boolean);
  let transFont: PDFFont | null = null;
  if (hasTranslations) {
    const scFontBytes = await getNotoSansScBytes();
    const usedTransText = translationStrings.filter(Boolean).join('') || ' ';
    transFont = await doc.embedFont(await subsetFont(scFontBytes, usedTransText), { subset: false });
  }

  const baseColor = rgb(0.1, 0.1, 0.1);
  const rubyColor = rgb(0.145, 0.388, 0.922);
  const headingColor = rgb(0.08, 0.08, 0.08);
  const transColor = rgb(0.35, 0.35, 0.35);
  const transFontSize = Math.max(8, Math.round(baseFontSize * (vertical ? 0.78 : 0.82) * 10) / 10);
  const transAdvance = transFontSize * 1.45;

  const contentSpan = (vertical ? pageHeight : pageWidth) - margin * 2;
  const startCoord = (vertical ? pageWidth : pageHeight) - margin;
  let page: PDFPage = doc.addPage([pageWidth, pageHeight]);
  let cursor = startCoord;

  const ensureSpace = (requiredSpan: number) => {
    if (cursor - requiredSpan < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      cursor = startCoord;
    }
  };

  const drawHeading = (headingText: string, fontSize: number, extraAfter: number) => {
    const units = buildHeadingUnits(headingText, font, fontSize, vertical);
    const segments = wrapUnits(units, contentSpan);
    for (const segment of segments) {
      ensureSpace(fontSize);
      if (vertical) {
        const colX = cursor - fontSize;
        let topY = pageHeight - margin;
        for (const unit of segment) {
          drawVerticalChar(page, font, unit.baseText, colX, topY - fontSize, fontSize, headingColor);
          topY -= fontSize;
        }
      } else {
        const baselineY = cursor - fontSize;
        let x = margin;
        for (const unit of segment) {
          page.drawText(unit.baseText, {
            x,
            y: baselineY,
            size: fontSize,
            font,
            color: headingColor,
          });
          x += unit.unitWidth;
        }
      }
      cursor -= fontSize * 1.4;
    }
    cursor -= extraAfter;
  };

  // Document title on first page
  drawHeading(title, titleFontSize, baseFontSize * 0.5);

  // Render each chapter
  for (const chapter of chapters) {
    drawHeading(chapter.title, chapterFontSize, baseFontSize * 0.3);

    const chapterLines =
      lines.length > 0 ? lines.slice(chapter.startLine, chapter.endLine + 1) : [];

    for (let offset = 0; offset < chapterLines.length; offset += 1) {
      const line = chapterLines[offset];
      const lineIdx = chapter.startLine + offset;
      const transText = transFont ? (translationStrings[lineIdx] || '') : '';
      const units = buildLineUnits(line, font, baseFontSize, rubyFontSize, vertical);

      // Empty line -> blank gap
      if (units.length === 0) {
        cursor -= lineAdvance;
        if (cursor < margin) {
          page = doc.addPage([pageWidth, pageHeight]);
          cursor = startCoord;
        }
        continue;
      }

      const segments = wrapUnits(units, contentSpan);
      const blockSpan = rubyReserve + baseFontSize;

      for (let segIdx = 0; segIdx < segments.length; segIdx += 1) {
        const segment = segments[segIdx];
        ensureSpace(blockSpan);

        if (vertical) {
          const colX = cursor - rubyReserve - baseFontSize;
          const rubyX = colX + baseFontSize + 2;
          let topY = pageHeight - margin;

          for (const unit of segment) {
            let charTopY = topY - (unit.unitWidth - unit.baseWidth) / 2;
            for (const ch of Array.from(unit.baseText)) {
              drawVerticalChar(page, font, ch, colX, charTopY - baseFontSize, baseFontSize, baseColor);
              charTopY -= baseFontSize;
            }

            if (unit.rubyText) {
              let rubyTopY = topY - (unit.unitWidth - unit.rubyWidth) / 2;
              for (const rch of Array.from(unit.rubyText)) {
                drawVerticalChar(page, font, rch, rubyX, rubyTopY - rubyFontSize, rubyFontSize, rubyColor);
                rubyTopY -= rubyFontSize;
              }
            }

            topY -= unit.unitWidth;
          }
        } else {
          const baseY = cursor - rubyReserve - baseFontSize;
          const rubyY = baseY + baseFontSize + 2;
          let x = margin;

          for (const unit of segment) {
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
        }

        const isLastSourceSeg = segIdx === segments.length - 1;
        cursor -= isLastSourceSeg && transText ? blockSpan + baseFontSize * 0.25 : lineAdvance;
      }

      if (transText && transFont) {
        const transUnits = buildHeadingUnits(transText, transFont, transFontSize, vertical);
        const transSegments = wrapUnits(transUnits, contentSpan);
        for (const tSeg of transSegments) {
          ensureSpace(transFontSize);
          if (vertical) {
            const colX = cursor - transFontSize;
            let topY = pageHeight - margin;
            for (const unit of tSeg) {
              drawVerticalChar(page, transFont, unit.baseText, colX, topY - transFontSize, transFontSize, transColor);
              topY -= transFontSize;
            }
          } else {
            const baseY = cursor - transFontSize;
            let x = margin;
            for (const unit of tSeg) {
              page.drawText(unit.baseText, {
                x,
                y: baseY,
                size: transFontSize,
                font: transFont,
                color: transColor,
              });
              x += unit.unitWidth;
            }
          }
          cursor -= transAdvance;
        }
        cursor -= baseFontSize * 0.35;
      }
    }
  }

  return new Blob([(await doc.save()) as BlobPart], { type: 'application/pdf' });
}
