'use client';

import React, { useEffect, useRef, useState } from 'react';
import { GlassButton } from './glass/GlassButton';
import { GlassPopover } from './glass/GlassPopover';
import { useGlass } from './glass/hooks';
import { IconCopy } from './glass/icons';
import { registerBackHandler } from '../utils/backStack';
import type { Translations } from '../utils/i18n';
import { INFLECTION_LABELS } from '../utils/lookup';
import type { LookupResult } from '../utils/lookup';

export type LookupState =
  | { status: 'loading'; query: string; progress?: number }
  | { status: 'done'; result: LookupResult }
  | { status: 'missing'; query: string }
  | { status: 'error'; query: string; error: string };

export interface LookupCardProps {
  state: LookupState | null;
  /** The highlighted word, for the desktop popover to grow out of. */
  anchor: HTMLElement | null;
  phone: boolean;
  onClose: () => void;
  dictTitles: Record<string, string>;
  locale: string;
  t: Translations;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

function Entries({ state, dictTitles, locale, t }: { state: LookupState; dictTitles: Record<string, string>; locale: string; t: Translations }) {
  if (state.status === 'loading') {
    return (
      <div className="px-4 py-5 text-sm text-[var(--label-2)]">
        <b className="mb-1 block font-[family-name:var(--font-mincho)] text-xl text-[var(--label)]">{state.query}</b>
        {state.progress !== undefined ? fill(t.lookupPreparing, { percent: Math.round(state.progress * 100) }) : <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--fill)] border-t-[var(--label)] align-middle" />}
      </div>
    );
  }
  if (state.status !== 'done') {
    return (
      <div className="px-4 py-[18px] text-sm leading-relaxed text-[var(--label-2)]">
        <b className="mb-1 block font-[family-name:var(--font-mincho)] text-xl text-[var(--label)]">{state.query}</b>
        {state.status === 'missing' ? t.lookupNotFound : fill(t.lookupFailed, { error: state.error })}
      </div>
    );
  }
  const { result } = state;
  const lang = locale === 'en' ? 'en' : 'zh';
  const inflection = result.inflections.map(code => INFLECTION_LABELS[code]?.[lang]).filter(Boolean).join(' · ');
  return (
    <div className="px-4 pb-1.5 pt-3.5">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-[var(--label-2)]">
        {t.lookupQuery} <b className="font-semibold text-[var(--label)]">{result.query}</b>
        {result.lemma !== result.query && (
          <span className="ml-auto text-[11px] text-[var(--label-3)]">{[result.lemma, inflection].filter(Boolean).join(' · ')}</span>
        )}
      </div>
      {result.entries.map((entry, index) => (
        <div key={`${entry.dict}-${entry.term}-${entry.reading}-${index}`} className={index ? 'mt-3 border-t border-[var(--sep)] pt-3' : ''}>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span lang="ja" className="font-[family-name:var(--font-mincho)] text-[26px] font-semibold tracking-[.02em]">
              {entry.reading && entry.reading !== entry.term
                ? <ruby>{entry.term}<rt className="font-sans text-[11px] text-[var(--ruby)]">{entry.reading}</rt></ruby>
                : entry.term}
            </span>
            <span className="inline-flex flex-wrap gap-1">
              {entry.tags.map(tag => <span key={tag} className="rounded-md bg-[var(--fill-2)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--label-2)]">{tag}</span>)}
            </span>
          </div>
          <ol className="mt-2 list-decimal pl-[1.35em] text-sm leading-[1.6] text-[var(--label)] marker:text-xs marker:text-[var(--label-3)]">
            {entry.glosses.map((gloss, glossIndex) => <li key={glossIndex} className="my-[3px] whitespace-pre-line">{gloss}</li>)}
          </ol>
          {entry.examples.slice(0, 3).map(([ja, zh], exampleIndex) => (
            <div key={exampleIndex} className="mb-0.5 mt-1 border-l-2 border-[var(--fill)] pl-2.5 text-[13px] text-[var(--label-2)]">
              <span lang="ja" className="font-[family-name:var(--font-mincho)] text-[var(--label)]">{ja}</span>　{zh}
            </div>
          ))}
          {result.entries.length > 1 && entry.dict !== result.entries[index - 1]?.dict && Object.keys(dictTitles).length > 1 && (
            <div className="mt-1 text-[11px] text-[var(--label-3)]">{dictTitles[entry.dict]}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function Footer({ state, dictTitles, t }: { state: LookupState; dictTitles: Record<string, string>; t: Translations }) {
  const [copied, setCopied] = useState(false);
  const word = state.status === 'done' ? state.result.entries[0]?.term ?? state.result.query : state.query;
  const source = state.status === 'done' ? dictTitles[state.result.entries[0]?.dict] : '';
  return (
    <div className="flex items-center gap-2 border-t border-[var(--sep)] py-2 pl-4 pr-3 text-[11px] text-[var(--label-3)]">
      <span className="truncate">{source}</span>
      <span className="flex-1" />
      <GlassButton
        className="!h-[30px] !px-2.5 text-xs text-[var(--label-2)]"
        onClick={() => { void navigator.clipboard?.writeText(word).then(() => setCopied(true)).catch(() => undefined); }}
      >
        <IconCopy size={15} />
        <span>{copied ? t.lookupCopied : t.lookupCopy}</span>
      </GlassButton>
    </div>
  );
}

/** Phone: a card that rises from the bottom; the grabber expands it (tap / drag up) or closes it (drag down). */
function PhoneCard({ state, onClose, children }: { state: LookupState | null; onClose: () => void; children: React.ReactNode }) {
  const ref = useGlass<HTMLDivElement>();
  const [tall, setTall] = useState(false);
  const startY = useRef<number | null>(null);
  const open = Boolean(state);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (!open) setTall(false); }
  useEffect(() => (open ? registerBackHandler(() => onCloseRef.current()) : undefined), [open]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-hidden={!open}
      className={`glass glass-sheet fixed inset-x-2 bottom-[max(8px,env(safe-area-inset-bottom))] z-[72] flex flex-col overflow-hidden rounded-[30px] transition-[translate,height] duration-[560ms,520ms] [transition-timing-function:var(--spring-smooth)] ${
        tall ? 'h-[86%]' : 'h-[46%]'} ${open ? 'translate-y-0' : 'pointer-events-none translate-y-[calc(100%+20px)]'}`}
    >
      <div
        className="flex h-6 shrink-0 cursor-grab touch-none justify-center pt-2"
        onPointerDown={event => { startY.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerUp={event => {
          if (startY.current === null) return;
          const dy = event.clientY - startY.current;
          startY.current = null;
          if (dy > 40) { if (tall) setTall(false); else onClose(); }
          else if (dy < -30 || Math.abs(dy) < 4) setTall(value => !value);
        }}
      >
        <i className="block h-[5px] w-9 rounded-full bg-[var(--label-3)]" />
      </div>
      {children}
    </div>
  );
}

/** Word lookup (mockup v3): glass popover beside the word on desktop, bottom card on phones. */
export function LookupCard({ state, anchor, phone, onClose, dictTitles, locale, t }: LookupCardProps) {
  // Keep the last content while the phone card slides away.
  const [shown, setShown] = useState<LookupState | null>(state);
  if (state && state !== shown) setShown(state);
  const content = shown && (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain md:max-h-[380px]">
        <Entries state={shown} dictTitles={dictTitles} locale={locale} t={t} />
      </div>
      <Footer state={shown} dictTitles={dictTitles} t={t} />
    </>
  );
  if (phone) return <PhoneCard state={state} onClose={onClose}>{content}</PhoneCard>;
  return (
    <GlassPopover open={Boolean(state)} onClose={onClose} anchor={anchor} ariaLabel={t.lookupDialog} className="glass-sheet flex w-[340px] flex-col !p-0 overflow-hidden">
      {content}
    </GlassPopover>
  );
}
