'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { GlassButton, GlassCapsule } from './glass/GlassButton';
import { GlassPopover, PopoverItem, PopoverSeparator } from './glass/GlassPopover';
import { LiquidSelector } from './glass/LiquidSelector';
import { useGlass } from './glass/hooks';
import {
  IconBooks,
  IconCheck,
  IconChevronDown,
  IconEdit,
  IconGear,
  IconImport,
  IconLink,
  IconMore,
  IconPaste,
  IconPlus,
  IconRead,
  IconSearch,
  IconStar,
  IconStarFill,
  IconTrash,
} from './glass/icons';
import { downscaleCover } from '../utils/assetStore';
import type { BookCategory, BookItem, BookMetadataPatch } from '../utils/libraryDatabase';
import type { Translations } from '../utils/i18n';

export interface LibraryPanelProps {
  t: Translations;
  books: BookItem[];
  onOpenInReader: (book: BookItem) => void;
  onOpenInEditor: (book: BookItem) => void;
  onImportFiles: (files: FileList) => Promise<void>;
  onImportPixivNovel: (urlOrId: string) => Promise<void>;
  onUpdateBookMetadata: (bookId: string, patch: BookMetadataPatch) => void;
  onCreateOrUpdateBook: (input: { title: string; author?: string; category?: BookCategory; content: string }) => void;
  onToggleFavorite: (bookId: string) => void;
  onDeleteBook: (bookId: string) => void;
}

type SortMode = 'recent' | 'updated' | 'title';
type Filter = BookCategory | 'all';

/** Mockup cover cloths; a book keeps its colour (hashed from its id). Light cloth gets dark ink. */
const COVERS = ['#26324A', '#4B5D3A', '#1E2230', '#9A4A28', '#5B3550', '#C2AE86', '#A33A2F', '#3D4450'];
const LIGHT_COVER = '#C2AE86';
const LONG_PRESS_MS = 480;

function coverColour(book: BookItem): string {
  if (book.category === 'subtitle') return '#3D4450';
  let hash = 0;
  for (const char of book.bookId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COVERS[hash % COVERS.length];
}

function countLines(content: string): number {
  return content ? content.replace(/\r\n?/g, '\n').split('\n').length : 0;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

export function LibraryPanel({
  t, books, onOpenInReader, onOpenInEditor, onImportFiles, onImportPixivNovel, onUpdateBookMetadata,
  onCreateOrUpdateBook, onToggleFavorite, onDeleteBook,
}: LibraryPanelProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Filter>('all');
  const [sortBy, setSortBy] = useState<SortMode>('recent');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<HTMLButtonElement | null>(null);
  const [phoneSortAnchor, setPhoneSortAnchor] = useState<HTMLButtonElement | null>(null);
  const [sortOpen, setSortOpen] = useState<'desktop' | 'phone' | null>(null);
  const [newAnchor, setNewAnchor] = useState<HTMLButtonElement | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [menu, setMenu] = useState<{ book: BookItem; point: { x: number; y: number } } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [infoBook, setInfoBook] = useState<BookItem | null>(null);
  const [infoDraft, setInfoDraft] = useState({ title: '', author: '', category: 'script' as BookCategory, coverUrl: '' });
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState({ title: '', author: '', category: 'script' as BookCategory, content: '' });
  const [pixivOpen, setPixivOpen] = useState(false);
  const [pixivUrl, setPixivUrl] = useState('');
  const [pixivBusy, setPixivBusy] = useState(false);
  const [pixivError, setPixivError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useGlass<HTMLLabelElement>();

  const categoryLabel: Record<Filter, string> = {
    all: t.libraryCategoryAll,
    script: t.libraryCategoryScript,
    novel: t.libraryCategoryNovel,
    subtitle: t.libraryCategorySubtitle,
    other: t.libraryCategoryOther,
  };
  const sortLabel: Record<SortMode, string> = { recent: t.librarySortRecent, updated: t.librarySortUpdated, title: t.librarySortTitle };
  const categoryOptions = (list: Filter[]) => list.map(value => ({ value, label: categoryLabel[value] }));

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return books
      .filter(book => category === 'all' || book.category === category)
      .filter(book => !favoritesOnly || book.favorite)
      .filter(book => !needle || `${book.title}\n${book.author}\n${book.content.slice(0, 200)}`.toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => {
        if (sortBy === 'title') return a.title.localeCompare(b.title, 'ja');
        if (sortBy === 'updated') return b.updatedAt - a.updatedAt;
        return (b.lastReadAt || b.updatedAt) - (a.lastReadAt || a.updatedAt);
      });
  }, [books, category, favoritesOnly, query, sortBy]);

  const openInfo = (book: BookItem) => {
    setInfoDraft({ title: book.title, author: book.author || '', category: book.category, coverUrl: book.coverUrl || '' });
    setInfoBook(book);
  };
  const deleteTarget = books.find(book => book.bookId === confirmDeleteId) || null;

  const submitPixiv = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pixivUrl.trim() || pixivBusy) return;
    setPixivBusy(true);
    setPixivError('');
    try {
      await onImportPixivNovel(pixivUrl.trim());
      setPixivOpen(false);
      setPixivUrl('');
    } catch (error) {
      setPixivError(`${t.libPixivImportError}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPixivBusy(false);
    }
  };

  const sortMenu = (
    <>
      {(['recent', 'updated', 'title'] as SortMode[]).map(mode => (
        <PopoverItem
          key={mode}
          icon={sortBy === mode ? <IconCheck size={17} /> : <span className="w-[18px]" />}
          onClick={() => { setSortBy(mode); setSortOpen(null); }}
        >
          {sortLabel[mode]}
        </PopoverItem>
      ))}
      <PopoverSeparator />
      <PopoverItem
        icon={favoritesOnly ? <IconStarFill size={17} className="text-[var(--review)]" /> : <IconStar size={17} />}
        onClick={() => { setFavoritesOnly(value => !value); setSortOpen(null); }}
      >
        {t.libraryFilterFavorites}
      </PopoverItem>
    </>
  );

  return (
    <section className="relative flex min-h-0 flex-1 flex-col">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".txt,.md,.srt,.vtt,.docx,.epub,.pdf,application/epub+zip,application/pdf,text/plain,text/markdown,application/x-subrip,text/vtt,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={event => {
          if (event.target.files?.length) void onImportFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {/* Floating toolbar */}
      <div className="pointer-events-none relative z-20 mb-3 flex items-center gap-2.5 [&>*]:pointer-events-auto">
        <label ref={searchRef} className="glass !hidden h-[42px] w-[230px] items-center gap-2 rounded-full px-3.5 text-[var(--label-2)] md:!flex">
          <IconSearch />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t.librarySearchPlaceholder}
            className="w-full border-0 bg-transparent text-sm text-[var(--label)] outline-none placeholder:text-[var(--label-3)]"
          />
        </label>
        <LiquidSelector
          variant="glass"
          className="!hidden h-[42px] !p-1 md:!inline-flex"
          ariaLabel={t.libraryCategoryLabel}
          value={category}
          onChange={setCategory}
          options={categoryOptions(['all', 'script', 'novel', 'subtitle', 'other'])}
        />
        <GlassCapsule className="!hidden md:!inline-flex">
          <GlassButton ref={setSortAnchor} aria-expanded={sortOpen === 'desktop'} onClick={() => setSortOpen(open => (open ? null : 'desktop'))}>
            <span>{sortLabel[sortBy]}</span>
            <IconChevronDown size={14} />
          </GlassButton>
          <GlassButton
            icon
            aria-label={t.libraryFilterFavorites}
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly(value => !value)}
            className={favoritesOnly ? '!text-[var(--review)]' : ''}
          >
            {favoritesOnly ? <IconStarFill /> : <IconStar />}
          </GlassButton>
        </GlassCapsule>
        <div className="flex-1" />
        <GlassCapsule className="md:!hidden">
          <GlassButton ref={setPhoneSortAnchor} icon aria-label={t.librarySortLabel} onClick={() => setSortOpen(open => (open ? null : 'phone'))}>
            <IconMore />
          </GlassButton>
        </GlassCapsule>
        <GlassButton ref={setNewAnchor} variant="prominent" aria-expanded={newOpen} onClick={() => setNewOpen(open => !open)} className="!h-[42px] !px-4">
          <IconPlus />
          <span>{t.libraryNewShort}</span>
        </GlassButton>
      </div>

      <h1 className="mx-1 mb-3.5 mt-1.5 text-[34px] font-bold tracking-[-0.02em] md:hidden">{t.libraryTab}</h1>
      <div className="mb-4 flex flex-col gap-2.5 md:hidden">
        <label className="flex h-[42px] items-center gap-2 rounded-full bg-[var(--fill)] px-3.5 text-[var(--label-2)]">
          <IconSearch />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t.librarySearchPlaceholder}
            className="w-full border-0 bg-transparent text-sm text-[var(--label)] outline-none placeholder:text-[var(--label-3)]"
          />
        </label>
        <LiquidSelector
          variant="solid"
          className="self-start"
          ariaLabel={t.libraryCategoryLabel}
          value={category === 'other' ? 'all' : category}
          onChange={setCategory}
          options={categoryOptions(['all', 'script', 'novel', 'subtitle'])}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain -mx-1 px-1">
        {visible.length === 0 ? (
          <div className="grid min-h-full place-items-center text-center text-[var(--label-2)]">
            <div>
              <IconBooks size={46} className="mx-auto text-[var(--label-3)]" />
              <h3 className="mb-1.5 mt-3.5 text-xl font-semibold text-[var(--label)]">{books.length ? t.libraryFilteredEmptyTitle : t.libraryEmptyTitle}</h3>
              <p className="mx-auto mb-[18px] max-w-[280px] text-sm leading-relaxed">{books.length ? t.libraryFilteredEmptyBody : t.libraryEmptyBody}</p>
              {!books.length && (
                <div className="flex justify-center gap-2">
                  <button type="button" className="btn btn-ink" onClick={() => fileRef.current?.click()}><IconImport size={17} />{t.libraryImportBook}</button>
                  <button type="button" className="btn" onClick={() => setPixivOpen(true)}><IconLink size={17} />{t.libPixivImportBtn}</button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div data-testid="apple-books-shelf" className="grid grid-cols-2 gap-x-4 gap-y-[22px] px-1 pb-8 pt-1.5 sm:grid-cols-3 md:grid-cols-4 md:gap-x-5 md:gap-y-[26px] lg:grid-cols-5 xl:grid-cols-6">
            {visible.map(book => (
              <BookCover
                key={book.bookId}
                book={book}
                t={t}
                categoryText={categoryLabel[book.category]}
                lifted={menu?.book.bookId === book.bookId}
                onOpen={() => onOpenInReader(book)}
                onMenu={point => setMenu({ book, point })}
              />
            ))}
          </div>
        )}
      </div>

      <GlassPopover open={sortOpen !== null} onClose={() => setSortOpen(null)} anchor={sortOpen === 'phone' ? phoneSortAnchor : sortAnchor} ariaLabel={t.librarySortLabel}>
        {sortMenu}
      </GlassPopover>

      <GlassPopover open={newOpen} onClose={() => setNewOpen(false)} anchor={newAnchor} ariaLabel={t.libraryNewShort}>
        <PopoverItem icon={<IconImport size={17} />} detail={t.libraryImportFormats} onClick={() => { setNewOpen(false); fileRef.current?.click(); }}>{t.libraryImportBook}</PopoverItem>
        <PopoverItem icon={<IconLink size={17} />} data-testid="pixiv-import-toggle-btn" onClick={() => { setNewOpen(false); setPixivError(''); setPixivOpen(true); }}>{t.libPixivImportBtn}</PopoverItem>
        <PopoverItem icon={<IconPaste size={17} />} onClick={() => { setNewOpen(false); setComposerOpen(true); }}>{t.libraryNewBook}</PopoverItem>
      </GlassPopover>

      {/* Context menu (right-click / long-press) */}
      <GlassPopover open={!!menu} onClose={() => setMenu(null)} point={menu?.point} ariaLabel={menu?.book.title}>
        {menu && (
          <>
            <PopoverItem icon={<IconRead size={17} />} onClick={event => { event.stopPropagation(); setMenu(null); onOpenInReader(menu.book); }}>{t.libraryRead}</PopoverItem>
            <PopoverItem icon={<IconEdit size={17} />} onClick={event => { event.stopPropagation(); setMenu(null); onOpenInEditor(menu.book); }}>{t.libraryOpenInEditor}</PopoverItem>
            <PopoverItem
              icon={menu.book.favorite ? <IconStarFill size={17} className="text-[var(--review)]" /> : <IconStar size={17} />}
              onClick={event => { event.stopPropagation(); setMenu(null); onToggleFavorite(menu.book.bookId); }}
            >
              {menu.book.favorite ? t.libraryRemoveFavorite : t.libraryAddFavorite}
            </PopoverItem>
            <PopoverItem icon={<IconGear size={17} />} data-testid="book-settings-gear-btn" onClick={event => { event.stopPropagation(); setMenu(null); openInfo(menu.book); }}>
              {t.libraryInfoAndCategory}
            </PopoverItem>
            <PopoverSeparator />
            <PopoverItem danger icon={<IconTrash size={17} />} onClick={event => { event.stopPropagation(); setMenu(null); setConfirmDeleteId(menu.book.bookId); }}>
              {t.libraryDelete}
            </PopoverItem>
          </>
        )}
      </GlassPopover>

      {/* Info & category */}
      <Modal isOpen={!!infoBook} onClose={() => setInfoBook(null)} title={t.libraryInfoAndCategory} maxWidth="sm">
        {infoBook && (
          <form
            data-testid="book-meta-modal"
            className="flex flex-col gap-3"
            onSubmit={event => {
              event.preventDefault();
              onUpdateBookMetadata(infoBook.bookId, {
                title: infoDraft.title.trim() || infoBook.title,
                author: infoDraft.author.trim(),
                category: infoDraft.category,
                coverUrl: infoDraft.coverUrl,
              });
              setInfoBook(null);
            }}
          >
            <Field value={infoDraft.title} onChange={title => setInfoDraft(d => ({ ...d, title }))} placeholder={t.scriptTitlePlaceholder} />
            <Field value={infoDraft.author} onChange={author => setInfoDraft(d => ({ ...d, author }))} placeholder={t.libraryBookAuthorPlaceholder} />
            <LiquidSelector
              variant="solid"
              role="radiogroup"
              className="flex w-full [&>[data-opt]]:flex-1 [&>[data-opt]]:px-1"
              ariaLabel={t.libraryCategoryLabel}
              value={infoDraft.category}
              onChange={value => setInfoDraft(d => ({ ...d, category: value }))}
              options={(['script', 'novel', 'subtitle', 'other'] as BookCategory[]).map(value => ({ value, label: categoryLabel[value] }))}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[var(--label-2)]">{t.libraryCoverLabel}</span>
              <div className="flex items-center gap-3">
                {infoDraft.coverUrl.trim() ? (
                  <img
                    src={infoDraft.coverUrl}
                    alt=""
                    className="h-[78px] w-[56px] shrink-0 rounded-[3px_7px_7px_3px] object-cover"
                    style={{ background: coverColour(infoBook) }}
                  />
                ) : (
                  <div
                    aria-hidden
                    className="h-[78px] w-[56px] shrink-0 rounded-[3px_7px_7px_3px]"
                    style={{ background: coverColour(infoBook) }}
                  />
                )}
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void downscaleCover(file).then(coverUrl => setInfoDraft(d => ({ ...d, coverUrl }))).catch(() => undefined);
                    }
                    event.target.value = '';
                  }}
                />
                <button type="button" className="btn" onClick={() => coverInputRef.current?.click()}>
                  {t.libraryChooseCover}
                </button>
                {infoDraft.coverUrl.trim() && (
                  <button type="button" className="btn btn-plain" onClick={() => setInfoDraft(d => ({ ...d, coverUrl: '' }))}>
                    {t.libraryDefaultCover}
                  </button>
                )}
              </div>
            </div>
            <div className="mt-1 flex gap-2">
              <button type="button" className="btn h-11 flex-1" onClick={() => setInfoBook(null)}>{t.cancel}</button>
              <button type="submit" className="btn btn-ink h-11 flex-1">{t.applyButton}</button>
            </div>
          </form>
        )}
      </Modal>

      {/* New / paste */}
      <Modal isOpen={composerOpen} onClose={() => setComposerOpen(false)} title={t.libraryNewBook} maxWidth="lg">
        <form
          className="flex flex-col gap-3"
          onSubmit={event => {
            event.preventDefault();
            if (!draft.content.trim()) return;
            onCreateOrUpdateBook({ title: draft.title.trim() || t.defaultScriptTitle, author: draft.author.trim(), category: draft.category, content: draft.content });
            setDraft({ title: '', author: '', category: 'script', content: '' });
            setComposerOpen(false);
          }}
        >
          <Field value={draft.title} onChange={title => setDraft(d => ({ ...d, title }))} placeholder={t.scriptTitlePlaceholder} />
          <Field value={draft.author} onChange={author => setDraft(d => ({ ...d, author }))} placeholder={t.libraryBookAuthorPlaceholder} />
          <LiquidSelector
            variant="solid"
            role="radiogroup"
            className="flex w-full [&>[data-opt]]:flex-1 [&>[data-opt]]:px-1"
            ariaLabel={t.libraryCategoryLabel}
            value={draft.category}
            onChange={value => setDraft(d => ({ ...d, category: value }))}
            options={(['script', 'novel', 'subtitle', 'other'] as BookCategory[]).map(value => ({ value, label: categoryLabel[value] }))}
          />
          <textarea
            value={draft.content}
            onChange={event => setDraft(d => ({ ...d, content: event.target.value }))}
            placeholder={t.inputPlaceholder}
            className="min-h-[220px] resize-y rounded-xl border-0 bg-[var(--fill-2)] p-3.5 text-[15px] leading-relaxed text-[var(--label)] outline-none placeholder:text-[var(--label-3)]"
          />
          <div className="flex gap-2">
            <button type="button" className="btn h-11 flex-1" onClick={() => setComposerOpen(false)}>{t.cancel}</button>
            <button type="submit" disabled={!draft.content.trim()} className="btn btn-ink h-11 flex-1">{t.applyButton}</button>
          </div>
        </form>
      </Modal>

      {/* Pixiv */}
      <Modal isOpen={pixivOpen} onClose={() => setPixivOpen(false)} title={t.libPixivImportBtn} maxWidth="sm">
        <form className="flex flex-col gap-3" onSubmit={submitPixiv}>
          <Field testId="pixiv-url-input" value={pixivUrl} onChange={setPixivUrl} placeholder={t.libPixivInputPlaceholder} />
          {pixivError && <p role="alert" className="text-xs font-medium text-[var(--danger)]">{pixivError}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn h-11 flex-1" onClick={() => setPixivOpen(false)}>{t.cancel}</button>
            <button type="submit" data-testid="pixiv-import-submit-btn" disabled={pixivBusy || !pixivUrl.trim()} className="btn btn-ink h-11 flex-1">
              {pixivBusy ? t.libPixivFetching : t.libPixivFetchBtn}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal isOpen={!!deleteTarget} onClose={() => setConfirmDeleteId(null)} title={t.libraryDeleteBookTitle} maxWidth="sm">
        {deleteTarget && (
          <div data-testid="book-delete-dialog">
            <p className="mb-4 text-sm leading-relaxed">{fill(t.libraryDeleteBookConfirm, { title: deleteTarget.title })}</p>
            <div className="flex gap-2">
              <button type="button" className="btn h-11 flex-1" onClick={() => setConfirmDeleteId(null)}>{t.cancel}</button>
              <button
                type="button"
                className="btn btn-danger h-11 flex-1"
                onClick={event => { event.stopPropagation(); onDeleteBook(deleteTarget.bookId); setConfirmDeleteId(null); }}
              >
                {t.libraryDelete}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

function Field({ value, onChange, placeholder, testId }: { value: string; onChange: (value: string) => void; placeholder: string; testId?: string }) {
  return (
    <label className="flex h-[42px] items-center rounded-xl bg-[var(--fill-2)] px-3.5">
      <input
        data-testid={testId}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full border-0 bg-transparent text-[var(--label)] outline-none placeholder:text-[var(--label-3)]"
      />
    </label>
  );
}

/** Mockup cover: cloth colour, spine shading, vertical Mincho title, author, category, progress along the bottom edge. */
function BookCover({ book, t, categoryText, lifted, onOpen, onMenu }: {
  book: BookItem;
  t: Translations;
  categoryText: string;
  lifted: boolean;
  onOpen: () => void;
  onMenu: (point: { x: number; y: number }) => void;
}) {
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };
  const percent = Math.max(0, Math.min(100, Math.round(book.readingProgress.percentage)));
  const started = percent > 0 || book.lastReadAt > 0;
  const colour = coverColour(book);
  const ink = colour === LIGHT_COVER ? '#2a2418' : '#F6F1E6';
  const subtitle = book.category === 'subtitle';
  const lines = countLines(book.content);
  const hasCover = Boolean(book.coverUrl?.trim()) && failedCoverUrl !== book.coverUrl;

  return (
    <div className="min-w-0 select-none [-webkit-touch-callout:none]">
      <div
        data-testid="script-book-cover"
        role="button"
        tabIndex={0}
        aria-label={book.title}
        onClick={() => {
          if (longPressed.current) { longPressed.current = false; return; }
          onOpen();
        }}
        onKeyDown={event => { if (event.key === 'Enter') onOpen(); }}
        onContextMenu={event => {
          event.preventDefault();
          if (!longPressed.current) onMenu({ x: event.clientX, y: event.clientY });
        }}
        onPointerDown={event => {
          longPressed.current = false;
          if (event.pointerType === 'mouse') return;
          origin.current = { x: event.clientX, y: event.clientY };
          const point = { x: event.clientX, y: event.clientY };
          timer.current = window.setTimeout(() => { timer.current = null; longPressed.current = true; onMenu(point); }, LONG_PRESS_MS);
        }}
        onPointerMove={event => {
          if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancel();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        className={`relative aspect-[3/4.2] cursor-pointer overflow-hidden rounded-[4px_10px_10px_4px] transition-[scale,box-shadow] duration-[560ms] [transition-timing-function:var(--spring-bouncy)] active:scale-[0.96] active:duration-[140ms] ${
          lifted
            ? 'scale-[1.05] shadow-[0_2px_4px_rgba(0,0,0,0.12),0_24px_40px_-14px_rgba(0,0,0,0.5)]'
            : 'shadow-[0_1px_2px_rgba(0,0,0,0.12),0_8px_20px_-10px_rgba(0,0,0,0.35)]'
        }`}
        style={{ background: colour, color: ink }}
      >
        {hasCover ? (
          <img src={book.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} onError={() => setFailedCoverUrl(book.coverUrl || '')} />
        ) : (
          <>
            <span className="absolute left-4 top-4 text-[10px] font-bold tracking-[0.1em] opacity-70">{categoryText}</span>
            {subtitle ? (
              <span className="absolute bottom-[30px] left-4 right-4 font-mono text-[15px] font-semibold leading-snug">{book.title}</span>
            ) : (
              <>
                <span className="absolute right-4 top-4 max-h-[calc(100%-32px)] overflow-hidden text-[19px] font-semibold leading-[1.35] tracking-[0.08em] [font-family:var(--font-mincho)] [writing-mode:vertical-rl]">
                  {book.title}
                </span>
                {book.author?.trim() && (
                  <span className="absolute bottom-4 left-[18px] max-h-[45%] overflow-hidden text-[11px] tracking-[0.12em] opacity-[0.78] [font-family:var(--font-mincho)] [writing-mode:vertical-rl]">
                    {book.author}
                  </span>
                )}
              </>
            )}
          </>
        )}
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,.22)_0,rgba(255,255,255,.14)_3%,rgba(0,0,0,.06)_6%,transparent_12%),linear-gradient(160deg,rgba(255,255,255,.12),transparent_40%)]" />
        <span
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={fill(t.libraryBookProgress, { percent })}
          className="absolute inset-x-0 bottom-0 h-[3px] bg-black/[0.18]"
        >
          <i className="block h-full bg-white/85" style={{ width: `${percent}%` }} />
        </span>
      </div>
      <div className="mt-2.5 truncate text-[13px] font-semibold" title={book.title}>{book.title}</div>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--label-2)]" title={book.format.toUpperCase()}>
        {book.favorite && <IconStarFill size={12} className="shrink-0 text-[var(--review)]" />}
        <span className="truncate">
          {categoryText} · {book.format === 'epub' || book.format === 'pdf'
            ? `${book.format.toUpperCase()} · ${book.chapters.length > 1 ? fill(t.importChapters, { count: book.chapters.length }) : fill(t.libraryBookLines, { count: lines })}`
            : fill(t.libraryBookLines, { count: lines })} · {started ? fill(t.libraryBookProgress, { percent }) : t.libraryUnread}
        </span>
      </div>
    </div>
  );
}
