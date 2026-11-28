// app/utils/epubExporter.ts
/**
 * Generate a valid EPUB 3 (.epub) file with horizontal writing and native HTML <ruby> annotations.
 */

import JSZip from 'jszip';
import type { ScriptLine } from './furigana';
import { cleanScriptTitle } from './docxImporter';
import { resolveExportCover, type ExportCoverInput } from './exportCover';
import { extractChapters, type BookChapter } from './libraryDatabase';
import { sanitizeText } from './textSanitize';

export interface EpubExportOptions {
  title?: string;
  author?: string;
  baseFontSize?: number;
  rubyFontSize?: number;
  lineSpacing?: number;
  translations?: readonly (string | undefined)[];
  translationLang?: string;
  cover?: ExportCoverInput;
  chapters?: BookChapter[];
}

function escapeXml(value: string): string {
  return sanitizeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const r = (Math.random() * 16) | 0;
    const v = char === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function chapterFileName(index: number): string {
  return `chapter-${String(index + 1).padStart(3, '0')}.xhtml`;
}

function renderLineHtml(line: ScriptLine, translation?: string, translationLang?: string): string {
  const parts: string[] = [];

  if (line.speaker) {
    parts.push(`<span class="speaker">${escapeXml(`${line.speaker}：`)}</span>`);
  }

  for (const token of line.tokens) {
    const surface = escapeXml(token.surface);
    if (token.ruby && !token.annotationSuppressed) {
      parts.push(`<ruby>${surface}<rt>${escapeXml(token.ruby)}</rt></ruby>`);
    } else {
      parts.push(surface);
    }
  }

  if (parts.length === 0) return '<p>&#160;</p>';
  const trans = translation ? translation.replace(/\r\n?/g, '\n').trim() : '';
  if (!trans) return `<p>${parts.join('')}</p>`;

  const langAttr = translationLang
    ? ` xml:lang="${escapeXml(translationLang)}" lang="${escapeXml(translationLang)}"`
    : '';
  return `<div class="bilingual"><p class="line">${parts.join('')}</p><p class="translation"${langAttr}>${escapeXml(trans)}</p></div>`;
}

function buildChapterXhtml(
  chapter: BookChapter,
  chapterLines: ScriptLine[],
  chapterTranslations?: readonly (string | undefined)[],
  translationLang?: string,
): string {
  const safeTitle = escapeXml(chapter.title);
  const paragraphs = chapterLines
    .map((line, index) => renderLineHtml(line, chapterTranslations?.[index], translationLang))
    .join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head>
  <meta charset="UTF-8"/>
  <title>${safeTitle}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <section epub:type="chapter">
    <h2>${safeTitle}</h2>
    ${paragraphs}
  </section>
</body>
</html>`;
}

function resolveExportChapters(
  lines: ScriptLine[],
  title: string,
  provided?: BookChapter[],
): BookChapter[] {
  if (!provided || provided.length === 0 || lines.length === 0) {
    return extractChapters(lines.map((l) => l.rawText).join('\n'), title);
  }
  const normalized: BookChapter[] = [];
  for (let i = 0; i < provided.length; i += 1) {
    const ch = provided[i];
    const startLine = Math.max(0, Math.min(lines.length - 1, ch.startLine));
    const endLine = Math.max(startLine, Math.min(lines.length - 1, ch.endLine));
    normalized.push({
      ...ch,
      id: ch.id || `chapter:${i + 1}`,
      title: sanitizeText(ch.title) || `Chapter ${i + 1}`,
      startLine,
      endLine,
    });
  }
  return normalized.length > 0 ? normalized : extractChapters(lines.map((l) => l.rawText).join('\n'), title);
}

/**
 * Build an EPUB 3 Blob with horizontal layout and <ruby> furigana annotations.
 */
export async function buildEpubBlob(
  lines: ScriptLine[],
  opts?: EpubExportOptions
): Promise<Blob> {
  const title = cleanScriptTitle(opts?.title || '') || '日语假名配音台本';
  const author = sanitizeText(opts?.author || '').trim();
  const baseFontSize = opts?.baseFontSize ?? 16;
  const rubyFontSize = opts?.rubyFontSize ?? 10;
  const lineSpacing = opts?.lineSpacing ?? 1.8;

  const chapters: BookChapter[] = resolveExportChapters(lines, title, opts?.chapters);
  const resolvedCover = await resolveExportCover(opts?.cover);

  const zip = new JSZip();

  // 1. mimetype must be the first entry and uncompressed (STORE)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // 2. META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.file('META-INF/container.xml', containerXml);

  // 3. OEBPS/style.css
  const styleCss = `html, body {
  writing-mode: horizontal-tb;
  font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
  font-size: ${baseFontSize}px;
  line-height: ${lineSpacing};
  color: #1a1a1a;
  margin: 0;
  padding: 1em;
}
h1, h2 {
  line-height: 1.4;
  margin: 0 0 0.8em 0;
}
p {
  margin: 0 0 0.6em 0;
  font-size: ${baseFontSize}px;
  line-height: ${lineSpacing};
}
.speaker {
  font-weight: bold;
  color: #333333;
}
ruby {
  ruby-align: center;
  ruby-position: over;
  -webkit-ruby-position: before;
}
rt {
  font-size: ${rubyFontSize}px;
  color: #2563eb;
  font-weight: 600;
  ruby-align: center;
  text-align: center;
}
.bilingual {
  break-inside: avoid;
  page-break-inside: avoid;
  margin: 0 0 0.75em 0;
}
.bilingual .line {
  margin: 0 0 0.15em 0;
}
.translation {
  margin: 0;
  font-size: ${Math.max(11, Math.round(baseFontSize * 0.88))}px;
  line-height: 1.5;
  color: #555555;
}
`;
  zip.file('OEBPS/style.css', styleCss);

  // 4. Optional cover page + Chapter XHTML files
  const manifestItems: string[] = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="style" href="style.css" media-type="text/css"/>',
  ];
  const spineItems: string[] = [];
  const navItems: string[] = [];

  if (resolvedCover) {
    const ext = resolvedCover.mime === 'image/png' ? 'png' : 'jpg';
    const coverHref = `images/cover.${ext}`;
    zip.file(`OEBPS/${coverHref}`, resolvedCover.data);
    const coverXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <style type="text/css">
    html, body { margin: 0; padding: 0; height: 100%; text-align: center; }
    img { max-width: 100%; max-height: 100%; object-fit: contain; }
  </style>
</head>
<body epub:type="cover">
  <img src="${coverHref}" alt="Cover"/>
</body>
</html>`;
    zip.file('OEBPS/cover.xhtml', coverXhtml);
    manifestItems.push(
      `<item id="cover-image" href="${coverHref}" media-type="${resolvedCover.mime}" properties="cover-image"/>`,
      '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>',
    );
    spineItems.push('<itemref idref="cover"/>');
  }

  chapters.forEach((chapter, idx) => {
    const fileName = chapterFileName(idx);
    const itemId = `chapter-${String(idx + 1).padStart(3, '0')}`;
    const chapterLines =
      lines.length > 0 ? lines.slice(chapter.startLine, chapter.endLine + 1) : [];
    const chapterTranslations =
      lines.length > 0 && opts?.translations
        ? opts.translations.slice(chapter.startLine, chapter.endLine + 1)
        : undefined;

    const xhtml = buildChapterXhtml(chapter, chapterLines, chapterTranslations, opts?.translationLang);
    zip.file(`OEBPS/${fileName}`, xhtml);

    manifestItems.push(
      `<item id="${itemId}" href="${fileName}" media-type="application/xhtml+xml"/>`
    );
    spineItems.push(`<itemref idref="${itemId}"/>`);
    navItems.push(
      `<li><a href="${fileName}">${escapeXml(chapter.title)}</a></li>`
    );
  });

  // 5. OEBPS/nav.xhtml
  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeXml(title)}</h1>
    <ol>
      ${navItems.join('\n      ')}
    </ol>
  </nav>
</body>
</html>`;
  zip.file('OEBPS/nav.xhtml', navXhtml);

  // 6. OEBPS/content.opf
  const bookUuid = generateUuid();
  const modifiedIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const creatorMeta = author ? `\n    <dc:creator>${escapeXml(author)}</dc:creator>` : '';
  const coverMeta = resolvedCover ? `\n    <meta name="cover" content="cover-image"/>` : '';
  const guideXml = resolvedCover
    ? `\n  <guide>\n    <reference type="cover" title="Cover" href="cover.xhtml"/>\n  </guide>`
    : '';
  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="book-id" xml:lang="ja">
  <metadata>
    <dc:identifier id="book-id">urn:uuid:${bookUuid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>${creatorMeta}
    <dc:language>ja</dc:language>
    <meta property="dcterms:modified">${modifiedIso}</meta>${coverMeta}
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>${guideXml}
</package>`;
  zip.file('OEBPS/content.opf', contentOpf);

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
  });
}
