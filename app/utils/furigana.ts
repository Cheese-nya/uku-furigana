// liquid-glass/app/utils/furigana.ts
/**
 * Japanese Furigana & Dubbing Script Processing Engine
 * High-performance browser-side Kana tokenizer & Furigana generator
 * Includes Context-Aware Disambiguation (前後文上下文多音字消歧) & Mora-Aligned Rubies
 */

import { getTokenizer, isKuromojiReady, type KuromojiToken } from './kuromojiEngine';
import { findCounterCompound } from './counterReadings';
import { sanitizeText } from './textSanitize';

export type RubyType = 'hiragana' | 'katakana' | 'romaji';

export type ReadingSource = 'automatic' | 'glossary' | 'learned' | 'source' | 'manual';

export interface Token {
  surface: string;
  ruby?: string;
  hasKanji: boolean;
  alternatives?: string[];
  readingSource?: ReadingSource;
  needsReview?: boolean;
  annotationSuppressed?: boolean;
  word?: { surface: string; reading: string; alternatives: string[]; offset: number; context?: string };
}

export interface ScriptLine {
  id: string;
  speaker?: string;
  rawText: string;
  cleanText: string;
  tokens: Token[];
  translation?: string;
}

// Kanji Unicode Range Test
export const KANJI_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

// High-Priority Japanese Idioms & Pre-Segmented Patterns
export const GRAMMAR_PATTERNS: Record<string, string> = {
  '一日中': 'いちにちじゅう',
  '大好きな': 'だいすきな',
  '大好きだ': 'だいすきだ',
  '大好き': 'だいすき',
  '大嫌い': 'だいきらい',
  '大部分': 'だいぶぶん',
  '大丈夫': 'だいじょうぶ',
  '大変': 'たいへん',
  '大切': 'たいせつ',
  '大事': 'だいじ',
  '匂い': 'におい',
  '匂う': 'におう',
  '匂っ': 'におっ',
  'そんな風に': 'そんなふうに',
  'こんな風に': 'こんなふうに',
  'あんな風に': 'あんなふうに',
  'どんな風に': 'どんなふうに',
  'そんな風': 'そんなふう',
  'こんな風': 'こんなふう',
  'あんな風': 'あんなふう',
  'どんな風': 'どんなふう',
  '読み方': 'よみかた',
  '書き方': 'かきかた',
  '考え方': 'かんがえかた',
  '話し方': 'はなしかた',
  '使い方': 'つかいかた',
  '教え方': 'おしえかた',
  '仕方': 'しかた',
  '二人': 'ふたり',
  '一人': 'ひとり',
  '三人': 'さんにん',
  '四人': 'よにん',
  '五人': 'ごにん',
  '六人': 'ろくにん',
  '七人': 'しちにん',
  '八人': 'はちにん',
  '九人': 'きゅうにん',
  '十人': 'じゅうにん',
  '思った': 'おもった',
  '思って': 'おもって',
  '思い': 'おもい',
  '思わ': 'おもわ',
  '思う': 'おもう',
  '言った': 'いった',
  '言って': 'いって',
  '言わ': 'いわ',
  '言う': 'いう',
  '行った': 'いった',
  '行って': 'いって',
  '行う': 'おこなう',
  '行い': 'おこない',
  '行われる': 'おこなわれる',
  '行なう': 'おこなう',
  '聞いて': 'きいて',
  '聞いた': 'きいた',
  '見つけた': 'みつけた',
  '見つけて': 'みつけて',
  '久しぶり': 'ひさしぶり',
};

// Fallback Kanji Dictionary for words Kuromoji doesn't recognize
export const KANJI_READINGS: Record<string, string> = {
  '日本語': 'にほんご', '日本': 'にほん', '世界': 'せかい', '学校': 'がっこう',
  '先生': 'せんせい', '学生': 'がくせい', '友達': 'ともだち', '声優': 'せいゆう',
  '台本': 'だいほん', '字幕': 'じまく', '吹替': 'ふきかえ', '役割': 'やくわり',
  '時間': 'じかん', '心': 'こころ', '愛': 'あい', '光': 'ひかり', '空': 'そら',
  '海': 'うみ', '風': 'かぜ', '雨': 'あめ', '花': 'はな', '夢': 'ゆめ',
  '声': 'こえ', '物語': 'ものがたり', '奇跡': 'きせき', '未来': 'みらい',
  '希望': 'きぼう', '絶望': 'ぜつぼう', '真実': 'しんじつ', '嘘': 'うそ',
  '約束': 'やくそく', '冒険': 'ぼうけん', '戦い': 'たたかい', '勝利': 'しょうり',
  '仲間': 'なかま', '絆': 'きずな', '感情': 'かんじょう', '記憶': 'きおく',
  '言葉': 'ことば', '運命': 'うんめい', '地球': 'ちきゅう', '宇宙': 'うちゅう',
  '星': 'ほし', '太陽': 'たいよう', '月': 'つき', '朝': 'あさ',
  '昼': 'ひる', '季節': 'きせつ', '春': 'はる', '夏': 'なつ', '秋': 'あき',
  '冬': 'ふゆ', '桜': 'さくら', '雪': 'ゆき', '神': 'かみ', '悪魔': 'あくま',
  '勇者': 'ゆうしゃ', '魔王': 'まおう', '魔法': 'まほう', '科学': 'かがく',
  '技術': 'ぎじゅつ', '力': 'ちから', '能力': 'のうりょく', '限界': 'げんかい',
  '今日': 'きょう', '明日': 'あした', '昨日': 'きのう', '今度': 'こんど',
  '配音': 'はいおん', '練習': 'れんしゅう', '仮名': 'かな', '假名': 'かな',
  '注音': 'ちゅうおん', '版本': 'はんほん', '配音台本': 'はいおんだいほん',
  '日文': 'にちぶん', '脚本': 'きゃくほん', '音响': 'おんきょう', '音響': 'おんきょう',
  '私': 'わたし', '僕': 'ぼく', '俺': 'おれ', '君': 'きみ', '人': 'ひと',
  '山田': 'やまだ', '佐藤': 'さとう', '鈴木': 'すずき', '田中': 'たなか',
  '高橋': 'たかはし', '渡辺': 'わたなべ', '伊藤': 'いとう', '中村': 'なかむら',
  '大': 'だい', '好': 'す', '匂': 'にお', '夜': 'よる', '狐': 'きつね',
  '久': 'ひさ', '今': 'いま', '何': 'なに', '誰': 'だれ', '行': 'い',
  '来': 'き', '食': 'た', '飲': 'の', '見': 'み', '聞': 'き',
  '話': 'はな', '書': 'か', '読': 'よ', '買': 'か', '売': 'う',
  '歩': 'ある', '走': 'はし', '泳': 'およ', '飛': 'と', '乗': 'の',
  '降': 'お', '起': 'お', '寝': 'ね', '始': 'はじ', '終': 'おわ',
  '勝': 'か', '負': 'ま', '助': 'たす', '守': 'まも', '壊': 'こわ',
  '作': 'つく', '使': 'つか', '休': 'やす', '働': 'はたら', '学': 'まな',
  '教': 'おし', '知': 'し', '考': 'かんが', '思': 'おも', '信': 'しん',
  '願': 'ねが', '祈': 'いの', '笑': 'わら', '泣': 'な', '怒': 'おこ',
  '恐': 'おそ', '驚': 'おどろ', '迷': 'まよ', '探': 'さが', '忘': 'わす',
  '覚': 'おぼ', '届': 'とど', '送': 'おく', '受': 'う', '渡': 'わた',
  '止': 'と', '动': 'うご', '動': 'うご', '变': 'か', '変': 'か',
  '開': 'あ', '閉': 'し', '小': 'ちい', '高': 'たか', '低': 'ひく',
  '新': 'あたら', '古': 'ふる', '長': 'なが', '短': 'みじか', '重': 'おも',
  '軽': 'かる', '強': 'つよ', '弱': 'よわ', '早': 'はや', '遅': 'おそ',
  '多': 'おお', '少': 'すく', '嫌': 'きら', '白': 'しろ', '黒': 'くろ',
  '赤': 'あか', '青': 'あお', '黄': 'き', '緑': 'みどり', '日': 'ひ',
  '火': 'ひ', '水': 'みず', '木': 'き', '金': 'かね', '土': 'つち',
  '男': 'おとこ', '女': 'おんな', '父': 'ちち', '母': 'はは', '兄': 'あに',
  '弟': 'おとうと', '姉': 'あね', '妹': 'いもうと', '家': 'いえ', '国': 'くに',
  '町': 'まち', '道': 'みち', '車': 'くるま', '船': 'ふね', '前': 'まえ',
  '後': 'うしろ', '上': 'うえ', '下': 'した', '中': 'なか', '外': 'そと',
  '右': 'みぎ', '左': 'ひだり', '東': 'ひがし', '西': 'にし', '南': 'みなみ',
  '北': 'きた'
};

// Kana to Romaji converter
const ROMAJI_MAP: Record<string, string> = {
  'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
  'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
  'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
  'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
  'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
  'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
  'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
  'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
  'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
  'わ': 'wa', 'を': 'o', 'ん': 'n',
  'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
  'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
  'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
  'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
  'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
  'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o', 'ゔ': 'vu',
  'っ': 'tsu', 'ゃ': 'ya', 'ゅ': 'yu', 'ょ': 'yo'
};

const ROMAJI_PAIRS: Record<string, string> = {
  'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo', 'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
  'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho', 'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
  'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho', 'ぢゃ': 'ja', 'ぢゅ': 'ju', 'ぢょ': 'jo',
  'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo', 'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
  'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo', 'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
  'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo', 'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
  'ふぁ': 'fa', 'ふぃ': 'fi', 'ふぇ': 'fe', 'ふぉ': 'fo', 'ふゅ': 'fyu',
  'てぃ': 'ti', 'でぃ': 'di', 'とぅ': 'tu', 'どぅ': 'du', 'てゅ': 'tyu', 'でゅ': 'dyu',
  'しぇ': 'she', 'じぇ': 'je', 'ちぇ': 'che', 'いぇ': 'ye',
  'うぃ': 'wi', 'うぇ': 'we', 'うぉ': 'wo', 'ゔぁ': 'va', 'ゔぃ': 'vi', 'ゔぇ': 've', 'ゔぉ': 'vo',
};

/** Hepburn consonants, with kana-spelled vowels (kyou / gakkou, no macrons). */
export function kanaToRomaji(kanaText: string): string {
  const text = katakanaToHiragana(kanaText.normalize('NFC'));
  const syllableAt = (index: number) => ROMAJI_PAIRS[text.slice(index, index + 2)] || ROMAJI_MAP[text[index]] || text[index] || '';
  let res = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === 'っ') {
      const next = syllableAt(i + 1);
      res += next.startsWith('ch') ? 't' : /^[bcdfghjklmpqrstvwxyz]/.test(next) ? next[0] : 'xtsu';
    } else if (char === 'ん') {
      res += /^[aeiouy]/.test(syllableAt(i + 1)) ? "n'" : 'n';
    } else if (char === 'ー') {
      res += /[aeiou]$/.test(res) ? res.slice(-1) : '-';
    } else {
      const pair = ROMAJI_PAIRS[text.slice(i, i + 2)];
      res += pair || ROMAJI_MAP[char] || char;
      if (pair) i++;
    }
  }
  return res;
}

export function katakanaToHiragana(kataText: string): string {
  return kataText.replace(/[\u30A1-\u30F6]/g, match => {
    return String.fromCharCode(match.charCodeAt(0) - 0x60);
  });
}

/**
 * Format a dictionary reading for the selected annotation mode.
 */
export function formatRuby(reading: string, rubyType: RubyType): string {
  const hira = katakanaToHiragana(reading);
  if (rubyType === 'katakana') {
    return hira.replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  }
  return rubyType === 'romaji' ? kanaToRomaji(hira) : hira;
}

export function parseCompoundToTokens(
  phrase: string,
  reading: string,
  rubyType: RubyType = 'hiragana',
  alternatives?: string[]
): Token[] {
  if (!KANJI_REGEX.test(phrase) || !reading) {
    return [{ surface: phrase, hasKanji: KANJI_REGEX.test(phrase), needsReview: KANJI_REGEX.test(phrase) }];
  }
  const choices = [...new Set([reading, ...(alternatives || [])].map(value => formatRuby(value.normalize('NFKC').trim(), rubyType)).filter(Boolean))];
  const withWord = (tokens: Token[]): Token[] => {
    let offset = 0;
    return tokens.map(token => {
      const result: Token = { ...token, needsReview: token.hasKanji && choices.length > 1,
        ...(token.alternatives ? { alternatives: [...new Set(token.alternatives)] } : {}),
        word: { surface: phrase, reading: formatRuby(reading, rubyType), alternatives: choices, offset } };
      offset += token.surface.length;
      return result;
    });
  };
  // Align the actual kana in the word, rather than guessing individual kanji readings.
  // Keep adjacent kanji together (二人/ふたり); split only at unambiguous okurigana.
  const parts = phrase.match(/[\u4E00-\u9FFF\u3400-\u4DBF]+|[^\u4E00-\u9FFF\u3400-\u4DBF]+/gu) || [phrase];
  const hira = katakanaToHiragana(reading);
  const solutions: Token[][] = [];
  const align = (index: number, offset: number, result: Token[]) => {
    if (solutions.length > 1) return;
    if (index === parts.length) {
      if (offset === hira.length) solutions.push(result);
      return;
    }
    const surface = parts[index];
    if (!KANJI_REGEX.test(surface)) {
      const literal = katakanaToHiragana(surface);
      if (hira.startsWith(literal, offset)) {
        align(index + 1, offset + literal.length, [...result, { surface, hasKanji: false }]);
      }
      return;
    }
    const nextLiteral = parts[index + 1];
    for (let end = offset + 1; end <= hira.length; end++) {
      if (nextLiteral ? !hira.startsWith(katakanaToHiragana(nextLiteral), end) : end !== hira.length) continue;
      align(index + 1, end, [...result, { surface, ruby: formatRuby(hira.slice(offset, end), rubyType), hasKanji: true,
        readingSource: 'automatic', needsReview: Boolean(alternatives?.length) }]);
    }
  };
  align(0, 0, []);
  if (solutions.length !== 1) {
    return withWord([{ surface: phrase, ruby: formatRuby(hira, rubyType), hasKanji: true,
      alternatives: alternatives?.map(value => formatRuby(value, rubyType)), readingSource: 'automatic' }]);
  }
  const tokens = solutions[0];
  if (alternatives && tokens.filter(token => token.hasKanji).length === 1) {
    const kanjiIndex = tokens.findIndex(token => token.hasKanji);
    const prefix = katakanaToHiragana(parts.slice(0, kanjiIndex).join(''));
    const suffix = katakanaToHiragana(parts.slice(kanjiIndex + 1).join(''));
    tokens[kanjiIndex].alternatives = alternatives
      .map(value => katakanaToHiragana(value))
      .filter(value => value.startsWith(prefix) && value.endsWith(suffix))
      .map(value => formatRuby(value.slice(prefix.length, suffix ? -suffix.length : undefined), rubyType));
  }
  return withWord(tokens);
}

/**
 * Common IPADIC heteronyms (多音字) whose dictionary entry is easily the wrong
 * reading in a dubbing script. Table-driven on purpose: `reading` is the default
 * and `alternatives` is the candidate set that reaches the review queue
 * (parseCompoundToTokens puts the selected reading first). Entries without
 * alternatives are certain jukujikun and stay out of review.
 */
const HETERONYM_READINGS: Record<string, { reading: string; alternatives?: string[] }> = {
  // 一人/二人 are already resolved as person compounds; kept here so the default
  // also holds when the word reaches disambiguation without the pair check.
  '一人': { reading: 'ひとり' },
  '二人': { reading: 'ふたり' },
  '大人': { reading: 'おとな' },
  '今日': { reading: 'きょう', alternatives: ['きょう', 'こんにち'] },
  '明日': { reading: 'あした', alternatives: ['あした', 'あす'] },
  '昨日': { reading: 'きのう', alternatives: ['きのう', 'さくじつ'] },
  '上手': { reading: 'じょうず', alternatives: ['じょうず', 'うわて'] },
  '下手': { reading: 'へた', alternatives: ['へた', 'したて'] },
  '人気': { reading: 'にんき', alternatives: ['にんき', 'ひとけ'] },
  '生物': { reading: 'せいぶつ', alternatives: ['せいぶつ', 'なまもの'] },
  '色紙': { reading: 'しきし', alternatives: ['しきし', 'いろがみ'] },
  '寒気': { reading: 'さむけ', alternatives: ['さむけ', 'かんき'] },
  '市場': { reading: 'しじょう', alternatives: ['しじょう', 'いちば'] },
  '最中': { reading: 'さいちゅう', alternatives: ['さいちゅう', 'もなか'] },
  '分別': { reading: 'ふんべつ', alternatives: ['ふんべつ', 'ぶんべつ'] },
  '目下': { reading: 'もっか', alternatives: ['もっか', 'めした'] },
  '大家': { reading: 'おおや', alternatives: ['おおや', 'たいか'] },
  '風車': { reading: 'ふうしゃ', alternatives: ['ふうしゃ', 'かざぐるま'] },
  '心中': { reading: 'しんじゅう', alternatives: ['しんじゅう', 'しんちゅう'] },
  '日本': { reading: 'にほん', alternatives: ['にほん', 'にっぽん'] },
  // Usually split as 何 + 時 / 何 + で by IPADIC; kept for dictionaries that fuse them.
  '何時': { reading: 'なんじ', alternatives: ['なんじ', 'いつ'] },
  '何で': { reading: 'なんで', alternatives: ['なんで', 'なにで'] },
};

/** 何時/時 + one of these is the pronoun いつ, not the counter reading なんじ. */
const ITSU_FOLLOWER = /^(も|でも|から|まで|か|だろう|頃)/;

/**
 * 何で + one of these is the interrogative "why" (なん + で = なんで); 何で +
 * anything else (何で書いた, 何で食べた) is instrumental (なに + で = なにで).
 */
const NANDE_FOLLOWER = /^(来|行|帰|泣|笑|遅|怒|死|起|寝|呼|言|思|知)/;

/** 何 + 時 + も/から/まで is the pronoun いつ, not the counter なんじ. */
function findItsuCompound(tokens: KuromojiToken[], index: number): { length: number; surface: string; reading: string } | null {
  if (tokens[index]?.surface_form !== '何' || tokens[index + 1]?.surface_form !== '時') return null;
  return ITSU_FOLLOWER.test(tokens[index + 2]?.surface_form || '') ? { length: 2, surface: '何時', reading: 'いつ' } : null;
}

/**
 * Contextual Disambiguation Engine (前後文上下文消歧引擎)
 * Analyzes surrounding tokens, grammatical markers, and sentence semantics to pick the correct reading for Japanese heteronyms.
 */
export function disambiguateToken(
  kt: KuromojiToken,
  i: number,
  allTokens: KuromojiToken[],
  fullSentence: string
): { reading: string; alternatives?: string[] } {
  const surface = kt.surface_form;
  let reading = kt.reading ? katakanaToHiragana(kt.reading) : (KANJI_READINGS[surface] || '');
  let alternatives: string[] | undefined;

  const prevToken = i > 0 ? allTokens[i - 1] : null;
  const nextToken = i < allTokens.length - 1 ? allTokens[i + 1] : null;
  const followingTokens = (count: number) =>
    allTokens.slice(i + 1, i + 1 + count).map(token => token.surface_form).join('');

  // 1. 辛い (からい vs つらい)
  if (surface === '辛い') {
    const foodKeywords = /味|料理|食べ|辛い物|塩|ラーメン|甘い|カレー|辛口|唐辛子|麻婆|激辛|舌|酒|スープ|飯|鍋|うどん|肉|野菜|わさび|唐揚げ/;
    const painKeywords = /日々|思い|経験|現実|練習|別れ|人生|仕事|悲しい|泣く|耐える|苦しい|胸が|失恋|孤独|切ない|苦痛/;

    // Restrict evidence to this clause. A food word in another clause must not
    // override a separate occurrence describing emotional pain.
    const boundary = (token: KuromojiToken) => /[、。，,.!?！？;；]/u.test(token.surface_form) ||
      (token.pos_detail_1 === '接続助詞' && /^(が|けど|けれど|けれども|のに|ても|でも)$/.test(token.surface_form));
    const evidence = (isBoundary: (token: KuromojiToken) => boolean) => {
      let start = i;
      let end = i + 1;
      while (start > 0 && !isBoundary(allTokens[start - 1])) start--;
      while (end < allTokens.length && !isBoundary(allTokens[end])) end++;
      const context = allTokens.slice(start, end).filter((_, index) => start + index !== i).map(token => token.surface_form).join('');
      return { food: foodKeywords.test(context), pain: painKeywords.test(context) };
    };
    const clause = evidence(boundary);
    // A bare predicate clause (このラーメン、辛い？) takes its topic from the rest of the sentence.
    const { food, pain } = clause.food || clause.pain ? clause : evidence(token => /[。.!?！？]/u.test(token.surface_form));
    if (food && !pain) reading = 'からい';
    if (pain && !food) reading = 'つらい';
    // Conflicting or absent evidence keeps the dictionary reading and both choices.
    alternatives = [reading, reading === 'つらい' ? 'からい' : 'つらい'];
  }

  // 2. 何 (なん vs なに)
  else if (surface === '何') {
    const nextSurface = nextToken ? nextToken.surface_form : '';
    const afterNext = allTokens[i + 2]?.surface_form || '';
    // The dictionary tags 何 as a numeral before any counter suffix (何歳, 何杯, 何軒).
    // ...but not before a particle: 何で書いた is なにで (with what), whatever the tag says.
    const isCounter = (kt.pos_detail_1 === '数' && !/^助(動)?詞$/.test(nextToken?.pos ?? '')) ||
      /^(人|日|回|度|番|年|時|分|秒|個|本|枚|匹|冊|通|台|階|体|点|色|曲|週|歳|種類)/.test(nextSurface);
    // 何で splits into 何 + で: なん + で (なんで "why") in 何でも and before motion
    // verbs, なに + で (なにで "with what") before other verbs (何で書いた).
    // The alternatives on 何 carry both outcome readings, so the review entry for
    // the following で stays coherent.
    const nande = nextSurface === 'で' && (/^も/.test(afterNext) || NANDE_FOLLOWER.test(afterNext));
    // なん before です/だ/の/と/て (何ですか, 何の本, 何と言った) and the counters above.
    const isNanFollower = nande || /^(だ|です|である|だった|だろう|の|と|て)/.test(nextSurface);

    if (isCounter || isNanFollower) {
      reading = 'なん';
      alternatives = ['なん', 'なに'];
    } else {
      reading = 'なに';
      alternatives = ['なに', 'なん'];
    }
  }

  // 3. 角 (かど vs つの vs かく)
  else if (surface === '角') {
    let localContext = '';
    for (let j = Math.max(0, i - 2); j <= Math.min(allTokens.length - 1, i + 2); j++) {
      if (allTokens[j]) localContext += allTokens[j].surface_form;
    }
    const streetKeywords = /曲が|交差点|通り|道|街|右|左/;
    const animalKeywords = /牛|鹿|羊|動物|鬼|生える|折れる/;
    const mathKeywords = /角度|直角|四角|三角|方角|対角|多角/;

    if (streetKeywords.test(localContext)) {
      reading = 'かど';
      alternatives = ['かど', 'つの', 'かく'];
    } else if (animalKeywords.test(localContext)) {
      reading = 'つの';
      alternatives = ['つの', 'かど', 'かく'];
    } else if (mathKeywords.test(localContext)) {
      reading = 'かく';
      alternatives = ['かく', 'かど', 'つの'];
    } else {
      reading = 'かど';
      alternatives = ['かど', 'つの', 'かく'];
    }
  }

  // 4. 風 (ふう vs かぜ)
  else if (surface === '風') {
    const prevSurface = prevToken ? prevToken.surface_form : '';
    const nextSurface = nextToken ? nextToken.surface_form : '';
    const manner = /^(こんな|そんな|あんな|どんな)$/.test(prevSurface) && /^(に|な|だ|です|の)$/.test(nextSurface);
    const styleSuffix = kt.pos_detail_1 === '接尾' && /^(和|洋|欧|現代|昔|南国)$/.test(prevSurface);
    if (manner || styleSuffix) reading = 'ふう';
    // この/その/あの and ordinary particles also occur with literal wind.
    reading = reading || 'かぜ';
    alternatives = [reading, reading === 'ふう' ? 'かぜ' : 'ふう'];
  }

  // 5. 方 (かた vs ほう)
  else if (surface === '方') {
    const prevSurface = prevToken ? prevToken.surface_form : '';
    const isVerbStem = prevToken && prevToken.pos === '動詞' && prevToken.conjugated_form && prevToken.conjugated_form.includes('連用形');
    const isHonorific = /^(あの|この|その|どなた)$/.test(prevSurface);

    if (isVerbStem || isHonorific || /^(読み|書き|話し|使い方|考え|教え|行き|作り)$/.test(prevSurface)) {
      reading = 'かた';
      alternatives = ['かた', 'ほう'];
    } else {
      reading = 'ほう';
      alternatives = ['ほう', 'かた'];
    }
  }

  // 6. 一日 (いちにち vs ついたち)
  else if (surface === '一日') {
    const nextSurface = nextToken ? nextToken.surface_form : '';
    if (nextSurface === '中' || fullSentence.includes('一日中') || fullSentence.includes('一日で')) {
      reading = 'いちにち';
      alternatives = ['いちにち', 'ついたち'];
    } else if (nextSurface === 'は' || /月一日/.test(fullSentence)) {
      reading = 'ついたち';
      alternatives = ['ついたち', 'いちにち'];
    } else {
      reading = 'いちにち';
      alternatives = ['いちにち', 'ついたち'];
    }
  }

  // 7. 行く (いく vs ゆく) / 行う (おこなう)
  else if (surface === '行っ') {
    const before = allTokens.slice(Math.max(0, i - 3), i).map(token => token.surface_form).join('');
    const after = allTokens.slice(i + 1, i + 5).map(token => token.surface_form).join('');
    const motion = /(?:に|へ|どこ|出て)$/.test(before) || /^て(?:おいで|来|き|くる)/.test(after);
    const eventObject = /を$/.test(before);
    if (motion && !eventObject) reading = 'いっ';
    alternatives = [reading, reading === 'いっ' ? 'おこなっ' : 'いっ'];
  }
  else if (surface === '行く') {
    reading = 'いく';
    alternatives = ['いく', 'ゆく'];
  } else if (surface === '行う' || surface === '行なう') {
    reading = 'おこなう';
    alternatives = ['おこなう'];
  }

  // 8. 人 (じん vs にん vs ひと) when isolated
  else if (surface === '人') {
    if (prevToken && (prevToken.pos === '名詞' || prevToken.surface_form.endsWith('国') || prevToken.surface_form === '日本')) {
      reading = reading || 'じん';
      alternatives = ['じん', 'にん', 'ひと'];
    } else {
      reading = reading || 'ひと';
      alternatives = ['ひと', 'にん', 'じん'];
    }
  }

  // 9. Common IPADIC heteronyms: table default, refined by a few set phrases.
  else if (HETERONYM_READINGS[surface]) {
    reading = HETERONYM_READINGS[surface].reading;
    alternatives = HETERONYM_READINGS[surface].alternatives;
    // 今日: こんにち in set phrases (今日的, 今日では, 今日までは, 今日の世界).
    // 今日は。 is the greeting, so the reading stays ambiguous there.
    if (surface === '今日' && /^(は[。」！？!?]|の(世界|日本(?![語人]))|的|では|までは)/.test(followingTokens(2))) {
      reading = 'こんにち';
      alternatives = ['きょう', 'こんにち'];
    }
    // 人気のない / 人気がない "no sign of people" reads ひとけ, not にんき (popularity).
    // 人気がある/人気のある stays にんき: it only ever means "popular".
    if (surface === '人気' && /^(の|が)(ない|無い|ありません)/.test(followingTokens(2))) {
      reading = 'ひとけ';
      alternatives = ['ひとけ', 'にんき'];
    }
    // A fused 何時 also covers the いつ pronunciation (何時も = いつも).
    if (surface === '何時' && ITSU_FOLLOWER.test(followingTokens(1))) {
      reading = 'いつ';
      alternatives = ['いつ', 'なんじ'];
    }
    // A fused 何で splits in practice (何 + で); keep both readings when it does not.
    // IPADIC fuses it as an adverb (ナンデ), so the same follower test as the split form decides.
    if (surface === '何で') {
      reading = NANDE_FOLLOWER.test(followingTokens(1)) ? 'なんで' : 'なにで';
      alternatives = ['なんで', 'なにで'];
    }
  }

  // 10. 時 split off after 何 is the counter じ (何時 = なんじ), not とき.
  else if (surface === '時' && prevToken?.surface_form === '何') {
    reading = 'じ';
    alternatives = ['じ', 'とき'];
  }

  return { reading, alternatives };
}

/**
 * Tokenizes Japanese text line into tokens with Kanji readings, keeping original text intact.
 * Context-aware and mora-aligned.
 */
const PERSON_COMPOUNDS: Record<string, string> = {
  '一人': 'ひとり', '二人': 'ふたり', '三人': 'さんにん', '四人': 'よにん',
  '五人': 'ごにん', '六人': 'ろくにん', '七人': 'しちにん', '八人': 'はちにん',
  '九人': 'きゅうにん', '十人': 'じゅうにん', '何人': 'なんにん',
};

function findPersonCompound(tokens: KuromojiToken[], index: number): { length: number; surface: string; reading: string } | null {
  const first = tokens[index]?.surface_form || '';
  const second = tokens[index + 1]?.surface_form || '';
  const surface = `${first}${second}`;
  if (/[0-9０-９一二三四五六七八九十百千万億兆]$/.test(tokens[index - 1]?.surface_form || '')) return null;
  if (PERSON_COMPOUNDS[surface] && tokens[index + 2]?.surface_form !== '称') {
    return { length: 2, surface, reading: PERSON_COMPOUNDS[surface] };
  }
  if (/^[0-9０-９]$/.test(first) && second === '人') {
    const digit = first.normalize('NFKC');
    const readings: Record<string, string> = { '1': 'ひとり', '2': 'ふたり', '3': 'さんにん', '4': 'よにん', '5': 'ごにん', '6': 'ろくにん', '7': 'しちにん', '8': 'はちにん', '9': 'きゅうにん' };
    if (readings[digit]) return { length: 2, surface, reading: readings[digit] };
  }
  return null;
}

export function annotateLine(
  rawLine: string,
  rubyType: RubyType = 'hiragana'
): ScriptLine {
  // A PDF text layer or a paste can carry NUL bytes and broken surrogate halves; kuromoji
  // throws on them (see textSanitize). The tokens are built from the cleaned line, so the
  // reader and exports never show the leftover bytes.
  const content = sanitizeText(rawLine);
  const tokens: Token[] = [];

  // Check for pre-segmented phrases (e.g. 一日中)
  const patternKeys = Object.keys(GRAMMAR_PATTERNS).sort((a, b) => b.length - a.length);

  // 1. If Kuromoji is ready, use it with Contextual Disambiguation
  if (isKuromojiReady()) {
    const tokenizer = getTokenizer();
    const kuromojiTokens = tokenizer.tokenize(content);

    for (let i = 0; i < kuromojiTokens.length; i++) {
      const kt = kuromojiTokens[i];
      // 何時も / 何時から is いつ: the counter path would say なんじ, so fuse the pair.
      const itsuCompound = findItsuCompound(kuromojiTokens, i);
      if (itsuCompound) {
        tokens.push(...parseCompoundToTokens(itsuCompound.surface, itsuCompound.reading, rubyType, ['いつ', 'なんじ'])
          .map(token => ({ ...token, readingSource: 'automatic' as const })));
        i += itsuCompound.length - 1;
        continue;
      }
      const counterCompound = findCounterCompound(kuromojiTokens, i);
      if (counterCompound) {
        // Counter readings are certain, except counts with two common readings (一日), which stay in review.
        const { alternatives } = counterCompound;
        tokens.push(...parseCompoundToTokens(counterCompound.surface, counterCompound.reading, rubyType, alternatives)
          .map(token => ({ ...token, readingSource: 'automatic' as const, ...(alternatives ? {} : { needsReview: false }) })));
        i += counterCompound.length - 1;
        continue;
      }
      const personCompound = findPersonCompound(kuromojiTokens, i);
      if (personCompound) {
        tokens.push(...parseCompoundToTokens(personCompound.surface, personCompound.reading, rubyType)
          .map(token => ({ ...token, readingSource: 'automatic' as const, needsReview: false })));
        i += personCompound.length - 1;
        continue;
      }

      if (!KANJI_REGEX.test(kt.surface_form)) {
        tokens.push({ surface: kt.surface_form, hasKanji: false });
        continue;
      }

      // Check if this token matches a high-priority compound grammar pattern
      let reading = GRAMMAR_PATTERNS[kt.surface_form];
      let alternatives: string[] | undefined;

      if (!reading) {
        const disambiguated = disambiguateToken(kt, i, kuromojiTokens, content);
        reading = disambiguated.reading;
        alternatives = disambiguated.alternatives;
      }

      if (reading) {
        const subTokens = parseCompoundToTokens(kt.surface_form, reading, rubyType, alternatives);
        tokens.push(...subTokens);
      } else {
        tokens.push({ surface: kt.surface_form, hasKanji: true, needsReview: true });
      }
    }
  } else {
    // 2. Fallback regex tokenizer with Context-Aware rules if Kuromoji isn't loaded
    let currentWord = '';

    for (let i = 0; i < content.length; i++) {
      let matched = false;

      // 2a. Check multi-char grammar idioms
      for (const pat of patternKeys) {
        if (content.startsWith(pat, i) && !(PERSON_COMPOUNDS[pat] &&
          (/[0-9０-９一二三四五六七八九十百千万億兆]/.test(content[i - 1] || '') || content[i + pat.length] === '称'))) {
          if (currentWord) {
            tokens.push({ surface: currentWord, hasKanji: KANJI_REGEX.test(currentWord) });
            currentWord = '';
          }
          const subTokens = parseCompoundToTokens(pat, GRAMMAR_PATTERNS[pat], rubyType);
          tokens.push(...subTokens);
          i += pat.length - 1;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // 2b. Check vocabulary dictionary
      for (let len = 6; len >= 2; len--) {
        if (i + len <= content.length) {
          const sub = content.slice(i, i + len);
          if (KANJI_READINGS[sub]) {
            if (currentWord) {
              tokens.push({ surface: currentWord, hasKanji: KANJI_REGEX.test(currentWord) });
              currentWord = '';
            }
            const reading = KANJI_READINGS[sub];
            const subTokens = parseCompoundToTokens(sub, reading, rubyType);
            tokens.push(...subTokens);
            i += len - 1;
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;

      // 2c. Single characters
      const char = content[i];
      if (KANJI_REGEX.test(char)) {
        if (currentWord) {
          tokens.push({ surface: currentWord, hasKanji: KANJI_REGEX.test(currentWord) });
          currentWord = '';
        }

        // Apply contextual rules on single character
        let reading = KANJI_READINGS[char] || '';
        let alternatives: string[] | undefined;

        if (char === '辛' && content.slice(i, i + 2) === '辛い') {
          // Handled by sub check or single
        } else if (char === '何') {
          const nextChar = content[i + 1] || '';
          if (/^(で|だ|で|の|人|時|分|年|回|度|番)/.test(nextChar)) {
            reading = 'なん';
            alternatives = ['なん', 'なに'];
          } else {
            reading = 'なに';
            alternatives = ['なに', 'なん'];
          }
        } else if (char === '角') {
          if (/曲が|道|通り|交差点/.test(content)) {
            reading = 'かど';
            alternatives = ['かど', 'つの', 'かく'];
          } else if (/牛|鹿|羊|動物/.test(content)) {
            reading = 'つの';
            alternatives = ['つの', 'かど', 'かく'];
          }
        }

        if (reading) {
          if (rubyType === 'katakana') {
            reading = reading.replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
          } else if (rubyType === 'romaji') {
            reading = kanaToRomaji(reading);
          }
          tokens.push({ surface: char, ruby: reading, hasKanji: true, readingSource: 'automatic', needsReview: Boolean(alternatives?.length), ...(alternatives ? { alternatives } : {}) });
        } else {
          tokens.push({ surface: char, hasKanji: true, needsReview: true });
        }
      } else {
        currentWord += char;
      }
    }

    if (currentWord) {
      tokens.push({ surface: currentWord, hasKanji: KANJI_REGEX.test(currentWord) });
    }
  }

  return {
    id: Math.random().toString(36).substring(2, 9),
    // The PDF/EPUB exporters read chapter titles from rawText; a stray NUL there is invalid XML.
    rawText: content,
    cleanText: content,
    tokens: tokens.map(token => {
      if (token.hasKanji && !token.ruby) return { ...token, needsReview: true };
      if (!token.word && token.alternatives) {
        const alternatives = [...new Set([token.ruby || '', ...token.alternatives].map(value => formatRuby(value, rubyType)).filter(Boolean))];
        return { ...token, alternatives, needsReview: alternatives.length > 1 };
      }
      return token;
    }),
  };
}

/**
 * Generate SRT format string from script lines
 */
export function generateSRT(lines: ScriptLine[]): string {
  return lines
    .map((line, index) => {
      const startTime = formatSRTTime(index * 4);
      const endTime = formatSRTTime(index * 4 + 3);
      return `${index + 1}\n${startTime} --> ${endTime}\n${line.cleanText}\n`;
    })
    .join('\n');
}

function formatSRTTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${hrs}:${mins}:${secs},000`;
}
