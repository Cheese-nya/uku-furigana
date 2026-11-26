// app/utils/docxExporter.ts
/**
 * 生成真正的 Word (.docx) 文件，含原生 Word Ruby (假名标注在汉字正上方)
 * Uses native OpenXML <w:ruby> elements so MS Word & WPS render furigana directly ABOVE kanji.
 */

import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  Packer,
  XmlComponent,
  Bookmark,
} from 'docx';
import type { ScriptLine } from './furigana';
import { cleanScriptTitle, EXPORT_TITLE_BOOKMARK } from './docxImporter';
import { sanitizeText } from './textSanitize';

class ElementComponent extends XmlComponent {
  constructor(name: string, children: XmlComponent[] = [], value?: string) {
    super(name);
    if (value !== undefined) this.root.push({ _attr: { 'w:val': value } });
    this.root.push(...children);
  }
}

/**
 * OpenXML Native Word Ruby Element (<w:ruby>)
 * Renders Phonetic Guide / Furigana directly ABOVE the base text in Word & WPS.
 */
class RubyElement extends XmlComponent {
  constructor(baseText: string, rubyText: string, baseSize = 24, rubySize = 12) {
    super('w:ruby');

    // w:rubyPr (Properties)
    const rubyPr = new ElementComponent('w:rubyPr', [
      new ElementComponent('w:rubyAlign', [], 'center'),
      new ElementComponent('w:hps', [], String(rubySize)),
      new ElementComponent('w:hpsRaise', [], String(baseSize)),
      new ElementComponent('w:hpsBaseText', [], String(baseSize)),
      new ElementComponent('w:lid', [], 'ja-JP'),
    ]);

    // w:rt (Ruby Text - Furigana positioned directly ABOVE kanji)
    const rtRun = new TextRun({
      text: rubyText,
      size: rubySize,
      color: '2563EB', // Blue furigana on top
      font: 'Yu Gothic',
      language: { eastAsia: 'ja-JP' },
    });
    const rt = new ElementComponent('w:rt', [rtRun]);

    // w:rubyBase (Base Kanji Text)
    const baseRun = new TextRun({
      text: baseText,
      size: baseSize, // 12pt = 小四
      font: 'Yu Gothic',
      color: '1A1A1A',
      language: { eastAsia: 'ja-JP' },
    });
    const rubyBase = new ElementComponent('w:rubyBase', [baseRun]);

    this.root.push(rubyPr, rt, rubyBase);
  }
}

export interface DocxExportOptions {
  title?: string;        // Document title (defaults to text name or '日语假名配音台本')
  baseFontSize?: number; // in px (e.g. 16)
  rubyFontSize?: number; // in px (e.g. 10)
  lineSpacing?: number;  // e.g. 1.8
}

/**
 * Build a real .docx Blob with native Word Ruby annotations (Furigana directly ABOVE Kanji),
 * respecting customizable line spacing and furigana font size options.
 */
export async function buildDocxBlob(lines: ScriptLine[], options?: DocxExportOptions): Promise<Blob> {
  const children: Paragraph[] = [];

  const baseSizeHalfPts = Math.round((options?.baseFontSize || 16) * 1.5);
  const rubySizeHalfPts = Math.round((options?.rubyFontSize || 10) * 1.5);
  const lineSpacingVal = Math.round((options?.lineSpacing || 1.8) * 240);

  const docTitle = sanitizeText(cleanScriptTitle(options?.title || '')) || '日语假名配音台本';

  // Title only — no exporter subtitle or horizontal rule. The bookmark lets
  // importDocx drop the title instead of turning it into a script line.
  children.push(
    new Paragraph({
      children: [
        new Bookmark({
          id: EXPORT_TITLE_BOOKMARK,
          children: [
            new TextRun({
              text: docTitle,
              bold: true,
              size: 36, // 18pt
              font: 'Yu Gothic',
            }),
          ],
        }),
      ],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // Process each script line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const paragraphChildren: TextRun[] = [];

    // Speaker prefix (bold)
    if (line.speaker) {
      paragraphChildren.push(
        new TextRun({
          text: `${sanitizeText(line.speaker)}：`,
          bold: true,
          size: baseSizeHalfPts,
          font: 'Yu Gothic',
          color: '333333',
        })
      );
    }

    // Render tokens with native Word Ruby elements (<w:ruby>)
    for (const token of line.tokens) {
      const surface = sanitizeText(token.surface);
      const ruby = token.ruby ? sanitizeText(token.ruby) : '';
      if (ruby && !token.annotationSuppressed) {
        // Kanji with furigana directly ABOVE it!
        paragraphChildren.push(
          // Ruby is run content in OpenXML; a direct paragraph child is invalid
          // and causes WPS to omit the annotated base text.
          new TextRun({
            children: [new RubyElement(surface, ruby, baseSizeHalfPts, rubySizeHalfPts)],
          })
        );
      } else {
        // Normal text without furigana
        paragraphChildren.push(
          new TextRun({
            text: surface,
            size: baseSizeHalfPts,
            font: 'Yu Gothic',
            color: '1A1A1A',
          })
        );
      }
    }

    children.push(
      new Paragraph({
        children: paragraphChildren,
        spacing: { after: 120, line: lineSpacingVal },
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,    // 1 inch
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}
