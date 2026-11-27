'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GlassPopover } from './glass/GlassPopover';
import { LiquidSelector } from './glass/LiquidSelector';
import { BottomCard } from './LookupCard';
import { IconSearch, IconTrash } from './glass/icons';
import { chapterIndexForLine, lineForSourcePage, type BookChapter, type BookmarkItem } from '../utils/libraryDatabase';
import type { Translations } from '../utils/i18n';

export type TocCardTab = 'toc' | 'bookmarks' | 'search';

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
  bookmarks?: BookmarkItem[];
  onJumpLine?: (lineIndex: number, searchMatch?: { start: number; end: number }) => void;
  onDeleteBookmark?: (id: string) => void;
  pageStarts?: number[];
  pageLabels?: string[];
  lineTexts?: string[];
  initialTab?: TocCardTab;
  onActiveSearchChange?: (query: string) => void;
  t: Translations;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

const MAX_SEARCH_HITS = 100;

/** Table of contents + Bookmarks + Search + PDF page jump (desktop popover / mobile sheet). */
export function TocCard({
  open, onClose, anchor, phone, chapters, current, percent, onSelect,
  bookmarks = [], onJumpLine, onDeleteBookmark, pageStarts, pageLabels, lineTexts = [],
  initialTab = 'toc', onActiveSearchChange, t,
}: TocCardProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasToc = chapters.length > 1;
  const [tab, setTab] = useState<TocCardTab>(hasToc ? initialTab : (initialTab === 'toc' ? 'bookmarks' : initialTab));
  const [wasOpen, setWasOpen] = useState(open);
  const [pageInput, setPageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTab(hasToc ? initialTab : (initialTab === 'toc' ? 'bookmarks' : initialTab));
    }
  }

  // Open with the current chapter in view or focus search box.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (tab === 'toc') {
        listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
      } else if (tab === 'search') {
        searchInputRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, current, tab]);

  const tabOptions = useMemo(() => {
    const opts: Array<{ value: TocCardTab; label: string }> = [];
    if (hasToc) opts.push({ value: 'toc', label: t.readerTabToc });
    opts.push({ value: 'bookmarks', label: `${t.readerTabBookmarks}${bookmarks.length ? ` (${bookmarks.length})` : ''}` });
    opts.push({ value: 'search', label: t.readerTabSearch });
    return opts;
  }, [hasToc, bookmarks.length, t.readerTabToc, t.readerTabBookmarks, t.readerTabSearch]);

  const searchHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !lineTexts.length) return [];
    const hits: Array<{ lineIndex: number; start: number; end: number; snippet: string; chapterTitle?: string }> = [];
    for (let i = 0; i < lineTexts.length; i += 1) {
      const text = lineTexts[i];
      if (!text) continue;
      const lower = text.toLowerCase();
      let from = 0;
      while (hits.length < MAX_SEARCH_HITS) {
        const idx = lower.indexOf(q, from);
        if (idx < 0) break;
        const snippetStart = Math.max(0, idx - 12);
        const snippetEnd = Math.min(text.length, idx + q.length + 20);
        const chapterIdx = hasToc ? chapterIndexForLine(chapters, i) : 0;
        hits.push({
          lineIndex: i,
          start: idx,
          end: idx + q.length,
          snippet: `${snippetStart > 0 ? '…' : ''}${text.slice(snippetStart, snippetEnd)}${snippetEnd < text.length ? '…' : ''}`,
          ...(hasToc && chapters[chapterIdx] ? { chapterTitle: chapters[chapterIdx].title } : {}),
        });
        from = idx + q.length;
      }
      if (hits.length >= MAX_SEARCH_HITS) break;
    }
    return hits;
  }, [searchQuery, lineTexts, hasToc, chapters]);

  const updateSearch = (value: string) => {
    setSearchQuery(value);
    onActiveSearchChange?.(value.trim());
  };

  const handlePageJump = (event: React.FormEvent) => {
    event.preventDefault();
    if (!onJumpLine) return;
    const line = lineForSourcePage(pageStarts, pageLabels, pageInput);
    if (line === null) return;
    setPageInput('');
    onJumpLine(line);
  };

  const sortedBookmarks = useMemo(
    () => [...bookmarks].sort((a, b) => a.lineIndex - b.lineIndex || b.createdAt - a.createdAt),
    [bookmarks],
  );

  const content = (
    <>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2 pt-3">
        <LiquidSelector
          variant="solid"
          className="flex w-full [&>[data-opt]]:h-7 [&>[data-opt]]:flex-1 [&>[data-opt]]:text-xs"
          ariaLabel={t.readerToc}
          value={tab}
          onChange={setTab}
          options={tabOptions}
        />
        {tab === 'toc' && hasToc && (
          <div className="flex items-center justify-between px-1 text-xs text-[var(--label-2)]">
            <span className="font-semibold text-[var(--label)]">{t.readerToc}</span>
            <span className="tabular-nums">{fill(t.readerChapterOf, { current: current + 1, total: chapters.length })}</span>
          </div>
        )}
        {tab === 'toc' && pageStarts && pageStarts.length > 0 && onJumpLine && (
          <form onSubmit={handlePageJump} className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="numeric"
              value={pageInput}
              onChange={e => setPageInput(e.target.value)}
              placeholder={t.readerPageJumpPlaceholder}
              className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--sep)] bg-[var(--fill-2)] px-2.5 text-xs text-[var(--label)] placeholder:text-[var(--label-3)] focus:outline-none focus:ring-1 focus:ring-[var(--label-2)]"
            />
            <span className="shrink-0 text-[11px] tabular-nums text-[var(--label-3)]">
              {fill(t.readerPageOfTotal, { total: pageStarts.length })}
            </span>
            <button type="submit" disabled={!pageInput.trim()} className="btn h-8 px-2.5 text-xs">
              {t.readerPageJump}
            </button>
          </form>
        )}
        {tab === 'search' && (
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--sep)] bg-[var(--fill-2)] px-2.5 py-1">
            <IconSearch size={14} className="text-[var(--label-3)]" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={e => updateSearch(e.target.value)}
              placeholder={t.readerSearchPlaceholder}
              className="h-6 min-w-0 flex-1 bg-transparent text-xs text-[var(--label)] placeholder:text-[var(--label-3)] focus:outline-none"
            />
            {searchQuery.trim() && (
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--label-3)]">
                {fill(t.readerSearchCount, { count: searchHits.length })}
              </span>
            )}
          </div>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2 md:max-h-[min(420px,56vh)]">
        {tab === 'toc' && hasToc && chapters.map((chapter, index) => (
          <button
            key={chapter.id}
            type="button"
            aria-current={index === current}
            onClick={() => onSelect(index)}
            style={{ paddingLeft: 12 + Math.min(2, chapter.level ?? 0) * 12 }}
            className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl pr-3 text-left transition-colors hover:bg-[var(--item-hover)] ${
              index === current ? 'bg-[var(--fill)] font-semibold' : ''}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${index === current ? 'bg-[var(--label)]' : ''}`} />
            <span className={`min-w-0 flex-1 truncate font-[family-name:var(--font-mincho)] text-[15px] ${index < current ? 'text-[var(--label-2)]' : ''}`}>
              {chapter.title}
            </span>
            {chapter.page !== undefined && (
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--label-3)]">{fill(t.importPreviewPageShort, { page: chapter.page })}</span>
            )}
            {index === current && <span className="shrink-0 text-xs tabular-nums text-[var(--label)]">{percent}%</span>}
          </button>
        ))}

        {tab === 'bookmarks' && (
          sortedBookmarks.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs leading-relaxed text-[var(--label-3)]">{t.readerBookmarksEmpty}</p>
          ) : (
            sortedBookmarks.map(item => (
              <div key={item.id} className="flex items-center gap-1 rounded-xl pr-1 transition-colors hover:bg-[var(--item-hover)]">
                <button
                  type="button"
                  onClick={() => onJumpLine?.(item.lineIndex)}
                  className="flex min-h-11 min-w-0 flex-1 flex-col justify-center px-3 py-1.5 text-left"
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--label)]">
                    <span className="truncate">{item.label}</span>
                    <span className="shrink-0 text-[11px] font-normal tabular-nums text-[var(--label-3)]">L{item.lineIndex + 1}</span>
                  </div>
                  {item.snippet && (
                    <span className="mt-0.5 truncate font-[family-name:var(--font-mincho)] text-[13px] text-[var(--label-2)]">
                      {item.snippet}
                    </span>
                  )}
                </button>
                {onDeleteBookmark && (
                  <button
                    type="button"
                    aria-label={t.readerBookmarkRemove}
                    onClick={() => onDeleteBookmark(item.id)}
                    className="shrink-0 rounded-lg p-2 text-[var(--label-3)] hover:text-[var(--danger)]"
                  >
                    <IconTrash size={15} />
                  </button>
                )}
              </div>
            ))
          )
        )}

        {tab === 'search' && (
          !searchQuery.trim() ? (
            <p className="px-4 py-8 text-center text-xs leading-relaxed text-[var(--label-3)]">{t.readerSearchEmpty}</p>
          ) : searchHits.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs leading-relaxed text-[var(--label-3)]">{t.readerSearchNoResult}</p>
          ) : (
            searchHits.map((hit, idx) => (
              <button
                key={`${hit.lineIndex}-${hit.start}-${idx}`}
                type="button"
                onClick={() => onJumpLine?.(hit.lineIndex, { start: hit.start, end: hit.end })}
                className="flex min-h-11 w-full flex-col justify-center rounded-xl px-3 py-1.5 text-left transition-colors hover:bg-[var(--item-hover)]"
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--label-3)]">
                  <span className="truncate">{hit.chapterTitle || t.readerTabToc}</span>
                  <span className="shrink-0 tabular-nums">L{hit.lineIndex + 1}</span>
                </div>
                <span className="mt-0.5 truncate font-[family-name:var(--font-mincho)] text-[14px] text-[var(--label)]">
                  {hit.snippet}
                </span>
              </button>
            ))
          )
        )}
      </div>
    </>
  );

  if (phone) return <BottomCard open={open} onClose={onClose} label={t.readerToc}>{content}</BottomCard>;
  return (
    <GlassPopover open={open} onClose={onClose} anchor={anchor} placement="above" ariaLabel={t.readerToc} tier="sheet" className="flex w-[320px] flex-col !p-0 overflow-hidden">
      {content}
    </GlassPopover>
  );
}
