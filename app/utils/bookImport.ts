import type { ImportedBook } from './bookAssets';
import { importDocx } from './docxImporter';
import { importTextScript, scriptSourceFormat } from './inlineRuby';
import type { BookCategory, BookFormat } from './libraryDatabase';
import type { RubyOverride } from './rubyOverrides';
import type { SrtCue } from './srt';

export interface ParsedBookFile {
  title: string;
  author?: string;
  content: string;
  format: BookFormat;
  category: BookCategory;
  sourceOverrides: RubyOverride[];
  srtCues: SrtCue[];
  chapters?: { title: string; startLine: number }[];
  images: ImportedBook['images'];
  cover?: Blob;
}

export const isBookFile = (name: string) => /\.(?:epub|pdf)$/i.test(name);

function fromImportedBook(book: ImportedBook, format: 'epub' | 'pdf'): ParsedBookFile {
  return {
    title: book.title,
    author: book.author,
    content: book.text,
    format,
    category: 'novel',
    sourceOverrides: book.overrides,
    srtCues: [],
    chapters: book.chapters,
    images: book.images,
    ...(book.cover ? { cover: new Blob([book.cover.data as BlobPart], { type: book.cover.mime }) } : {}),
  };
}

/** Parse a picked file (TXT/MD/SRT/VTT/DOCX/EPUB/PDF) into a library-ready book. EPUB and PDF load their parsers on demand. */
export async function parseBookFile(file: File): Promise<ParsedBookFile> {
  const title = file.name.replace(/\.[^/.]+$/, '') || 'Untitled';
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.epub')) {
    const { importEpub } = await import('./epubImporter');
    return fromImportedBook(await importEpub(await file.arrayBuffer(), file.name), 'epub');
  }
  if (lower.endsWith('.pdf')) {
    const { importPdf } = await import('./pdfImporter');
    return fromImportedBook(await importPdf(await file.arrayBuffer(), file.name), 'pdf');
  }
  if (lower.endsWith('.docx')) {
    const imported = await importDocx(await file.arrayBuffer());
    return { title, content: imported.text, format: 'docx', category: 'script', sourceOverrides: imported.overrides, srtCues: [], images: [] };
  }
  // SRT via parseSRT, VTT via parseVTT; a subtitle file without valid cues is kept as plain text.
  // Books store LF-only text, so key the inline readings by LF lines from the start.
  const imported = importTextScript(file.name, (await file.text()).replace(/\r\n?/g, '\n'));
  return {
    title, content: imported.text, format: scriptSourceFormat(file.name), category: 'script',
    sourceOverrides: imported.overrides, srtCues: imported.cues, images: [],
  };
}
