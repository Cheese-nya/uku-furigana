'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { LiquidSelector } from './glass/LiquidSelector';
import { IconWarning } from './glass/icons';
import type { BookCategory, LibraryFolder } from '../utils/libraryDatabase';
import type { Translations } from '../utils/i18n';
import {
  editFromPreview,
  formatImportBytes,
  importErrorText,
  importWarningText,
  type ImportEdit,
  type ImportReviewDecision,
  type ImportReviewState,
} from '../utils/importPreview';

export interface ImportPreviewModalProps {
  t: Translations;
  review: ImportReviewState | null;
  folders: LibraryFolder[];
  onResolve: (decision: ImportReviewDecision) => void;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

function Field({ label, value, onChange, type = 'text' }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-[var(--label-2)]">
      <span className="truncate">{label}</span>
      <input
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        aria-label={label}
        className="h-[40px] min-w-0 rounded-xl bg-[var(--fill-2)] px-3 text-sm text-[var(--label)] outline-none placeholder:text-[var(--label-3)]"
      />
    </label>
  );
}

function Stat({ label }: { label: string }) {
  return <span className="rounded-lg bg-[var(--fill-2)] px-2 py-1 text-[11px] font-medium text-[var(--label-2)]">{label}</span>;
}

/**
 * The one import sheet: preview + editable metadata + duplicate choice, a PDF password prompt, or a
 * parse failure with retry/skip. It never parses or writes by itself; the queue owns that.
 */
export function ImportPreviewModal({ t, review, folders, onResolve }: ImportPreviewModalProps) {
  const [draft, setDraft] = useState<ImportEdit | null>(null);
  const [draftFor, setDraftFor] = useState<unknown>(null);
  const [password, setPassword] = useState('');

  // Reset the editable draft only when a different file's preview arrives, not when a commit error
  // re-opens this sheet for the same preview (that would throw away the user's edits).
  if (review?.preview && review.preview !== draftFor) {
    setDraftFor(review.preview);
    setDraft(editFromPreview(review.preview));
    setPassword('');
  }

  const cover = review?.preview?.cover;
  const coverUrl = useMemo(() => (cover ? URL.createObjectURL(cover) : ''), [cover]);
  useEffect(() => () => {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
  }, [coverUrl]);

  if (!review) return null;

  const { preview, error } = review;
  const passwordError = error?.code === 'password-required' || error?.code === 'password-wrong';
  const title = passwordError
    ? t.importPreviewPasswordTitle
    : error && !preview
      ? t.importPreviewErrorTitle
      : t.importPreviewTitle;
  const categoryOptions: Array<{ value: BookCategory; label: string }> = [
    { value: 'novel', label: t.libraryCategoryNovel },
    { value: 'script', label: t.libraryCategoryScript },
    { value: 'subtitle', label: t.libraryCategorySubtitle },
    { value: 'other', label: t.libraryCategoryOther },
  ];
  const cancelButton = (
    <button type="button" className="btn h-11" onClick={() => onResolve({ action: 'cancel' })}>
      {review.single ? t.importPreviewCancel : t.cancel}
    </button>
  );
  const skipButton = !review.single ? (
    <button type="button" className="btn h-11" onClick={() => onResolve({ action: 'skip' })}>
      {t.importPreviewSkip}
    </button>
  ) : null;

  // Password step: the parse failed because the PDF is encrypted.
  if (passwordError) {
    return (
      <Modal
        isOpen
        onClose={() => onResolve({ action: 'cancel' })}
        title={title}
        maxWidth="sm"
        footer={<>{cancelButton}{skipButton}<button type="submit" form="import-password-form" className="btn btn-ink h-11">{t.importPreviewPasswordSubmit}</button></>}
      >
        <div data-testid="import-password-step">
          {!review.single && (
            <p className="mb-2 text-xs tabular-nums text-[var(--label-3)]">
              {fill(t.importPreviewQueueProgress, { current: review.index, total: review.total, name: review.fileName, stage: '' }).replace(/\s*·\s*$/, '')}
            </p>
          )}
          <p className="mb-3 text-sm leading-relaxed">{t.importPreviewPasswordBody}</p>
          <form
            id="import-password-form"
            onSubmit={event => {
              event.preventDefault();
              if (password.trim()) {
                onResolve({ action: 'password', password });
                setPassword('');
              }
            }}
          >
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder={t.importPreviewPasswordPlaceholder}
              aria-label={t.importPreviewPasswordPlaceholder}
              className="h-11 w-full rounded-xl bg-[var(--fill-2)] px-3.5 text-sm text-[var(--label)] outline-none placeholder:text-[var(--label-3)]"
            />
          </form>
          {review.wrongPassword && <p role="alert" className="mt-2 text-xs font-medium text-[var(--danger)]">{t.importPreviewPasswordWrong}</p>}
          {error?.detail && <p className="mt-2 break-words text-[11px] text-[var(--label-3)]">{error.detail}</p>}
        </div>
      </Modal>
    );
  }

  // Parse/commit failure with no preview to confirm.
  if (error && !preview) {
    return (
      <Modal
        isOpen
        onClose={() => onResolve({ action: 'cancel' })}
        title={title}
        maxWidth="sm"
        footer={<>{cancelButton}{skipButton}<button type="button" className="btn btn-ink h-11" onClick={() => onResolve({ action: 'retry' })}>{t.importPreviewRetry}</button></>}
      >
        <div data-testid="import-error-step">
          <div className="flex items-start gap-3 rounded-xl bg-[var(--fill-2)] p-3.5">
            <IconWarning size={19} className="mt-0.5 shrink-0 text-[var(--danger)]" />
            <div className="min-w-0">
              <b className="block text-sm text-[var(--label)]">{t.importPreviewErrorTitle}</b>
              <p className="mt-1 text-sm leading-relaxed">{importErrorText(t, error.code)}</p>
              <p className="mt-1 truncate text-xs text-[var(--label-3)]">{review.fileName}</p>
              {error.detail && <p className="mt-1 break-words text-[11px] text-[var(--label-3)]">{error.detail}</p>}
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  if (!preview || !draft) return null;

  const stats = preview.stats;
  const large = preview.fileSize > 100 * 1024 * 1024;
  const duplicate = preview.duplicate;
  const update = (patch: Partial<ImportEdit>) => setDraft(previous => (previous ? { ...previous, ...patch } : previous));
  const confirm = (duplicateMode: 'merge' | 'keep-both') => {
    if (draft) onResolve({ action: 'confirm', edit: draft, duplicateMode });
  };
  const toc = preview.chapters.slice(0, 8);
  const moreCount = preview.chapters.length - toc.length;

  return (
    <Modal
      isOpen
      onClose={() => onResolve({ action: 'cancel' })}
      title={title}
      maxWidth="lg"
      footer={
        <>
          {cancelButton}
          {skipButton}
          {duplicate ? (
            <>
              <button type="button" className="btn h-11" onClick={() => confirm('keep-both')}>{t.importPreviewKeepBoth}</button>
              <button type="button" className="btn btn-ink h-11" onClick={() => confirm('merge')}>{t.importPreviewMerge}</button>
            </>
          ) : (
            <button type="button" className="btn btn-ink h-11" onClick={() => confirm('keep-both')}>{t.importPreviewImport}</button>
          )}
        </>
      }
    >
      <div data-testid="import-preview-step" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--label-3)]">
          <span className="truncate">{review.fileName}</span>
          <span className="shrink-0 tabular-nums">
            {fill(t.importPreviewSubtitle, { format: preview.format.toUpperCase(), size: formatImportBytes(preview.fileSize) })}
            {!review.single ? ` · ${review.index}/${review.total}` : ''}
          </span>
        </div>

        {duplicate && (
          <div className="rounded-xl border border-[var(--review)]/35 bg-[var(--review)]/10 p-3.5 text-sm">
            <b className="block text-[var(--label)]">{fill(t.importPreviewDuplicate, { title: duplicate.title })}</b>
            <p className="mt-1 text-xs leading-relaxed text-[var(--label-2)]">{t.importPreviewDuplicateDetail}</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl bg-[var(--fill-2)] p-3 text-sm">
            <IconWarning size={17} className="mt-0.5 shrink-0 text-[var(--danger)]" />
            <div className="min-w-0 flex-1">
              <span className="text-[var(--label)]">{importErrorText(t, error.code)}</span>
              <button type="button" className="ml-2 text-xs font-semibold underline" onClick={() => onResolve({ action: 'retry' })}>
                {t.importPreviewRetry}
              </button>
            </div>
          </div>
        )}

        {large && (
          <p className="rounded-xl bg-[var(--fill-2)] px-3 py-2 text-xs leading-relaxed text-[var(--label-2)]">
            {fill(t.importPreviewLargeFile, { size: formatImportBytes(preview.fileSize) })}
          </p>
        )}

        <div className="flex gap-4">
          <div className="w-[104px] shrink-0 sm:w-[124px]">
            <div className="aspect-[3/4.2] overflow-hidden rounded-[3px_9px_9px_3px] bg-[var(--fill-2)] shadow-[0_8px_20px_-10px_rgba(0,0,0,0.35)]">
              {coverUrl ? (
                <img src={coverUrl} alt={t.importPreviewTitle} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center px-2 text-center text-xs text-[var(--label-3)]">
                  {t.importPreviewNoCover}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <Field label={t.importPreviewTitleField} value={draft.title} onChange={value => update({ title: value })} />
            <Field label={t.importPreviewAuthorField} value={draft.author} onChange={value => update({ author: value })} />
            <div className="flex min-w-0 flex-col gap-1 text-xs font-medium text-[var(--label-2)]">
              <span>{t.importPreviewCategory}</span>
              <LiquidSelector
                variant="solid"
                className="self-start"
                ariaLabel={t.importPreviewCategory}
                value={draft.category}
                onChange={value => update({ category: value })}
                options={categoryOptions}
              />
            </div>
            <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-[var(--label-2)]">
              <span>{t.importPreviewFolder}</span>
              <select
                value={draft.folderId ?? ''}
                onChange={event => update({ folderId: event.target.value || null })}
                aria-label={t.importPreviewFolder}
                className="h-[40px] min-w-0 rounded-xl bg-[var(--fill-2)] px-3 text-sm text-[var(--label)] outline-none"
              >
                <option value="">{t.importPreviewNoFolder}</option>
                {folders.map(folder => <option key={folder.folderId} value={folder.folderId}>{folder.name}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Stat label={fill(t.importPreviewStatChars, { count: stats.characters })} />
          <Stat label={fill(t.importPreviewStatLines, { count: stats.lines })} />
          <Stat label={fill(t.importPreviewStatChapters, { count: stats.chapters })} />
          {stats.images > 0 && <Stat label={fill(t.importPreviewStatImages, { count: stats.images })} />}
          {stats.rubies > 0 && <Stat label={fill(t.importPreviewStatRubies, { count: stats.rubies })} />}
          {stats.pages > 0 && <Stat label={fill(t.importPreviewStatPages, { count: stats.pages })} />}
        </div>

        {preview.warnings.length > 0 && (
          <div>
            <b className="mb-1.5 block text-xs font-semibold text-[var(--label-2)]">{t.importPreviewWarnings}</b>
            <ul className="flex flex-col gap-1">
              {preview.warnings.map((warning, index) => (
                <li key={`${warning.code}:${index}`} className="flex items-start gap-2 text-xs leading-relaxed text-[var(--label-2)]">
                  <IconWarning size={14} className="mt-0.5 shrink-0 text-[var(--review)]" />
                  <span>{importWarningText(t, warning)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {toc.length > 0 && (
          <div>
            <b className="mb-1.5 block text-xs font-semibold text-[var(--label-2)]">{t.importPreviewToc}</b>
            <ol className="flex flex-col gap-0.5 rounded-xl bg-[var(--fill-2)] p-2">
              {toc.map((chapter, index) => (
                <li
                  key={`${chapter.title}:${index}`}
                  className="flex min-h-7 items-center gap-2 rounded-lg px-1.5 text-[13px] text-[var(--label)]"
                  style={{ paddingLeft: 6 + Math.min(2, chapter.level ?? 0) * 12 }}
                >
                  <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
                  {chapter.page !== undefined && <span className="shrink-0 text-[11px] tabular-nums text-[var(--label-3)]">{fill(t.importPreviewPageShort, { page: chapter.page })}</span>}
                </li>
              ))}
              {moreCount > 0 && <li className="px-1.5 pt-1 text-[11px] text-[var(--label-3)]">{fill(t.importPreviewTocMore, { count: moreCount })}</li>}
            </ol>
          </div>
        )}

        {preview.sampleLines.length > 0 && (
          <div>
            <b className="mb-1.5 block text-xs font-semibold text-[var(--label-2)]">{t.importPreviewSample}</b>
            <div className="rounded-xl bg-[var(--fill-2)] p-3 text-[13px] leading-relaxed text-[var(--label)] [font-family:var(--font-mincho)]">
              {preview.sampleLines.map((line, index) => <p key={index} className="line-clamp-2">{line}</p>)}
            </div>
          </div>
        )}

        <details className="rounded-xl bg-[var(--fill-2)] p-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--label-2)]">{t.importPreviewAdvanced}</summary>
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Field label={t.importPreviewLanguage} value={draft.language} onChange={value => update({ language: value })} />
            <Field label={t.importPreviewPublisher} value={draft.publisher} onChange={value => update({ publisher: value })} />
            <Field label={t.importPreviewPublishedAt} value={draft.publishedAt} onChange={value => update({ publishedAt: value })} />
            <Field label={t.importPreviewSeries} value={draft.series} onChange={value => update({ series: value })} />
            <Field label={t.importPreviewSeriesIndex} value={draft.seriesIndex} onChange={value => update({ seriesIndex: value })} />
            <Field label={t.importPreviewIdentifier} value={draft.identifier} onChange={value => update({ identifier: value })} />
          </div>
        </details>
      </div>
    </Modal>
  );
}
