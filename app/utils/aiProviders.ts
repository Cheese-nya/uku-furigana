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
    note: { zh: '部分开源模型免费（Qwen、GLM 等）；账号需先完成实名认证才能调用', en: 'Several open models are free (Qwen, GLM…); the account must pass real-name verification first' },
  },
  {
    id: 'dashscope', name: '通义', nameEn: 'Qwen (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1', direct: true,
    note: { zh: '新用户有免费额度，之后按量付费', en: 'Free quota for new users, then pay as you go' },
  },
  {
    id: 'openrouter', name: 'OpenRouter', nameEn: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free',
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

export type ModelPrice = 'free' | 'quota' | 'paid' | 'unknown';
export interface ModelInfo { id: string; price: ModelPrice }

// Free models SiliconFlow publishes (its /models list carries no prices); Pro/ variants are always paid.
const SILICONFLOW_FREE = /(?:^|\/)(?:Qwen2\.5-7B-Instruct|Qwen2\.5-Coder-7B-Instruct|Qwen3-8B|Qwen2-7B-Instruct|glm-4-9b-chat|GLM-4-9B-0414|GLM-Z1-9B-0414|DeepSeek-R1-0528-Qwen3-8B|DeepSeek-R1-Distill-Qwen-7B|internlm2_5-7b-chat|Hunyuan-MT-7B)$/i;
// Not chat models: embeddings, speech, images, rerankers, moderation.
const NOT_CHAT = /embed|whisper|tts|speech|audio|rerank|image|imagen|veo|lyria|guard|moderation|bge-|sdxl|flux|kolors|aqa/i;

/** Whether a model costs nothing: from the price list where the platform has one, else from what it publishes. */
export function modelPrice(providerId: string, id: string, pricing?: { prompt?: unknown; completion?: unknown }): ModelPrice {
  if (pricing && pricing.prompt !== undefined) {
    return Number(pricing.prompt) === 0 && Number(pricing.completion ?? 0) === 0 ? 'free' : 'paid';
  }
  if (id.endsWith(':free')) return 'free';
  switch (providerId) {
    case 'siliconflow': return id.startsWith('Pro/') ? 'paid' : SILICONFLOW_FREE.test(id) ? 'free' : 'unknown';
    case 'groq': return 'quota';
    case 'gemini': return /flash/i.test(id) ? 'quota' : 'paid';
    case 'deepseek': return 'paid';
    default: return 'unknown';
  }
}

const PRICE_ORDER: Record<ModelPrice, number> = { free: 0, quota: 1, unknown: 2, paid: 3 };

/** Chat models the platform offers (`GET /models`), free ones first. */
export async function listModels(llm: LlmSettings, fetchImpl: typeof fetch = fetch): Promise<ModelInfo[]> {
  const response = await fetchImpl(`${trimSlash(llm.baseUrl)}/models`, {
    headers: llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {},
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as { data?: { id?: unknown; pricing?: { prompt?: unknown; completion?: unknown }; architecture?: { output_modalities?: unknown } }[] };
  const provider = llm.provider ?? 'custom';
  const seen = new Set<string>();
  const models: ModelInfo[] = [];
  for (const model of body.data ?? []) {
    if (typeof model.id !== 'string') continue;
    // Gemini lists "models/gemini-…"; the chat endpoint takes the bare name.
    const id = model.id.replace(/^models\//, '');
    const outputs = model.architecture?.output_modalities;
    if (NOT_CHAT.test(id) || (Array.isArray(outputs) && !outputs.includes('text')) || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, price: modelPrice(provider, id, model.pricing) });
  }
  return models.sort((a, b) => PRICE_ORDER[a.price] - PRICE_ORDER[b.price] || a.id.localeCompare(b.id));
}

/** Translate one short sentence with these settings; resolves to the translation, rejects with the reason. */
export async function testConnection(llm: LlmSettings, target: TranslationTarget, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  const [translation] = await translateLlm(['こんにちは。'], target, llm, fetchImpl, signal);
  return translation;
}

export type ProbeResult = { state: 'ok' } | { state: 'bad'; reason: 'key' | 'limit' | 'missing' | 'account' | 'timeout' | 'other'; detail: string };

function probeReason(message: string): ProbeResult {
  if (/HTTP 40[13]/.test(message)) return { state: 'bad', reason: 'key', detail: message };
  if (/HTTP 429/.test(message)) return { state: 'bad', reason: 'limit', detail: message };
  if (/HTTP 404/.test(message)) return { state: 'bad', reason: 'missing', detail: message };
  // 402 is the account (not verified, no balance) — even for free models, so it is not "paid".
  if (/HTTP 402/.test(message)) return { state: 'bad', reason: 'account', detail: message };
  if (/abort|中止|timeout/i.test(message)) return { state: 'bad', reason: 'timeout', detail: message };
  return { state: 'bad', reason: 'other', detail: message };
}

/**
 * Try each model with one tiny translation, two at a time, 20 s each, reporting as results come in.
 * Only free models are probed by the app, so the check never costs the user anything.
 */
export async function probeModels(
  llm: LlmSettings, ids: string[], target: TranslationTarget,
  onResult: (id: string, result: ProbeResult) => void, signal: AbortSignal, fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (!signal.aborted && next < ids.length) {
      const id = ids[next++];
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 20000);
      const stop = () => timeout.abort();
      signal.addEventListener('abort', stop);
      try {
        await testConnection({ ...llm, model: id }, target, fetchImpl, timeout.signal);
        if (!signal.aborted) onResult(id, { state: 'ok' });
      } catch (error) {
        if (!signal.aborted) onResult(id, probeReason(error instanceof Error ? `${error.name} ${error.message}` : String(error)));
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
      }
    }
  };
  await Promise.all([lane(), lane()]);
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
