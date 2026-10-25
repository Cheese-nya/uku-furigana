import { translateLlm, type LlmSettings, type TranslationTarget } from './translation';

/** OpenAI-compatible translation platforms offered as presets (mockup v3.2). */
export interface AiProvider {
  id: string;
  name: string;
  nameEn: string;
  baseUrl: string;
  /** Suggested model; the user can pick another from the platform's own /models list. */
  model: string;
  /** Where the user creates a key. */
  keyUrl: string;
  /** Reachable from mainland China without a proxy. */
  direct: boolean;
  note: { zh: string; en: string };
  /** One-click sign-in through the platform's OAuth (OpenRouter only). */
  login?: boolean;
}

// Only platforms whose API answers browser requests (CORS) are listed: the app calls them directly from
// the page. Checked 2026-10-25; Zhipu does not, so it is left out.
export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'siliconflow', name: '硅基流动', nameEn: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-8B',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak', direct: true,
    note: { zh: '部分开源模型免费（Qwen、GLM 等）', en: 'Several open models are free (Qwen, GLM…)' },
  },
  {
    id: 'dashscope', name: '通义', nameEn: 'Qwen (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1', direct: true,
    note: { zh: '新用户有免费额度，之后按量付费', en: 'Free quota for new users, then pay as you go' },
  },
  {
    id: 'openrouter', name: 'OpenRouter', nameEn: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-4-31b-it:free',
    keyUrl: 'https://openrouter.ai/settings/keys', direct: false, login: true,
    note: { zh: '名称带 :free 的模型免费，可用账号一键登录', en: 'Models ending in :free cost nothing; sign in with one click' },
  },
  {
    id: 'gemini', name: 'Gemini', nameEn: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey', direct: false,
    note: { zh: 'Flash 系列有免费额度', en: 'Free quota on the Flash models' },
  },
  {
    id: 'groq', name: 'Groq', nameEn: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys', direct: false,
    note: { zh: '免费额度，速度快', en: 'Free quota, very fast' },
  },
  {
    id: 'deepseek', name: 'DeepSeek', nameEn: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys', direct: true,
    note: { zh: '付费，价格低，翻译质量好', en: 'Paid, inexpensive, good translations' },
  },
  {
    id: 'custom', name: '自定义', nameEn: 'Custom', baseUrl: '', model: '', keyUrl: '', direct: true,
    note: { zh: '任何兼容 OpenAI 格式的接口', en: 'Any OpenAI-compatible endpoint' },
  },
];

export function providerById(id: string): AiProvider {
  return AI_PROVIDERS.find(provider => provider.id === id) ?? AI_PROVIDERS[AI_PROVIDERS.length - 1];
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** Model ids the platform offers (`GET /models`), free ones first. */
export async function listModels(llm: LlmSettings, fetchImpl: typeof fetch = fetch): Promise<{ id: string; free: boolean }[]> {
  const response = await fetchImpl(`${trimSlash(llm.baseUrl)}/models`, {
    headers: llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {},
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as { data?: { id?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }[] };
  const models = (body.data ?? [])
    .filter(model => typeof model.id === 'string')
    .map(model => {
      const id = model.id as string;
      const zeroPrice = model.pricing && Number(model.pricing.prompt) === 0 && Number(model.pricing.completion) === 0;
      return { id, free: id.endsWith(':free') || Boolean(zeroPrice) };
    });
  return models.sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id));
}

/** Translate one short sentence with these settings; resolves to the translation, rejects with the reason. */
export async function testConnection(llm: LlmSettings, target: TranslationTarget, fetchImpl: typeof fetch = fetch): Promise<string> {
  const [translation] = await translateLlm(['こんにちは。'], target, llm, fetchImpl);
  return translation;
}

// ---- OpenRouter one-click sign-in (OAuth PKCE): the page goes to openrouter.ai and comes back with ?code= ----

const VERIFIER_KEY = 'uku-openrouter-verifier';

function base64Url(bytes: Uint8Array): string {
  let text = '';
  bytes.forEach(byte => { text += String.fromCharCode(byte); });
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The page address to come back to, without a code from an earlier sign-in. */
function callbackUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.hash = '';
  return url.toString();
}

export async function startOpenRouterLogin(): Promise<void> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const auth = new URL('https://openrouter.ai/auth');
  auth.searchParams.set('callback_url', callbackUrl());
  auth.searchParams.set('code_challenge', challenge);
  auth.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(auth.toString());
}

/**
 * Back from openrouter.ai: exchange ?code= for the user's key. Returns the key, or null when this page load
 * is not a sign-in return. The code is removed from the address bar either way.
 */
export async function completeOpenRouterLogin(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!code || !verifier) return null;
  url.searchParams.delete('code');
  window.history.replaceState(null, '', url.toString());
  sessionStorage.removeItem(VERIFIER_KEY);
  const response = await fetchImpl('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!response.ok) {
    const detail = await response.json().then((body: { error?: { message?: unknown } }) => body.error?.message, () => undefined);
    throw new Error(typeof detail === 'string' && detail ? detail : `HTTP ${response.status}`);
  }
  const body = await response.json() as { key?: unknown };
  if (typeof body.key !== 'string' || !body.key) throw new Error('OpenRouter 没有返回 Key');
  return body.key;
}
