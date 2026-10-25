import type { AnalyzedToken } from './analyze';
import { DictionaryStore } from './dictionaryStore';
import { lookupAt, type LookupResult } from './lookup';
import { Translator, loadTranslationSettings, type TranslationSettings } from './translation';
import { defaultTranslationStore } from './translationStore';

export interface DictionaryInfo {
  id: string;
  title: string;
  revision: string;
  attribution: string;
  license?: string;
  enabled: boolean;
  order: number;
  builtin: boolean;
  count: number;
}

/** What the reader needs from lookup and translation; built once per settings change by useReadingTools. */
export interface ReaderTools {
  lookup(text: string, offset: number, onPreparing?: (progress: number) => void): Promise<LookupResult | null>;
  translate(bookId: string, texts: string[], signal?: AbortSignal): Promise<Map<string, string>>;
  countTranslated(bookId: string, texts: string[]): Promise<number>;
  pretranslate(bookId: string, texts: string[], onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<void>;
  /** Changes whenever the engine or target language does, so cached state in the reader resets. */
  settingsKey: string;
  engineLabel: string;
}

/** Bundled dictionaries, in display order: Japanese–Chinese first, Jitendex (Japanese–English) to fill its gaps. */
const BUILTIN_DICTIONARIES = ['ja-zh', 'ja-en'];

/** Bundled dictionary files sit next to the page like the kuromoji dictionary (so a sub-path works too). */
export function builtinDictionaryUrl(name: string): string {
  return typeof window === 'undefined' ? `/lookup/${name}/` : new URL(`./lookup/${name}/`, window.location.href.split('?')[0]).pathname;
}

let dictionaryStore: DictionaryStore | null = null;
export function getDictionaryStore(): DictionaryStore {
  dictionaryStore ??= new DictionaryStore();
  return dictionaryStore;
}

// One install per dictionary per session; every caller waiting on the first one hears its progress.
const installs = new Map<string, Promise<void>>();
const installListeners = new Set<(progress: number) => void>();
function install(name: string, order: number, onProgress?: (progress: number) => void): Promise<void> {
  let running = installs.get(name);
  if (!running) {
    running = getDictionaryStore().ensureBuiltin(builtinDictionaryUrl(name), onProgress, order)
      .then(() => undefined, (error: unknown) => { installs.delete(name); throw error; });
    installs.set(name, running);
  }
  return running;
}

/**
 * Installs (or upgrades) the bundled dictionaries. Resolves once the first one is ready, which is all a lookup
 * needs; the larger Japanese–English one keeps installing in the background and joins the results when done.
 */
export async function ensureBuiltinDictionary(onProgress?: (progress: number) => void, onAllDone?: () => void): Promise<void> {
  if (onProgress) installListeners.add(onProgress);
  try {
    await install(BUILTIN_DICTIONARIES[0], 0, progress => installListeners.forEach(listener => listener(progress)));
  } finally {
    if (onProgress) installListeners.delete(onProgress);
  }
  const rest = BUILTIN_DICTIONARIES.slice(1).reduce<Promise<void>>(
    (previous, name, index) => previous.then(() => install(name, index + 1)), Promise.resolve(),
  );
  void rest.then(onAllDone, () => undefined);
}

export function createReaderTools(options: {
  analyze: (text: string) => Promise<AnalyzedToken[]>;
  settings: TranslationSettings;
  engineLabel: string;
}): ReaderTools {
  const store = defaultTranslationStore();
  const translator = new Translator({ store, settings: () => options.settings });
  const target = options.settings.target;
  return {
    async lookup(text, offset, onPreparing) {
      await ensureBuiltinDictionary(onPreparing);
      const tokens = await options.analyze(text);
      const dictionaries = getDictionaryStore();
      return lookupAt(text, offset, tokens, terms => dictionaries.find(terms));
    },
    translate: (bookId, texts, signal) => translator.translate(bookId, texts, signal),
    countTranslated: (bookId, texts) => store.count(bookId, target, texts),
    pretranslate: (bookId, texts, onProgress, signal) => translator.pretranslate(bookId, texts, onProgress, signal),
    settingsKey: `${options.settings.engine}|${target}|${options.settings.llm.baseUrl}|${options.settings.llm.model}`,
    engineLabel: options.engineLabel,
  };
}

export { loadTranslationSettings };
