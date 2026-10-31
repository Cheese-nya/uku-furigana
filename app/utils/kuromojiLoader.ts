import BrowserDictionaryLoader from 'kuromoji/src/loader/BrowserDictionaryLoader';
import ViterbiBuilder from 'kuromoji/src/viterbi/ViterbiBuilder';
import ViterbiLattice from 'kuromoji/src/viterbi/ViterbiLattice';
import ViterbiNode from 'kuromoji/src/viterbi/ViterbiNode';
import SurrogateAwareString from 'kuromoji/src/util/SurrogateAwareString';
import { sanitizeText } from './textSanitize';

type LoadCallback = (err: unknown, buffer: ArrayBuffer | null) => void;

/**
 * Stock kuromoji fires all twelve dictionary downloads at once and inflates each
 * with zlibjs, which grows its output buffer by doubling. The dictionary is ~100 MB
 * once inflated, so the stock path peaks at several times that, which is enough to
 * get the WebView renderer killed on memory-constrained phones.
 *
 * This replaces the browser loader with one that loads a file at a time and
 * inflates with the native DecompressionStream straight into a buffer sized from
 * the gzip trailer (ISIZE), so peak memory is roughly the final dictionary.
 * Anything unsupported or failing falls back to the stock loader for that file.
 */
const proto = BrowserDictionaryLoader.prototype as { loadArrayBuffer: (url: string, callback: LoadCallback) => void };
const stockLoad = proto.loadArrayBuffer;

let queue: Promise<unknown> = Promise.resolve();

const canStream = () =>
  typeof DecompressionStream === 'function' &&
  typeof fetch === 'function' &&
  /^https?:$/.test(globalThis.location?.protocol ?? '');

async function inflate(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const blob = await response.blob();
  if (blob.size < 18) throw new Error('not a gzip stream');
  const size = new DataView(await blob.slice(-4).arrayBuffer()).getUint32(0, true);
  const out = new Uint8Array(size);
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > size) throw new Error('gzip size mismatch');
    out.set(value, offset);
    offset += value.length;
  }
  if (offset !== size) throw new Error('gzip size mismatch');
  return out.buffer;
}

function stock(this: unknown, url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    stockLoad.call(this, url, (err, buffer) => (err || !buffer ? reject(err ?? new Error('empty dictionary file')) : resolve(buffer)));
  });
}

proto.loadArrayBuffer = function (this: unknown, url: string, callback: LoadCallback) {
  const run = async () => {
    if (canStream()) {
      try {
        return await inflate(url);
      } catch (error) {
        console.warn('Streaming dictionary load failed, using stock loader:', url, error);
      }
    }
    return stock.call(this, url);
  };
  queue = queue
    .then(run)
    .then(buffer => callback(null, buffer), err => callback(err, null))
    .catch(() => undefined);
};

interface UnknownClass {
  class_name: string;
  class_id: number;
  is_always_invoke: number;
  is_grouping: number;
}

interface BuilderInternals {
  trie: { commonPrefixSearch(key: string): { k: string; v?: number }[] };
  token_info_dictionary: {
    target_map: Record<number, string[] | undefined>;
    dictionary: { getShort(index: number): number };
  };
  unknown_dictionary: {
    lookup(text: string): UnknownClass;
    target_map: Record<number, string[] | undefined>;
    dictionary: { getShort(index: number): number };
  };
}

/**
 * kuromoji's own ViterbiBuilder, with the lattice lengths kept in code points. Stock kuromoji
 * does `key += next_char` on a SurrogateAwareString while grouping an unknown word, which turns
 * key into a primitive string: the node's length then counts UTF-16 units while lattice
 * positions count code points, so a run of supplementary-plane characters (rare kanji, emoji)
 * makes the lattice skip the characters that follow it (「😀😀連続」 tokenizes as 「😀😀」 and
 * 連続 disappears). The word-id guard also covers a trie entry without a word id, which is what
 * doublearray answers for the U+0000 terminator.
 */
function buildLattice(this: BuilderInternals, sentenceStr: string) {
  const lattice = new ViterbiLattice();
  const sentence = new SurrogateAwareString(sentenceStr);

  for (let pos = 0; pos < sentence.length; pos += 1) {
    const tail = sentence.slice(pos);
    const vocabulary = this.trie.commonPrefixSearch(tail);
    for (const entry of vocabulary) {
      const tokenInfoIds = entry.v === undefined ? undefined : this.token_info_dictionary.target_map[entry.v];
      if (!tokenInfoIds) continue;
      const keyLength = new SurrogateAwareString(entry.k).length;
      for (const tokenInfoId of tokenInfoIds) {
        const id = parseInt(tokenInfoId);
        const leftId = this.token_info_dictionary.dictionary.getShort(id);
        const rightId = this.token_info_dictionary.dictionary.getShort(id + 2);
        const wordCost = this.token_info_dictionary.dictionary.getShort(id + 4);
        lattice.append(new ViterbiNode(id, wordCost, pos + 1, keyLength, 'KNOWN', leftId, rightId, entry.k));
      }
    }

    // Unknown word processing
    const surrogateAwareTail = new SurrogateAwareString(tail);
    const headChar = new SurrogateAwareString(surrogateAwareTail.charAt(0));
    const headClass = this.unknown_dictionary.lookup(headChar.toString());
    if (!vocabulary || vocabulary.length === 0 || headClass.is_always_invoke === 1) {
      let key = headChar.toString();
      let keyLength = headChar.length;
      if (headClass.is_grouping === 1 && surrogateAwareTail.length > 1) {
        for (let k = 1; k < surrogateAwareTail.length; k += 1) {
          const nextChar = surrogateAwareTail.charAt(k);
          const nextClass = this.unknown_dictionary.lookup(nextChar);
          if (headClass.class_name !== nextClass.class_name) break;
          key += nextChar;
          // charAt returns a whole code point: two UTF-16 units only for a surrogate pair.
          keyLength += nextChar.length === 2 ? 1 : nextChar.length;
        }
      }

      const unknownIds = this.unknown_dictionary.target_map[headClass.class_id] ?? [];
      for (const unknownId of unknownIds) {
        const id = parseInt(unknownId);
        const leftId = this.unknown_dictionary.dictionary.getShort(id);
        const rightId = this.unknown_dictionary.dictionary.getShort(id + 2);
        const wordCost = this.unknown_dictionary.dictionary.getShort(id + 4);
        lattice.append(new ViterbiNode(id, wordCost, pos + 1, keyLength, 'UNKNOWN', leftId, rightId, key));
      }
    }
  }
  lattice.appendEos();

  return lattice;
}

const builderProto = ViterbiBuilder.prototype as { build: (this: BuilderInternals, sentence: string) => unknown };

builderProto.build = function (sentence: string) {
  return buildLattice.call(this, sanitizeText(sentence));
};
