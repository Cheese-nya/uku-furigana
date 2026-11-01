import type { ImportOptions, ImportWarning, ImportedBook } from './bookAssets';
import { cleanScriptTitle, importDocx } from './docxImporter';
import { toImportError, throwIfAborted } from './importErrors';
import { importTextScript, scriptSourceFormat } from './inlineRuby';
import type { BookCategory, BookFormat, PdfLayout } from './libraryDatabase';
import type { RubyOverride } from './rubyOverrides';
import type { SrtCue } from './srt';

export interface ParsedBookFile {
  title: string;
  author?: string;
  description?: string;
  language?: string;
  publisher?: string;
  publishedAt?: string;
  series?: string;
  seriesIndex?: string;
  identifier?: string;
  content: string;
  format: BookFormat;
  category: BookCategory;
  sourceOverrides: RubyOverride[];
  srtCues: SrtCue[];
  chapters?: { title: string; startLine: number; level?: number; page?: number }[];
  images: ImportedBook['images'];
  cover?: Blob;
  /** Source PDF layout, forwarded so batch export can reproduce it. */
  pdfLayout?: PdfLayout;
  /** PDF line→page mapping, index = page - 1. */
  pageStarts?: number[];
  pageLabels?: string[];
  warnings: ImportWarning[];
  /** Structural count of source pages, for the preview. */
  pageCount?: number;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// The pickers also offer text/plain and subtitle/markdown/archive MIMEs, so an extension-less pick must pass the queue filter too.
const IMPORTABLE_MIMES = new Set([
  'application/pdf',
  'application/epub+zip',
  DOCX_MIME,
  'text/plain',
  'text/markdown',
  'application/x-subrip',
  'text/vtt',
  'application/zip',
  'application/octet-stream',
]);
const IMPORTABLE_NAME = /\.(?:txt|md|srt|vtt|docx|epub|pdf)$/i;

export type DetectedBookFormat = 'epub' | 'pdf' | 'docx' | null;

/**
 * Whether the batch queue should take the file: a known extension, a known document MIME
 * type, or an extensionless Android `content://` pick whose MIME type was left blank by the
 * document provider (its magic bytes are checked when the queue runs).
 */
export const isImportableFile = (file: File) => {
  if (IMPORTABLE_NAME.test(file.name)) return true;
  const mime = (file.type || '').toLowerCase();
  if (IMPORTABLE_MIMES.has(mime)) return true;
  return !file.name.includes('.') && mime === '';
};

/**
 * Which structured parser a picked file needs. The name alone is not enough: an Android
 * document provider hands the WebView a `content://` URI whose File name can be a document id
 * ("document:1234", "msf:42") with no extension, so the MIME type and the first bytes decide.
 * A PDF read as plain text is binary garbage that crashes annotation; this routes it to the
 * PDF parser instead.
 */
export async function detectBookFormat(file: File): Promise<DetectedBookFormat> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.epub')) return 'epub';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';

  const type = (file.type || '').toLowerCase();
  if (type === 'application/epub+zip') return 'epub';
  if (type === 'application/pdf') return 'pdf';
  if (type === DOCX_MIME) return 'docx';

  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const headAscii = new TextDecoder('latin1').decode(head);
  if (headAscii.includes('%PDF-')) {
    return 'pdf'; // %PDF- within the first 1024 bytes
  }
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    // EPUB and DOCX are both ZIP files; an EPUB opens with a stored `mimetype` entry or `META-INF/`.
    return headAscii.includes('application/epub+zip') || headAscii.includes('META-INF/') ? 'epub' : 'docx';
  }
  return null;
}

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
    warnings: book.warnings,
    ...(book.description ? { description: book.description } : {}),
    ...(book.language ? { language: book.language } : {}),
    ...(book.publisher ? { publisher: book.publisher } : {}),
    ...(book.publishedAt ? { publishedAt: book.publishedAt } : {}),
    ...(book.series ? { series: book.series } : {}),
    ...(book.seriesIndex ? { seriesIndex: book.seriesIndex } : {}),
    ...(book.identifier ? { identifier: book.identifier } : {}),
    ...(book.pdfLayout ? { pdfLayout: book.pdfLayout } : {}),
    ...(book.pageStarts ? { pageStarts: book.pageStarts } : {}),
    ...(book.pageLabels ? { pageLabels: book.pageLabels } : {}),
    ...(book.pageStarts ? { pageCount: book.pageStarts.length } : {}),
    ...(book.cover ? { cover: new Blob([book.cover.data as BlobPart], { type: book.cover.mime }) } : {}),
  };
}

/** Parse a picked file (TXT/MD/SRT/VTT/DOCX/EPUB/PDF) into a library-ready book. EPUB and PDF load their parsers on demand. */
export async function parseBookFile(file: File, options: ImportOptions = {}): Promise<ParsedBookFile> {
  throwIfAborted(options.signal);
  const title = cleanScriptTitle(file.name.replace(/\.[^/.]+$/, '')) || 'Untitled';
  let format: Awaited<ReturnType<typeof detectBookFormat>>;
  try {
    format = await detectBookFormat(file);
  } catch (error) {
    throw toImportError(error);
  }
  if (format === 'epub') {
    const { importEpub } = await import('./epubImporter');
    try {
      return fromImportedBook(await importEpub(await file.arrayBuffer(), file.name, undefined, options), 'epub');
    } catch (error) {
      throw toImportError(error);
    }
  }
  if (format === 'pdf') {
    const { importPdf } = await import('./pdfImporter');
    try {
      return fromImportedBook(await importPdf(await file.arrayBuffer(), file.name, undefined, options), 'pdf');
    } catch (error) {
      throw toImportError(error);
    }
  }
  if (format === 'docx') {
    try {
      const imported = await importDocx(await file.arrayBuffer());
      return { title, content: imported.text, format: 'docx', category: 'script', sourceOverrides: imported.overrides, srtCues: [], images: [], warnings: [] };
    } catch (error) {
      throw toImportError(error);
    }
  }
  // SRT via parseSRT, VTT via parseVTT; a subtitle file without valid cues is kept as plain text.
  // Books store LF-only text, so key the inline readings by LF lines from the start.
  try {
    const imported = importTextScript(file.name, (await file.text()).replace(/\r\n?/g, '\n'));
    return {
      title, content: imported.text, format: scriptSourceFormat(file.name), category: 'script',
      sourceOverrides: imported.overrides, srtCues: imported.cues, images: [], warnings: [],
    };
  } catch (error) {
    throw toImportError(error);
  }
}
