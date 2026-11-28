export const PAGE_NUMBER_RE = /^\s*[-–—―]?\s*[\d０-９]{1,4}\s*[-–—―]?\s*$/u;
export const PARA_START_RE = /^[　「『（]/u;
export const PARA_END_RE = /[。」』！？!?]$/u;

// ASCII lines wrap after words, sentence punctuation, or a closing bracket; CJK lines join directly.
// A trailing hyphen is deliberately absent: it is a word split, not a line break to be spaced.
const ASCII_WORD_END_RE = /[A-Za-z0-9.,!?;:%)}\]"'”’]/;
const ASCII_WORD_START_RE = /[A-Za-z0-9([{"'“‘]/;

export function asciiJoin(previous: string, next: string): string {
  return ASCII_WORD_END_RE.test(previous) && ASCII_WORD_START_RE.test(next) ? ' ' : '';
}

export const HEADING_PATTERN_RE =
  /^(?:第[0-9０-９一二三四五六七八九十百千]+[章話節篇部]|序章|終章|プロローグ|エピローグ|あとがき|後書き|目次|Chapter\b)/;

// Embedded CJK fonts often map glyphs to Kangxi radicals or compatibility ideographs (⼀ ⾒ ⼥) instead of
// the unified ideographs (一 見 女); NFKC folds exactly those back, and only those are touched here.
// The CJK Radicals Supplement (⻑ ⻄ ⻝ …) has no NFKC mapping; this is Unicode's EquivalentUnifiedIdeograph.txt for it.
const SUPPLEMENT_FROM = Array.from('⺁⺂⺃⺄⺅⺆⺇⺈⺉⺊⺋⺌⺍⺎⺏⺐⺑⺒⺓⺔⺕⺖⺗⺘⺙⺛⺜⺝⺞⺟⺠⺡⺢⺣⺤⺥⺦⺧⺨⺩⺪⺫⺬⺭⺮⺯⺰⺱⺲⺳⺴⺵⺶⺷⺸⺹⺺⺻⺼⺽⺾⺿⻀⻁⻂⻃⻄⻅⻆⻇⻈⻉⻊⻋⻌⻍⻎⻏⻐⻑⻒⻓⻔⻕⻖⻗⻘⻙⻚⻛⻜⻝⻞⻟⻠⻡⻢⻣⻤⻥⻦⻧⻨⻩⻪⻫⻬⻭⻮⻯⻰⻱⻲⻳');
const SUPPLEMENT_TO = Array.from('厂乛乚乙亻冂𠘨刀刂卜㔾小小兀尣尢𡯂巳幺彑𫜹忄心扌攵旡日月歺母民氵氺灬爫爫丬牛犭王𤴔目示礻𥫗糹纟罓罒㓁冗𦉫羊𦍌𦍋耂肀聿肉𦥑艹艹艹虎衤覀西见角𧢲讠贝𧾷车辶辶辶邑钅長镸长门𨸏阝雨青韦页风飞食𩙿飠饣𩠐马骨鬼鱼鸟卤麦黄黾斉齐歯齿竜龙龜亀龟');
const VERTICAL_PUNCTUATION_FROM = Array.from('︑︒︓︔︕︖︗︘︙︱︲︵︶︷︸︹︺︻︼︽︾︿﹀﹁﹂﹃﹄﹇﹈');
const VERTICAL_PUNCTUATION_TO = Array.from('、。：；！？〖〗…—―（）｛｝〔〕【】《》〈〉「」『』［］');
const SUPPLEMENT = new Map([
  ...SUPPLEMENT_FROM.map((char, index) => [char, SUPPLEMENT_TO[index]] as const),
  ...VERTICAL_PUNCTUATION_FROM.map((char, index) => [char, VERTICAL_PUNCTUATION_TO[index]] as const),
]);
const RADICALS = /[⺀-⿟豈-﫿︐-︙︰-﹏]/g;

export function foldRadicals(text: string): string {
  return text.replace(RADICALS, char => SUPPLEMENT.get(char) ?? char.normalize('NFKC'));
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Text characters in a line, ignoring whitespace. */
export function glyphLength(text: string): number {
  return Array.from(text.replace(/\s+/g, '')).length;
}

/** The body size of a page: the median of the upper half, so source ruby (about half the body size) cannot pull it down. */
export function bodyGlyphHeight(heights: number[]): number {
  const median = computeMedian(heights);
  if (median <= 0) return median;
  return computeMedian(heights.filter(height => height >= median)) || median;
}

/** Digits (ASCII or full-width) become `#` so "第 3 章 · 12" and "第 3 章 · 13" share a running-head key. */
export function runningHeadKey(text: string): string {
  return text.replace(/[\d０-９]+/g, '#').replace(/\s+/g, '');
}
