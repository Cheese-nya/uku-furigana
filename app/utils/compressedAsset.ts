export type AssetCompression = 'gzip' | 'br';

export interface CompressedAssetUrls {
  /** Preferred when the browser can decompress it. */
  brotli?: string;
  /** Always present; the compatibility path and the fallback when a Brotli file is missing. */
  gzip: string;
}

const gzipMagic = (bytes: Uint8Array) => bytes[0] === 0x1f && bytes[1] === 0x8b;

/** Firefox/Safari may accept "brotli" or "br"; Chrome/Edge (tested through 157) support neither. */
function nativeFormat(format: AssetCompression): CompressionFormat | null {
  if (typeof DecompressionStream !== 'function') return null;
  for (const candidate of format === 'br' ? ['brotli', 'br'] : ['gzip']) {
    try {
      new DecompressionStream(candidate as CompressionFormat);
      return candidate as CompressionFormat;
    } catch {
      // Try the next spelling, then fall back to gzip.
    }
  }
  return null;
}

export function supportsCompression(format: AssetCompression): boolean {
  return nativeFormat(format) !== null;
}

export interface FetchCompressedOptions {
  /** Allocate the output exactly once; important for the ~100 MB dictionary. */
  expectedSize?: number;
}

function checkSize(bytes: Uint8Array, expectedSize?: number): Uint8Array {
  if (expectedSize !== undefined && bytes.byteLength !== expectedSize) {
    throw new Error(`解压后大小不符：期望 ${expectedSize}，实际 ${bytes.byteLength}`);
  }
  return bytes;
}

/** Decompresses a response body unless the server already did it (or the gzip bytes are already plain). */
export async function decompressAsset(
  bytes: Uint8Array,
  format: AssetCompression,
  alreadyDecoded = false,
  expectedSize?: number,
): Promise<Uint8Array> {
  if (alreadyDecoded) return checkSize(bytes, expectedSize);
  // Servers commonly decode .gz themselves via Content-Encoding. Brotli has no magic, so the
  // caller supplies the response header; gzip can additionally be recognised by its signature.
  if (format === 'gzip' && !gzipMagic(bytes)) return checkSize(bytes, expectedSize);
  const native = nativeFormat(format);
  if (!native) {
    throw new Error(`当前浏览器不支持 ${format} 解压`);
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(native));
  if (expectedSize === undefined) {
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const reader = stream.getReader();
  const out = new Uint8Array(expectedSize);
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > expectedSize) throw new Error('解压后大小超出预期');
    out.set(value, offset);
    offset += value.length;
  }
  if (offset !== expectedSize) throw new Error(`解压后大小不符：期望 ${expectedSize}，实际 ${offset}`);
  return out;
}

export async function fetchCompressedBytes(
  urls: CompressedAssetUrls,
  fetchFn: typeof fetch = fetch,
  options: FetchCompressedOptions = {},
): Promise<Uint8Array> {
  let brotliError: unknown;
  if (urls.brotli && supportsCompression('br')) {
    try {
      const response = await fetchFn(urls.brotli);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return await decompressAsset(
        bytes,
        'br',
        Boolean(response.headers.get('content-encoding')),
        options.expectedSize,
      );
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') throw error;
      brotliError = error;
    }
  }

  const response = await fetchFn(urls.gzip);
  if (!response.ok) {
    const detail = brotliError ? `；Brotli：${String(brotliError)}` : '';
    throw new Error(`${response.status} ${response.statusText}${detail}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return decompressAsset(
    bytes,
    'gzip',
    Boolean(response.headers.get('content-encoding')),
    options.expectedSize,
  );
}

export async function fetchCompressedJson<T>(
  urls: CompressedAssetUrls,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const bytes = await fetchCompressedBytes(urls, fetchFn);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** Rewrites a gzip URL to its sibling Brotli URL (used by manifests that only list gzip names). */
export function brotliSibling(url: string): string {
  return url.endsWith('.gz') ? `${url.slice(0, -3)}.br` : `${url}.br`;
}
