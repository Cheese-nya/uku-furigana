import type { ImportedBook } from './bookAssets';
import { cleanScriptTitle, importDocx } from './docxImporter';
import { importTextScript, scriptSourceFormat } from './inlineRuby';
import type { BookCategory, BookFormat, PdfLayout } from './libraryDatabase';
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
  /** Source PDF layout, forwarded so batch export can reproduce it. */
  pdfLayout?: PdfLayout;
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
    ...(book.pdfLayout ? { pdfLayout: book.pdfLayout } : {}),
    ...(book.cover ? { cover: new Blob([book.cover.data as BlobPart], { type: book.cover.mime }) } : {}),
  };
}

/** Parse a picked file (TXT/MD/SRT/VTT/DOCX/EPUB/PDF) into a library-ready book. EPUB and PDF load their parsers on demand. */
export async function parseBookFile(file: File): Promise<ParsedBookFile> {
  const title = cleanScriptTitle(file.name.replace(/\.[^/.]+$/, '')) || 'Untitled';
  const format = await detectBookFormat(file);
  if (format === 'epub') {
    const { importEpub } = await import('./epubImporter');
    return fromImportedBook(await importEpub(await file.arrayBuffer(), file.name), 'epub');
  }
  if (format === 'pdf') {
    const { importPdf } = await import('./pdfImporter');
    return fromImportedBook(await importPdf(await file.arrayBuffer(), file.name), 'pdf');
  }
  if (format === 'docx') {
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
