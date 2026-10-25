import { logEvent } from './appLog';
import {
  fetchNativePixivNovel,
  getNativePixivBridge,
} from './pixivNativeBridge';

export interface PixivNovelResult {
  id: string;
  title: string;
  author: string;
  description: string;
  content: string;
  rubyOverrides: Record<string, string>;
  coverUrl: string;
  sourceUrl: string;
}

// Pixiv ids are 4-15 digits in every shape (bare id, `id=` query/fragment, `/novels/` path),
// so all patterns share one rule; `(?!\d)` rejects a truncated prefix of a longer number.
const BARE_ID_RE = /^(\d{4,15})(?!\d)$/;
const QUERY_ID_RE = /[?&]id=(\d{4,15})(?!\d)/i;
const LOOSE_ID_RE = /\bid=(\d{4,15})(?!\d)/i;
const NOVEL_PATH_ID_RE = /\/novels\/(\d{4,15})(?!\d)/i;

export function extractPixivNovelId(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (BARE_ID_RE.test(trimmed)) {
    return trimmed;
  }

  const queryMatch = trimmed.match(QUERY_ID_RE) || trimmed.match(LOOSE_ID_RE);
  if (queryMatch?.[1]) {
    return queryMatch[1];
  }

  const pathMatch = trimmed.match(NOVEL_PATH_ID_RE);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  return null;
}

export function cleanPixivDescription(html: string): string {
  if (!html) return '';
  return html
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&amp;/gi, '&')
    .trim();
}

export function cleanPixivContent(raw: string): {
  content: string;
  rubyOverrides: Record<string, string>;
} {
  const rubyOverrides: Record<string, string> = {};
  if (!raw) return { content: '', rubyOverrides };

  let content = raw.replace(/\r\n?/g, '\n');

  content = content.replace(
    /\[\[rb:([^\s>＞]+)\s*[>＞]\s*([^\]]+)\]\]/g,
    (_match, kanji: string, reading: string) => {
      const cleanKanji = kanji.trim();
      const cleanReading = reading.trim();
      if (cleanKanji && cleanReading) {
        rubyOverrides[cleanKanji] = cleanReading;
      }
      // A whitespace-only reading carries no annotation: keep the base text only
      // instead of emitting an empty pair of parentheses.
      return cleanReading ? `${cleanKanji}(${cleanReading})` : cleanKanji;
    },
  );

  content = content.replace(/\[chapter:([^\]]+)\]/gi, '\n【$1】\n');
  content = content.replace(/\[newpage\]/gi, '\n\n');
  content = content.replace(/\[pixivimage:[^\]]+\]/gi, '');
  content = content.replace(/\[uploadedimage:[^\]]+\]/gi, '');
  content = content.replace(/\n{4,}/g, '\n\n\n').trim();

  return { content, rubyOverrides };
}

export function toPixivMirrorCoverUrl(coverUrl: string): string {
  if (!coverUrl) return '';
  const trimmed = coverUrl.trim();
  if (trimmed.startsWith('data:')) return trimmed;
  return trimmed.replace(/^https?:\/\/i\.pximg\.net\//i, 'https://i.pixiv.re/');
}

export async function fetchPixivNovel(urlOrId: string): Promise<PixivNovelResult> {
  const id = extractPixivNovelId(urlOrId);
  if (!id) {
    throw new Error('无效的 Pixiv 小说链接或 ID');
  }

  // Native shells have no /api routes and cannot call pixiv.net cross-origin, so the
  // injected bridge is the only working transport there. Keep its error so a network
  // failure is reported as such instead of as a misleading 404 from the cascade below.
  // What each transport answered, for the bug-report log (no novel text, only reasons and status codes).
  const attempts: string[] = [];
  const describe = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  let nativeErrorMessage: string | null = null;
  if (getNativePixivBridge()) {
    try {
      return await fetchNativePixivNovel(id);
    } catch (error) {
      nativeErrorMessage = error instanceof Error ? error.message : String(error);
      attempts.push(`native bridge: ${describe(error)}`);
    }
  }

  let apiErrorMessage: string | null = null;
  try {
    const apiRes = await fetch(`/api/pixiv?id=${encodeURIComponent(id)}`);
    if (apiRes.ok) {
      const data = (await apiRes.json()) as PixivNovelResult;
      if (data && typeof data.content === 'string') {
        return data;
      }
    } else {
      try {
        const errJson = (await apiRes.json()) as { error?: string };
        if (errJson?.error) apiErrorMessage = errJson.error;
      } catch {
        // Ignore non-JSON error body
      }
      attempts.push(`/api/pixiv: HTTP ${apiRes.status}`);
    }
  } catch (error) {
    // Ignore local route network errors and try direct fallback
    attempts.push(`/api/pixiv: ${describe(error)}`);
  }

  const ajaxEndpoints = [
    `/api/pixiv-ajax?id=${encodeURIComponent(id)}`,
    `https://www.pixiv.net/ajax/novel/${encodeURIComponent(id)}`,
  ];

  let lastError: unknown = null;
  // Pixiv's own explanation (e.g. 作品已删除) is more useful than a generic HTTP failure
  // from a later endpoint, so remember it even when the cascade ends on a transport error.
  let cascadePixivMessage: string | null = null;
  // The Android shell answers /api/pixiv-ajax itself and fetches pixiv.net natively; when that cannot
  // reach pixiv it says why (timeout, DNS…). The direct request after it always fails on CORS with a
  // bare "Failed to fetch", so this reason is the one worth showing.
  let proxyNetworkMessage: string | null = null;
  for (const endpoint of ajaxEndpoints) {
    const label = endpoint.startsWith('/') ? '/api/pixiv-ajax' : 'pixiv.net direct';
    try {
      const directRes = await fetch(endpoint, {
        headers: {
          Accept: 'application/json',
        },
      });
      if (!directRes.ok) {
        const reason = await directRes.json().then(
          (body: { message?: unknown }) => (typeof body?.message === 'string' ? body.message.trim() : ''),
          () => '',
        );
        attempts.push(`${label}: HTTP ${directRes.status}${reason ? ` ${reason}` : ''}`);
        if (reason && label === '/api/pixiv-ajax' && directRes.status === 502) proxyNetworkMessage = reason;
        else if (reason) cascadePixivMessage = reason;
        throw new Error(`Pixiv 请求失败 (HTTP ${directRes.status})`);
      }
      const json = (await directRes.json()) as {
        error?: boolean;
        message?: string;
        body?: {
          title?: string;
          userName?: string;
          description?: string;
          content?: string;
          coverUrl?: string;
        };
      };
      if (json.error !== false || !json.body) {
        if (json.message) cascadePixivMessage = json.message;
        throw new Error(json.message || '未找到该 Pixiv 小说');
      }
      const body = json.body;
      const title = (body.title || `Pixiv #${id}`).trim();
      const author = (body.userName || '').trim();
      const description = cleanPixivDescription(body.description || '');
      const { content, rubyOverrides } = cleanPixivContent(body.content || '');
      let coverUrl = toPixivMirrorCoverUrl(body.coverUrl || '');

      if (body.coverUrl && typeof body.coverUrl === 'string') {
        try {
          const imgRes = await fetch(
            `/api/pixiv-image?url=${encodeURIComponent(body.coverUrl)}`,
          );
          if (imgRes.ok) {
            const imgData = (await imgRes.json()) as { dataUrl?: string };
            if (imgData?.dataUrl?.startsWith('data:image/')) {
              coverUrl = imgData.dataUrl;
            }
          }
        } catch {
          // Keep mirror coverUrl fallback
        }
      }

      return {
        id,
        title,
        author,
        description,
        content,
        rubyOverrides,
        coverUrl,
        sourceUrl: `https://www.pixiv.net/novel/show.php?id=${id}`,
      };
    } catch (err) {
      if (!(err instanceof Error && err.message.startsWith('Pixiv 请求失败'))) attempts.push(`${label}: ${describe(err)}`);
      lastError = err;
    }
  }

  logEvent('warn', 'pixiv', `import failed: ${attempts.join(' | ')}`);
  // Precedence: the native bridge reason (the only real transport in the shells), then
  // the local /api/pixiv reason, then Pixiv's own cascade message, then the native proxy's
  // network reason, then the last failure.
  if (nativeErrorMessage) {
    throw new Error(nativeErrorMessage);
  }
  if (apiErrorMessage) {
    throw new Error(apiErrorMessage);
  }
  if (cascadePixivMessage) {
    throw new Error(cascadePixivMessage);
  }
  if (proxyNetworkMessage) {
    throw new Error(`${PIXIV_UNREACHABLE}（${proxyNetworkMessage}）`);
  }
  // fetch() rejects with a TypeError for network and CORS failures ("Failed to fetch", "Load failed").
  if (lastError instanceof TypeError) {
    throw new Error(PIXIV_UNREACHABLE);
  }
  throw lastError instanceof Error ? lastError : new Error('获取 Pixiv 小说失败');
}

export const PIXIV_UNREACHABLE = '无法连接 pixiv.net，请检查网络（中国大陆需要能访问 pixiv 才能导入）';
