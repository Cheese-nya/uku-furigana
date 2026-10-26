// app/utils/epubExporter.ts
/**
 * Generate a valid EPUB 3 (.epub) file with horizontal writing and native HTML <ruby> annotations.
 */

import JSZip from 'jszip';
import type { ScriptLine } from './furigana';
import { cleanScriptTitle } from './docxImporter';
import { extractChapters, type BookChapter } from './libraryDatabase';

export interface EpubExportOptions {
  title?: string;
  baseFontSize?: number;
  rubyFontSize?: number;
  lineSpacing?: number;
}

function escapeXml(value: string): string {
  return value
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

function renderLineHtml(line: ScriptLine): string {
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

  return `<p>${parts.join('')}</p>`;
}

function buildChapterXhtml(chapter: BookChapter, chapterLines: ScriptLine[]): string {
  const safeTitle = escapeXml(chapter.title);
  const paragraphs = chapterLines.map(renderLineHtml).join('\n    ');

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

/**
 * Build an EPUB 3 Blob with horizontal layout and <ruby> furigana annotations.
 */
export async function buildEpubBlob(
  lines: ScriptLine[],
  opts?: EpubExportOptions
): Promise<Blob> {
  const title = cleanScriptTitle(opts?.title || '') || '日语假名配音台本';
  const baseFontSize = opts?.baseFontSize ?? 16;
  const rubyFontSize = opts?.rubyFontSize ?? 10;
  const lineSpacing = opts?.lineSpacing ?? 1.8;

  const rawJoined = lines.map((l) => l.rawText).join('\n');
  const chapters: BookChapter[] = extractChapters(rawJoined, title);

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
}
rt {
  font-size: ${rubyFontSize}px;
  color: #2563eb;
}
`;
  zip.file('OEBPS/style.css', styleCss);

  // 4. Chapter XHTML files
  const manifestItems: string[] = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="style" href="style.css" media-type="text/css"/>',
  ];
  const spineItems: string[] = [];
  const navItems: string[] = [];

  chapters.forEach((chapter, idx) => {
    const fileName = chapterFileName(idx);
    const itemId = `chapter-${String(idx + 1).padStart(3, '0')}`;
    const chapterLines =
      lines.length > 0 ? lines.slice(chapter.startLine, chapter.endLine + 1) : [];

    const xhtml = buildChapterXhtml(chapter, chapterLines);
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
  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="book-id" xml:lang="ja">
  <metadata>
    <dc:identifier id="book-id">urn:uuid:${bookUuid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>ja</dc:language>
    <meta property="dcterms:modified">${modifiedIso}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', contentOpf);

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
  });
}
