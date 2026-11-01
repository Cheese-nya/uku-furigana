import { IMAGE_LINE, type ImportWarning } from './bookAssets';
import type { ParsedBookFile } from './bookImport';
import type { ImportError, ImportErrorCode } from './importErrors';
import type { BookCategory, BookItem, LibraryFolder, UpsertBookInput } from './libraryDatabase';
import type { Translations } from './i18n';

/** What the preview modal can change before a parsed file enters the library. */
export interface ImportEdit {
  title: string;
  author: string;
  category: BookCategory;
  folderId: string | null;
  description: string;
  language: string;
  publisher: string;
  publishedAt: string;
  series: string;
  seriesIndex: string;
  identifier: string;
}

export interface ImportStats {
  characters: number;
  lines: number;
  chapters: number;
  images: number;
  rubies: number;
  pages: number;
}

export interface ImportPreview {
  fileName: string;
  fileSize: number;
  format: ParsedBookFile['format'];
  title: string;
  author: string;
  category: BookCategory;
  folderId: string | null;
  description: string;
  language: string;
  publisher: string;
  publishedAt: string;
  series: string;
  seriesIndex: string;
  identifier: string;
  stats: ImportStats;
  /** First few TOC entries, with source level and page when the format has them. */
  chapters: Array<{ title: string; level?: number; page?: number }>;
  sampleLines: string[];
  warnings: ImportWarning[];
  cover?: Blob;
  duplicate: BookItem | null;
}

export type ImportDuplicateMode = 'merge' | 'keep-both';

export type ImportReviewDecision =
  | { action: 'confirm'; edit: ImportEdit; duplicateMode: ImportDuplicateMode }
  | { action: 'password'; password: string }
  | { action: 'retry' }
  | { action: 'skip' }
  | { action: 'cancel' };

/** State shown by ImportPreviewModal: a preview to confirm, a password prompt, or a parse failure. */
export interface ImportReviewState {
  itemId: string;
  fileName: string;
  index: number;
  total: number;
  single: boolean;
  preview: ImportPreview | null;
  error: ImportError | null;
  /** True when the last submitted PDF password was rejected. */
  wrongPassword?: boolean;
}

export interface ImportEditOptions {
  duplicate?: BookItem | null;
  folders?: LibraryFolder[];
  folderId?: string | null;
}

/** Stats ignore image placeholder lines, which are not text the reader sees. */
export function importStats(parsed: ParsedBookFile): ImportStats {
  const lines = parsed.content ? parsed.content.replace(/\r\n?/g, '\n').split('\n') : [];
  const textLines = lines.filter(line => !IMAGE_LINE.test(line));
  return {
    characters: textLines.join('').replace(/\s/g, '').length,
    lines: lines.length,
    chapters: parsed.chapters?.length ?? 0,
    images: parsed.images.length,
    rubies: parsed.sourceOverrides.length,
    pages: parsed.pageCount ?? parsed.pageStarts?.length ?? 0,
  };
}

/** A short, displayable sample of the body, skipping image lines and blank lines. */
export function importSampleLines(content: string, limit = 3): string[] {
  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !IMAGE_LINE.test(line))
    .slice(0, limit)
    .map(line => (line.length > 120 ? `${line.slice(0, 120)}…` : line));
}

export function buildImportPreview(
  file: File,
  parsed: ParsedBookFile,
  options: ImportEditOptions = {},
): ImportPreview {
  const duplicate = options.duplicate ?? null;
  // A merge updates an existing book: keep its folder and category, and fill metadata the new file
  // does not carry, so re-importing to refresh images cannot silently clear the reader's edits.
  const preferredFolder = duplicate?.folderId ?? options.folderId;
  const folderId = preferredFolder && options.folders?.some(folder => folder.folderId === preferredFolder)
    ? preferredFolder
    : null;
  const keep = (parsedValue: string | undefined, existing: string | undefined) =>
    parsedValue?.trim() || existing?.trim() || '';
  return {
    fileName: file.name,
    fileSize: file.size,
    format: parsed.format,
    title: parsed.title,
    author: keep(parsed.author, duplicate?.author),
    category: duplicate?.category ?? parsed.category,
    folderId,
    description: keep(parsed.description, duplicate?.description),
    language: keep(parsed.language, duplicate?.language),
    publisher: keep(parsed.publisher, duplicate?.publisher),
    publishedAt: keep(parsed.publishedAt, duplicate?.publishedAt),
    series: keep(parsed.series, duplicate?.series),
    seriesIndex: keep(parsed.seriesIndex, duplicate?.seriesIndex),
    identifier: keep(parsed.identifier, duplicate?.identifier),
    stats: importStats(parsed),
    chapters: (parsed.chapters ?? []).map(chapter => ({
      title: chapter.title,
      ...(chapter.level !== undefined ? { level: chapter.level } : {}),
      ...(chapter.page !== undefined ? { page: chapter.page } : {}),
    })),
    sampleLines: importSampleLines(parsed.content),
    warnings: parsed.warnings,
    ...(parsed.cover ? { cover: parsed.cover } : {}),
    duplicate,
  };
}

export function editFromPreview(preview: ImportPreview): ImportEdit {
  return {
    title: preview.title,
    author: preview.author,
    category: preview.category,
    folderId: preview.folderId,
    description: preview.description,
    language: preview.language,
    publisher: preview.publisher,
    publishedAt: preview.publishedAt,
    series: preview.series,
    seriesIndex: preview.seriesIndex,
    identifier: preview.identifier,
  };
}

/** Blank editable metadata clears the field; parsed metadata is not silently restored. */
export function importEditToUpsertInput(
  parsed: ParsedBookFile,
  edit: ImportEdit,
  fingerprint: string,
  options: { bookId?: string; allowDuplicate?: boolean; coverUrl?: string } = {},
): UpsertBookInput {
  return {
    ...(options.bookId ? { bookId: options.bookId } : {}),
    ...(options.allowDuplicate ? { allowDuplicate: true } : {}),
    // The cover is downscaled from the parsed PDF/EPUB image; without this passthrough the preview
    // showed it but the saved book fell back to a theme cover.
    ...(options.coverUrl ? { coverUrl: options.coverUrl } : {}),
    title: edit.title.trim() || parsed.title,
    author: edit.author.trim(),
    description: edit.description,
    language: edit.language,
    publisher: edit.publisher,
    publishedAt: edit.publishedAt,
    series: edit.series,
    seriesIndex: edit.seriesIndex,
    identifier: edit.identifier,
    category: edit.category,
    folderId: edit.folderId,
    format: parsed.format,
    content: parsed.content,
    fingerprint,
    sourceOverrides: parsed.sourceOverrides,
    srtCues: parsed.srtCues,
    chapters: parsed.chapters,
    ...(parsed.pdfLayout ? { pdfLayout: parsed.pdfLayout } : {}),
    ...(parsed.pageStarts ? { pageStarts: parsed.pageStarts } : {}),
    ...(parsed.pageLabels ? { pageLabels: parsed.pageLabels } : {}),
  };
}

export function formatImportBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

export function importWarningText(t: Translations, warning: ImportWarning): string {
  switch (warning.code) {
    case 'auto-chapters': return t.importPreviewWarningAutoChapters;
    case 'running-heads-removed': return fill(t.importPreviewWarningRunningHeads, { count: warning.count ?? 0 });
    case 'footnotes-inline': return t.importPreviewWarningFootnotesInline;
    case 'fixed-layout': return t.importPreviewWarningFixedLayout;
    case 'missing-cover': return t.importPreviewWarningMissingCover;
    case 'images-skipped': return fill(t.importPreviewWarningImagesSkipped, { count: warning.count ?? 0 });
    case 'low-text': return t.importPreviewWarningLowText;
    case 'unknown-image-format': return t.importPreviewWarningUnknownImageFormat;
  }
}

export function importErrorText(t: Translations, code: ImportErrorCode): string {
  switch (code) {
    case 'password-required': return t.importPreviewErrorPasswordRequired;
    case 'password-wrong': return t.importPreviewErrorPasswordWrong;
    case 'drm-protected': return t.importPreviewErrorDrmProtected;
    case 'scanned-pdf': return t.importPreviewErrorScannedPdf;
    case 'empty-book': return t.importPreviewErrorEmptyBook;
    case 'corrupt-file': return t.importPreviewErrorCorruptFile;
    case 'unsupported-format': return t.importPreviewErrorUnsupportedFormat;
    case 'out-of-memory': return t.importPreviewErrorOutOfMemory;
    case 'io-error': return t.importPreviewErrorIo;
    case 'cancelled': return t.importPreviewErrorCancelled;
    case 'unknown': return t.importPreviewErrorUnknown;
  }
}

export function importStageText(t: Translations, stage: string): string {
  switch (stage) {
    case 'reading': return t.importPreviewStageReading;
    case 'text': return t.importPreviewStageText;
    case 'images': return t.importPreviewStageImages;
    case 'chapters': return t.importPreviewStageChapters;
    case 'cover': return t.importPreviewStageCover;
    case 'done': return t.importPreviewStageDone;
    default: return stage;
  }
}
