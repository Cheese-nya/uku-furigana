import { NextResponse } from 'next/server';
import { requirePixivContent } from '../../utils/pixivErrors';
import {
  cleanPixivContent,
  cleanPixivDescription,
  extractPixivNovelId,
  toPixivMirrorCoverUrl,
} from '../../utils/pixivImporter';

const PIXIV_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export async function GET(request: Request) {
  const rawId = new URL(request.url).searchParams.get('id') || '';
  const novelId = extractPixivNovelId(rawId);
  if (!novelId) {
    return NextResponse.json({ error: '无效的 Pixiv 小说链接或 ID' }, { status: 400 });
  }

  try {
    const res = await fetch(`https://www.pixiv.net/ajax/novel/${encodeURIComponent(novelId)}`, {
      headers: {
        'User-Agent': PIXIV_USER_AGENT,
        Referer: 'https://www.pixiv.net/',
        'Accept-Language': 'ja,zh-CN;q=0.9,en;q=0.8',
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `无法从 Pixiv 获取小说 (HTTP ${res.status})` },
        { status: res.status === 404 ? 404 : 502 },
      );
    }

    const json = (await res.json()) as {
      error?: boolean;
      message?: string;
      body?: {
        title?: string;
        userName?: string;
        description?: string;
        content?: string;
        coverUrl?: string;
        isLoginOnly?: boolean;
      };
    };

    if (json.error !== false || !json.body) {
      return NextResponse.json(
        { error: json.message || '未找到该 Pixiv 小说' },
        { status: 404 },
      );
    }

    const body = json.body;
    const title = (body.title || `Pixiv #${novelId}`).trim();
    const author = (body.userName || '').trim();
    const description = cleanPixivDescription(body.description || '');
    const { content, rubyOverrides } = cleanPixivContent(body.content || '');
    try {
      requirePixivContent(content, body.isLoginOnly);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: body.isLoginOnly ? 403 : 502 });
    }

    let coverUrl = '';
    if (body.coverUrl && typeof body.coverUrl === 'string') {
      try {
        const imgRes = await fetch(body.coverUrl, {
          headers: {
            Referer: 'https://www.pixiv.net/',
            'User-Agent': PIXIV_USER_AGENT,
          },
        });
        if (imgRes.ok) {
          const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
          const buf = await imgRes.arrayBuffer();
          const b64 = Buffer.from(buf).toString('base64');
          coverUrl = `data:${contentType};base64,${b64}`;
        } else {
          coverUrl = toPixivMirrorCoverUrl(body.coverUrl);
        }
      } catch {
        coverUrl = toPixivMirrorCoverUrl(body.coverUrl);
      }
    }

    return NextResponse.json({
      id: novelId,
      title,
      author,
      description,
      content,
      rubyOverrides,
      coverUrl,
      sourceUrl: `https://www.pixiv.net/novel/show.php?id=${novelId}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求 Pixiv 失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
