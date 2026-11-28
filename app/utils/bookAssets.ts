import { ImportError } from './importErrors';
import type { PdfLayout } from './libraryDatabase';
import type { OcrPageResult } from './ocrTypes';
import type { RubyOverride } from './rubyOverrides';

export interface ImportedBookImage {
  id: string;
  mime: string;
  data: Uint8Array;
}

/** A table-of-contents entry with the source book's own nesting and page number when it has them. */
export interface ImportedChapter {
  title: string;
  startLine: number;
  /** 0 = top level; importers cap nesting at 2. */
  level?: number;
  /** 1-based page in the source PDF, when known. */
  page?: number;
}

export type ImportWarningCode =
  | 'auto-chapters'
  | 'running-heads-removed'
  | 'footnotes-inline'
  | 'fixed-layout'
  | 'missing-cover'
  | 'images-skipped'
  | 'low-text'
  | 'unknown-image-format'
  | 'ocr-recognized'
  | 'ocr-low-confidence'
  | 'ocr-pages-failed';

export interface ImportWarning {
  code: ImportWarningCode;
  count?: number;
  detail?: string;
}

export interface ImportedBook {
  title: string;
  author: string;
  text: string;
  overrides: RubyOverride[];
  chapters: ImportedChapter[];
  images: ImportedBookImage[];
  /** Source PDF page geometry, read back on export; absent when the loader gives no page viewport. */
  pdfLayout?: PdfLayout;
  cover?: { mime: string; data: Uint8Array };
  defaultWritingMode?: 'horizontal' | 'vertical';
  description?: string;
  language?: string;
  publisher?: string;
  publishedAt?: string;
  series?: string;
  seriesIndex?: string;
  identifier?: string;
  /** Index = page - 1; value = first output line on that page, or -1 when the page has no text. */
  pageStarts?: number[];
  /** Source page labels (`i`, `ii`, `1`, …), index = page - 1. */
  pageLabels?: string[];
  /** Non-fatal things the importer removed or could not restore; the preview lists them. */
  warnings: ImportWarning[];
}

export class ScannedPdfError extends ImportError {
  constructor(message?: string) {
    super('scanned-pdf', message ?? '这是扫描版 PDF，没有可提取的文字');
    this.name = 'ScannedPdfError';
  }
}

export type ImportStage = 'reading' | 'text' | 'images' | 'ocr' | 'chapters' | 'cover' | 'done';

export interface ImportProgress {
  stage: ImportStage;
  current: number;
  total?: number;
}

export interface OcrPageInput {
  pageIndex: number;
  width: number;
  height: number;
  canvas?: HTMLCanvasElement;
}

export interface ImportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
  /** Password for an encrypted PDF; omit on the first attempt so pdf.js reports that one is needed. */
  password?: string;
  /** Control local OCR on scanned/mixed PDFs (`auto` by default). */
  ocr?: 'auto' | 'off' | 'force';
  /** Test seam: run OCR on a page without spawning a browser worker or native bridge. */
  recognizePage?: (page: OcrPageInput) => Promise<OcrPageResult>;
}

/** A content line that stands for an EPUB illustration: U+FFFC (object replacement) + the image id. */
export const IMAGE_LINE = /^￼(img-\d+)$/;

export function imageLine(id: string): string {
  return '￼' + id;
}

/** The text without illustration lines, for places that only handle text (workbench, batch export). */
export function withoutImageLines(text: string): string {
  return text.split('\n').filter(line => !IMAGE_LINE.test(line)).join('\n');
}
