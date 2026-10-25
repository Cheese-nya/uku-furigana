import JSZip from 'jszip';

export type CompactEntry = [
  term: string,
  reading: string,
  tags: string[],
  glosses: string[],
  examples: [string, string][],
  score: number,
];

const POS_LABELS: Record<string, string> = {
  n: '名词',
  noun: '名词',
  v: '动词',
  verb: '动词',
  adj: '形容词',
  adjective: '形容词',
  adj_noun: '形容动词',
  'adj-na': '形容动词',
  adv: '副词',
  adverb: '副词',
  ichidan: '一段',
  v1: '一段',
  godan: '五段',
  v5: '五段',
  vt: '他动',
  'transitive verb': '他动',
  vi: '自动',
  'intransitive verb': '自动',
  suru: 'サ变',
  vs: 'サ变',
  phrase: '惯用语',
  expression: '惯用语',
  exp: '惯用语',
  name: '专名',
  'prop-n': '专名',
  'proper noun': '专名',
  particle: '助词',
  ptcl: '助词',
  conj: '接续词',
  conjunction: '接续词',
  intj: '感叹词',
  interjection: '感叹词',
  pron: '代词',
  pronoun: '代词',
  suffix: '后缀',
  suf: '后缀',
  prefix: '前缀',
  pref: '前缀',
  num: '数词',
  numeral: '数词',
  counter: '量词',
};

const BLOCK_TAGS = new Set(['div', 'li', 'p', 'ol', 'ul']);

type StructuredNode = {
  tag?: string;
  content?: unknown;
  data?: Record<string, unknown>;
  lang?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDataContent(node: StructuredNode): string {
  const raw = node.data?.content;
  return typeof raw === 'string' ? raw : '';
}

function isExcludedFromGloss(node: StructuredNode): boolean {
  const dc = getDataContent(node);
  if (!dc) return false;
  return (
    dc.startsWith('details-entry') ||
    dc === 'extra-info' ||
    dc === 'preamble' ||
    dc === 'backlink' ||
    dc === 'attribution'
  );
}

function renderNodeText(node: unknown, excludeDetails: boolean): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    return node.map((child) => renderNodeText(child, excludeDetails)).join('');
  }
  if (!isRecord(node)) return '';
  const sc = node as StructuredNode;
  if (excludeDetails && isExcludedFromGloss(sc)) return '';
  const tag = typeof sc.tag === 'string' ? sc.tag.toLowerCase() : '';
  if (tag === 'br') return '\n';
  const inner = renderNodeText(sc.content, excludeDetails);
  if (BLOCK_TAGS.has(tag)) {
    return inner.endsWith('\n') ? inner : `${inner}\n`;
  }
  return inner;
}

function cleanGlossText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findNodes(
  node: unknown,
  predicate: (n: StructuredNode) => boolean,
  out: StructuredNode[] = [],
): StructuredNode[] {
  if (Array.isArray(node)) {
    for (const child of node) findNodes(child, predicate, out);
    return out;
  }
  if (!isRecord(node)) return out;
  const sc = node as StructuredNode;
  if (predicate(sc)) out.push(sc);
  if (sc.content !== undefined) findNodes(sc.content, predicate, out);
  return out;
}

function collectDirectLiChildren(content: unknown, out: StructuredNode[] = []): StructuredNode[] {
  if (Array.isArray(content)) {
    for (const item of content) collectDirectLiChildren(item, out);
    return out;
  }
  if (!isRecord(content)) return out;
  const sc = content as StructuredNode;
  if (typeof sc.tag === 'string' && sc.tag.toLowerCase() === 'li') {
    out.push(sc);
  } else if (sc.content !== undefined) {
    collectDirectLiChildren(sc.content, out);
  }
  return out;
}

function extractExampleFromSentenceNode(node: StructuredNode): [string, string] | null {
  const partA = findNodes(node.content, (n) => getDataContent(n) === 'example-sentence-a');
  const partB = findNodes(node.content, (n) => getDataContent(n) === 'example-sentence-b');
  const partC = findNodes(node.content, (n) => getDataContent(n) === 'example-sentence-c');

  if (partA.length > 0 || partB.length > 0 || partC.length > 0) {
    if (partA.length === 0 || partB.length === 0) return null;
    const ja = cleanGlossText(renderNodeText(partA[0].content, false));
    const zh = cleanGlossText(renderNodeText(partB[0].content, false));
    return ja && zh ? [ja, zh] : null;
  }

  // Fallback for synthetic example-sentence nodes without -a/-b markers
  const children = Array.isArray(node.content) ? node.content : [node.content];
  const texts = children
    .map((c) => cleanGlossText(renderNodeText(c, false)))
    .filter(Boolean);
  if (texts.length >= 2) {
    return [texts[0], texts[1]];
  }
  if (texts.length === 1 && texts[0].includes('\n')) {
    const lines = texts[0].split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) return [lines[0], lines[1]];
  }
  return null;
}

function extractExamplesFromTree(root: unknown): [string, string][] {
  const examples: [string, string][] = [];
  const sentenceNodes = findNodes(root, (n) => getDataContent(n) === 'example-sentence');
  if (sentenceNodes.length > 0) {
    for (const sNode of sentenceNodes) {
      const pair = extractExampleFromSentenceNode(sNode);
      if (pair) examples.push(pair);
    }
    return examples;
  }

  const exampleDetails = findNodes(root, (n) => getDataContent(n) === 'details-entry-examples');
  for (const dNode of exampleDetails) {
    const children = Array.isArray(dNode.content) ? dNode.content : [dNode.content];
    const nonSummary = children.filter(
      (c) => !(isRecord(c) && (c.tag === 'summary' || getDataContent(c as StructuredNode) === 'summary-entry')),
    );
    for (const item of nonSummary) {
      if (isRecord(item)) {
        const pair = extractExampleFromSentenceNode(item as StructuredNode);
        if (pair) examples.push(pair);
      }
    }
  }
  return examples;
}

function extractEmbeddedPosTags(headerLines: string[]): string[] {
  const tags: string[] = [];
  const add = (t: string) => {
    if (!tags.includes(t)) tags.push(t);
  };
  for (const line of headerLines) {
    if (line.includes('【') && !line.includes('】 ')) continue;
    const cleaned = line.replace(/.*】\s*/, '').trim();
    if (!cleaned || cleaned.length > 16) continue;
    if (/[五一]|下一|上一|カ変|サ変/.test(cleaned)) add('动词');
    if (cleaned.includes('五')) add('五段');
    if (cleaned.includes('一')) add('一段');
    if (cleaned.includes('他')) add('他动');
    if (cleaned.includes('自')) add('自动');
    if (cleaned.includes('サ')) add('サ变');
    if (cleaned.includes('名')) add('名词');
    if (/形[動动]/.test(cleaned)) add('形容动词');
    else if (cleaned.includes('形')) add('形容词');
    if (cleaned.includes('副')) add('副词');
    if (cleaned.includes('感')) add('感叹词');
    if (cleaned.includes('代')) add('代词');
    if (cleaned.includes('接尾')) add('后缀');
    else if (cleaned.includes('接头') || cleaned.includes('接頭')) add('前缀');
    else if (cleaned.includes('接')) add('接续词');
  }
  return tags;
}

function parseTextGlossBlock(
  rawText: string,
  allowExamples: boolean,
): {
  glosses: string[];
  examples: [string, string][];
  extractedReading?: string;
  extractedTags?: string[];
} {
  const cleaned = cleanGlossText(rawText);
  if (!cleaned) return { glosses: [], examples: [] };

  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const firstNumIdx = lines.findIndex((l) => /^1[.．]\s*\S/.test(l));
  if (firstNumIdx === -1 || firstNumIdx > 3) {
    return { glosses: [cleaned], examples: [] };
  }

  let extractedReading: string | undefined;
  let extractedTags: string[] | undefined;
  let hasEmbeddedHeader = false;
  if (firstNumIdx > 0) {
    const headerLines = lines.slice(0, firstNumIdx);
    const looksLikeHeader = headerLines.every((l) => l.includes('【') || l.length <= 24);
    if (!looksLikeHeader) {
      return { glosses: [cleaned], examples: [] };
    }
    hasEmbeddedHeader = true;
    for (const hl of headerLines) {
      const m = hl.match(/【([ぁ-んァ-ヶー・]+)】/);
      if (m) {
        extractedReading = m[1];
        break;
      }
    }
    const posTags = extractEmbeddedPosTags(headerLines);
    if (posTags.length > 0) extractedTags = posTags;
  }

  const items: { gloss: string; subLines: string[] }[] = [];
  for (let i = firstNumIdx; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(\d+)[.．]\s*(.*)$/);
    if (m) {
      const glossBody = m[2].trim();
      if (glossBody) {
        items.push({ gloss: glossBody, subLines: [] });
      }
    } else if (items.length > 0) {
      items[items.length - 1].subLines.push(line);
    }
  }

  if (items.length === 0) {
    return { glosses: [cleaned], examples: [] };
  }

  // If there is no embedded header and non-numbered lines exist, check if they form valid example pairs
  if (!hasEmbeddedHeader && !allowExamples && items.some((it) => it.subLines.length > 0)) {
    return { glosses: [cleaned], examples: [] };
  }

  const glosses: string[] = [];
  const examples: [string, string][] = [];
  for (const item of items) {
    glosses.push(item.gloss);
    if (allowExamples || hasEmbeddedHeader) {
      for (let j = 0; j + 1 < item.subLines.length; j += 2) {
        const ja = item.subLines[j];
        const zh = item.subLines[j + 1];
        if (ja && zh) {
          examples.push([ja, zh]);
        }
      }
    }
  }

  return { glosses, examples, extractedReading, extractedTags };
}

function mapTags(
  definitionTags: string,
  termTags: string,
  tagNames?: Record<string, string>,
): string[] {
  const rawTokens = `${definitionTags} ${termTags}`
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of rawTokens) {
    if (raw === 'non-lemma') continue;
    const note = tagNames?.[raw]?.trim();
    const label = (
      note && note.length <= 24 ? (POS_LABELS[note] ?? note) : (POS_LABELS[raw] ?? raw)
    ).trim();
    if (!label || label.length > 24 || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }

  return out;
}

export function convertTermBank(
  rows: unknown[],
  tagNames?: Record<string, string>,
): CompactEntry[] {
  if (!Array.isArray(rows)) return [];
  const entries: CompactEntry[] = [];

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const term = typeof row[0] === 'string' ? row[0].trim() : '';
    if (!term) continue;
    let reading = typeof row[1] === 'string' ? row[1].trim() : '';
    const defTags = typeof row[2] === 'string' ? row[2] : '';
    const score = typeof row[4] === 'number' && Number.isFinite(row[4]) ? row[4] : 0;

    const isV3 = Array.isArray(row[5]);
    const definitions: unknown[] = isV3 ? (row[5] as unknown[]) : row.slice(5);
    const termTags = isV3 && typeof row[7] === 'string' ? row[7] : '';

    const glosses: string[] = [];
    const examples: [string, string][] = [];
    const fallbackTags: string[] = [];

    const consumeParsed = (parsed: ReturnType<typeof parseTextGlossBlock>) => {
      if (!reading && parsed.extractedReading) reading = parsed.extractedReading;
      if (parsed.extractedTags) {
        for (const t of parsed.extractedTags) {
          if (!fallbackTags.includes(t)) fallbackTags.push(t);
        }
      }
      glosses.push(...parsed.glosses);
      examples.push(...parsed.examples);
    };

    for (const def of definitions) {
      if (typeof def === 'string') {
        consumeParsed(parseTextGlossBlock(def, true));
        continue;
      }

      if (Array.isArray(def) || !isRecord(def)) {
        // v3.2 [deinflectedTerm, ruleChain] or invalid definition: skip
        continue;
      }

      const type = def.type;
      if (type === 'image') continue;

      if (type === 'text') {
        if (typeof def.text === 'string') {
          consumeParsed(parseTextGlossBlock(def.text, true));
        }
        continue;
      }

      const contentRoot = type === 'structured-content' ? def.content : def;
      const glossLists = findNodes(contentRoot, (n) => getDataContent(n) === 'glosses');

      if (glossLists.length > 0) {
        for (const glossList of glossLists) {
          const liNodes = collectDirectLiChildren(glossList.content);
          const targets = liNodes.length > 0 ? liNodes : [glossList];
          for (const li of targets) {
            const liText = cleanGlossText(renderNodeText(li, true));
            if (liText) {
              consumeParsed(parseTextGlossBlock(liText, true));
            }
            examples.push(...extractExamplesFromTree(li));
          }
        }
      } else {
        const fullText = cleanGlossText(renderNodeText(contentRoot, true));
        if (fullText) {
          consumeParsed(parseTextGlossBlock(fullText, true));
        }
        examples.push(...extractExamplesFromTree(contentRoot));
      }
    }

    if (glosses.length === 0) continue;
    const mappedTags = mapTags(defTags, termTags, tagNames);
    const tags = mappedTags.length > 0 ? mappedTags : fallbackTags;
    entries.push([term, reading, tags, glosses, examples, score]);
  }

  return entries;
}

function bankIndex(name: string): number {
  const m = name.match(/_(\d+)\.json$/);
  return m ? Number(m[1]) : 0;
}

export async function readYomitanZip(data: ArrayBuffer): Promise<{
  title: string;
  revision: string;
  attribution: string;
  entries: CompactEntry[];
}> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('不是 Yomitan 词典');
  }

  const indexFile =
    zip.file('index.json') ??
    zip.file(/(?:^|\/)index\.json$/)[0] ??
    null;
  if (!indexFile) {
    throw new Error('不是 Yomitan 词典');
  }

  let indexJson: Record<string, unknown>;
  try {
    indexJson = JSON.parse(await indexFile.async('string')) as Record<string, unknown>;
  } catch {
    throw new Error('不是 Yomitan 词典');
  }

  const format = indexJson.format ?? indexJson.version;
  if (typeof format !== 'number' || format < 1 || format > 3) {
    throw new Error('暂不支持这种词典格式');
  }

  const tagNames: Record<string, string> = {};
  const tagFiles = zip
    .file(/(?:^|\/)tag_bank_\d+\.json$/)
    .sort((a, b) => bankIndex(a.name) - bankIndex(b.name));

  for (const tf of tagFiles) {
    const rows = JSON.parse(await tf.async('string')) as unknown[];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[3] === 'string') {
        const name = row[0].trim();
        const notes = row[3].trim();
        if (name && notes) tagNames[name] = notes;
      }
    }
  }

  const termFiles = zip
    .file(/(?:^|\/)term_bank_\d+\.json$/)
    .sort((a, b) => bankIndex(a.name) - bankIndex(b.name));

  const entries: CompactEntry[] = [];
  for (const tf of termFiles) {
    const rows = JSON.parse(await tf.async('string')) as unknown[];
    entries.push(...convertTermBank(rows, tagNames));
  }

  return {
    title: typeof indexJson.title === 'string' ? indexJson.title : '',
    revision: typeof indexJson.revision === 'string' ? indexJson.revision : '',
    attribution: typeof indexJson.attribution === 'string' ? indexJson.attribution : '',
    entries,
  };
}
