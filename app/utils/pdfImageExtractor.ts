import { throwIfAborted } from './importErrors';
import { installPdfJsCompat } from './pdfjsCompat';

interface PdfObjectStoreLike {
  get(name: string, callback?: (value: unknown) => void): unknown;
}

/** The subset of a pdf.js page needed to pull illustrations and render a cover. */
export interface PdfImagePageLike {
  getOperatorList?(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs?: PdfObjectStoreLike;
  commonObjs?: PdfObjectStoreLike;
  getViewport?(params: { scale: number }): { width: number; height: number };
  render?(params: { canvasContext: CanvasRenderingContext2D; viewport: unknown; intent?: 'display' | 'print' }):
    | { promise: Promise<void> }
    | Promise<void>;
}

export interface EncodedImage {
  mime: string;
  data: Uint8Array;
}

export interface PdfImageItem extends EncodedImage {
  id: string;
  pageIndex: number;
}

interface PdfImageLike {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8ClampedArray | Uint8Array;
  /** pdf.js 6 delivers decoded images as an ImageBitmap wrapper instead of raw pixels. */
  bitmap?: CanvasImageSource | null;
  isSvg?: boolean;
}

interface OpsLike {
  paintImageXObject?: number;
  paintJpegXObject?: number;
  paintInlineImageXObject?: number;
}

export interface PdfImageExtractionOptions {
  /** Test seam: encode a pdf.js image object without a DOM canvas. */
  encodeImage?: (image: unknown) => Promise<EncodedImage | null>;
  /** Test seam: pdf.js OPS constants; loaded lazily in the browser. */
  ops?: OpsLike;
  /** Text characters on the page; a full-page background under real text is skipped. */
  pageTextChars?: number;
  /** Image hashes already emitted, so a repeated decoration is stored once. */
  seen?: Set<string>;
  signal?: AbortSignal;
  /** Images smaller than this fraction of the page are decorations/gaiji. */
  minAreaRatio?: number;
}

function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function imageDimensions(image: unknown): { width: number; height: number } | null {
  if (!image || typeof image !== 'object') return null;
  const width = positive((image as PdfImageLike).width);
  const height = positive((image as PdfImageLike).height);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** FNV-1a over the first few KB: enough to spot the same decoration repeated across pages. */
function imageHash(image: PdfImageLike, width: number, height: number): string | null {
  const data = image.data;
  // pdf.js 6 bitmaps carry no pixel bytes; dimensions alone would merge distinct illustrations
  // that happen to share a size, so those images are never deduplicated.
  if (!data || typeof data.length !== 'number') return null;
  let hash = 0x811c9dc5;
  const limit = Math.min(data.length, 4096);
  for (let index = 0; index < limit; index += 1) {
    hash ^= data[index];
    hash = Math.imul(hash, 0x01000193);
  }
  return `${width}x${height}:${image.kind ?? 0}:${data.length}:${hash >>> 0}`;
}

function objectForName(page: PdfImagePageLike, name: unknown): unknown {
  if (typeof name !== 'string') return undefined;
  // pdf.js sends page-local images through `objs` and shared ones (g_*) through `commonObjs`.
  const store = name.startsWith('g_') ? page.commonObjs : page.objs;
  if (!store?.get) return undefined;
  try {
    return store.get(name);
  } catch {
    // The worker may still be decoding this image when the operator list resolves. Dropping it
    // here silently loses illustrations; pdf.js calls back when the object arrives.
    return new Promise(resolve => {
      try {
        store.get(name, resolve);
      } catch {
        resolve(undefined);
      }
    });
  }
}

async function loadOps(options: PdfImageExtractionOptions): Promise<OpsLike | null> {
  if (options.ops) return options.ops;
  installPdfJsCompat();
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjs.OPS as unknown as OpsLike;
  } catch {
    return null;
  }
}

function toRgba(image: PdfImageLike, width: number, height: number): { data: Uint8ClampedArray; alpha: boolean } | null {
  const source = image.data;
  if (!source) return null;
  if (image.kind === 1) {
    // 1-bit grayscale: rows are byte-aligned, MSB first.
    const rowBytes = (width + 7) >> 3;
    if (source.length < rowBytes * height) return null;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (source[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const value = bit ? 0 : 255;
        const target = (y * width + x) * 4;
        rgba[target] = value;
        rgba[target + 1] = value;
        rgba[target + 2] = value;
        rgba[target + 3] = 255;
      }
    }
    return { data: rgba, alpha: false };
  }
  if (image.kind === 2) {
    if (source.length < width * height * 3) return null;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      rgba[index * 4] = source[index * 3];
      rgba[index * 4 + 1] = source[index * 3 + 1];
      rgba[index * 4 + 2] = source[index * 3 + 2];
      rgba[index * 4 + 3] = 255;
    }
    return { data: rgba, alpha: false };
  }
  if (image.kind === 3) {
    if (source.length < width * height * 4) return null;
    return { data: new Uint8ClampedArray(source.buffer.slice(source.byteOffset, source.byteOffset + width * height * 4)), alpha: true };
  }
  return null;
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

/** Browser default: draw the pdf.js image object into a canvas, downscale, encode. */
export async function defaultEncodeImage(image: unknown): Promise<EncodedImage | null> {
  if (typeof document === 'undefined') return null;
  const dimensions = imageDimensions(image);
  if (!dimensions) return null;
  const { width, height } = dimensions;
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  let source: CanvasImageSource | null = null;
  let alpha = false;
  const typed = image as PdfImageLike;
  if (typed.bitmap) {
    // pdf.js 6 stores the decoded pixels here; the wrapper has no `data`.
    source = typed.bitmap;
    alpha = typed.kind === 3 || typed.isSvg === true;
  } else {
    const rgba = toRgba(typed, width, height);
    if (rgba) {
      alpha = rgba.alpha;
      const raw = document.createElement('canvas');
      raw.width = width;
      raw.height = height;
      const rawContext = raw.getContext('2d');
      if (!rawContext) return null;
      rawContext.putImageData(new ImageData(rgba.data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
      source = raw;
    } else if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      source = image;
    } else if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
      source = image;
    } else if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
      source = image;
    }
  }
  if (!source) return null;

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  const mime = alpha ? 'image/png' : 'image/jpeg';
  const blob = await canvasToBlob(canvas, mime, 0.85);
  if (!blob) return null;
  const data = new Uint8Array(await blob.arrayBuffer());
  canvas.width = 0;
  canvas.height = 0;
  return { mime, data };
}

/**
 * Pull large images from one PDF page. Text-layer PDFs use images for covers, illustrations and
 * background art; small gaiji/decoration is ignored, and a full-page background under real text is
 * skipped so a scanned-looking backdrop never replaces the extracted text.
 */
export async function extractPageImages(
  page: PdfImagePageLike,
  pageIndex: number,
  pageSize: { width: number; height: number } | null,
  options: PdfImageExtractionOptions = {},
): Promise<{ images: PdfImageItem[]; skipped: number; failed: number }> {
  if (!pageSize || !page.getOperatorList) return { images: [], skipped: 0, failed: 0 };
  const ops = await loadOps(options);
  if (!ops) return { images: [], skipped: 0, failed: 0 };

  let operatorList: { fnArray: number[]; argsArray: unknown[][] };
  try {
    operatorList = await page.getOperatorList();
  } catch {
    return { images: [], skipped: 0, failed: 0 };
  }

  const pageArea = pageSize.width * pageSize.height;
  const minAreaRatio = options.minAreaRatio ?? 0.05;
  const seen = options.seen ?? new Set<string>();
  const images: PdfImageItem[] = [];
  let ignored = 0;
  let failed = 0;

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    throwIfAborted(options.signal);
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] ?? [];
    let image: unknown;
    if (fn === ops.paintImageXObject || fn === ops.paintJpegXObject) {
      image = await objectForName(page, args[0]);
    } else if (fn === ops.paintInlineImageXObject) {
      image = args[0];
    } else {
      continue;
    }
    const dimensions = imageDimensions(image);
    if (!dimensions) continue;
    const { width, height } = dimensions;
    if (width < 64 && height < 64) {
      ignored += 1;
      continue;
    }
    const areaRatio = (width * height) / pageArea;
    if (areaRatio < minAreaRatio) {
      ignored += 1;
      continue;
    }
    if (areaRatio > 0.85 && (options.pageTextChars ?? 0) > 100) {
      ignored += 1;
      continue;
    }
    const hash = imageHash(image as PdfImageLike, width, height);
    if (hash) {
      if (seen.has(hash)) {
        ignored += 1;
        continue;
      }
      seen.add(hash);
    }

    const encoded = options.encodeImage
      ? await options.encodeImage(image)
      : await defaultEncodeImage(image);
    if (!encoded) {
      failed += 1;
      continue;
    }
    images.push({ id: `img-${pageIndex + 1}-${images.length + 1}`, pageIndex, ...encoded });
  }

  return { images, skipped: ignored, failed };
}

/** Render page 1 as the cover. Injected in tests; a missing DOM canvas just yields no cover. */
export async function renderPdfCover(
  page: PdfImagePageLike,
  encode: (page: PdfImagePageLike) => Promise<EncodedImage | null>,
): Promise<EncodedImage | null> {
  return encode(page);
}

export async function defaultCoverEncoder(page: PdfImagePageLike): Promise<EncodedImage | null> {
  if (typeof document === 'undefined' || !page.render || !page.getViewport) return null;
  const base = page.getViewport({ scale: 1 });
  if (positive(base.width) <= 0 || positive(base.height) <= 0) return null;
  const scale = Math.min(2, Math.max(1, 600 / Math.max(base.width, base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) return null;
  try {
    // Print intent schedules the render on microtasks instead of animation frames. A cover is a
    // one-off bitmap and does not need screen-only annotations; rAF scheduling can stall when the
    // page is in a background tab, which would otherwise hang the whole import at the cover stage.
    const task = page.render({ canvasContext: context, viewport, intent: 'print' });
    await ('promise' in task ? task.promise : task);
  } catch {
    return null;
  }
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
  if (!blob) return null;
  const data = new Uint8Array(await blob.arrayBuffer());
  canvas.width = 0;
  canvas.height = 0;
  return { mime: 'image/jpeg', data };
}
