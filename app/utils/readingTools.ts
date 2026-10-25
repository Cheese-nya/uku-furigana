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

/** Bundled dictionary files, next to the page like the kuromoji dictionary (works under a sub-path too). */
export function builtinDictionaryUrl(): string {
  return typeof window === 'undefined' ? '/lookup/ja-zh/' : new URL('./lookup/ja-zh/', window.location.href.split('?')[0]).pathname;
}

let dictionaryStore: DictionaryStore | null = null;
export function getDictionaryStore(): DictionaryStore {
  dictionaryStore ??= new DictionaryStore();
  return dictionaryStore;
}

let installing: Promise<void> | null = null;
const installListeners = new Set<(progress: number) => void>();
/** Installs (or upgrades) the bundled dictionary once per session; every caller waiting on it hears the progress. */
export async function ensureBuiltinDictionary(onProgress?: (progress: number) => void): Promise<void> {
  if (onProgress) installListeners.add(onProgress);
  installing ??= getDictionaryStore()
    .ensureBuiltin(builtinDictionaryUrl(), progress => installListeners.forEach(listener => listener(progress)))
    .then(() => undefined, (error: unknown) => { installing = null; throw error; });
  try {
    await installing;
  } finally {
    if (onProgress) installListeners.delete(onProgress);
  }
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
