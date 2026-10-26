import type { PdfLayout } from './libraryDatabase';
import type { RubyOverride } from './rubyOverrides';

export interface ImportedBookImage {
  id: string;
  mime: string;
  data: Uint8Array;
}

export interface ImportedBook {
  title: string;
  author: string;
  text: string;
  overrides: RubyOverride[];
  chapters: { title: string; startLine: number }[];
  images: ImportedBookImage[];
  /** Source PDF page geometry, read back on export; absent when the loader gives no page viewport. */
  pdfLayout?: PdfLayout;
  cover?: { mime: string; data: Uint8Array };
}

export class ScannedPdfError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'ScannedPdfError';
  }
}

/** A content line that stands for an EPUB illustration: U+FFFC (object replacement) + the image id. */
export const IMAGE_LINE = /^\uFFFC(img-\d+)$/;

export function imageLine(id: string): string {
  return '\uFFFC' + id;
}

/** The text without illustration lines, for places that only handle text (workbench, batch export). */
export function withoutImageLines(text: string): string {
  return text.split('\n').filter(line => !IMAGE_LINE.test(line)).join('\n');
}
