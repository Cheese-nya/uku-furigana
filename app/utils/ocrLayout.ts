import type { ImportWarning, ImportedChapter } from './bookAssets';
import {
  HEADING_PATTERN_RE,
  PAGE_NUMBER_RE,
  PARA_END_RE,
  PARA_START_RE,
  asciiJoin,
  bodyGlyphHeight,
  computeMedian,
  foldRadicals,
  glyphLength,
  runningHeadKey,
} from './japaneseLayoutText';
import type { OcrPageResult, OcrRawBox } from './ocrTypes';
import { sanitizeText } from './textSanitize';

const KANA_CHAR_RE = /[\u3040-\u309F\u30A0-\u30FFー・]/;

export interface ReconstructedOcrDocument {
  text: string;
  chapters: ImportedChapter[];
  pageStarts: number[];
  defaultWritingMode: 'horizontal' | 'vertical';
  warnings: ImportWarning[];
  meanConfidence: number;
}

function boxThickness(box: OcrRawBox, vertical: boolean): number {
  return vertical ? box.width : box.height;
}

function boxSpan(box: OcrRawBox, vertical: boolean): number {
  return vertical ? box.height : box.width;
}

function kanaRatio(text: string): number {
  const chars = Array.from(text.replace(/\s+/g, ''));
  if (chars.length === 0) return 0;
  let kana = 0;
  for (const ch of chars) {
    if (KANA_CHAR_RE.test(ch)) kana += 1;
  }
  return kana / chars.length;
}

/** Vote whether a page reads vertically (tategaki) or horizontally by character weight. */
export function detectPageWritingMode(boxes: readonly OcrRawBox[]): boolean {
  let verticalWeight = 0;
  let horizontalWeight = 0;
  for (const box of boxes) {
    if (box.role === 'figure' || box.role === 'ad' || box.role === 'ruby' || box.role === 'running-head') {
      continue;
    }
    const weight = Math.max(1, glyphLength(box.text));
    if (box.height > box.width * 1.35 || (box.vertical && !(box.width > box.height * 1.35))) {
      verticalWeight += weight;
    } else if (box.width > box.height * 1.35 || !box.vertical) {
      horizontalWeight += weight;
    }
  }
  return verticalWeight > horizontalWeight;
}

/**
 * Dual-layer furigana filter:
 * 1. Semantic role filtering (`ruby`, `ad`, `figure`, `running-head`).
 * 2. Geometric fallback filtering (essential for Apple Vision and safety net for NDLOCR-Lite):
 *    small kana-heavy boxes sitting on the ruby side (right of vertical line / above horizontal line)
 *    of a full-size body line.
 */
export function filterRubyBoxes(
  boxes: readonly OcrRawBox[],
  vertical: boolean,
  filterRuby = true,
): OcrRawBox[] {
  const active = boxes.filter(box => {
    if (box.role === 'figure' || box.role === 'running-head') return false;
    if (filterRuby && (box.role === 'ruby' || box.role === 'ad')) return false;
    return box.text.trim().length > 0;
  });
  if (!filterRuby || active.length <= 1) return active;

  const thicknesses = active.map(b => boxThickness(b, vertical)).filter(t => t > 0);
  const bodyThick = bodyGlyphHeight(thicknesses);
  if (bodyThick <= 0) return active;

  const mainBoxes = active.filter(b => boxThickness(b, vertical) >= bodyThick * 0.72);
  if (mainBoxes.length === 0) return active;

  return active.filter(box => {
    const thick = boxThickness(box, vertical);
    if (thick >= bodyThick * 0.62) return true;
    const len = glyphLength(box.text);
    if (len === 0 || len > 14 || kanaRatio(box.text) < 0.8) return true;

    const boxCX = box.x + box.width / 2;
    const boxCY = box.y + box.height / 2;

    for (const main of mainBoxes) {
      if (main === box) continue;
      if (vertical) {
        const mainCX = main.x + main.width / 2;
        if (boxCX <= mainCX) continue;
        const gap = box.x - (main.x + main.width);
        if (gap < -bodyThick * 0.3 || gap > bodyThick * 1.25) continue;
        const overlap = Math.min(box.y + box.height, main.y + main.height) - Math.max(box.y, main.y);
        if (overlap >= Math.min(box.height, main.height) * 0.5) return false;
      } else {
        const mainCY = main.y + main.height / 2;
        if (boxCY >= mainCY) continue;
        const gap = main.y - (box.y + box.height);
        if (gap < -bodyThick * 0.3 || gap > bodyThick * 1.25) continue;
        const overlap = Math.min(box.x + box.width, main.x + main.width) - Math.max(box.x, main.x);
        if (overlap >= Math.min(box.width, main.width) * 0.5) return false;
      }
    }
    return true;
  });
}

function findLargestCleanGap(
  intervals: Array<{ start: number; end: number; idx: number }>,
  minGap: number,
): number | null {
  if (intervals.length <= 1) return null;
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  let maxEnd = sorted[0].end;
  let bestCut: number | null = null;
  let bestGap = minGap;

  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i];
    if (cur.start > maxEnd) {
      const gap = cur.start - maxEnd;
      if (gap > bestGap) {
        bestGap = gap;
        bestCut = (maxEnd + cur.start) / 2;
      }
    }
    if (cur.end > maxEnd) maxEnd = cur.end;
  }
  return bestCut;
}

function sortBlockBoxes(boxes: OcrRawBox[], vertical: boolean, medianThick: number): OcrRawBox[] {
  const tol = Math.max(4, medianThick * 0.45);
  if (vertical) {
    // Vertical columns: right-to-left across columns, top-to-bottom within each column.
    const sortedX = [...boxes].sort((a, b) => (b.x + b.width / 2) - (a.x + a.width / 2));
    const columns: Array<{ cx: number; items: OcrRawBox[] }> = [];
    for (const box of sortedX) {
      const cx = box.x + box.width / 2;
      const last = columns[columns.length - 1];
      if (last && Math.abs(last.cx - cx) <= tol) {
        last.cx = (last.cx * last.items.length + cx) / (last.items.length + 1);
        last.items.push(box);
      } else {
        columns.push({ cx, items: [box] });
      }
    }
    return columns.flatMap(col => col.items.sort((a, b) => a.y - b.y || a.x - b.x));
  }

  // Horizontal lines: top-to-bottom across lines, left-to-right within each line.
  const sortedY = [...boxes].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2));
  const rows: Array<{ cy: number; items: OcrRawBox[] }> = [];
  for (const box of sortedY) {
    const cy = box.y + box.height / 2;
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.cy - cy) <= tol) {
      last.cy = (last.cy * last.items.length + cy) / (last.items.length + 1);
      last.items.push(box);
    } else {
      rows.push({ cy, items: [box] });
    }
  }
  return rows.flatMap(row => row.items.sort((a, b) => a.x - b.x || a.y - b.y));
}

function xyCutRecursive(boxes: OcrRawBox[], vertical: boolean, medianThick: number, depth = 0): OcrRawBox[] {
  if (boxes.length <= 1 || depth >= 10) return sortBlockBoxes(boxes, vertical, medianThick);

  const xIntervals = boxes.map((b, idx) => ({ start: b.x, end: b.x + b.width, idx }));
  const yIntervals = boxes.map((b, idx) => ({ start: b.y, end: b.y + b.height, idx }));

  if (vertical) {
    // Prefer splitting two-page spreads / distinct vertical column zones (right -> left), then upper/lower bands (top -> bottom).
    const xCut = findLargestCleanGap(xIntervals, Math.max(12, medianThick * 1.5));
    if (xCut !== null) {
      const right = boxes.filter(b => b.x + b.width / 2 >= xCut);
      const left = boxes.filter(b => b.x + b.width / 2 < xCut);
      if (right.length > 0 && left.length > 0) {
        return [
          ...xyCutRecursive(right, vertical, medianThick, depth + 1),
          ...xyCutRecursive(left, vertical, medianThick, depth + 1),
        ];
      }
    }
    const yCut = findLargestCleanGap(yIntervals, Math.max(14, medianThick * 1.8));
    if (yCut !== null) {
      const top = boxes.filter(b => b.y + b.height / 2 < yCut);
      const bottom = boxes.filter(b => b.y + b.height / 2 >= yCut);
      if (top.length > 0 && bottom.length > 0) {
        return [
          ...xyCutRecursive(top, vertical, medianThick, depth + 1),
          ...xyCutRecursive(bottom, vertical, medianThick, depth + 1),
        ];
      }
    }
  } else {
    // Horizontal: prefer splitting upper/lower blocks (top -> bottom), then multi-column blocks (left -> right).
    const yCut = findLargestCleanGap(yIntervals, Math.max(12, medianThick * 1.4));
    if (yCut !== null) {
      const top = boxes.filter(b => b.y + b.height / 2 < yCut);
      const bottom = boxes.filter(b => b.y + b.height / 2 >= yCut);
      if (top.length > 0 && bottom.length > 0) {
        return [
          ...xyCutRecursive(top, vertical, medianThick, depth + 1),
          ...xyCutRecursive(bottom, vertical, medianThick, depth + 1),
        ];
      }
    }
    const xCut = findLargestCleanGap(xIntervals, Math.max(16, medianThick * 1.8));
    if (xCut !== null) {
      const left = boxes.filter(b => b.x + b.width / 2 < xCut);
      const right = boxes.filter(b => b.x + b.width / 2 >= xCut);
      if (left.length > 0 && right.length > 0) {
        return [
          ...xyCutRecursive(left, vertical, medianThick, depth + 1),
          ...xyCutRecursive(right, vertical, medianThick, depth + 1),
        ];
      }
    }
  }

  return sortBlockBoxes(boxes, vertical, medianThick);
}

/** Order boxes into natural reading order using recursive XY-Cut + direction-aware column/line sorting. */
export function orderReadingBoxes(boxes: readonly OcrRawBox[], vertical: boolean): OcrRawBox[] {
  if (boxes.length <= 1) return [...boxes];
  const medianThick = computeMedian(boxes.map(b => boxThickness(b, vertical)).filter(t => t > 0)) || 20;
  return xyCutRecursive([...boxes], vertical, medianThick, 0);
}

interface OrderedOcrLine {
  pageIndex: number;
  text: string;
  vertical: boolean;
  box: OcrRawBox;
  thickness: number;
  span: number;
  isHeading: boolean;
  headingLevel: number;
  medianSpan: number;
  medianStep: number;
}

export function reconstructOcrDocument(
  pages: readonly OcrPageResult[],
  options: { filterRuby?: boolean } = {},
): ReconstructedOcrDocument {
  const filterRuby = options.filterRuby ?? true;
  const pageDirections: boolean[] = [];
  const pagePreparedBoxes: OcrRawBox[][] = [];
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const normalized = page.boxes
      .map(box => ({
        ...box,
        text: foldRadicals(sanitizeText(box.text)).trim(),
      }))
      .filter(box => box.text.length > 0 && box.width > 0 && box.height > 0);

    const vertical = detectPageWritingMode(normalized);
    pageDirections.push(vertical);

    const filtered = filterRubyBoxes(normalized, vertical, filterRuby);
    const ordered = orderReadingBoxes(filtered, vertical).filter(box => {
      if (!PAGE_NUMBER_RE.test(box.text)) return true;
      const inOuterMargin = box.y < page.pageHeight * 0.08 || (box.y + box.height) > page.pageHeight * 0.92;
      return !inOuterMargin;
    });

    for (const box of ordered) {
      if (Number.isFinite(box.confidence) && box.confidence > 0) {
        confidenceSum += box.confidence;
        confidenceCount += 1;
      }
    }
    pagePreparedBoxes.push(ordered);
  }

  // Conservative running-head / folio cleanup across >= 3 pages.
  let runningHeadsRemoved = 0;
  if (pages.length >= 3) {
    const candidates = new Map<OcrRawBox, { pageIndex: number; key: string }>();
    const pagesByKey = new Map<string, Set<number>>();
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = pages[pageIndex];
      const vertical = pageDirections[pageIndex];
      const boxes = pagePreparedBoxes[pageIndex];
      const bodyThick = bodyGlyphHeight(boxes.map(b => boxThickness(b, vertical)).filter(t => t > 0));
      for (const box of boxes) {
        if (glyphLength(box.text) > 40) continue;
        if (bodyThick > 0 && boxThickness(box, vertical) > bodyThick * 0.95) continue;
        const topBand = page.pageHeight * 0.08;
        const bottomBand = page.pageHeight * 0.92;
        if (box.y > topBand && box.y + box.height < bottomBand) continue;
        const key = runningHeadKey(box.text);
        candidates.set(box, { pageIndex, key });
        const set = pagesByKey.get(key) ?? new Set<number>();
        set.add(pageIndex);
        pagesByKey.set(key, set);
      }
    }
    const threshold = Math.max(3, Math.ceil(pages.length * 0.2));
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      pagePreparedBoxes[pageIndex] = pagePreparedBoxes[pageIndex].filter(box => {
        const entry = candidates.get(box);
        if (!entry) return true;
        if ((pagesByKey.get(entry.key)?.size ?? 0) >= threshold) {
          runningHeadsRemoved += 1;
          return false;
        }
        return true;
      });
    }
  }

  // Assemble ordered lines with per-page geometry stats for paragraph & heading detection.
  const orderedLines: OrderedOcrLine[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const vertical = pageDirections[pageIndex];
    const boxes = pagePreparedBoxes[pageIndex];
    if (boxes.length === 0) continue;
    const bodyThick = bodyGlyphHeight(boxes.map(b => boxThickness(b, vertical)).filter(t => t > 0));
    const medianSpan = computeMedian(boxes.map(b => boxSpan(b, vertical)).filter(s => s > 0));
    const steps: number[] = [];
    for (let i = 1; i < boxes.length; i += 1) {
      const step = vertical
        ? Math.abs((boxes[i - 1].x + boxes[i - 1].width / 2) - (boxes[i].x + boxes[i].width / 2))
        : Math.abs((boxes[i - 1].y + boxes[i - 1].height / 2) - (boxes[i].y + boxes[i].height / 2));
      if (step > 0) steps.push(step);
    }
    const medianStep = computeMedian(steps);

    for (const box of boxes) {
      const thickness = boxThickness(box, vertical);
      const len = glyphLength(box.text);
      const patternHeading = HEADING_PATTERN_RE.test(box.text) && len <= 40;
      const largeHeading = bodyThick > 0 && thickness >= bodyThick * 1.35 && len <= 40;
      const explicitTitle = box.role === 'title' && len <= 50;
      const isHeading = explicitTitle || patternHeading || largeHeading;
      const headingLevel = patternHeading || (bodyThick > 0 && thickness >= bodyThick * 1.6) ? 0 : 1;
      orderedLines.push({
        pageIndex,
        text: box.text,
        vertical,
        box,
        thickness,
        span: boxSpan(box, vertical),
        isHeading,
        headingLevel,
        medianSpan,
        medianStep,
      });
    }
  }

  const paragraphs: string[] = [];
  const firstParaTouchingPage = new Map<number, number>();
  const autoChapters: ImportedChapter[] = [];
  let prev: OrderedOcrLine | null = null;

  for (const line of orderedLines) {
    let startNew = false;
    if (!prev) {
      startNew = true;
    } else if (line.isHeading || prev.isHeading) {
      startNew = true;
    } else if (line.vertical !== prev.vertical) {
      startNew = true;
    } else if (PARA_START_RE.test(line.text)) {
      startNew = true;
    } else if (PARA_END_RE.test(prev.text)) {
      startNew = true;
    } else if (prev.medianSpan > 0 && prev.span < prev.medianSpan * 0.72 && !PARA_END_RE.test(prev.text) && prev.pageIndex === line.pageIndex) {
      // Short standalone line (e.g. speaker/section/broken fragment) ends paragraph if clearly short.
      startNew = true;
    } else if (prev.pageIndex === line.pageIndex && line.medianStep > 0) {
      const gap = line.vertical
        ? Math.abs((prev.box.x + prev.box.width / 2) - (line.box.x + line.box.width / 2))
        : Math.abs((prev.box.y + prev.box.height / 2) - (line.box.y + line.box.height / 2));
      if (gap > line.medianStep * 1.65) startNew = true;
    }

    if (startNew) {
      const paraIndex = paragraphs.length;
      paragraphs.push(line.text);
      if (line.isHeading) {
        autoChapters.push({
          title: line.text,
          startLine: paraIndex,
          level: line.headingLevel,
          page: line.pageIndex + 1,
        });
      }
      if (!firstParaTouchingPage.has(line.pageIndex)) {
        firstParaTouchingPage.set(line.pageIndex, paraIndex);
      }
    } else {
      const idx = paragraphs.length - 1;
      const cur = paragraphs[idx];
      const sep = asciiJoin(cur[cur.length - 1] || '', line.text[0] || '');
      paragraphs[idx] = cur + sep + line.text;
      if (!firstParaTouchingPage.has(line.pageIndex)) {
        firstParaTouchingPage.set(line.pageIndex, idx);
      }
    }
    prev = line;
  }

  const pageStarts: number[] = [];
  let lastStart = -1;
  for (let p = 0; p < pages.length; p += 1) {
    const raw = firstParaTouchingPage.get(p);
    const start = raw === undefined ? -1 : Math.max(raw, lastStart);
    if (start >= 0) lastStart = start;
    pageStarts.push(start);
  }

  const verticalCharVotes = orderedLines
    .filter(l => l.vertical)
    .reduce((sum, l) => sum + glyphLength(l.text), 0);
  const totalChars = orderedLines.reduce((sum, l) => sum + glyphLength(l.text), 0);
  const defaultWritingMode: 'horizontal' | 'vertical' =
    totalChars > 0 && verticalCharVotes * 2 > totalChars ? 'vertical' : 'horizontal';

  const meanConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 1;
  const warnings: ImportWarning[] = [{ code: 'ocr-recognized', count: pages.length }];
  if (autoChapters.length >= 2) {
    warnings.push({ code: 'auto-chapters', count: autoChapters.length });
  }
  if (runningHeadsRemoved > 0) {
    warnings.push({ code: 'running-heads-removed', count: runningHeadsRemoved });
  }
  if (confidenceCount >= 5 && meanConfidence < 0.72) {
    warnings.push({ code: 'ocr-low-confidence' });
  }

  return {
    text: paragraphs.join('\n'),
    chapters: autoChapters.length >= 2 ? autoChapters : [],
    pageStarts,
    defaultWritingMode,
    warnings,
    meanConfidence,
  };
}
