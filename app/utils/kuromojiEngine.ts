import kuromoji from 'kuromoji';
import { primeKuromojiDictionary, releasePrimedKuromojiDictionary } from './kuromojiLoader';
import { loadDictionaryAssets } from './dictionaryAssetCache';

export interface KuromojiToken {
  word_id: number;
  word_type: string;
  word_position: number;
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  pos_detail_2: string;
  pos_detail_3: string;
  conjugated_type: string;
  conjugated_form: string;
  basic_form: string;
  reading?: string;
  pronunciation?: string;
}

let tokenizer: { tokenize(text: string): KuromojiToken[] } | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Where the kuromoji dictionary lives. The reading table (readings.json.gz) sits in the same
 * directory, so this is also its base path.
 */
export const resolveDictionaryPath = (dictionaryPath?: string): string => {
  if (dictionaryPath) return dictionaryPath;
  // Determine the dictionary path based on window.location if in browser
  const location = typeof window === 'undefined' ? undefined : window.location;
  if (!location) return '/dict';
  // In PyWebView Desktop mode, we might need a relative or specific path
  if (location.protocol === 'file:') return './dict';
  // In NextJS dev/export mode, /dict is in the public root; ensure trailing slash is not an issue.
  return location.pathname.replace(/\/$/, '') + '/dict';
};

export const initKuromoji = async (dictionaryPath?: string): Promise<void> => {
  if (tokenizer) return;
  if (initPromise) return initPromise;

  const dicPath = resolveDictionaryPath(dictionaryPath);
  initPromise = (async () => {
    try {
      const assets = await loadDictionaryAssets(dicPath);
      if (assets) primeKuromojiDictionary(assets.files);
    } catch (error) {
      // Prefetch is an optimisation; the patched loader can still fetch the plain gzip files.
      console.warn('离线词典预加载失败，回退逐文件加载：', error);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        kuromoji.builder({ dicPath }).build((err, _tokenizer) => {
          if (err) {
            reject(err);
            return;
          }
          tokenizer = _tokenizer;
          resolve();
        });
      });
    } finally {
      releasePrimedKuromojiDictionary();
    }
  })().catch(error => {
    console.error('Kuromoji initialization failed:', error);
    initPromise = null;
    throw error;
  });

  return initPromise;
};

export const getTokenizer = () => {
  if (!tokenizer) throw new Error('Kuromoji is not initialized');
  return tokenizer;
};

export const isKuromojiReady = () => !!tokenizer;
