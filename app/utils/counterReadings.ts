import type { KuromojiToken } from './kuromojiEngine';

// Small offline pronunciation lexicon for numbers + counters. Morphological
// dictionaries often return イチ + ハツ rather than the spoken イッパツ.
// Index 0 is the multiple-of-ten form, 1-9 follow a digit. A partial row only
// lists the digits the dictionary gets wrong; the others stay with the dictionary.
type Endings = Readonly<Partial<Record<number, string>>>;
const MONTHS_COUNT: Endings = ['じゅっかげつ', 'いっかげつ', 'にかげつ', 'さんかげつ', 'よんかげつ', 'ごかげつ', 'ろっかげつ', 'ななかげつ', 'はっかげつ', 'きゅうかげつ'];
const COUNTERS: Record<string, Endings> = {
  '発': ['じゅっぱつ', 'いっぱつ', 'にはつ', 'さんぱつ', 'よんはつ', 'ごはつ', 'ろっぱつ', 'ななはつ', 'はっぱつ', 'きゅうはつ'],
  '本': ['じゅっぽん', 'いっぽん', 'にほん', 'さんぼん', 'よんほん', 'ごほん', 'ろっぽん', 'ななほん', 'はっぽん', 'きゅうほん'],
  '杯': ['じゅっぱい', 'いっぱい', 'にはい', 'さんばい', 'よんはい', 'ごはい', 'ろっぱい', 'ななはい', 'はっぱい', 'きゅうはい'],
  '匹': ['じゅっぴき', 'いっぴき', 'にひき', 'さんびき', 'よんひき', 'ごひき', 'ろっぴき', 'ななひき', 'はっぴき', 'きゅうひき'],
  '回': ['じゅっかい', 'いっかい', 'にかい', 'さんかい', 'よんかい', 'ごかい', 'ろっかい', 'ななかい', 'はっかい', 'きゅうかい'],
  '個': ['じゅっこ', 'いっこ', 'にこ', 'さんこ', 'よんこ', 'ごこ', 'ろっこ', 'ななこ', 'はっこ', 'きゅうこ'],
  '冊': ['じゅっさつ', 'いっさつ', 'にさつ', 'さんさつ', 'よんさつ', 'ごさつ', 'ろくさつ', 'ななさつ', 'はっさつ', 'きゅうさつ'],
  '階': ['じゅっかい', 'いっかい', 'にかい', 'さんがい', 'よんかい', 'ごかい', 'ろっかい', 'ななかい', 'はっかい', 'きゅうかい'],
  '分': ['じゅっぷん', 'いっぷん', 'にふん', 'さんぷん', 'よんぷん', 'ごふん', 'ろっぷん', 'ななふん', 'はっぷん', 'きゅうふん'],
  '時': { 4: 'よじ', 7: 'しちじ', 9: 'くじ' },
  '日': { 7: 'しちにち', 9: 'くにち' },
  '歳': { 0: 'じゅっさい', 1: 'いっさい', 8: 'はっさい' },
  '週間': { 1: 'いっしゅうかん' },
  '軒': { 1: 'いっけん', 3: 'さんげん', 8: 'はっけん' },
  '歩': { 0: 'じゅっぽ', 1: 'いっぽ', 6: 'ろっぽ', 8: 'はっぽ' },
  '件': { 1: 'いっけん' },
  '点': { 0: 'じゅってん', 1: 'いってん' },
  '着': { 1: 'いっちゃく' },
  '通': { 1: 'いっつう' },
  '頭': { 0: 'じゅっとう', 1: 'いっとう', 8: 'はっとう' },
  '足': { 3: 'さんぞく' },
  '羽': { 0: 'じゅっぱ', 3: 'さんば', 6: 'ろっぱ', 8: 'はっぱ' },
  '泊': ['じゅっぱく', 'いっぱく', 'にはく', 'さんぱく', 'よんはく', 'ごはく', 'ろっぱく', 'ななはく', 'はっぱく', 'きゅうはく'],
  '票': ['じゅっぴょう', 'いっぴょう', 'にひょう', 'さんぴょう', 'よんひょう', 'ごひょう', 'ろっぴょう', 'ななひょう', 'はっぴょう', 'きゅうひょう'],
  '品': ['じゅっぴん', 'いっぴん', 'にひん', 'さんぴん', 'よんひん', 'ごひん', 'ろっぴん', 'ななひん', 'はっぴん', 'きゅうひん'],
  '勝': { 0: 'じゅっしょう', 1: 'いっしょう', 8: 'はっしょう' },
  '敗': { 0: 'じゅっぱい', 1: 'いっぱい', 3: 'さんぱい', 6: 'ろっぱい', 8: 'はっぱい' },
  '周': { 0: 'じゅっしゅう', 1: 'いっしゅう', 8: 'はっしゅう' },
  '章': { 1: 'いっしょう' },
  '巻': { 0: 'じゅっかん', 1: 'いっかん', 6: 'ろっかん', 8: 'はっかん' },
  '曲': { 0: 'じゅっきょく', 1: 'いっきょく', 6: 'ろっきょく', 8: 'はっきょく' },
  '局': { 1: 'いっきょく' },
  '脚': { 0: 'じゅっきゃく', 1: 'いっきゃく', 6: 'ろっきゃく', 8: 'はっきゃく' },
  'ヶ月': MONTHS_COUNT,
  'か月': MONTHS_COUNT,
  'カ月': MONTHS_COUNT,
  'ケ月': MONTHS_COUNT,
  'ヵ月': MONTHS_COUNT,
  '箇月': MONTHS_COUNT,
};
// Zero counts for common counters (0発 remains null to leave unsupported counters untouched).
const ZERO_COUNTER_READINGS: Readonly<Record<string, string>> = {
  '時': 'れいじ',
  '分': 'ぜろふん',
  '回': 'ぜろかい',
  '点': 'ぜろてん',
  '円': 'ぜろえん',
  '人': 'ぜろにん',
  '個': 'ぜろこ',
  '本': 'ぜろほん',
};
// Whole counts whose reading is not built from the digits.
const FIXED_READINGS: Record<string, Readonly<Record<number, string>>> = {
  '歳': { 20: 'はたち' },
  '通り': { 1: 'ひととおり', 2: 'ふたとおり' },
  'つ': {
    1: 'ひとつ', 2: 'ふたつ', 3: 'みっつ', 4: 'よっつ', 5: 'いつつ',
    6: 'むっつ', 7: 'ななつ', 8: 'やっつ', 9: 'ここのつ',
  },
  '月': {
    1: 'いちがつ', 2: 'にがつ', 3: 'さんがつ', 4: 'しがつ', 5: 'ごがつ', 6: 'ろくがつ',
    7: 'しちがつ', 8: 'はちがつ', 9: 'くがつ', 10: 'じゅうがつ', 11: 'じゅういちがつ', 12: 'じゅうにがつ',
  },
  '日': {
    2: 'ふつか', 3: 'みっか', 4: 'よっか', 5: 'いつか', 6: 'むいか', 7: 'なのか', 8: 'ようか', 9: 'ここのか', 10: 'とおか',
    14: 'じゅうよっか', 20: 'はつか', 24: 'にじゅうよっか',
  },
};
// Counts with two common readings: keep the dictionary's first and send the word to review.
const AMBIGUOUS_READINGS: Record<string, Readonly<Record<number, readonly string[]>>> = {
  '日': { 1: ['いちにち', 'ついたち'] },
};
// The dictionary fuses some counters with the following morpheme (四 + 時半, 三 + 日間).
const FUSED_COUNTERS: Record<string, { counter: string; tail: string }> = {
  '時半': { counter: '時', tail: 'はん' },
  '時間': { counter: '時', tail: 'かん' },
  '日間': { counter: '日', tail: 'かん' },
};
// Round hundreds geminate (ひゃっぽん) and round thousands take these endings (せんぼん);
// counters missing here leave round hundreds and thousands to the dictionary.
const THOUSAND_ENDINGS: Record<string, string> = {
  '発': 'ぱつ', '本': 'ぼん', '杯': 'ばい', '匹': 'びき', '回': 'かい',
  '個': 'こ', '冊': 'さつ', '階': 'がい', '分': 'ぷん',
  '泊': 'はく', '票': 'ひょう', '品': 'ひん',
  'ヶ月': 'かげつ', 'か月': 'かげつ', 'カ月': 'かげつ', 'ケ月': 'かげつ', 'ヵ月': 'かげつ', '箇月': 'かげつ',
};
const DIGITS = ['ぜろ', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
const KANJI_DIGITS = '〇一二三四五六七八九';
const NUMBER_CHAR = /^[0-9０-９〇零一二三四五六七八九十百千万億兆]+$/u;

function parseNumber(surface: string): number | null {
  const normalized = surface.normalize('NFKC');
  if (/^[1-9][0-9]{0,3}$/.test(normalized)) return Number(normalized);
  // Canonical unit notation, up to 9999; leave digit strings and larger values
  // to the dictionary instead of partially repairing the end of a number.
  const match = normalized.match(/^(?:([一二三四五六七八九]?)千)?(?:([一二三四五六七八九]?)百)?(?:([一二三四五六七八九]?)十)?([一二三四五六七八九])?$/u);
  if (!match || !normalized) return null;
  return [1000, 100, 10, 1].reduce((value, unit, index) => {
    const digit = match[index + 1];
    if (digit === undefined) return value;
    return value + (digit === '' ? 1 : KANJI_DIGITS.indexOf(digit)) * unit;
  }, 0) || null;
}

export function counterReading(number: string, counter: string): string | null {
  const fused = FUSED_COUNTERS[counter];
  if (fused) {
    const reading = counterReading(number, fused.counter);
    return reading && reading + fused.tail;
  }
  const normalizedZero = number.normalize('NFKC');
  if (normalizedZero === '0' || normalizedZero === '〇' || normalizedZero === '零') {
    return ZERO_COUNTER_READINGS[counter] ?? null;
  }
  const value = parseNumber(number);
  if (value === null) return null;
  if (counter === '人') {
    if (value === 1) return 'ひとり';
    if (value === 2) return 'ふたり';
    const thousands = Math.floor(value / 1000);
    const hundreds = Math.floor((value % 1000) / 100);
    const tens = Math.floor((value % 100) / 10);
    const units = value % 10;
    const tStr = thousands === 0 ? '' : thousands === 1 ? 'せん' :
      thousands === 3 ? 'さんぜん' : thousands === 8 ? 'はっせん' : DIGITS[thousands] + 'せん';
    const hStr = hundreds === 0 ? '' : hundreds === 1 ? 'ひゃく' :
      hundreds === 3 ? 'さんびゃく' : hundreds === 6 ? 'ろっぴゃく' :
      hundreds === 8 ? 'はっぴゃく' : DIGITS[hundreds] + 'ひゃく';
    const tenStr = tens === 0 ? '' : (tens === 1 ? '' : DIGITS[tens]) + 'じゅう';
    const unitStr = units === 0 ? '' : units === 4 ? 'よ' : units === 7 ? 'しち' : units === 9 ? 'きゅう' : DIGITS[units];
    return tStr + hStr + tenStr + unitStr + 'にん';
  }
  const fixed = FIXED_READINGS[counter]?.[value];
  if (fixed) return fixed;
  const endings = COUNTERS[counter];
  if (!endings) return null;
  const thousands = Math.floor(value / 1000);
  const hundreds = Math.floor(value % 1000 / 100);
  const remainder = value % 100;
  const thousandReading = thousands === 0 ? '' : thousands === 1 ? 'せん' :
    thousands === 3 ? 'さんぜん' : thousands === 8 ? 'はっせん' : DIGITS[thousands] + 'せん';
  const hundredReading = hundreds === 0 ? '' : hundreds === 1 ? 'ひゃく' :
    hundreds === 3 ? 'さんびゃく' : hundreds === 6 ? 'ろっぴゃく' :
    hundreds === 8 ? 'はっぴゃく' : DIGITS[hundreds] + 'ひゃく';
  const prefix = thousandReading + hundredReading;
  if (remainder > 0) {
    const tens = Math.floor(remainder / 10);
    const units = remainder % 10;
    const ending = endings[units];
    if (!ending) return null;
    const tensReading = tens === 0 ? '' : (tens === 1 ? '' : DIGITS[tens]) + (units === 0 ? '' : 'じゅう');
    return prefix + tensReading + ending;
  }
  const thousandEnding = THOUSAND_ENDINGS[counter];
  const one = endings[1];
  if (!thousandEnding || !one) return null;
  if (hundreds > 0) {
    if (counter === '冊') return prefix + 'さつ';
    return prefix.slice(0, -1) + 'っ' + one.slice(2);
  }
  return prefix + thousandEnding;
}

export interface CounterCompound {
  length: number;
  surface: string;
  reading: string;
  /** Present only when the count has more than one common reading. */
  alternatives?: string[];
}

export function findCounterCompound(tokens: KuromojiToken[], index: number): CounterCompound | null {
  // Never repair just the tail of a larger number or an identifier.
  if (NUMBER_CHAR.test(tokens[index - 1]?.surface_form || '')) return null;
  if (tokens[index]?.surface_form === '何') {
    // 何 takes the same sound change as 三: なんぼん, なんばい, なんがい, なんげん.
    const counter = tokens[index + 1];
    const three = counter && COUNTERS[counter.surface_form]?.[3];
    if (tokens[index].pos_detail_1 !== '数' || counter?.pos_detail_1 !== '接尾' || !three) return null;
    return { length: 2, surface: '何' + counter.surface_form, reading: 'なん' + three.slice(2) };
  }
  let number = '';
  let end = index;
  while (end < tokens.length && NUMBER_CHAR.test(tokens[end].surface_form)) {
    if (tokens[end].pos_detail_1 !== '数') return null;
    number += tokens[end].surface_form;
    end++;
  }
  if (end === index || !tokens[end]) return null;
  const counter = tokens[end].surface_form;
  // Check POS as well as surface: 本 can be a book noun outside a count (月 is 名詞-一般).
  if (tokens[end].pos_detail_1 !== '接尾' && counter !== '月' && counter !== 'つ') return null;
  if (counter === '人' && tokens[end + 1]?.surface_form === '称') return null;
  const length = end - index + 1;
  const value = parseNumber(number);
  const choices = value === null ? undefined : AMBIGUOUS_READINGS[counter]?.[value];
  const reading = choices?.[0] ?? counterReading(number, counter);
  if (!reading) return null;
  if ((counter === '日' || counter === '時間' || counter === '週間') &&
      tokens[end + 1]?.surface_form === '中' && tokens[end + 1].pos_detail_1 === '接尾') {
    return { length: length + 1, surface: number + counter + '中', reading: reading + 'じゅう' };
  }
  return choices
    ? { length, surface: number + counter, reading, alternatives: [...choices] }
    : { length, surface: number + counter, reading };
}
