import kuromoji from 'kuromoji';
import './kuromojiLoader';

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

  initPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      initPromise = null;
      reject(new Error('离线词典加载超时，请重试'));
    }, 60000);
    kuromoji.builder({ dicPath: resolveDictionaryPath(dictionaryPath) }).build((err, _tokenizer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err) {
        console.error('Kuromoji initialization failed:', err);
        initPromise = null;
        reject(err);
        return;
      }
      tokenizer = _tokenizer;
      resolve();
    });
  });

  return initPromise;
};

export const getTokenizer = () => {
  if (!tokenizer) throw new Error('Kuromoji is not initialized');
  return tokenizer;
};

export const isKuromojiReady = () => !!tokenizer;
