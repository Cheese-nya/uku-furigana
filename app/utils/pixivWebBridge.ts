import { uniqueId } from './uniqueId';
import { PIXIV_EMPTY_CONTENT, PIXIV_LOGIN_REQUIRED } from './pixivErrors';

const CHANNEL = 'uku-pixiv-helper-v1';
export const PIXIV_HELPER_DOWNLOAD = './uku-pixiv-helper.zip';

export function hasPixivWebHelper(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' &&
    typeof window.postMessage === 'function' && !!document.querySelector?.('meta[name="uku-pixiv-helper"][content="1"]');
}

/** Content-script messaging carries only status or novel fields, never account cookies. */
export function requestPixivWeb<T>(action: 'status' | 'login' | 'logout' | 'novel', novelId?: string): Promise<T> {
  if (!hasPixivWebHelper()) return Promise.reject(new Error('Pixiv 浏览器助手未连接，请在设置中安装后刷新页面。'));
  return new Promise((resolve, reject) => {
    const id = uniqueId();
    const origin = window.location.origin;
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); };
    const receive = (event: MessageEvent) => {
      const value = event.data;
      if (event.source !== window || event.origin !== origin || value?.channel !== CHANNEL || value.direction !== 'response' || value.id !== id) return;
      cleanup();
      if (value.result?.ok === true) resolve(value.result.data as T);
      else {
        const code = value.result?.error;
        reject(new Error(code === 'PIXIV_LOGIN_REQUIRED' ? PIXIV_LOGIN_REQUIRED : code === 'PIXIV_EMPTY_CONTENT' ? PIXIV_EMPTY_CONTENT :
          code === 'PIXIV_WORK_UNAVAILABLE' ? 'Pixiv 作品不存在或当前账号无权访问。' :
          '浏览器助手无法读取 Pixiv，请检查浏览器的网络、代理与助手权限后重试。'));
      }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Pixiv 浏览器助手请求超时，请刷新页面后重试。')); }, action === 'novel' ? 45_000 : 5_000);
    window.addEventListener('message', receive);
    window.postMessage({ channel: CHANNEL, direction: 'request', id, action, novelId }, origin);
  });
}

export interface PixivWebNovel {
  title: string;
  userName: string;
  description: string;
  content: string;
  coverUrl: string;
  isLoginOnly: boolean;
}
