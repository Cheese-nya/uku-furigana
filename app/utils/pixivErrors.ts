export const PIXIV_LOGIN_REQUIRED = '这篇 Pixiv 小说需要登录后才能阅读。请前往「设置 → Pixiv 账号」登录自己的账号后重试。';
export const PIXIV_EMPTY_CONTENT = 'Pixiv 返回的正文为空，未导入空白书籍。作品可能需要登录或受到访问限制，请在 Pixiv 页面确认正文是否可见。';

export function isPixivLoginRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /PIXIV_LOGIN_REQUIRED|需要登录后才能阅读|Pixiv.*(?:login required|log in to read)/i.test(message);
}

export function requirePixivContent(content: unknown, isLoginOnly?: boolean): asserts content is string {
  if (typeof content === 'string' && content.trim()) return;
  throw new Error(isLoginOnly ? PIXIV_LOGIN_REQUIRED : PIXIV_EMPTY_CONTENT);
}
