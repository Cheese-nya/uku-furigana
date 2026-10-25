import type { AnalyzedToken } from './analyze';
import type { DictEntry } from './dictionaryStore';

export type { AnalyzedToken, DictEntry };

export interface LookupResult {
  /** Highlighted range in the line, including trailing auxiliaries (死に|ます). */
  start: number;
  end: number;
  query: string;
  /** Dictionary form that matched. */
  lemma: string;
  /** Inflection codes of the auxiliaries after the word, for INFLECTION_LABELS. */
  inflections: string[];
  entries: DictEntry[];
}

export const INFLECTION_LABELS: Record<string, { zh: string; en: string }> = {
  masu: { zh: 'ます形', en: '-masu form' },
  past: { zh: '过去', en: 'past' },
  negative: { zh: '否定', en: 'negative' },
  te: { zh: 'て形', en: 'te-form' },
  passive: { zh: '被动/可能', en: 'passive/potential' },
  causative: { zh: '使役', en: 'causative' },
  want: { zh: '愿望', en: 'desire' },
  volitional: { zh: '意志', en: 'volitional' },
  conditional: { zh: '假定', en: 'conditional' },
  progressive: { zh: '持续', en: 'progressive' },
  completive: { zh: '完了', en: 'completion' },
};

// Our own small table (suffix → dictionary-form endings). It over-generates on purpose: the dictionary
// decides which candidate exists. Applied up to three times, so 食べなかった → 食べない → 食べる.
const RULES: [string, string[]][] = [
  ['いた', ['く']], ['いだ', ['ぐ']], ['した', ['す', 'する']], ['った', ['う', 'つ', 'る']], ['んだ', ['む', 'ぶ', 'ぬ']],
  ['いて', ['く']], ['いで', ['ぐ']], ['して', ['す', 'する']], ['って', ['う', 'つ', 'る']], ['んで', ['む', 'ぶ', 'ぬ']],
  ['た', ['る']], ['て', ['る']],
  ['きます', ['く']], ['ぎます', ['ぐ']], ['します', ['す', 'する']], ['ちます', ['つ']], ['にます', ['ぬ']],
  ['びます', ['ぶ']], ['みます', ['む']], ['ります', ['る']], ['います', ['う']], ['ます', ['る']],
  ['ました', ['ます']], ['ません', ['ます']], ['ましょう', ['ます']],
  ['かない', ['く']], ['がない', ['ぐ']], ['さない', ['す']], ['たない', ['つ']], ['なない', ['ぬ']],
  ['ばない', ['ぶ']], ['まない', ['む']], ['らない', ['る']], ['わない', ['う']], ['ない', ['る']], ['しない', ['する']],
  ['かった', ['い']], ['くて', ['い']], ['くない', ['い']], ['ければ', ['い']], ['く', ['い']], ['さ', ['い']],
  ['えば', ['う']], ['けば', ['く']], ['げば', ['ぐ']], ['せば', ['す']], ['てば', ['つ']], ['ねば', ['ぬ']],
  ['べば', ['ぶ']], ['めば', ['む']], ['れば', ['る']],
  ['られる', ['る']], ['かれる', ['く']], ['がれる', ['ぐ']], ['される', ['す', 'する']], ['たれる', ['つ']],
  ['なれる', ['ぬ']], ['ばれる', ['ぶ']], ['まれる', ['む']], ['われる', ['う']], ['れる', ['る']],
  ['させる', ['る', 'する']], ['かせる', ['く']], ['がせる', ['ぐ']], ['たせる', ['つ']], ['なせる', ['ぬ']],
  ['ばせる', ['ぶ']], ['ませる', ['む']], ['らせる', ['る']], ['わせる', ['う']],
  ['よう', ['る']], ['おう', ['う']], ['こう', ['く']], ['ごう', ['ぐ']], ['そう', ['す']], ['とう', ['つ']],
  ['のう', ['ぬ']], ['ぼう', ['ぶ']], ['もう', ['む']], ['ろう', ['る']],
  ['たい', ['る']], ['きたい', ['く']], ['みたい', ['む']], ['りたい', ['る']], ['いたい', ['う']],
  ['きた', ['くる']], ['きて', ['くる']], ['こない', ['くる']], ['きます', ['くる']],
];

export function deinflect(surface: string, depth = 3): string[] {
  const found: string[] = [];
  const visit = (word: string, level: number) => {
    if (level === 0) return;
    for (const [suffix, endings] of RULES) {
      if (!word.endsWith(suffix) || word.length <= suffix.length) continue;
      const stem = word.slice(0, -suffix.length);
      for (const ending of endings) {
        const form = stem + ending;
        if (form === surface || found.includes(form)) continue;
        found.push(form);
        visit(form, level - 1);
      }
    }
  };
  visit(surface, depth);
  return found;
}

const INFLECTION_CODES: Record<string, string> = {
  'ます': 'masu', 'た': 'past', 'ない': 'negative', 'ぬ': 'negative', 'ん': 'negative', 'て': 'te', 'で': 'te',
  'れる': 'passive', 'られる': 'passive', 'せる': 'causative', 'させる': 'causative', 'たい': 'want',
  'う': 'volitional', 'よう': 'volitional', 'まい': 'volitional', 'ば': 'conditional', 'いる': 'progressive', 'しまう': 'completive',
};

const INFLECTABLE = new Set(['動詞', '形容詞', '助動詞']);

/** Auxiliaries that belong to the word before them: 死に|ます, 見|た, 静か|な, 読ん|で|いる. */
function isAuxiliary(token: AnalyzedToken): boolean {
  if (token.pos === '助動詞') return true;
  if (token.pos === '助詞' && token.posDetail === '接続助詞') return ['て', 'で', 'ば'].includes(token.surface);
  return token.pos === '動詞' && token.posDetail === '非自立';
}

function inflectionOf(token: AnalyzedToken, previous: AnalyzedToken | undefined): string | undefined {
  // だ after a verb (読んだ) is the past tense; after a noun it is the copula, which is no inflection.
  if (token.basicForm === 'だ') return previous?.pos === '動詞' ? 'past' : undefined;
  return INFLECTION_CODES[token.basicForm];
}

/**
 * Look up the word at `offset` of a line: the longest run of tokens from the tapped one that the
 * dictionaries know, tried as written, with kuromoji's dictionary form, and through our own deinflector.
 */
export async function lookupAt(
  text: string,
  offset: number,
  tokens: AnalyzedToken[],
  find: (terms: string[]) => Promise<DictEntry[]>,
): Promise<LookupResult | null> {
  const k = tokens.findIndex(token => token.start <= offset && offset < token.end);
  if (k < 0) return null;
  const first = tokens[k];
  if (first.pos === '記号' || !first.surface.trim()) return null;

  for (let j = Math.min(k + 5, tokens.length - 1); j >= k; j -= 1) {
    if (tokens.slice(k + 1, j + 1).some(token => token.pos === '記号')) continue;
    const last = tokens[j];
    const base = text.slice(first.start, last.end);
    const candidates = [base];
    if (last.basicForm && last.basicForm !== '*' && last.basicForm !== last.surface) {
      candidates.push(text.slice(first.start, last.start) + last.basicForm);
    }
    for (const form of deinflect(base)) if (!candidates.includes(form)) candidates.push(form);
    const entries = await find(candidates);
    if (!entries.length) continue;
    const rank = (entry: DictEntry) => {
      const byTerm = candidates.indexOf(entry.term);
      return byTerm >= 0 ? byTerm : candidates.length + Math.max(0, candidates.indexOf(entry.reading));
    };
    const sorted = [...entries].sort((a, b) => rank(a) - rank(b));
    const lemmaEntry = sorted[0];
    const lemma = candidates.includes(lemmaEntry.term) ? lemmaEntry.term : lemmaEntry.reading;

    // Inflected words take their auxiliaries along; a plain noun does not (学生|です).
    let end = j;
    const extendable = INFLECTABLE.has(last.pos) || last.posDetail === '形容動詞語幹';
    while (extendable && end + 1 < tokens.length && isAuxiliary(tokens[end + 1])) end += 1;
    const inflections: string[] = [];
    for (let index = k + 1; index <= end; index += 1) {
      if (!isAuxiliary(tokens[index])) continue;
      const code = inflectionOf(tokens[index], tokens[index - 1]);
      if (code && !inflections.includes(code)) inflections.push(code);
    }
    const stop = tokens[end].end;
    return { start: first.start, end: stop, query: text.slice(first.start, stop), lemma, inflections, entries: sorted.slice(0, 8) };
  }

  // Nothing as a word: a single kanji may still be in the dictionary.
  const char = text[offset];
  if (char && /[㐀-鿿]/.test(char)) {
    const entries = await find([char]);
    if (entries.length) return { start: offset, end: offset + 1, query: char, lemma: char, inflections: [], entries: entries.slice(0, 8) };
  }
  return null;
}
