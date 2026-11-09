import { requirePixivContent } from './pixivErrors';

export interface NativePixivNovel {
  id: string;
  title: string;
  author: string;
  description: string;
  content: string;
  rubyOverrides: Record<string, string>;
  coverUrl: string;
  sourceUrl: string;
}

interface NativePixivBridge {
  isNative?: boolean;
  novel?: (id: string) => Promise<unknown>;
  image?: (url: string) => Promise<unknown>;
  account?: (action: 'status' | 'login' | 'logout') => Promise<{ supported: boolean; loggedIn: boolean; error?: string }>;
}

declare global {
  interface Window {
    furiganaPixiv?: NativePixivBridge;
  }
}

/**
 * Recovers the native Pixiv transport, when the app runs inside a native shell.
 *
 * The statically exported bundle has no `/api` routes, so `fetch('/api/pixiv?id=…')`
 * resolves to `capacitor://localhost/api/pixiv` and fails with WebKit's
 * `TypeError: Load failed`; a direct request to pixiv.net is blocked by CORS.
 * Android intercepts the virtual host in `MainActivity.java`; iOS injects
 * `window.furiganaPixiv` from `PixivNativeBridge.swift`. On the web this returns null
 * and the normal `/api/pixiv` + direct-AJAX path in `pixivImporter.ts` is used.
 */
export function getNativePixivBridge(): NativePixivBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.furiganaPixiv;
  if (!bridge || typeof bridge.novel !== 'function') return null;
  return bridge;
}

export function hasNativePixivBridge(): boolean {
  return getNativePixivBridge() !== null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeRubyOverrides(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const overrides: Record<string, string> = {};
  for (const [surface, reading] of Object.entries(record)) {
    if (typeof reading !== 'string') continue;
    const trimmedSurface = surface.trim();
    const trimmedReading = reading.trim();
    if (trimmedSurface && trimmedReading) {
      overrides[trimmedSurface] = trimmedReading;
    }
  }
  return overrides;
}

/** Validates the native payload before it reaches the editor and library storage. */
export function normalizeNativePixivNovel(raw: unknown, fallbackId: string): NativePixivNovel | null {
  const record = asRecord(raw);
  if (!record) return null;
  const content = asString(record.content);
  if (!content.trim()) return null;

  const id = asString(record.id) || fallbackId;
  const title = asString(record.title).trim() || `Pixiv #${id}`;
  return {
    id,
    title,
    author: asString(record.author).trim(),
    description: asString(record.description),
    content,
    rubyOverrides: normalizeRubyOverrides(record.rubyOverrides),
    coverUrl: asString(record.coverUrl),
    sourceUrl: asString(record.sourceUrl) || `https://www.pixiv.net/novel/show.php?id=${id}`,
  };
}

/** Fetches novel metadata through the native bridge; throws with the native reason. */
export async function fetchNativePixivNovel(id: string): Promise<NativePixivNovel> {
  const bridge = getNativePixivBridge();
  if (!bridge?.novel) {
    throw new Error('原生 Pixiv 通道不可用');
  }
  const raw = await bridge.novel(id);
  const record = asRecord(raw);
  requirePixivContent(record?.content, record?.isLoginOnly === true);
  const novel = normalizeNativePixivNovel(raw, id);
  if (!novel) {
    throw new Error('Pixiv 返回的正文为空');
  }
  return novel;
}

/** Fetches a cover as a data URL through the native bridge; null when unavailable. */
export async function fetchNativePixivImage(url: string): Promise<string | null> {
  const bridge = getNativePixivBridge();
  if (!bridge?.image || !url) return null;
  try {
    const dataUrl = await bridge.image(url);
    return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : null;
  } catch {
    return null;
  }
}
