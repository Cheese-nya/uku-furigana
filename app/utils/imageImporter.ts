import type { ImportOptions, ImportWarning, ImportedBook } from './bookAssets';
import { cleanScriptTitle } from './docxImporter';
import { ImportError, throwIfAborted, toImportError } from './importErrors';
import { reconstructOcrDocument } from './ocrLayout';
import { recognizeCanvas } from './ocrService';
import { loadOcrSettings } from './ocrSettings';
import type { OcrEngineUsed, OcrPageResult } from './ocrTypes';

const MAX_OCR_LONG_SIDE = 1600;
const MAX_COVER_LONG_SIDE = 600;

function stripFileExt(name: string): string {
  const base = name.replace(/^.*[/\\]/, '');
  const stripped = base.replace(/\.[^.]+$/, '').trim() || base;
  return /^(?:document|msf|primary|raw|image|video|audio|downloads?):\d+$/i.test(stripped) ? 'Untitled' : stripped;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob(blob => resolve(blob), mime, quality);
  });
}

async function decodeBlobToCanvas(blob: Blob, maxLongSide: number, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  throwIfAborted(signal);
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new ImportError('ocr-failed', 'Browser canvas is unavailable for image OCR');
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImportError('corrupt-file', 'Unable to decode image'));
      el.src = url;
    });
    throwIfAborted(signal);
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (naturalW <= 0 || naturalH <= 0) {
      throw new ImportError('corrupt-file', 'Image has empty dimensions');
    }
    const scale = Math.min(1, maxLongSide / Math.max(naturalW, naturalH));
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.width = 0;
      canvas.height = 0;
      throw new ImportError('ocr-failed', 'Canvas 2D context unavailable');
    }
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function encodeCanvasCover(canvas: HTMLCanvasElement): Promise<{ mime: string; data: Uint8Array } | undefined> {
  if (typeof document === 'undefined') return undefined;
  const scale = Math.min(1, MAX_COVER_LONG_SIDE / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const thumb = document.createElement('canvas');
  thumb.width = w;
  thumb.height = h;
  try {
    const ctx = thumb.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(canvas, 0, 0, w, h);
    const blob = await canvasToBlob(thumb, 'image/jpeg', 0.85);
    if (!blob) return undefined;
    return { mime: 'image/jpeg', data: new Uint8Array(await blob.arrayBuffer()) };
  } finally {
    thumb.width = 0;
    thumb.height = 0;
  }
}

export interface ImageOcrTextResult {
  text: string;
  defaultWritingMode: 'horizontal' | 'vertical';
  warnings: ImportWarning[];
  engineUsed: OcrEngineUsed;
}

/** Recognize one image file or pasted screenshot into reconstructed Japanese text. */
export async function recognizeImageToText(
  image: Blob,
  options: ImportOptions = {},
): Promise<ImageOcrTextResult> {
  throwIfAborted(options.signal);
  const settings = loadOcrSettings();
  let pageResult: OcrPageResult;

  if (options.recognizePage) {
    pageResult = await options.recognizePage({ pageIndex: 0, width: 0, height: 0 });
  } else {
    const canvas = await decodeBlobToCanvas(image, MAX_OCR_LONG_SIDE, options.signal);
    try {
      pageResult = await recognizeCanvas(canvas, {
        signal: options.signal,
        filterRuby: settings.filterRuby,
      });
    } catch (error) {
      throw toImportError(error);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  const reconstructed = reconstructOcrDocument([pageResult], { filterRuby: settings.filterRuby });
  return {
    text: reconstructed.text,
    defaultWritingMode: reconstructed.defaultWritingMode,
    warnings: reconstructed.warnings,
    engineUsed: pageResult.engineUsed,
  };
}

/** Sort image files naturally so `page_2.png` comes before `page_10.png`. */
export function sortImageFilesNaturally(files: readonly File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/**
 * Import one or multiple image files as a structured book via local OCR, keeping natural page
 * order, page-1 cover, `pageStarts`, `defaultWritingMode`, and auto-detected chapters.
 */
export async function importImagesAsBook(
  files: readonly File[],
  options: ImportOptions = {},
): Promise<ImportedBook> {
  throwIfAborted(options.signal);
  if (files.length === 0) {
    throw new ImportError('empty-book', 'No image files provided');
  }

  const ordered = sortImageFilesNaturally(files);
  const settings = loadOcrSettings();
  const pages: OcrPageResult[] = [];
  let cover: { mime: string; data: Uint8Array } | undefined;
  let failedPages = 0;

  for (let i = 0; i < ordered.length; i += 1) {
    throwIfAborted(options.signal);
    const file = ordered[i];
    options.onProgress?.({ stage: 'ocr', current: i + 1, total: ordered.length });

    let canvas: HTMLCanvasElement | null = null;
    try {
      if (options.recognizePage) {
        const res = await options.recognizePage({ pageIndex: i, width: 0, height: 0 });
        pages.push({ ...res, pageIndex: i });
      } else {
        canvas = await decodeBlobToCanvas(file, MAX_OCR_LONG_SIDE, options.signal);
        if (i === 0) {
          cover = await encodeCanvasCover(canvas).catch(() => undefined);
        }
        const res = await recognizeCanvas(canvas, {
          signal: options.signal,
          filterRuby: settings.filterRuby,
        });
        pages.push({ ...res, pageIndex: i });
      }
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
      if (ordered.length === 1) {
        throw toImportError(error);
      }
      failedPages += 1;
      pages.push({
        pageIndex: i,
        pageWidth: 0,
        pageHeight: 0,
        boxes: [],
        engineUsed: 'ndlocr-lite',
        elapsedMs: 0,
        warnings: [],
      });
    } finally {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }

  const reconstructed = reconstructOcrDocument(pages, { filterRuby: settings.filterRuby });
  if (reconstructed.text.replace(/\s+/g, '').length === 0) {
    throw new ImportError('empty-book', '未从图片中识别出文字');
  }

  const warnings = [...reconstructed.warnings];
  if (!cover) warnings.push({ code: 'missing-cover' });
  if (failedPages > 0) warnings.push({ code: 'ocr-pages-failed', count: failedPages });

  const baseName = stripFileExt(ordered[0].name);
  const title = cleanScriptTitle(baseName) || 'Untitled';
  const pageLabels = ordered.map((_, idx) => String(idx + 1));

  options.onProgress?.({ stage: 'done', current: 1, total: 1 });
  return {
    title,
    author: '',
    text: reconstructed.text,
    overrides: [],
    chapters: reconstructed.chapters,
    images: [],
    warnings,
    defaultWritingMode: reconstructed.defaultWritingMode,
    pageStarts: reconstructed.pageStarts,
    pageLabels,
    ...(cover ? { cover } : {}),
  };
}
