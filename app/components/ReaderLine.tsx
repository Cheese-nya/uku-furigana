'use client';

import React, { memo, useEffect, useState } from 'react';
import type { ScriptLine } from '../utils/furigana';
import type { Translations } from '../utils/i18n';
import { bookAssetUrl } from '../utils/assetStore';
import { IMAGE_LINE } from '../utils/bookAssets';
import { splitSentences } from '../utils/sentences';
import { IconWarning } from './glass/icons';

const SPEAKER = /^([^：:]{1,16})[：:](.*)$/;

export interface ReaderLineProps {
  line: ScriptLine;
  lineIndex: number;
  bookId: string;
  vertical: boolean;
  showRuby: boolean;
  /** Per-sentence translations under the text; undefined when bilingual reading is off. */
  bilingual?: { translations: Map<string, string>; failed: Set<string>; onRetry: (text: string) => void };
  /** What this line's sentences currently show (see bilingualSignature): the bundle is shared by every line,
   * so the line re-renders when its own translations change, not whenever any translation arrives. */
  bilingualSig?: string;
  /** Highlighted lookup range within this line. */
  hit?: { start: number; end: number } | null;
  t: Translations;
}

interface Piece { start: number; text: string; ruby?: string }

/** Cut the line's tokens into pieces at the given offsets. Ruby words stay whole; plain runs are split. */
function pieces(line: ScriptLine, cuts: number[]): Piece[] {
  const result: Piece[] = [];
  let offset = 0;
  for (const token of line.tokens) {
    const start = offset;
    offset += token.surface.length;
    if (token.ruby) { result.push({ start, text: token.surface, ruby: token.ruby }); continue; }
    let from = start;
    for (const cut of cuts) {
      if (cut <= from || cut >= offset) continue;
      result.push({ start: from, text: token.surface.slice(from - start, cut - start) });
      from = cut;
    }
    result.push({ start: from, text: token.surface.slice(from - start) });
  }
  return result;
}

function Figure({ bookId, id }: { bookId: string; id: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    void bookAssetUrl(bookId, id).then(value => { if (active) setUrl(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [bookId, id]);
  if (!url) return null;
  return <img src={url} alt="" className="reader-figure" draggable={false} />;
}

/** Translation state of one line, as a string: changes exactly when the line would render differently. */
export function bilingualSignature(text: string, translations: Map<string, string>, failed: Set<string>): string {
  return splitSentences(text).map(sentence => translations.get(sentence.text) ?? (failed.has(sentence.text) ? '\u0001' : '')).join('\u0002');
}

function sameLine(previous: ReaderLineProps, next: ReaderLineProps): boolean {
  return previous.line === next.line && previous.lineIndex === next.lineIndex && previous.bookId === next.bookId
    && previous.vertical === next.vertical && previous.showRuby === next.showRuby && previous.t === next.t
    && Boolean(previous.bilingual) === Boolean(next.bilingual) && previous.bilingualSig === next.bilingualSig
    && previous.hit?.start === next.hit?.start && previous.hit?.end === next.hit?.end;
}

/** One line of the immersive reader. Every text piece carries `data-o`, its offset in the line, for word lookup. */
export const ReaderLine = memo(function ReaderLine({ line, lineIndex, bookId, vertical, showRuby, bilingual, hit, t }: ReaderLineProps) {
  const text = line.tokens.map(token => token.surface).join('');
  const image = (line.cleanText || text).match(IMAGE_LINE);
  if (image) {
    return <figure data-line={lineIndex} className="reader-figure-wrap"><Figure bookId={bookId} id={image[1]} /></figure>;
  }

  const speakerMatch = (line.rawText || line.cleanText || '').match(SPEAKER);
  const speaker = line.speaker || speakerMatch?.[1];
  // "名前：" is shown as a label instead of inside the text.
  let skip = 0;
  if (speaker && text.startsWith(speaker)) {
    const delimiter = text.slice(speaker.length).match(/^[：:]\s*/);
    skip = speaker.length + (delimiter ? delimiter[0].length : 0);
  }
  const sentences = bilingual ? splitSentences(text) : [];
  const cuts = [...sentences.map(sentence => sentence.end), ...(hit ? [hit.start, hit.end] : [])];
  const all = pieces(line, cuts);
  const rtStyle = { color: 'var(--ruby)', visibility: showRuby ? 'visible' : 'hidden' } as const;

  const render = (from: number, to: number) => all
    .filter(piece => piece.start + piece.text.length > Math.max(from, skip) && piece.start < to)
    .map(piece => {
      let { start, text: value } = piece;
      if (start < skip) { value = value.slice(skip - start); start = skip; }
      const lit = hit && start < hit.end && start + value.length > hit.start ? ' lookup-hit' : '';
      if (!piece.ruby) return <span key={start} data-o={start} className={lit || undefined}>{value}</span>;
      return (
        <ruby key={start} data-o={start} className={lit || undefined}>
          {value}
          <rt className="select-none text-[0.56em] font-semibold tracking-[0.01em]" style={rtStyle}>{piece.ruby}</rt>
        </ruby>
      );
    });

  return (
    <p data-line={lineIndex} className={`${vertical ? 'ml-4' : 'mb-[0.6em]'}${bilingual ? ' reader-bilingual' : ''}`}>
      {speaker && <span className="mr-[0.4em] font-sans text-[0.72em] font-semibold tracking-normal text-[var(--label-2)]">{speaker}</span>}
      {line.tokens.length === 0 && <br />}
      {bilingual
        ? sentences.map(sentence => {
          const translation = bilingual.translations.get(sentence.text);
          const failed = bilingual.failed.has(sentence.text);
          return (
            <React.Fragment key={sentence.start}>
              <span className="reader-sentence">{render(sentence.start, sentence.end)}</span>
              {translation !== undefined
                ? <span className="reader-tr">{translation.trim()}</span>
                : failed
                  ? (
                    <span className="reader-tr reader-tr-err">
                      <IconWarning size={14} />{t.translationLineFailed}
                      <button type="button" onClick={event => { event.stopPropagation(); bilingual.onRetry(sentence.text); }}>{t.translationRetry}</button>
                    </span>
                  )
                  : <span className="reader-tr reader-tr-skel" aria-hidden />}
            </React.Fragment>
          );
        })
        : render(0, text.length)}
    </p>
  );
}, sameLine);
