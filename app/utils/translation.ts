import { logEvent } from './appLog';
import type { TranslationCache } from './translationStore';

export type TranslationEngine = 'microsoft' | 'llm';
export type TranslationTarget = 'zh-Hans' | 'zh-Hant' | 'en';

export interface LlmSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Preset the fields came from (aiProviders.ts), 'custom' for a hand-entered endpoint. */
  provider?: string;
}

/** A custom endpoint can be a local/open server without authentication; hosted presets require a key. */
export function llmNeedsApiKey(llm: Partial<LlmSettings>): boolean {
  return (llm.provider ?? 'custom') !== 'custom';
}

export interface TranslationSettings {
  engine: TranslationEngine;
  target: TranslationTarget;
  llm: LlmSettings;
  /** Key, model and endpoint last used with each platform, so switching platforms keeps them. */
  saved?: Record<string, LlmSettings>;
  /** Show Microsoft translations as an instant draft while waiting for the LLM, then replace them. */
  quickDraft?: boolean;
  /** Ask the configured LLM to disambiguate polyphone readings after annotation completes. */
  aiReadingReview?: boolean;
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  engine: 'microsoft',
  target: 'zh-Hans',
  llm: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '', provider: 'deepseek' },
  saved: {},
  quickDraft: true,
  aiReadingReview: false,
};

const SETTINGS_KEY = 'uku-translation-settings-v1';
const ENGINES: TranslationEngine[] = ['microsoft', 'llm'];
const TARGETS: TranslationTarget[] = ['zh-Hans', 'zh-Hant', 'en'];

export class TranslationError extends Error {
  readonly retryable: boolean;
  /** How long the platform asked us to wait (Retry-After), when it said. */
  retryAfterMs?: number;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'TranslationError';
    this.retryable = retryable;
  }
}

function text(value: unknown, fallback: string, allowEmpty = false): string {
  return typeof value === 'string' && (allowEmpty || value.trim()) ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Validates a stored settings object field by field, so one bad field never discards the rest. */
export function validateTranslationSettings(value: unknown): TranslationSettings {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Partial<TranslationSettings>;
  const llm = (typeof source.llm === 'object' && source.llm !== null ? source.llm : {}) as Partial<LlmSettings>;
  const defaults = DEFAULT_TRANSLATION_SETTINGS;
  const validLlm = (value: Partial<LlmSettings>, fallback: LlmSettings): LlmSettings => ({
    baseUrl: text(value.baseUrl, fallback.baseUrl),
    model: text(value.model, fallback.model),
    apiKey: text(value.apiKey, '', true),
    provider: text(value.provider, fallback.provider ?? 'custom'),
  });
  const saved: Record<string, LlmSettings> = {};
  if (typeof source.saved === 'object' && source.saved !== null) {
    for (const [id, value] of Object.entries(source.saved)) {
      if (typeof value === 'object' && value !== null) saved[id] = validLlm(value, { baseUrl: '', model: '', apiKey: '', provider: id });
    }
  }
  return {
    engine: oneOf(source.engine, ENGINES, defaults.engine),
    target: oneOf(source.target, TARGETS, defaults.target),
    // Settings saved before presets existed have no provider: they were a hand-entered endpoint.
    llm: validLlm(llm, { ...defaults.llm, provider: typeof source.llm === 'object' && source.llm !== null ? 'custom' : defaults.llm.provider }),
    saved,
    quickDraft: typeof source.quickDraft === 'boolean' ? source.quickDraft : defaults.quickDraft,
    aiReadingReview: typeof source.aiReadingReview === 'boolean' ? source.aiReadingReview : defaults.aiReadingReview,
  };
}

export function loadTranslationSettings(): TranslationSettings {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(SETTINGS_KEY);
    return raw ? validateTranslationSettings(JSON.parse(raw)) : validateTranslationSettings(undefined);
  } catch {
    return validateTranslationSettings(undefined);
  }
}

export function saveTranslationSettings(settings: TranslationSettings): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(SETTINGS_KEY, JSON.stringify(validateTranslationSettings(settings)));
  } catch {
    // A full or unavailable localStorage must not break translation.
  }
}

// Letters and digits keep a sentence worth translating; punctuation, whitespace and symbols
// (……, 「」, ！？) are returned as their own "translation" so they cost no request. Kana ranges
// stop before ・ and ー, which are punctuation and a length mark rather than words.
const MEANINGFUL = /[0-9A-Za-z\u3041-\u3096\u30A1-\u30FA\u3400-\u4DBF\u4E00-\u9FFF\uFF10-\uFF5A]/;

export function needsTranslation(value: string): boolean {
  return MEANINGFUL.test(value);
}

function abortError(): Error {
  // `DOMException` carries the name the callers check for; where it is missing (older
  // environments) a plain Error with the same name is enough.
  if (typeof DOMException === 'function') return new DOMException('翻译已中止', 'AbortError');
  const error = new Error('翻译已中止');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { cleanup(); reject(abortError()); };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort);
  });
}

const MICROSOFT_TIMEOUT_MS = 20_000;
const LLM_TIMEOUT_MS = 60_000;

interface TimeoutControl {
  signal: AbortSignal;
  didTimeout: () => boolean;
  reset: () => void;
  cleanup: () => void;
}

/** Links an optional caller AbortSignal with an idle/request timeout (Chrome >= 92 compatible). */
function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): TimeoutControl {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = () => {
    if (timer !== null) clearTimeout(timer);
    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }
  };
  const onAbort = () => {
    if (timer !== null) clearTimeout(timer);
    controller.abort();
  };
  if (signal?.aborted) controller.abort();
  else {
    signal?.addEventListener('abort', onAbort, { once: true });
    arm();
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut && !signal?.aborted,
    reset: () => { if (!signal?.aborted && !timedOut) arm(); },
    cleanup: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function wrapTransportError(error: unknown, signal: AbortSignal | undefined, timeout: TimeoutControl): never {
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError' && !timeout.didTimeout())) {
    throw error instanceof Error && error.name === 'AbortError' ? error : abortError();
  }
  if (timeout.didTimeout()) throw new TranslationError('请求超时', true);
  if (error instanceof TranslationError) throw error;
  const message = error instanceof Error && error.message ? error.message : '网络请求失败';
  throw new TranslationError(message, true);
}

function httpError(status: number, what: string): TranslationError {
  const retryable = status === 408 || status === 429 || status >= 500;
  return new TranslationError(`${what}失败（HTTP ${status}）`, retryable);
}

function parseRetryAfter(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return Math.min(30, numeric) * 1000;
  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp)) {
    const ms = timestamp - Date.now();
    if (ms > 0) return Math.min(30_000, ms);
  }
  return undefined;
}

const MICROSOFT_ENDPOINT = 'https://edge.microsoft.com/translate/translatetext';

/** Microsoft Edge's free endpoint: a JSON array in, `[{ translations: [{ text }] }]` out, same order. */
export async function translateMicrosoft(
  texts: string[],
  target: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  timeoutMs = MICROSOFT_TIMEOUT_MS,
): Promise<string[]> {
  if (!texts.length) return [];
  throwIfAborted(signal);
  const url = `${MICROSOFT_ENDPOINT}?from=ja&to=${encodeURIComponent(target)}&isEnterpriseClient=false`;
  const timeout = withTimeoutSignal(signal, timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(texts),
      signal: timeout.signal,
    });
  } catch (error) {
    timeout.cleanup();
    wrapTransportError(error, signal, timeout);
  }
  try {
    if (!response.ok) {
      const error = httpError(response.status, '微软翻译');
      const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
      if (retryAfterMs !== undefined) error.retryAfterMs = retryAfterMs;
      throw error;
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal?.aborted || timeout.didTimeout()) wrapTransportError(error, signal, timeout);
      throw new TranslationError('微软翻译返回了无法解析的数据', true);
    }
    if (!Array.isArray(payload) || payload.length !== texts.length) {
      throw new TranslationError('微软翻译返回的条数不一致', false);
    }
    return payload.map((item: unknown) => {
      const translations = (item as { translations?: { text?: unknown }[] } | null)?.translations;
      const value = Array.isArray(translations) ? translations[0]?.text : undefined;
      if (typeof value !== 'string') throw new TranslationError('微软翻译返回的数据不完整', false);
      return value;
    });
  } finally {
    timeout.cleanup();
  }
}

export interface TranslationGlossaryEntry {
  surface: string;
  reading?: string;
}

const TARGET_NAMES: Record<string, string> = { 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese', en: 'English' };

function systemPrompt(target: string): string {
  return [
    `You are a literary Japanese → ${TARGET_NAMES[target] || target} translator.`,
    `Translate each item of the input JSON array into ${TARGET_NAMES[target] || target}.`,
    'Keep every item\'s meaning and its order, and stay natural and faithful to the original tone.',
    'Never add explanations, notes or extra items.',
    'Output ONLY a JSON array of strings with exactly the same length and order as the input.',
  ].join(' ');
}

function matchGlossary(texts: string[], context: string[], entries: TranslationGlossaryEntry[]): TranslationGlossaryEntry[] {
  if (!entries.length) return [];
  const haystack = `${context.join('\n')}\n${texts.join('\n')}`;
  const seen = new Set<string>();
  const matched: TranslationGlossaryEntry[] = [];
  const sorted = [...entries].sort((a, b) => b.surface.length - a.surface.length);
  for (const entry of sorted) {
    const surface = entry.surface.trim();
    if (!surface || seen.has(surface) || !haystack.includes(surface)) continue;
    seen.add(surface);
    matched.push({ surface, reading: entry.reading?.trim() });
    if (matched.length >= 20) break;
  }
  return matched;
}

function userPrompt(texts: string[], context: string[], glossary: TranslationGlossaryEntry[] = []): string {
  const parts: string[] = [];
  const terms = matchGlossary(texts, context, glossary);
  if (terms.length) {
    const rows = terms.map(term => (term.reading ? `- ${term.surface} (${term.reading})` : `- ${term.surface}`));
    parts.push(`Glossary (keep proper-noun names/readings consistent, do not translate literally):\n${rows.join('\n')}`);
  }
  const lines = context.filter(line => line.trim()).map(line => line.trim());
  if (lines.length) parts.push(`Context (previous lines, do not translate):\n${lines.join('\n')}`);
  parts.push(`Sentences to translate (JSON array):\n${JSON.stringify(texts)}`);
  return parts.join('\n\n');
}

/** Iterates balanced JSON arrays `[...]` in the text, skipping string contents. */
function findJsonArrays(source: string): string[] {
  const arrays: string[] = [];
  let pos = 0;
  while (pos < source.length) {
    const start = source.indexOf('[', pos);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < source.length; index++) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '[') depth += 1;
      else if (char === ']') {
        depth -= 1;
        if (depth === 0) { end = index; break; }
      }
    }
    if (end >= 0) {
      arrays.push(source.slice(start, end + 1));
      pos = end + 1;
    } else {
      pos = start + 1;
    }
  }
  return arrays;
}

const stringList = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.length && value.every(item => typeof item === 'string') ? value as string[] : undefined;

/** Reasoning models think aloud first (<think>…</think>, sometimes cut off); fences wrap the answer. */
export function cleanLlmReply(reply: string): string {
  return reply
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*<\/think>/i, '')
    .replace(/<think>[\s\S]*$/i, '')
    .replace(/```[a-zA-Z]*\s*/g, '')
    .trim();
}

// A truncated or otherwise malformed model answer can echo the request header. It is
// never a translation, even when a bare-text fallback would otherwise accept the whole reply.
const LLM_INSTRUCTION = /(?:需要翻译的句子|Sentences to translate)\s*[（(]?\s*JSON(?:数组|\s*array)/i;

/**
 * Extracts every fully-closed string element of the top-level JSON array from a growing streamed reply,
 * skipping `<think>…</think>` blocks, markdown code fences, and non-string preamble brackets like `[2]`.
 */
export function parseIncrementalArray(reply: string): string[] {
  const text = cleanLlmReply(reply);
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('[', pos);
    if (start < 0) return [];
    const items: string[] = [];
    let depth = 0;
    let inString = false;
    let escaped = false;
    let token = '';
    let closedAt = -1;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          if (depth === 1) {
            if (char === 'n') token += '\n';
            else if (char === 'r') token += '\r';
            else if (char === 't') token += '\t';
            else if (char === 'b') token += '\b';
            else if (char === 'f') token += '\f';
            else if (char === 'u' && /^[0-9a-fA-F]{4}/.test(text.slice(index + 1, index + 5))) {
              token += String.fromCharCode(parseInt(text.slice(index + 1, index + 5), 16));
              index += 4;
            } else {
              token += char;
            }
          }
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
          if (depth === 1) items.push(token);
        } else if (depth === 1) {
          token += char;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        if (depth === 1) token = '';
      } else if (char === '[' || char === '{') {
        depth += 1;
      } else if (char === ']' || char === '}') {
        depth -= 1;
        if (depth <= 0) { closedAt = index; break; }
      }
    }
    if (items.length > 0 || closedAt < 0) return items;
    // Preamble brackets like `[2]` closed with zero strings: continue to the real array.
    pos = closedAt + 1;
  }
  return [];
}

/** Platform-specific parameters to turn off or minimize chain-of-thought reasoning for translation speed. */
export function reasoningParams(llm: LlmSettings): Record<string, unknown> {
  const provider = (llm.provider ?? '').toLowerCase();
  const model = llm.model ?? '';
  if (provider === 'groq' && /gpt-oss/i.test(model)) return { reasoning_effort: 'low' };
  if ((provider === 'siliconflow' || provider === 'dashscope') && /qwen3/i.test(model)) return { enable_thinking: false };
  if (provider === 'gemini' && /2\.5/.test(model)) return { reasoning_effort: 'none' };
  if (provider === 'openrouter') return { reasoning: { effort: 'low' } };
  return {};
}

function chatHeaders(llm: LlmSettings): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (llm.apiKey.trim()) headers.Authorization = `Bearer ${llm.apiKey.trim()}`;
  return headers;
}

function cleanPlainReply(reply: string, source: string): string {
  let out = cleanLlmReply(reply).trim();
  // Always strip ASCII JSON/code quotes around a plain reply, but preserve CJK dialogue quotes when the source had them.
  out = out.replace(/^["']|["']$/g, '').trim();
  const hasOpeningDialogueQuote = /^[「『“]/.test(source.trim());
  if (!hasOpeningDialogueQuote) out = out.replace(/^[「“]|[」”]$/g, '').trim();
  return out;
}

/**
 * Read the model's translations, forgiving what models really send: an object around the array, single
 * quotes, trailing commas, unescaped double quotes inside a translation, or a numbered list.
 */
export function parseLlmTranslations(reply: string, expected: number): string[] {
  const text = cleanLlmReply(reply);
  const attempts: (() => string[] | undefined)[] = [
    () => {
      for (const raw of findJsonArrays(text)) {
        try {
          const parsed = stringList(JSON.parse(raw));
          if (parsed) return parsed;
        } catch {
          // Try next balanced array candidate (e.g. skip preamble `[2]`).
        }
      }
      return undefined;
    },
    () => {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return undefined;
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
      const nested = Object.values(parsed).map(stringList).find(Boolean);
      if (nested) return nested;
      const entries = Object.entries(parsed);
      if (!entries.length) return undefined;
      if (entries.every(([k]) => /^\d+$/.test(k))) {
        entries.sort(([a], [b]) => Number(a) - Number(b));
      }
      return stringList(entries.map(([, v]) => v));
    },
    () => {
      for (const raw of findJsonArrays(text)) {
        try {
          const parsed = stringList(JSON.parse(raw.replace(/,\s*\]$/, ']')));
          if (parsed) return parsed;
        } catch {
          // Try next candidate.
        }
      }
      return undefined;
    },
    // ["他说："你好"。", "…"]: split between items instead of trusting the quotes inside them.
    () => {
      const open = text.search(/\[\s*["']/);
      const close = Math.max(text.lastIndexOf('"]'), text.lastIndexOf("']"), text.search(/["']\s*,?\s*\]\s*$/));
      if (open < 0 || close <= open) return undefined;
      const inner = text.slice(text.indexOf(text.slice(open).match(/["']/)?.[0] ?? '"', open) + 1, close);
      return inner.split(/["']\s*,\s*["']/).map(item => item.replace(/\\n/g, '\n').replace(/\\(["'\\])/g, '$1').replace(/^["']+|["']+$/g, ''));
    },
    // One small array per line (["甲"]\n["乙""]), as translation models such as Hunyuan-MT answer.
    () => {
      const items = text.split('\n').map(line => line.match(/^\s*\[\s*["'](.*?)["']*\s*\]\s*,?\s*$/)?.[1]).filter((line): line is string => line !== undefined);
      return items.length ? items.map(item => item.replace(/\\(["'\\])/g, '$1')) : undefined;
    },
    // A model may repeat the prompt and truncate the final JSON string. For a single
    // sentence, the text inside that last unterminated string is still unambiguous.
    () => {
      if (expected !== 1) return undefined;
      const item = text.match(/\[\s*["']([\s\S]*?)["']{0,2}\s*$/)?.[1];
      return item?.trim() ? [item.replace(/\\n/g, '\n').replace(/\\(["'\\])/g, '$1').trim()] : undefined;
    },
    () => {
      const items = text.split('\n').map(line => line.match(/^\s*(?:\d+|[-*•])\s*[.)、:：]?\s+(.+)$/)?.[1]).filter((line): line is string => Boolean(line));
      return items.length ? items.map(item => item.replace(/^["'「“]|["'」”],?$/g, '')) : undefined;
    },
  ];
  let mismatch: string[] | undefined;
  for (const attempt of attempts) {
    let found: string[] | undefined;
    try { found = attempt(); } catch { found = undefined; }
    if (found?.length === expected) return found;
    if (found) mismatch ??= found;
  }
  if (mismatch) throw new TranslationError('译文条数不一致', false);
  throw new TranslationError('模型返回的 JSON 无法解析', false);
}

/** Keep the actual answer out of a prompt-echoing reply; reject a bare prompt fragment. */
function usableLlmReply(reply: string, source = ''): string | undefined {
  const bare = cleanLlmReply(reply).trim();
  if (!bare) return undefined;
  if (LLM_INSTRUCTION.test(bare)) {
    try {
      const extracted = parseLlmTranslations(bare, 1).find(item => item.trim());
      return extracted ? cleanPlainReply(extracted, source) || undefined : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const parsed = parseLlmTranslations(bare, 1)[0].trim();
    return parsed ? (cleanPlainReply(parsed, source) || undefined) : undefined;
  } catch {
    return cleanPlainReply(bare, source) || undefined;
  }
}

/** Do not retain old prompt-echoing cache rows; recover the truncated array when possible. */
export function usableCachedTranslation(engine: TranslationEngine, value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (engine !== 'llm') return value;
  // Recover an already displayed truncated array; a bare prompt echo must be re-fetched.
  if (LLM_INSTRUCTION.test(trimmed)) {
    try { return parseLlmTranslations(trimmed, 1)[0]?.trim() || undefined; }
    catch { return undefined; }
  }
  return usableLlmReply(value);
}

const FORMAT_ERRORS = new Set(['模型返回的 JSON 无法解析', '译文条数不一致', '模型没有返回译文']);
const REASONING_PARAM_NAMES = ['reasoning_effort', 'enable_thinking', 'reasoning'];

function extractContentPiece(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : (part as { text?: unknown } | null)?.text))
      .filter((part): part is string => typeof part === 'string')
      .join('');
  }
  return '';
}

function extractErrorDetail(body: unknown): string | undefined {
  if (typeof body === 'string') return body;
  if (Array.isArray(body)) return body.length ? extractErrorDetail(body[0]) : undefined;
  if (!body || typeof body !== 'object') return undefined;
  const obj = body as { error?: unknown; message?: unknown; msg?: unknown; detail?: unknown };
  if (typeof obj.error === 'string') return obj.error;
  if (obj.error && typeof obj.error === 'object') {
    const nested = extractErrorDetail(obj.error);
    if (nested) return nested;
  }
  if (typeof obj.message === 'string') return obj.message;
  if (typeof obj.msg === 'string') return obj.msg;
  if (typeof obj.detail === 'string') return obj.detail;
  return undefined;
}

function sseStreamError(parsed: unknown): TranslationError | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const err = (parsed as { error?: unknown }).error;
  if (!err) return null;
  const detail = extractErrorDetail({ error: err })?.trim();
  const code = typeof err === 'object' && err !== null ? Number((err as { code?: unknown; status?: unknown }).code ?? (err as { status?: unknown }).status) : NaN;
  const retryable = code === 408 || code === 429 || (Number.isFinite(code) && code >= 500)
    || Boolean(detail && /rate.?limit|overloaded|timeout|temporarily/i.test(detail));
  return new TranslationError(detail ? `模型翻译失败：${detail.slice(0, 160)}` : '模型翻译失败', retryable);
}

export async function chat(
  url: string,
  llm: LlmSettings,
  messages: { role: string; content: string }[],
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  onText?: (accumulated: string) => void,
  includeReasoning = true,
  timeoutMs = LLM_TIMEOUT_MS,
): Promise<string> {
  throwIfAborted(signal);
  const extra = includeReasoning ? reasoningParams(llm) : {};
  const timeout = withTimeoutSignal(signal, timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: chatHeaders(llm),
      body: JSON.stringify({ model: llm.model, temperature: 0.3, stream: true, ...extra, messages }),
      signal: timeout.signal,
    });
  } catch (error) {
    timeout.cleanup();
    wrapTransportError(error, signal, timeout);
  }
  try {
    if (!response.ok) {
      // Platforms explain refusals in the body (balance, real-name verification, unknown model…): show that.
      const rawClone = typeof response.clone === 'function' ? response.clone() : undefined;
      const detail = await response.json().then(
        extractErrorDetail,
        async () => {
          const textBody = await rawClone?.text?.().catch(() => undefined);
          return textBody && !/^\s*</.test(textBody) ? textBody : undefined;
        },
      );
      if (
        response.status === 400 &&
        includeReasoning &&
        Object.keys(extra).length > 0 &&
        typeof detail === 'string' &&
        (REASONING_PARAM_NAMES.some(name => detail.includes(name)) || /extra_inputs|unknown\s+(?:parameter|field)|unrecognized\s+request\s+argument/i.test(detail))
      ) {
        logEvent('info', 'translate', `${llm.model}: 400 on reasoning params (${Object.keys(extra).join(', ')}), retrying without them`);
        timeout.cleanup();
        return chat(url, llm, messages, fetchImpl, signal, onText, false, timeoutMs);
      }
      const error = httpError(response.status, '模型翻译');
      if (typeof detail === 'string' && detail.trim()) error.message += `：${detail.trim().slice(0, 160)}`;
      const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
      if (retryAfterMs !== undefined) error.retryAfterMs = retryAfterMs;
      throw error;
    }
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (/text\/event-stream/i.test(contentType) && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      const consumeLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        const streamErr = sseStreamError(parsed);
        if (streamErr) throw streamErr;
        const choice = (parsed as { choices?: { delta?: { content?: unknown }; message?: { content?: unknown } }[] } | null)?.choices?.[0];
        const piece = extractContentPiece(choice?.delta?.content ?? choice?.message?.content);
        if (piece) {
          accumulated += piece;
          onText?.(accumulated);
        }
      };
      try {
        while (true) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (error) {
            wrapTransportError(error, signal, timeout);
          }
          if (chunk.done) break;
          timeout.reset();
          buffer += decoder.decode(chunk.value, { stream: true });
          let newline = buffer.indexOf('\n');
          while (newline >= 0) {
            consumeLine(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf('\n');
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
          for (const line of buffer.split('\n')) consumeLine(line);
        }
      } finally {
        try { void reader.cancel().catch(() => undefined); } catch { /* ignore */ }
      }
      if (!cleanLlmReply(accumulated)) throw new TranslationError('模型没有返回译文', false);
      return accumulated;
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal?.aborted || timeout.didTimeout()) wrapTransportError(error, signal, timeout);
      throw new TranslationError('模型返回了无法解析的数据', true);
    }
    const content = (payload as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
    // Some endpoints send content as parts: [{ type: 'text', text }].
    const reply = Array.isArray(content)
      ? content.map(part => (typeof part === 'string' ? part : (part as { text?: unknown })?.text)).filter(part => typeof part === 'string').join('')
      : content;
    if (typeof reply !== 'string' || !cleanLlmReply(reply)) throw new TranslationError('模型没有返回译文', false);
    return reply;
  } finally {
    timeout.cleanup();
  }
}

/**
 * OpenAI-compatible chat endpoint, asked for a JSON array so one request covers a whole batch. When a
 * model cannot keep to that (wrong count, broken JSON, a reply cut off), the batch is split in half and
 * tried again, down to single sentences asked for plain text — so small or reasoning models still work.
 */
export async function translateLlm(
  texts: string[],
  target: string,
  llm: LlmSettings,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  context: string[] = [],
  onItem?: (index: number, text: string) => void,
  glossary: TranslationGlossaryEntry[] = [],
  timeoutMs = LLM_TIMEOUT_MS,
): Promise<string[]> {
  if (!texts.length) return [];
  if (!llm.apiKey.trim() && llmNeedsApiKey(llm)) throw new TranslationError('请先在设置里填写 API Key', false);
  const url = `${llm.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
  const language = TARGET_NAMES[target] || target;
  let emitted = 0;
  const handleText = onItem
    ? (accumulated: string) => {
        const items = parseIncrementalArray(accumulated);
        while (emitted < items.length && emitted < texts.length) {
          const value = items[emitted];
          if (value.trim()) onItem(emitted, value);
          emitted += 1;
        }
      }
    : undefined;
  if (texts.length === 1) {
    try {
      const reply = await chat(url, llm, [
        { role: 'system', content: systemPrompt(target) },
        { role: 'user', content: userPrompt(texts, context, glossary) },
      ], fetchImpl, signal, handleText, true, timeoutMs);
      try {
        const [one] = parseLlmTranslations(reply, 1);
        if (!one.trim()) throw new TranslationError('模型没有返回译文', false);
        return [one];
      } catch (error) {
        // A one-sentence answer without the array around it is still the answer.
        const bare = cleanLlmReply(reply);
        if (bare && !/^[[{]/.test(bare) && !bare.includes('\n\n')) {
          const plain = usableLlmReply(reply, texts[0]);
          if (plain) return [plain];
        }
        throw error;
      }
    } catch (error) {
      if (!(error instanceof TranslationError) || !FORMAT_ERRORS.has(error.message)) throw error;
      logEvent('info', 'translate', `${llm.model}: single sentence asked as plain text (${error.message.includes('JSON') ? 'unreadable reply' : 'empty reply'})`);
      const reply = await chat(url, llm, [
        { role: 'system', content: `Translate the Japanese text into ${language}. Reply with the translation only, no quotes, notes or explanations.` },
        { role: 'user', content: texts[0] },
      ], fetchImpl, signal, undefined, true, timeoutMs);
      const plain = usableLlmReply(reply, texts[0]);
      if (!plain) throw new TranslationError('模型没有返回译文', true);
      return [plain];
    }
  }
  try {
    const reply = await chat(url, llm, [
      { role: 'system', content: systemPrompt(target) },
      { role: 'user', content: userPrompt(texts, context, glossary) },
    ], fetchImpl, signal, handleText, true, timeoutMs);
    const list = parseLlmTranslations(reply, texts.length);
    // Some models answer with the right number of items but leave some empty: ask those one by one.
    const empty = list.map((item, index) => (item.trim() ? -1 : index)).filter(index => index >= 0);
    if (empty.length) {
      logEvent('info', 'translate', `${llm.model}: ${empty.length}/${texts.length} empty items, asked again one by one`);
      for (const index of empty) {
        const itemContext = [...context, ...texts.slice(0, index)].filter(needsTranslation).slice(-CONTEXT_LINES);
        [list[index]] = await translateLlm([texts[index]], target, llm, fetchImpl, signal, itemContext, undefined, glossary, timeoutMs);
      }
    }
    return list;
  } catch (error) {
    if (!(error instanceof TranslationError) || !FORMAT_ERRORS.has(error.message)) throw error;
    logEvent('info', 'translate', `${llm.model}: batch of ${texts.length} unreadable (${error.message === '译文条数不一致' ? 'wrong count' : 'not JSON'}), split in half`);
    const half = Math.ceil(texts.length / 2);
    const first = await translateLlm(texts.slice(0, half), target, llm, fetchImpl, signal, context, onItem, glossary, timeoutMs);
    const second = await translateLlm(
      texts.slice(half),
      target,
      llm,
      fetchImpl,
      signal,
      [...context, ...texts.slice(0, half)].filter(needsTranslation).slice(-CONTEXT_LINES),
      onItem ? (index, value) => onItem(half + index, value) : undefined,
      glossary,
      timeoutMs,
    );
    return [...first, ...second];
  }
}

interface EngineLimits {
  batchSize: number;
  maxChars: number;
  /** The first batch of a request is smaller: a model's reply time grows with its length, so the first lines show sooner. */
  firstBatch: number;
}

const ENGINE_LIMITS: Record<TranslationEngine, EngineLimits> = {
  microsoft: { batchSize: 50, maxChars: 8000, firstBatch: 10 },
  // Small free models truncate long replies; a failed batch is split anyway, but smaller ones rarely fail.
  llm: { batchSize: 12, maxChars: 2000, firstBatch: 4 },
};

/**
 * Requests in flight at once, per platform, across everything the reader asks for. Kept under each free
 * tier's request-per-minute limit (Gemini and OpenRouter free allow about 10–20); a 429 still waits and retries.
 */
const LLM_CONCURRENCY: Record<string, number> = { siliconflow: 4, dashscope: 4, deepseek: 4, groq: 3, gemini: 2, openrouter: 2 };
const MICROSOFT_CONCURRENCY = 3;
const DEFAULT_LLM_CONCURRENCY = 2;

export function translationConcurrency(settings: TranslationSettings): number {
  if (settings.engine !== 'llm') return MICROSOFT_CONCURRENCY;
  return LLM_CONCURRENCY[settings.llm.provider ?? 'custom'] ?? DEFAULT_LLM_CONCURRENCY;
}

// Context is sent only to make the model's sentence boundaries and pronouns coherent; the
// neighbouring lines are never part of the returned array.
const CONTEXT_LINES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];
const PRETRANSLATE_CHUNK = 200;

export interface TranslatorOptions {
  store: TranslationCache;
  settings: () => TranslationSettings;
  fetchImpl?: typeof fetch;
  batchSize?: number;
  maxChars?: number;
  concurrency?: number;
  glossary?: () => TranslationGlossaryEntry[];
  requestTimeoutMs?: number;
  retryDelays?: number[];
}

interface PendingText {
  text: string;
  order: number;
}

function buildBatches(pending: PendingText[], limits: EngineLimits, leading = 0): PendingText[][] {
  const batches: PendingText[][] = [];
  let batch: PendingText[] = [];
  let chars = 0;
  for (const item of pending) {
    const size = batches.length ? limits.batchSize : Math.min(limits.firstBatch, limits.batchSize);
    // Never mix the leading (on-screen) texts into a batch with the rest: they would wait for the longer reply.
    const boundary = batch.length > 0 && batch[batch.length - 1].order < leading && item.order >= leading;
    const overflow = boundary || batch.length >= size || (batch.length > 0 && chars + item.text.length > limits.maxChars);
    if (overflow) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(item);
    chars += item.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/**
 * Request slots shared by every translate call, so scrolling never stacks up more requests than the platform
 * allows. A free slot goes to the newest call first (what is on screen now), then in each call's own order;
 * background whole-book work waits behind the reader.
 */
function compareRank(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

class Lanes {
  private running = 0;
  private waiting: { rank: [number, number, number]; start: () => void; abort: () => void }[] = [];

  constructor(private readonly limit: () => number) {}

  run(rank: [number, number, number], task: () => Promise<void>, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const entry = {
        rank,
        start: () => {
          cleanup();
          if (signal?.aborted) {
            this.running--;
            this.pump();
            reject(abortError());
            return;
          }
          task().then(resolve, reject).finally(() => { this.running--; this.pump(); });
        },
        abort: () => {
          cleanup();
          reject(abortError());
        },
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) {
          this.waiting.splice(index, 1);
          entry.abort();
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(entry);
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < Math.max(1, this.limit()) && this.waiting.length) {
      let best = 0;
      for (let index = 1; index < this.waiting.length; index++) {
        if (compareRank(this.waiting[index].rank, this.waiting[best].rank) < 0) best = index;
      }
      const [next] = this.waiting.splice(best, 1);
      this.running++;
      next.start();
    }
  }
}

/** Batched, cached, retrying translator over the Microsoft endpoint or an OpenAI-compatible LLM. */
/**
 * Cache slot for a sentence: the target language plus who translated it. Microsoft keeps the plain target
 * (what earlier versions stored), every LLM endpoint + model gets its own slot, so switching models
 * translates again instead of showing the old engine's text, and switching back finds it still there.
 */
export function translationCacheKey(settings: TranslationSettings): string {
  if (settings.engine !== 'llm') return settings.target;
  return `${settings.target}|${settings.llm.baseUrl.trim().replace(/\/+$/, '')}|${settings.llm.model.trim()}`;
}

export interface TranslateOptions {
  /**
   * Receives sentences as they arrive: cached lines first, then an optional Microsoft quick draft
   * (`draft = true`, never cached in the LLM slot), then streamed and final LLM sentences.
   */
  onPartial?: (found: Map<string, string>, draft?: boolean) => void;
  /** Whole-book work: its batches only take slots the reader is not waiting for. */
  background?: boolean;
  /** How many of the texts are on screen: they get batches of their own. */
  leading?: number;
  /** Preceding sentences from an earlier chunk, used only as LLM context. */
  context?: string[];
}

export class Translator {
  private readonly store: TranslationCache;
  private readonly settings: () => TranslationSettings;
  private readonly fetchImpl: typeof fetch;
  private readonly batchSize?: number;
  private readonly maxChars?: number;
  private readonly concurrency?: number;
  private readonly glossary?: () => TranslationGlossaryEntry[];
  private readonly requestTimeoutMs?: number;
  private readonly retryDelays: number[];
  private readonly lanes: Lanes;
  private calls = 0;

  constructor(options: TranslatorOptions) {
    this.store = options.store;
    this.settings = options.settings;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.batchSize = options.batchSize;
    this.maxChars = options.maxChars;
    this.concurrency = options.concurrency;
    this.glossary = options.glossary;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.retryDelays = options.retryDelays ?? RETRY_DELAYS;
    this.lanes = new Lanes(() => this.concurrency ?? translationConcurrency(this.settings()));
  }

  private limits(engine: TranslationEngine): EngineLimits {
    const defaults = ENGINE_LIMITS[engine];
    return {
      batchSize: Math.max(1, this.batchSize ?? defaults.batchSize),
      maxChars: Math.max(1, this.maxChars ?? defaults.maxChars),
      firstBatch: Math.max(1, this.batchSize ?? defaults.firstBatch),
    };
  }

  private async request(
    engine: TranslationEngine,
    texts: string[],
    target: string,
    context: string[],
    signal?: AbortSignal,
    onItem?: (index: number, text: string) => void,
  ): Promise<string[]> {
    const settings = this.settings();
    const glossary = engine === 'llm' ? (this.glossary?.() ?? []) : [];
    const timeoutMs = this.requestTimeoutMs ?? (engine === 'llm' ? LLM_TIMEOUT_MS : MICROSOFT_TIMEOUT_MS);
    for (let attempt = 0; ; attempt++) {
      throwIfAborted(signal);
      try {
        return engine === 'llm'
          ? await translateLlm(texts, target, settings.llm, this.fetchImpl, signal, context, onItem, glossary, timeoutMs)
          : await translateMicrosoft(texts, target, this.fetchImpl, signal, timeoutMs);
      } catch (error) {
        const retryable = error instanceof TranslationError && error.retryable;
        const model = engine === 'llm' ? `${settings.llm.provider ?? 'custom'} ${settings.llm.model}` : 'microsoft';
        const message = error instanceof Error ? error.message : String(error);
        if (!retryable || attempt >= this.retryDelays.length) {
          if (!(error instanceof Error && error.name === 'AbortError')) logEvent('error', 'translate', `${model}: ${texts.length} sentences failed: ${message}`);
          throw error;
        }
        logEvent('warn', 'translate', `${model}: attempt ${attempt + 1} failed, retrying: ${message}`);
        await delay(Math.max(this.retryDelays[attempt], error instanceof TranslationError ? error.retryAfterMs ?? 0 : 0), signal);
      }
    }
  }

  /**
   * Translations for `texts`, from the cache or the engine. `onPartial` gets what is ready as it arrives (the
   * cached part first, then a Microsoft draft when `quickDraft` is on, then each streamed/batch item), so the
   * reader shows lines without waiting for the slowest batch.
   */
  async translate(bookId: string, texts: string[], signal?: AbortSignal, options: TranslateOptions = {}): Promise<Map<string, string>> {
    throwIfAborted(signal);
    const settings = this.settings();
    const target = settings.target;
    const slot = translationCacheKey(settings);
    const engine = settings.engine;
    const result = new Map<string, string>();
    const seen = new Set<string>();
    const pending: PendingText[] = [];
    texts.forEach((value, order) => {
      if (seen.has(value)) return;
      seen.add(value);
      if (needsTranslation(value)) pending.push({ text: value, order });
      else result.set(value, value);
    });
    if (!pending.length) {
      options.onPartial?.(new Map(result));
      return result;
    }

    const cached = await this.store.get(bookId, slot, pending.map(item => item.text));
    throwIfAborted(signal);
    const misses = pending.filter(item => {
      if (!cached.has(item.text)) return true;
      const usable = usableCachedTranslation(engine, cached.get(item.text) as string);
      if (usable === undefined) return true;
      result.set(item.text, usable);
      return false;
    });
    options.onPartial?.(new Map(result));
    if (!misses.length) return result;

    let draftAbort: AbortController | null = null;
    let stopDraft: (() => void) | null = null;
    if (engine === 'llm' && (settings.quickDraft ?? true) && !options.background && options.onPartial) {
      draftAbort = new AbortController();
      stopDraft = () => draftAbort?.abort();
      if (signal?.aborted) draftAbort.abort();
      else signal?.addEventListener('abort', stopDraft, { once: true });
      const draftBatches = buildBatches(misses, ENGINE_LIMITS.microsoft, options.leading);
      const draftSignal = draftAbort.signal;
      const draftTimeoutMs = this.requestTimeoutMs ?? MICROSOFT_TIMEOUT_MS;
      void Promise.all(draftBatches.map(async batch => {
        try {
          const batchTexts = batch.map(item => item.text);
          const drafts = await translateMicrosoft(batchTexts, target, this.fetchImpl, draftSignal, draftTimeoutMs);
          if (draftSignal.aborted) return;
          const draftMap = new Map<string, string>();
          batchTexts.forEach((source, index) => {
            const value = drafts[index];
            if (typeof value === 'string' && value.trim() && !result.has(source)) {
              draftMap.set(source, value);
            }
          });
          if (draftMap.size) options.onPartial?.(draftMap, true);
        } catch {
          // Microsoft draft is best-effort; ignore failures silently and proceed with the LLM.
        }
      }));
    }

    const leadingContext = (options.context ?? []).filter(needsTranslation);
    const runBatch = async (batch: PendingText[]) => {
      const list = batch.map(item => item.text);
      const context = engine === 'llm'
        ? [...leadingContext, ...texts.slice(0, batch[0].order).filter(needsTranslation)].slice(-CONTEXT_LINES)
        : [];
      const translations = await this.request(engine, list, target, context, signal, (index, value) => {
        const source = list[index];
        const usable = usableCachedTranslation(engine, value);
        if (source !== undefined && usable !== undefined) {
          result.set(source, usable);
          options.onPartial?.(new Map([[source, usable]]));
        }
      });
      const pairs: [string, string][] = [];
      list.forEach((source, index) => {
        const value = translations[index];
        if (typeof value !== 'string') return;
        const usable = usableCachedTranslation(engine, value);
        if (usable === undefined) return;
        result.set(source, usable);
        pairs.push([source, usable]);
      });
      if (pairs.length) {
        options.onPartial?.(new Map(pairs));
        await this.store.put(bookId, slot, engine, pairs);
      }
    };

    const batches = buildBatches(misses, this.limits(engine), options.leading);
    const call = ++this.calls;
    // The first failure stops this call's batches that have not started; ones already in flight finish and
    // keep their results, which is why a retry resumes from the cache.
    let failure: { error: unknown } | null = null;
    try {
      await Promise.all(batches.map((batch, index) => this.lanes.run([options.background ? 1 : 0, -call, index], async () => {
        if (failure || signal?.aborted) return;
        try {
          await runBatch(batch);
        } catch (error) {
          failure ??= { error };
        }
      }, signal)));
    } finally {
      draftAbort?.abort();
      if (stopDraft) signal?.removeEventListener('abort', stopDraft);
    }
    if (failure) throw (failure as { error: unknown }).error;
    throwIfAborted(signal);
    return result;
  }

  /**
   * Translates a whole book in book order and reports how far it got. Progress counts
   * the cached sentences as done, so an interrupted run resumes from that share instead
   * of restarting the counter at zero.
   */
  async pretranslate(
    bookId: string,
    texts: string[],
    onProgress: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const total = texts.length;
    const slot = translationCacheKey(this.settings());
    // Read the cache chunk by chunk so a whole book never becomes one huge transaction.
    const done = texts.map(value => !needsTranslation(value));
    for (let start = 0; start < total; start += PRETRANSLATE_CHUNK) {
      throwIfAborted(signal);
      const chunk = texts.slice(start, start + PRETRANSLATE_CHUNK);
      const cached = await this.store.get(bookId, slot, chunk.filter(needsTranslation));
      chunk.forEach((value, index) => { if (cached.has(value)) done[start + index] = true; });
    }
    const report = () => onProgress(done.filter(Boolean).length, total);
    report();
    let prevContext: string[] = [];
    for (let start = 0; start < total; start += PRETRANSLATE_CHUNK) {
      throwIfAborted(signal);
      const chunk = texts.slice(start, start + PRETRANSLATE_CHUNK);
      await this.translate(bookId, chunk, signal, { background: true, context: prevContext });
      throwIfAborted(signal);
      prevContext = chunk.filter(needsTranslation).slice(-CONTEXT_LINES);
      done.fill(true, start, start + chunk.length);
      report();
    }
  }
}
