import JSZip from 'jszip';
import { imageLine, type ImportedBook, type ImportedBookImage } from './bookAssets';
import { katakanaToHiragana } from './furigana';
import type { RubyOverride } from './rubyOverrides';
import { sanitizeText } from './textSanitize';

export interface DomParserLike {
  parseFromString(source: string, type: string): Document;
}

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'dt',
  'dd',
  'tr',
  'section',
  'article',
  'figure',
  'figcaption',
  'pre',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'details',
  'summary',
  'caption',
  'address',
  'center',
  'td',
  'th',
  'hr',
]);

/** Fonts are obfuscated (not encrypted) by most editors and stores: the text stays readable. */
const FONT_OBFUSCATION_ALGORITHMS = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
]);

/** Emphasis dots and similar marks that publishers put in <rt>; they are not readings. */
const MARK_ONLY_READING_RE = /^[\s・･﹅﹆●○◎◉▲△▼▽◆◇★☆※＊*•·.。、,､﹏]+$/;

const INLINE_IMAGE_HINT_RE = /gaiji|emoji|glyph|\binline\b/i;
const ALL_BLANK_RE = /^[\u3000\u00A0\s]*$/;

const HEADING_TAGS = new Set(['h1', 'h2', 'h3']);
const SKIP_TAGS = new Set(['script', 'style', 'rt', 'rp', 'head']);

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: '\u00A0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
};

const CJK_CHAR_RE =
  /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3100-\u312F\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u{20000}-\u{2FA1F}]/u;

function isAsciiWs(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

function isCjk(ch: string | undefined): boolean {
  return Boolean(ch && CJK_CHAR_RE.test(ch));
}

function localTag(el: Element): string {
  const raw = el.localName || el.tagName || '';
  const colon = raw.indexOf(':');
  return (colon >= 0 ? raw.slice(colon + 1) : raw).toLowerCase();
}

async function readZipText(file: JSZip.JSZipObject): Promise<string> {
  const source = await file.async('string');
  return sanitizeText(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
}

function safeDecodeURI(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '';
}

function normalizeZipPath(rawPath: string): string {
  const parts = rawPath.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}

function resolveHref(baseDir: string, href: string): { path: string; fragment: string } {
  const hashIdx = href.indexOf('#');
  const rawPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const fragment = hashIdx >= 0 ? safeDecodeURI(href.slice(hashIdx + 1)) : '';
  const decoded = safeDecodeURI(rawPart.trim());
  if (!decoded) {
    return { path: normalizeZipPath(baseDir), fragment };
  }
  const combined = decoded.startsWith('/')
    ? decoded.slice(1)
    : baseDir
      ? `${baseDir}/${decoded}`
      : decoded;
  return { path: normalizeZipPath(combined), fragment };
}

function stripExtension(fileName: string): string {
  const base = fileName.replace(/^.*[/\\]/, '');
  const stripped = base.replace(/\.[^.]+$/, '').trim() || base;
  return /^(?:document|msf|primary|raw|image|video|audio|downloads?):\d+$/i.test(stripped) ? 'Untitled' : stripped;
}

function mimeFromExtension(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'avif':
      return 'image/avif';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'image/jpeg';
  }
}

function replaceHtmlEntities(source: string): string {
  return source.replace(
    /&(nbsp|ensp|emsp|thinsp|hellip|mdash|ndash|lsquo|rsquo|ldquo|rdquo);/g,
    (full, name: string) => NAMED_ENTITIES[name] ?? full,
  );
}

function tryParseDoc(parser: DomParserLike, source: string, mimeType: string): Document | null {
  try {
    const doc = parser.parseFromString(source, mimeType);
    if (!doc || !doc.documentElement) return null;
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    if (localTag(doc.documentElement) === 'parsererror') return null;
    return doc;
  } catch {
    return null;
  }
}

function parseXml(source: string, parser: DomParserLike): Document | null {
  return (
    tryParseDoc(parser, source, 'application/xml') ||
    tryParseDoc(parser, replaceHtmlEntities(source), 'application/xml') ||
    tryParseDoc(parser, replaceHtmlEntities(source), 'text/html')
  );
}

function parseXhtml(source: string, parser: DomParserLike): Document {
  let doc = tryParseDoc(parser, source, 'application/xhtml+xml');
  if (doc) return doc;
  const replaced = replaceHtmlEntities(source);
  doc = tryParseDoc(parser, replaced, 'application/xhtml+xml');
  if (doc) return doc;
  return parser.parseFromString(replaced, 'text/html');
}

function findElements(root: Document | Element, name: string): Element[] {
  const target = name.toLowerCase();
  const all = Array.from(root.getElementsByTagName('*'));
  return all.filter(el => localTag(el) === target);
}

interface RawRuby {
  rawStart: number;
  surface: string;
  reading: string;
}

interface FinalizedTextLine {
  line: string;
  overrides: RubyOverride[];
}

function collapseInlineString(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && isAsciiWs(raw[start])) start += 1;
  while (end > start && isAsciiWs(raw[end - 1])) end -= 1;
  if (start >= end) return '';

  let out = '';
  let i = start;
  while (i < end) {
    if (!isAsciiWs(raw[i])) {
      out += raw[i];
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < end && isAsciiWs(raw[j])) j += 1;
    const prev = out[out.length - 1];
    const next = raw[j];
    if (!(isCjk(prev) && isCjk(next))) {
      out += ' ';
    }
    i = j;
  }
  return out;
}

function finalizeTextLine(rawText: string, rawRubies: RawRuby[]): FinalizedTextLine | null {
  let start = 0;
  let end = rawText.length;
  while (start < end && isAsciiWs(rawText[start])) start += 1;
  while (end > start && isAsciiWs(rawText[end - 1])) end -= 1;
  if (start >= end) return null;
  if (ALL_BLANK_RE.test(rawText)) return null;

  const offsetMap = new Int32Array(rawText.length + 1);
  let out = '';
  let i = start;
  while (i < end) {
    if (!isAsciiWs(rawText[i])) {
      offsetMap[i] = out.length;
      out += rawText[i];
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < end && isAsciiWs(rawText[j])) j += 1;
    for (let k = i; k < j; k += 1) {
      offsetMap[k] = out.length;
    }
    const prev = out[out.length - 1];
    const next = rawText[j];
    if (!(isCjk(prev) && isCjk(next))) {
      out += ' ';
    }
    i = j;
  }
  offsetMap[end] = out.length;

  const overrides: RubyOverride[] = [];
  for (const ruby of rawRubies) {
    if (ruby.rawStart < start || ruby.rawStart >= end) continue;
    const mappedStart = offsetMap[ruby.rawStart];
    overrides.push({
      line: out,
      start: mappedStart,
      surface: ruby.surface,
      reading: ruby.reading,
      type: 'hiragana',
    });
  }
  return { line: out, overrides };
}

function epubType(el: Element): string {
  return (
    el.getAttribute('epub:type') ||
    el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ||
    el.getAttribute('role') ||
    ''
  ).toLowerCase();
}

/** Page-break markers and display:none content are not part of the story text. */
function isHiddenElement(el: Element): boolean {
  if (el.hasAttribute('hidden')) return true;
  if (/display\s*:\s*none/i.test(el.getAttribute('style') || '')) return true;
  return /\bpagebreak\b/.test(epubType(el));
}

/** A declared size small enough to be a glyph (<= 64px or <= 3em) rather than an illustration. */
function isTinySize(el: Element): boolean {
  const small = (raw: string | null) => {
    const m = /^\s*([\d.]+)\s*(px|em|rem|ex|%)?\s*$/i.exec(raw || '');
    if (!m) return false;
    const n = Number(m[1]);
    const unit = (m[2] || 'px').toLowerCase();
    if (unit === '%') return false;
    return unit === 'px' ? n <= 64 : n <= 3;
  };
  const style = el.getAttribute('style') || '';
  const styled = /(?:^|;)\s*(?:width|height)\s*:\s*([^;]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = styled.exec(style))) if (small(m[1])) return true;
  return small(el.getAttribute('width')) || small(el.getAttribute('height'));
}

/**
 * Gaiji / emoji / small icons sit inside a sentence and must not break the paragraph; a real
 * illustration (no such marker) still becomes its own image line.
 */
function isInlineImage(el: Element, src: string): boolean {
  if (INLINE_IMAGE_HINT_RE.test(`${el.getAttribute('class') || ''} ${src}`)) return true;
  return isTinySize(el);
}

/** Visible text without ruby annotations or scripts. */
function ownText(node: Node): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  if (SKIP_TAGS.has(localTag(el)) || isHiddenElement(el)) return '';
  return Array.from(el.childNodes).map(ownText).join('');
}

/**
 * A printed contents page inside the spine: almost all of its text is internal links. Importing it
 * would put the chapter list in front of the story as if it were prose.
 */
function isLinkIndexPage(body: Element): boolean {
  const compact = (value: string) => value.replace(/\s+/g, '');
  const links = findElements(body, 'a').filter(a => {
    const href = (a.getAttribute('href') || '').trim();
    return href && !/^[a-z][a-z0-9+.-]*:/i.test(href);
  });
  if (links.length < 2) return false;
  const headingLen = [...HEADING_TAGS].reduce(
    (sum, tag) => sum + findElements(body, tag).reduce((n, h) => n + compact(ownText(h)).length, 0),
    0,
  );
  const total = compact(ownText(body)).length - headingLen;
  const linked = links.reduce((n, a) => n + compact(ownText(a)).length, 0);
  return total > 0 && linked / total >= 0.8;
}

function extractRubyParts(rubyEl: Element): { base: string; reading: string } {
  let rawBase = '';
  let rawReading = '';

  const walkRuby = (node: Node, inRt: boolean) => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      if (inRt) {
        rawReading += node.nodeValue || '';
      } else {
        rawBase += node.nodeValue || '';
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = localTag(el);
    if (tag === 'rp' || tag === 'script' || tag === 'style') return;
    const nextInRt = inRt || tag === 'rt';
    for (const child of Array.from(el.childNodes)) {
      walkRuby(child, nextInRt);
    }
  };

  for (const child of Array.from(rubyEl.childNodes)) {
    walkRuby(child, false);
  }

  return {
    base: collapseInlineString(rawBase),
    reading: collapseInlineString(rawReading),
  };
}

interface ManifestItem {
  id: string;
  href: string;
  zipPath: string;
  mediaType: string;
  properties: string[];
}

type SpineEntry =
  | { kind: 'text'; line: string; overrides: RubyOverride[]; isHeading: boolean }
  | { kind: 'image'; zipPath: string };

export async function importEpub(
  data: ArrayBuffer,
  fileName: string,
  parser: DomParserLike = new DOMParser(),
): Promise<ImportedBook> {
  const zip = await JSZip.loadAsync(data);

  const encryptionFile = zip.file('META-INF/encryption.xml');
  if (encryptionFile) {
    const encXml = await readZipText(encryptionFile);
    const encDoc = parseXml(encXml, parser);
    const entries = encDoc ? findElements(encDoc, 'EncryptedData') : [];
    const encrypted = encDoc
      ? entries.some(entry => {
          const method = findElements(entry, 'EncryptionMethod')[0];
          return !FONT_OBFUSCATION_ALGORITHMS.has(method?.getAttribute('Algorithm')?.trim() || '');
        })
      : /<(?:\w+:)?EncryptedData\b/i.test(encXml) &&
        ![...FONT_OBFUSCATION_ALGORITHMS].some(algorithm => encXml.includes(algorithm));
    if (encrypted) {
      throw new Error('不支持加密的 EPUB');
    }
  }

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    throw new Error('EPUB 中没有可读的正文');
  }
  const containerDoc = parseXml(await readZipText(containerFile), parser);
  if (!containerDoc) {
    throw new Error('EPUB 中没有可读的正文');
  }
  const rootfileEl = findElements(containerDoc, 'rootfile')[0];
  const opfPath = rootfileEl?.getAttribute('full-path')?.trim() || '';
  if (!opfPath) {
    throw new Error('EPUB 中没有可读的正文');
  }

  const opfFile = zip.file(normalizeZipPath(safeDecodeURI(opfPath))) || zip.file(opfPath);
  if (!opfFile) {
    throw new Error('EPUB 中没有可读的正文');
  }
  const opfDir = dirname(normalizeZipPath(safeDecodeURI(opfPath)));
  const opfDoc = parseXml(await readZipText(opfFile), parser);
  if (!opfDoc) {
    throw new Error('EPUB 中没有可读的正文');
  }

  const fallbackTitle = stripExtension(fileName);
  const titleEl = findElements(opfDoc, 'title').find(el => (el.textContent || '').trim().length > 0);
  const title = titleEl ? collapseInlineString(titleEl.textContent || '') || fallbackTitle : fallbackTitle;

  const creatorEl = findElements(opfDoc, 'creator').find(
    el => (el.textContent || '').trim().length > 0,
  );
  const author = creatorEl ? collapseInlineString(creatorEl.textContent || '') : '';

  const manifestById = new Map<string, ManifestItem>();
  const manifestByPath = new Map<string, ManifestItem>();
  for (const itemEl of findElements(opfDoc, 'item')) {
    const id = itemEl.getAttribute('id') || '';
    const href = itemEl.getAttribute('href') || '';
    if (!id || !href) continue;
    const mediaType = (itemEl.getAttribute('media-type') || '').trim();
    const propsAttr = itemEl.getAttribute('properties') || '';
    const properties = propsAttr.split(/\s+/).filter(Boolean);
    const { path: zipPath } = resolveHref(opfDir, href);
    const item: ManifestItem = { id, href, zipPath, mediaType, properties };
    manifestById.set(id, item);
    if (!manifestByPath.has(zipPath)) {
      manifestByPath.set(zipPath, item);
    }
  }

  let coverItem: ManifestItem | undefined;
  for (const item of manifestById.values()) {
    if (item.properties.includes('cover-image') && item.mediaType.startsWith('image/')) {
      coverItem = item;
      break;
    }
  }
  if (!coverItem) {
    for (const metaEl of findElements(opfDoc, 'meta')) {
      if (metaEl.getAttribute('name')?.toLowerCase() === 'cover') {
        const coverId = metaEl.getAttribute('content')?.trim() || '';
        const candidate = manifestById.get(coverId);
        if (candidate && candidate.mediaType.startsWith('image/')) {
          coverItem = candidate;
          break;
        }
      }
    }
  }

  let cover: { mime: string; data: Uint8Array } | undefined;
  let coverZipPath: string | undefined;
  if (coverItem) {
    const coverZipFile = zip.file(coverItem.zipPath);
    if (coverZipFile) {
      cover = {
        mime: coverItem.mediaType,
        data: await coverZipFile.async('uint8array'),
      };
      coverZipPath = coverItem.zipPath;
    }
  }

  const spineEl = findElements(opfDoc, 'spine')[0];
  const spineItems: ManifestItem[] = [];
  if (spineEl) {
    for (const itemref of findElements(spineEl, 'itemref')) {
      if (itemref.getAttribute('linear')?.toLowerCase() === 'no') continue;
      const idref = itemref.getAttribute('idref') || '';
      const item = manifestById.get(idref);
      if (item) spineItems.push(item);
    }
  }

  const lines: string[] = [];
  const overrides: RubyOverride[] = [];
  const images: ImportedBookImage[] = [];
  const imageIdByPath = new Map<string, string>();
  const fileStartLine = new Map<string, number>();
  const elementStartLine = new Map<string, number>();
  const headingFallbackChapters: { title: string; startLine: number }[] = [];
  let textLineCount = 0;

  for (const spineItem of spineItems) {
    // The generated navigation page only repeats the chapter list; reading it as story text is clutter.
    if (spineItem.properties.includes('nav')) continue;
    const xhtmlFile = zip.file(spineItem.zipPath);
    if (!xhtmlFile) continue;
    const xhtmlSource = await readZipText(xhtmlFile);
    const doc = parseXhtml(xhtmlSource, parser);
    const body = findElements(doc, 'body')[0] || doc.documentElement;
    if (!body) continue;

    const spineDir = dirname(spineItem.zipPath);
    if (isLinkIndexPage(body)) continue;

    const spineEntries: SpineEntry[] = [];
    // Footnote bodies are collected here and appended after the chapter text instead of interrupting it.
    const deferredEntries: SpineEntry[] = [];
    let sink = spineEntries;
    const pendingAnchors: { id: string; entryIndex: number }[] = [];

    let rawLine = '';
    let rawRubies: RawRuby[] = [];
    let headingDepth = 0;

    const flushCurrentLine = () => {
      const finalized = finalizeTextLine(rawLine, rawRubies);
      rawLine = '';
      rawRubies = [];
      if (!finalized) return;
      sink.push({
        kind: 'text',
        line: finalized.line,
        overrides: finalized.overrides,
        isHeading: headingDepth > 0,
      });
    };

    const recordIdIfPresent = (el: Element) => {
      const id = el.getAttribute('id')?.trim() || (localTag(el) === 'a' ? el.getAttribute('name')?.trim() : '');
      if (id && sink === spineEntries) {
        pendingAnchors.push({ id, entryIndex: spineEntries.length });
      }
    };

    const walk = (node: Node) => {
      if (node.nodeType === 3 || node.nodeType === 4) {
        rawLine += node.nodeValue || '';
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node as Element;
      const tag = localTag(el);
      if (SKIP_TAGS.has(tag) || isHiddenElement(el)) return;

      const isBlock = BLOCK_TAGS.has(tag);
      const isHeading = HEADING_TAGS.has(tag);

      if (sink === spineEntries && /\b(?:footnote|endnote|rearnote|doc-footnote|doc-endnote)\b/.test(epubType(el))) {
        flushCurrentLine();
        sink = deferredEntries;
        for (const child of Array.from(el.childNodes)) walk(child);
        flushCurrentLine();
        sink = spineEntries;
        return;
      }

      if (isBlock) {
        flushCurrentLine();
      }

      recordIdIfPresent(el);

      if (tag === 'br') {
        flushCurrentLine();
        return;
      }

      if (tag === 'img' || tag === 'image') {
        const rawSrc =
          tag === 'img'
            ? el.getAttribute('src')
            : el.getAttribute('href') ||
              el.getAttribute('xlink:href') ||
              el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (rawSrc) {
          const { path: imgZipPath } = resolveHref(spineDir, rawSrc);
          if (isInlineImage(el, imgZipPath)) {
            // Keep the sentence in one piece: a gaiji glyph becomes its alt text, or 〓 when it has none.
            const alt = collapseInlineString(el.getAttribute('alt') || '');
            if (alt && alt.length <= 4) rawLine += alt;
            else if (INLINE_IMAGE_HINT_RE.test(el.getAttribute('class') || '')) rawLine += '〓';
          } else if (zip.file(imgZipPath)) {
            flushCurrentLine();
            sink.push({ kind: 'image', zipPath: imgZipPath });
          }
        }
        return;
      }

      if (tag === 'ruby') {
        const { base, reading } = extractRubyParts(el);
        if (base) {
          const hiraReading = katakanaToHiragana(reading);
          if (hiraReading && reading !== base && hiraReading !== base && !MARK_ONLY_READING_RE.test(hiraReading)) {
            rawRubies.push({
              rawStart: rawLine.length,
              surface: base,
              reading: hiraReading,
            });
          }
          rawLine += base;
        }
        return;
      }

      if (isHeading) headingDepth += 1;
      for (const child of Array.from(el.childNodes)) {
        walk(child);
      }
      if (isBlock) {
        flushCurrentLine();
      }
      if (isHeading) headingDepth -= 1;
    };

    recordIdIfPresent(body);
    for (const child of Array.from(body.childNodes)) {
      walk(child);
    }
    flushCurrentLine();
    spineEntries.push(...deferredEntries);

    if (
      coverZipPath &&
      spineEntries.length === 1 &&
      spineEntries[0].kind === 'image' &&
      spineEntries[0].zipPath === coverZipPath
    ) {
      continue;
    }

    if (spineEntries.length === 0) continue;

    const spineStartLine = lines.length;
    fileStartLine.set(spineItem.zipPath, spineStartLine);

    if (spineEntries[0].kind === 'text' && spineEntries[0].isHeading) {
      headingFallbackChapters.push({
        title: spineEntries[0].line,
        startLine: spineStartLine,
      });
    }

    const entryLineIndices: number[] = [];
    for (const entry of spineEntries) {
      entryLineIndices.push(lines.length);
      if (entry.kind === 'text') {
        lines.push(entry.line);
        overrides.push(...entry.overrides);
        textLineCount += 1;
      } else {
        let imgId = imageIdByPath.get(entry.zipPath);
        if (!imgId) {
          const imgZipFile = zip.file(entry.zipPath);
          if (!imgZipFile) continue;
          imgId = `img-${images.length + 1}`;
          imageIdByPath.set(entry.zipPath, imgId);
          const mime =
            manifestByPath.get(entry.zipPath)?.mediaType || mimeFromExtension(entry.zipPath);
          images.push({
            id: imgId,
            mime,
            data: await imgZipFile.async('uint8array'),
          });
        }
        lines.push(imageLine(imgId));
      }
    }

    for (const anchor of pendingAnchors) {
      const key = `${spineItem.zipPath}#${anchor.id}`;
      if (elementStartLine.has(key)) continue;
      if (anchor.entryIndex < entryLineIndices.length) {
        elementStartLine.set(key, entryLineIndices[anchor.entryIndex]);
      }
    }
  }

  if (textLineCount === 0) {
    throw new Error('EPUB 中没有可读的正文');
  }

  const tocTargets = await extractTocTargets(zip, parser, manifestById, spineEl);
  const chapters: { title: string; startLine: number }[] = [];

  if (tocTargets.length > 0) {
    const seenLines = new Set<number>();
    for (const target of tocTargets) {
      const startLine = target.fragment
        ? elementStartLine.get(`${target.zipPath}#${target.fragment}`)
        : fileStartLine.get(target.zipPath);
      if (startLine === undefined || seenLines.has(startLine)) continue;
      seenLines.add(startLine);
      chapters.push({ title: target.title, startLine });
    }
  } else if (headingFallbackChapters.length > 0) {
    const seenLines = new Set<number>();
    for (const ch of headingFallbackChapters) {
      if (seenLines.has(ch.startLine)) continue;
      seenLines.add(ch.startLine);
      chapters.push(ch);
    }
  }

  return {
    title,
    author,
    text: lines.join('\n'),
    overrides,
    chapters,
    images,
    ...(cover ? { cover } : {}),
  };
}

interface TocTarget {
  title: string;
  zipPath: string;
  fragment: string;
}

async function extractTocTargets(
  zip: JSZip,
  parser: DomParserLike,
  manifestById: Map<string, ManifestItem>,
  spineEl: Element | undefined,
): Promise<TocTarget[]> {
  let navItem: ManifestItem | undefined;
  for (const item of manifestById.values()) {
    if (item.properties.includes('nav')) {
      navItem = item;
      break;
    }
  }

  if (navItem) {
    const navFile = zip.file(navItem.zipPath);
    if (navFile) {
      const navDoc = parseXhtml(await readZipText(navFile), parser);
      const navDir = dirname(navItem.zipPath);
      const navEls = findElements(navDoc, 'nav');
      const tocNav =
        navEls.find(el => {
          const epubType =
            el.getAttribute('epub:type') ||
            el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ||
            el.getAttribute('type') ||
            '';
          return epubType.split(/\s+/).includes('toc');
        }) || navEls[0];

      if (tocNav) {
        const targets: TocTarget[] = [];
        for (const aEl of findElements(tocNav, 'a')) {
          const href = aEl.getAttribute('href')?.trim() || '';
          const label = collapseInlineString(aEl.textContent || '');
          if (!href || !label) continue;
          const { path: zipPath, fragment } = resolveHref(navDir, href);
          if (!zipPath) continue;
          targets.push({ title: label, zipPath, fragment });
        }
        if (targets.length > 0) return targets;
      }
    }
  }

  const tocId = spineEl?.getAttribute('toc')?.trim() || '';
  let ncxItem = tocId ? manifestById.get(tocId) : undefined;
  if (!ncxItem) {
    for (const item of manifestById.values()) {
      if (item.mediaType === 'application/x-dtbncx+xml') {
        ncxItem = item;
        break;
      }
    }
  }

  if (ncxItem) {
    const ncxFile = zip.file(ncxItem.zipPath);
    if (ncxFile) {
      const ncxDoc = parseXml(await readZipText(ncxFile), parser);
      if (ncxDoc) {
        const ncxDir = dirname(ncxItem.zipPath);
        const targets: TocTarget[] = [];
        for (const navPoint of findElements(ncxDoc, 'navPoint')) {
          const childEls = Array.from(navPoint.childNodes).filter(
            (n): n is Element => n.nodeType === 1,
          );
          const navLabel = childEls.find(el => localTag(el) === 'navlabel');
          const contentEl = childEls.find(el => localTag(el) === 'content');
          const textEl = navLabel ? findElements(navLabel, 'text')[0] : undefined;
          const label = collapseInlineString(textEl?.textContent || '');
          const src = contentEl?.getAttribute('src')?.trim() || '';
          if (!label || !src) continue;
          const { path: zipPath, fragment } = resolveHref(ncxDir, src);
          if (!zipPath) continue;
          targets.push({ title: label, zipPath, fragment });
        }
        if (targets.length > 0) return targets;
      }
    }
  }

  return [];
}
