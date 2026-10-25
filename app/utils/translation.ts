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

export interface TranslationSettings {
  engine: TranslationEngine;
  target: TranslationTarget;
  llm: LlmSettings;
  /** Key, model and endpoint last used with each platform, so switching platforms keeps them. */
  saved?: Record<string, LlmSettings>;
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  engine: 'microsoft',
  target: 'zh-Hans',
  llm: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '', provider: 'deepseek' },
  saved: {},
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

function httpError(status: number, what: string): TranslationError {
  const retryable = status === 429 || status >= 500;
  return new TranslationError(`${what}失败（HTTP ${status}）`, retryable);
}

const MICROSOFT_ENDPOINT = 'https://edge.microsoft.com/translate/translatetext';

/** Microsoft Edge's free endpoint: a JSON array in, `[{ translations: [{ text }] }]` out, same order. */
export async function translateMicrosoft(
  texts: string[],
  target: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!texts.length) return [];
  const url = `${MICROSOFT_ENDPOINT}?from=ja&to=${encodeURIComponent(target)}&isEnterpriseClient=false`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(texts),
    signal,
  });
  if (!response.ok) throw httpError(response.status, '微软翻译');
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
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

function userPrompt(texts: string[], context: string[]): string {
  const lines = context.filter(line => line.trim()).map(line => line.trim());
  const header = lines.length ? `Context (previous lines, do not translate):\n${lines.join('\n')}\n\n` : '';
  return `${header}Sentences to translate (JSON array):\n${JSON.stringify(texts)}`;
}

/** First balanced JSON array in the text, so surrounding prose does not matter. */
function firstJsonArray(source: string): string | undefined {
  const start = source.indexOf('[');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
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
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return undefined;
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

/**
 * Read the model's translations, forgiving what models really send: an object around the array, single
 * quotes, trailing commas, unescaped double quotes inside a translation, or a numbered list.
 */
export function parseLlmTranslations(reply: string, expected: number): string[] {
  const text = cleanLlmReply(reply);
  const attempts: (() => string[] | undefined)[] = [
    () => { const raw = firstJsonArray(text); return raw ? stringList(JSON.parse(raw)) : undefined; },
    () => {
      const parsed: unknown = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      return parsed && typeof parsed === 'object' ? Object.values(parsed).map(stringList).find(Boolean) : undefined;
    },
    () => { const raw = firstJsonArray(text); return raw ? stringList(JSON.parse(raw.replace(/,\s*\]$/, ']'))) : undefined; },
    // ["他说："你好"。", "…"]: split between items instead of trusting the quotes inside them.
    () => {
      const open = text.search(/\[\s*["']/);
      const close = Math.max(text.lastIndexOf('"]'), text.lastIndexOf("']"), text.search(/["']\s*,?\s*\]\s*$/));
      if (open < 0 || close <= open) return undefined;
      const inner = text.slice(text.indexOf(text.slice(open).match(/["']/)?.[0] ?? '"', open) + 1, close);
      return inner.split(/["']\s*,\s*["']/).map(item => item.replace(/\\n/g, '\n').replace(/\\(["'\\])/g, '$1'));
    },
    () => {
      const items = text.split('\n').map(line => line.match(/^\s*(?:\d+|[-*•])\s*[.)、:：]?\s+(.+)$/)?.[1]).filter((line): line is string => Boolean(line));
      return items.length ? items.map(item => item.replace(/^["'「“]|["'」”],?$/g, '')) : undefined;
    },
  ];
  let found: string[] | undefined;
  for (const attempt of attempts) {
    try { found = attempt(); } catch { found = undefined; }
    if (found?.length === expected) return found;
  }
  if (found) throw new TranslationError('译文条数不一致', false);
  throw new TranslationError('模型返回的 JSON 无法解析', false);
}

const FORMAT_ERRORS = new Set(['模型返回的 JSON 无法解析', '译文条数不一致', '模型没有返回译文']);

async function chat(url: string, llm: LlmSettings, messages: { role: string; content: string }[], fetchImpl: typeof fetch, signal?: AbortSignal): Promise<string> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({ model: llm.model, temperature: 0.3, messages }),
    signal,
  });
  if (!response.ok) {
    // Platforms explain refusals in the body (balance, real-name verification, unknown model…): show that.
    const detail = await response.json().then(
      (body: { error?: { message?: unknown } | string; message?: unknown }) =>
        typeof body.error === 'string' ? body.error : body.error?.message ?? body.message,
      () => undefined,
    );
    const error = httpError(response.status, '模型翻译');
    if (typeof detail === 'string' && detail.trim()) error.message += `：${detail.trim().slice(0, 160)}`;
    const wait = Number(response.headers?.get?.('retry-after'));
    if (Number.isFinite(wait) && wait > 0) error.retryAfterMs = Math.min(30, wait) * 1000;
    throw error;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TranslationError('模型返回了无法解析的数据', true);
  }
  const content = (payload as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  // Some endpoints send content as parts: [{ type: 'text', text }].
  const reply = Array.isArray(content)
    ? content.map(part => (typeof part === 'string' ? part : (part as { text?: unknown })?.text)).filter(part => typeof part === 'string').join('')
    : content;
  if (typeof reply !== 'string' || !cleanLlmReply(reply)) throw new TranslationError('模型没有返回译文', false);
  return reply;
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
): Promise<string[]> {
  if (!texts.length) return [];
  if (!llm.apiKey.trim()) throw new TranslationError('请先在设置里填写 API Key', false);
  const url = `${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const language = TARGET_NAMES[target] || target;
  if (texts.length === 1) {
    try {
      const reply = await chat(url, llm, [
        { role: 'system', content: systemPrompt(target) },
        { role: 'user', content: userPrompt(texts, context) },
      ], fetchImpl, signal);
      try {
        return parseLlmTranslations(reply, 1);
      } catch (error) {
        // A one-sentence answer without the array around it is still the answer.
        const bare = cleanLlmReply(reply);
        if (bare && !/^[[{]/.test(bare) && !bare.includes('\n\n')) return [bare.replace(/^["'「“]|["'」”]$/g, '').trim()];
        throw error;
      }
    } catch (error) {
      if (!(error instanceof TranslationError) || !FORMAT_ERRORS.has(error.message)) throw error;
      const reply = cleanLlmReply(await chat(url, llm, [
        { role: 'system', content: `Translate the Japanese text into ${language}. Reply with the translation only, no quotes, notes or explanations.` },
        { role: 'user', content: texts[0] },
      ], fetchImpl, signal));
      return [reply.replace(/^["'「“]|["'」”]$/g, '').trim()];
    }
  }
  try {
    const reply = await chat(url, llm, [
      { role: 'system', content: systemPrompt(target) },
      { role: 'user', content: userPrompt(texts, context) },
    ], fetchImpl, signal);
    return parseLlmTranslations(reply, texts.length);
  } catch (error) {
    if (!(error instanceof TranslationError) || !FORMAT_ERRORS.has(error.message)) throw error;
    const half = Math.ceil(texts.length / 2);
    const first = await translateLlm(texts.slice(0, half), target, llm, fetchImpl, signal, context);
    const second = await translateLlm(texts.slice(half), target, llm, fetchImpl, signal, [...context, ...texts.slice(0, half)].slice(-3));
    return [...first, ...second];
  }
}

interface EngineLimits {
  batchSize: number;
  maxChars: number;
}

const ENGINE_LIMITS: Record<TranslationEngine, EngineLimits> = {
  microsoft: { batchSize: 50, maxChars: 8000 },
  // Small free models truncate long replies; a failed batch is split anyway, but smaller ones rarely fail.
  llm: { batchSize: 12, maxChars: 2000 },
};

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
}

interface PendingText {
  text: string;
  order: number;
}

function buildBatches(pending: PendingText[], limits: EngineLimits): PendingText[][] {
  const batches: PendingText[][] = [];
  let batch: PendingText[] = [];
  let chars = 0;
  for (const item of pending) {
    const overflow = batch.length >= limits.batchSize || (batch.length > 0 && chars + item.text.length > limits.maxChars);
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

async function runLimited<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const errors: unknown[] = [];
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, async () => {
    for (;;) {
      // The first failure stops new batches; ones already in flight finish and keep
      // their results, which is why a retry resumes from the cache.
      if (errors.length) return;
      const index = next++;
      if (index >= items.length) return;
      try {
        await worker(items[index]);
      } catch (error) {
        errors.push(error);
        return;
      }
    }
  }));
  if (errors.length) throw errors[0];
}

/** Batched, cached, retrying translator over the Microsoft endpoint or an OpenAI-compatible LLM. */
/**
 * Cache slot for a sentence: the target language plus who translated it. Microsoft keeps the plain target
 * (what earlier versions stored), every LLM endpoint + model gets its own slot, so switching models
 * translates again instead of showing the old engine's text, and switching back finds it still there.
 */
export function translationCacheKey(settings: TranslationSettings): string {
  if (settings.engine !== 'llm') return settings.target;
  return `${settings.target}|${settings.llm.baseUrl.replace(/\/+$/, '')}|${settings.llm.model}`;
}

export class Translator {
  private readonly store: TranslationCache;
  private readonly settings: () => TranslationSettings;
  private readonly fetchImpl: typeof fetch;
  private readonly batchSize?: number;
  private readonly maxChars?: number;
  private readonly concurrency: number;

  constructor(options: TranslatorOptions) {
    this.store = options.store;
    this.settings = options.settings;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.batchSize = options.batchSize;
    this.maxChars = options.maxChars;
    this.concurrency = Math.max(1, options.concurrency ?? 2);
  }

  private limits(engine: TranslationEngine): EngineLimits {
    const defaults = ENGINE_LIMITS[engine];
    return {
      batchSize: Math.max(1, this.batchSize ?? defaults.batchSize),
      maxChars: Math.max(1, this.maxChars ?? defaults.maxChars),
    };
  }

  private async request(
    engine: TranslationEngine,
    texts: string[],
    target: string,
    context: string[],
    signal?: AbortSignal,
  ): Promise<string[]> {
    const settings = this.settings();
    for (let attempt = 0; ; attempt++) {
      throwIfAborted(signal);
      try {
        return engine === 'llm'
          ? await translateLlm(texts, target, settings.llm, this.fetchImpl, signal, context)
          : await translateMicrosoft(texts, target, this.fetchImpl, signal);
      } catch (error) {
        const retryable = error instanceof TranslationError && error.retryable;
        if (!retryable || attempt >= RETRY_DELAYS.length) throw error;
        await delay(Math.max(RETRY_DELAYS[attempt], error instanceof TranslationError ? error.retryAfterMs ?? 0 : 0), signal);
      }
    }
  }

  async translate(bookId: string, texts: string[], signal?: AbortSignal): Promise<Map<string, string>> {
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
    if (!pending.length) return result;

    const cached = await this.store.get(bookId, slot, pending.map(item => item.text));
    const misses = pending.filter(item => {
      if (!cached.has(item.text)) return true;
      result.set(item.text, cached.get(item.text) as string);
      return false;
    });
    if (!misses.length) return result;

    const batches = buildBatches(misses, this.limits(engine));
    await runLimited(batches, this.concurrency, async batch => {
      const list = batch.map(item => item.text);
      const context = engine === 'llm'
        ? texts.slice(Math.max(0, batch[0].order - CONTEXT_LINES), batch[0].order)
        : [];
      const translations = await this.request(engine, list, target, context, signal);
      const pairs: [string, string][] = [];
      list.forEach((source, index) => {
        const value = translations[index];
        if (typeof value !== 'string') return;
        result.set(source, value);
        pairs.push([source, value]);
      });
      await this.store.put(bookId, slot, engine, pairs);
    });
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
    for (let start = 0; start < total; start += PRETRANSLATE_CHUNK) {
      throwIfAborted(signal);
      const chunk = texts.slice(start, start + PRETRANSLATE_CHUNK);
      await this.translate(bookId, chunk, signal);
      throwIfAborted(signal);
      done.fill(true, start, start + chunk.length);
      report();
    }
  }
}
