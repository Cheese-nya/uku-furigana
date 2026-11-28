export interface ExportCover {
  data: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
  width?: number;
  height?: number;
}

export type ExportCoverInput = ExportCover | Blob | string | null | undefined;

export function readImageDimensions(
  bytes: Uint8Array,
  mime: 'image/jpeg' | 'image/png',
): { width: number; height: number } | null {
  if (mime === 'image/png' && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (mime === 'image/jpeg' && bytes.length >= 4) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (offset + 2 > bytes.length) break;
      const segLen = view.getUint16(offset, false);
      if (segLen < 2 || offset + segLen > bytes.length) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && segLen >= 7) {
        const height = view.getUint16(offset + 3, false);
        const width = view.getUint16(offset + 5, false);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += segLen;
    }
  }
  return null;
}

function sniffImageMime(bytes: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

function decodeBase64(base64: string): Uint8Array | null {
  const cleaned = base64.replace(/\s+/g, '');
  if (!cleaned) return null;
  if (typeof atob === 'function') {
    try {
      const binary = atob(cleaned);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        out[i] = binary.charCodeAt(i);
      }
      return out;
    } catch {
      return null;
    }
  }
  if (typeof Buffer !== 'undefined') {
    try {
      return new Uint8Array(Buffer.from(cleaned, 'base64'));
    } catch {
      return null;
    }
  }
  return null;
}

async function transcodeToJpegOrPng(blob: Blob): Promise<ExportCover | null> {
  if (typeof document === 'undefined') return null;
  const url = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(blob)
    : null;
  if (!url) return null;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode cover image'));
      el.src = url;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width <= 0 || height <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    const mime: 'image/jpeg' | 'image/png' = blob.type === 'image/png' || blob.type === 'image/webp'
      ? 'image/png'
      : 'image/jpeg';
    const outBlob = await new Promise<Blob | null>(resolve => {
      if (typeof canvas.toBlob !== 'function') {
        resolve(null);
        return;
      }
      canvas.toBlob(result => resolve(result), mime, mime === 'image/jpeg' ? 0.9 : undefined);
    });
    canvas.width = 0;
    canvas.height = 0;
    if (!outBlob) return null;
    const bytes = new Uint8Array(await outBlob.arrayBuffer());
    const sniffed = sniffImageMime(bytes);
    return sniffed ? { data: bytes, mime: sniffed } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Normalise a cover from library metadata (`data:image/...` URL), a parsed `Blob`, or raw
 * `ExportCover` bytes into JPEG or PNG bytes ready to embed in EPUB, PDF, or DOCX exports.
 */
export async function resolveExportCover(input: ExportCoverInput): Promise<ExportCover | null> {
  if (!input) return null;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    const match = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
    if (!match) return null;
    const bytes = decodeBase64(match[2]);
    if (!bytes || bytes.length === 0) return null;
    const sniffed = sniffImageMime(bytes);
    if (sniffed) return { data: bytes, mime: sniffed };
    const rawMime = match[1].toLowerCase();
    if (typeof Blob !== 'undefined' && rawMime.startsWith('image/')) {
      return transcodeToJpegOrPng(new Blob([bytes as BlobPart], { type: rawMime }));
    }
    return null;
  }

  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    try {
      const bytes = new Uint8Array(await input.arrayBuffer());
      if (bytes.length === 0) return null;
      const sniffed = sniffImageMime(bytes);
      if (sniffed) return { data: bytes, mime: sniffed };
      return transcodeToJpegOrPng(input);
    } catch {
      return null;
    }
  }

  if (typeof input === 'object' && 'data' in input && input.data instanceof Uint8Array) {
    if (input.data.length === 0) return null;
    const sniffed = sniffImageMime(input.data);
    if (sniffed) return { data: input.data, mime: sniffed };
    return null;
  }

  return null;
}
