'use client';

import React, { useEffect, useRef } from 'react';
import { GlassPopover } from './glass/GlassPopover';
import { BottomCard } from './LookupCard';
import type { BookChapter } from '../utils/libraryDatabase';
import type { Translations } from '../utils/i18n';

export interface TocCardProps {
  open: boolean;
  onClose: () => void;
  /** The capsule: the desktop popover rises above it. */
  anchor: HTMLElement | null;
  phone: boolean;
  chapters: BookChapter[];
  current: number;
  /** Progress through the current chapter, 0–100. */
  percent: number;
  onSelect: (index: number) => void;
  t: Translations;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

/** Table of contents (mockup v3.1): popover above the capsule on desktop, bottom card on phones. */
export function TocCard({ open, onClose, anchor, phone, chapters, current, percent, onSelect, t }: TocCardProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Open with the current chapter in view.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, current]);

  const content = (
    <>
      <div className="flex shrink-0 items-baseline justify-between px-4 pb-2 pt-3.5">
        <b className="text-[15px]">{t.readerToc}</b>
        <span className="text-xs tabular-nums text-[var(--label-2)]">{fill(t.readerChapterOf, { current: current + 1, total: chapters.length })}</span>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2 md:max-h-[min(420px,56vh)]">
        {chapters.map((chapter, index) => (
          <button
            key={chapter.id}
            type="button"
            aria-current={index === current}
            onClick={() => onSelect(index)}
            className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left transition-colors hover:bg-[var(--item-hover)] ${
              index === current ? 'bg-[var(--fill)] font-semibold' : ''}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${index === current ? 'bg-[var(--label)]' : ''}`} />
            <span className={`min-w-0 flex-1 truncate font-[family-name:var(--font-mincho)] text-[15px] ${index < current ? 'text-[var(--label-2)]' : ''}`}>
              {chapter.title}
            </span>
            {index === current && <span className="text-xs tabular-nums text-[var(--label)]">{percent}%</span>}
          </button>
        ))}
      </div>
    </>
  );

  if (phone) return <BottomCard open={open} onClose={onClose} label={t.readerToc}>{content}</BottomCard>;
  return (
    <GlassPopover open={open} onClose={onClose} anchor={anchor} placement="above" ariaLabel={t.readerToc} className="glass-sheet flex w-[320px] flex-col !p-0 overflow-hidden">
      {content}
    </GlassPopover>
  );
}
