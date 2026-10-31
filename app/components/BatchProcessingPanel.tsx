'use client';

import React, { useMemo, useState } from 'react';
import { GlassButton, GlassCapsule } from './glass/GlassButton';
import { GlassPopover, PopoverItem } from './glass/GlassPopover';
import { Modal } from './Modal';
import { IconBooks, IconCheck, IconDoc, IconPlus, IconSearch, IconStack } from './glass/icons';
import type { BookItem } from '../utils/libraryDatabase';
import type { Translations } from '../utils/i18n';

export interface BatchFileItem {
  id: string;
  /** Queued from the library instead of a file: its text comes from the book, which is never written back. */
  file?: File;
  bookId?: string;
  name: string;
  size: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress: number;
  lineCount?: number;
  content?: string;
  error?: string;
}

export type ExportFormat = 'docx' | 'srt' | 'txt' | 'epub' | 'pdf';

interface BatchProcessingPanelProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrop: (e: React.DragEvent) => void;
  batchFiles: BatchFileItem[];
  removeBatchFile: (id: string) => void;
  processBatchQueue: (format: ExportFormat) => void;
  isBatchProcessing: boolean;
  isKuromojiLoading: boolean;
  correctionsReady: boolean;
  /** Library books offered by the 从台本库添加 sheet. */
  books: BookItem[];
  onAddBooks: (books: BookItem[]) => void;
  t: Translations;
}

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Mockup batch page: add files, export all (format chosen on click), one list card with per-file state. */
export function BatchProcessingPanel({
  fileInputRef, handleFileSelect, handleDrop, batchFiles, removeBatchFile, processBatchQueue, isBatchProcessing,
  isKuromojiLoading, correctionsReady, books, onAddBooks, t,
}: BatchProcessingPanelProps) {
  const [exportAnchor, setExportAnchor] = useState<HTMLButtonElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [pickedBookIds, setPickedBookIds] = useState<string[]>([]);
  const canExport = batchFiles.some(file => file.status === 'pending') && !isBatchProcessing && !isKuromojiLoading && correctionsReady;
  const queuedBookIds = useMemo(() => new Set(batchFiles.map(file => file.bookId).filter((bookId): bookId is string => !!bookId)), [batchFiles]);
  const visibleBooks = useMemo(() => {
    const needle = libraryQuery.trim().toLowerCase();
    return needle ? books.filter(book => book.title.toLowerCase().includes(needle)) : books;
  }, [books, libraryQuery]);
  // Books already in the queue cannot be picked again.
  const selectableBooks = useMemo(() => visibleBooks.filter(book => !queuedBookIds.has(book.bookId)), [visibleBooks, queuedBookIds]);
  const allVisiblePicked = selectableBooks.length > 0 && selectableBooks.every(book => pickedBookIds.includes(book.bookId));

  const openLibrary = () => {
    setLibraryQuery('');
    setPickedBookIds([]);
    setLibraryOpen(true);
  };

  const toggleBook = (bookId: string) => {
    setPickedBookIds(prev => prev.includes(bookId) ? prev.filter(id => id !== bookId) : [...prev, bookId]);
  };

  const toggleAllVisible = () => {
    const selectableIds = selectableBooks.map(book => book.bookId);
    setPickedBookIds(prev => allVisiblePicked ? prev.filter(id => !selectableIds.includes(id)) : [...new Set([...prev, ...selectableIds])]);
  };

  const confirmPick = () => {
    const picked = books.filter(book => pickedBookIds.includes(book.bookId));
    setLibraryOpen(false);
    if (picked.length) onAddBooks(picked);
  };

  return (
    <section className="relative flex min-h-0 flex-1 flex-col" onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.srt,.vtt,.docx,.epub,.pdf,text/plain,text/markdown,application/x-subrip,text/vtt,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={event => { handleFileSelect(event); event.target.value = ''; }}
      />

      <div className="pointer-events-none relative z-20 mb-3 flex items-center gap-2.5 [&>*]:pointer-events-auto">
        <GlassCapsule>
          <GlassButton disabled={isBatchProcessing} onClick={() => fileInputRef.current?.click()}>
            <IconPlus />
            <span>{t.batchAddFiles}</span>
          </GlassButton>
          <GlassButton disabled={isBatchProcessing} onClick={openLibrary}>
            <IconBooks />
            <span>{t.batchAddFromLibrary}</span>
          </GlassButton>
        </GlassCapsule>
        <div className="flex-1" />
        <GlassButton
          ref={setExportAnchor}
          variant="prominent"
          disabled={!canExport}
          aria-expanded={exportOpen}
          onClick={() => setExportOpen(open => !open)}
          className="!h-[42px] !px-[18px]"
        >
          <span>{isBatchProcessing ? t.batchProcessingInProgress : t.batchExportAll}</span>
        </GlassButton>
      </div>

      <h1 className="mx-1 mb-3.5 mt-1.5 text-[34px] font-bold tracking-[-0.02em] md:hidden">{t.mobileNavBatch}</h1>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-[18px] bg-[var(--surface)] shadow-[var(--card-shadow)]">
        {batchFiles.length === 0 ? (
          <div className="grid min-h-[260px] place-items-center px-6 text-center text-[var(--label-2)]">
            <div>
              <IconStack size={46} className="mx-auto text-[var(--label-3)]" />
              <h3 className="mb-1.5 mt-3.5 text-xl font-semibold text-[var(--label)]">{t.batchEmptyTitle}</h3>
              <p className="mx-auto mb-[18px] max-w-[280px] text-sm leading-relaxed">{t.batchEmptyBody}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className="btn btn-ink" onClick={() => fileInputRef.current?.click()}><IconPlus size={17} />{t.batchAddFiles}</button>
                <button type="button" className="btn" onClick={openLibrary}><IconBooks size={17} />{t.batchAddFromLibrary}</button>
              </div>
            </div>
          </div>
        ) : (
          <ul className="min-h-0 overflow-y-auto overscroll-contain">
            {batchFiles.map(file => (
              <li key={file.id} className="flex min-h-[62px] items-center gap-3 border-b-[0.5px] border-[color:var(--sep)] px-[18px] py-[13px] last:border-0 max-md:px-3.5">
                <IconDoc className="text-[var(--label-2)]" />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{file.name}</div>
                  <div className="mt-0.5 text-xs text-[var(--label-2)]">
                    {file.status === 'error' ? file.error : `${formatSize(file.size)}${file.lineCount ? ` · ${file.lineCount} ${t.linesCount}` : ''}`}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2 text-[13px] font-medium">
                  {file.status === 'done' && <span className="flex items-center gap-1 text-[var(--ok)]"><IconCheck size={17} />{t.batchStatusDone}</span>}
                  {file.status === 'processing' && (
                    <>
                      <span className="h-1 w-[90px] overflow-hidden rounded-sm bg-[var(--fill)]">
                        <i className="block h-full rounded-sm bg-[var(--label)]" style={{ width: `${file.progress}%` }} />
                      </span>
                      <span className="tabular-nums">{file.progress}%</span>
                    </>
                  )}
                  {file.status === 'pending' && <span className="text-[var(--label-3)]">{t.batchStatusQueued}</span>}
                  {file.status === 'error' && <span className="text-[var(--danger)]">{t.batchStatusFailed}</span>}
                  {(file.status === 'error' || (file.status === 'pending' && !isBatchProcessing)) && (
                    <button type="button" className={`btn h-7 px-3 text-xs ${file.status === 'error' ? 'btn-danger' : ''}`} onClick={() => removeBatchFile(file.id)}>
                      {t.batchRemove}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <GlassPopover open={exportOpen} onClose={() => setExportOpen(false)} anchor={exportAnchor} ariaLabel={t.batchExportAll}>
        {(['txt', 'srt', 'docx', 'epub', 'pdf'] as const).map(format => (
          <PopoverItem key={format} icon={<IconDoc size={17} />} onClick={() => { setExportOpen(false); processBatchQueue(format); }}>
            .{format.toUpperCase()}
          </PopoverItem>
        ))}
      </GlassPopover>

      <Modal isOpen={libraryOpen} onClose={() => setLibraryOpen(false)} title={t.batchAddFromLibrary}>
        <div className="flex flex-col gap-3">
          <label className="flex h-[42px] items-center gap-2 rounded-xl bg-[var(--fill-2)] px-3.5 text-[var(--label-2)]">
            <IconSearch size={17} />
            <input
              value={libraryQuery}
              onChange={event => setLibraryQuery(event.target.value)}
              placeholder={t.batchSearchLibrary}
              aria-label={t.batchSearchLibrary}
              className="w-full border-0 bg-transparent text-[var(--label)] outline-none placeholder:text-[var(--label-3)]"
            />
          </label>
          {books.length > 0 && (
            <div className="flex items-center justify-between px-1">
              <button type="button" className="btn h-8 px-3 text-xs" onClick={toggleAllVisible} disabled={!selectableBooks.length}>
                {allVisiblePicked && <IconCheck size={15} />}
                {t.libraryCategoryAll}
              </button>
              <span className="text-xs tabular-nums text-[var(--label-3)]">{pickedBookIds.length}</span>
            </div>
          )}
          {visibleBooks.length === 0 ? (
            <p className="rounded-xl bg-[var(--fill-2)] p-4 text-center text-xs font-medium text-[var(--label-2)]">
              {books.length ? t.readerSearchNoResults : t.batchLibraryEmpty}
            </p>
          ) : (
            <ul className="max-h-[46vh] overflow-y-auto overscroll-contain rounded-[18px] bg-[var(--fill-2)]">
              {visibleBooks.map(book => {
                const queued = queuedBookIds.has(book.bookId);
                const picked = pickedBookIds.includes(book.bookId);
                return (
                  <li key={book.bookId} className="border-b-[0.5px] border-[color:var(--sep)] last:border-0">
                    <button
                      type="button"
                      aria-pressed={picked}
                      disabled={queued}
                      onClick={() => toggleBook(book.bookId)}
                      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left disabled:opacity-40"
                    >
                      <span
                        aria-hidden
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-[color:var(--label-3)] ${picked ? 'border-transparent bg-[var(--label)] text-[var(--surface)]' : ''}`}
                      >
                        {picked && <IconCheck size={13} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--label)]">{book.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--label-2)]">{book.author || t.untitledScript}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold uppercase text-[var(--label-3)]">{book.format}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex justify-end gap-3 border-t border-[var(--sep)] pt-4">
            <button type="button" className="btn h-11" onClick={() => setLibraryOpen(false)}>{t.cancel}</button>
            <button type="button" className="btn btn-ink h-11" onClick={confirmPick} disabled={pickedBookIds.length === 0}>{t.batchAddSelected}</button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
