'use client';

import React, { useState } from 'react';
import { GlassButton, GlassCapsule } from './glass/GlassButton';
import { GlassPopover, PopoverItem } from './glass/GlassPopover';
import { IconCheck, IconDoc, IconPlus, IconStack } from './glass/icons';
import type { Translations } from '../utils/i18n';

export interface BatchFileItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress: number;
  lineCount?: number;
  content?: string;
  error?: string;
}

type ExportFormat = 'docx' | 'srt' | 'txt';

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
  t: Translations;
}

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Mockup batch page: add files, export all (format chosen on click), one list card with per-file state. */
export function BatchProcessingPanel({
  fileInputRef, handleFileSelect, handleDrop, batchFiles, removeBatchFile, processBatchQueue, isBatchProcessing,
  isKuromojiLoading, correctionsReady, t,
}: BatchProcessingPanelProps) {
  const [exportAnchor, setExportAnchor] = useState<HTMLButtonElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const canExport = batchFiles.some(file => file.status === 'pending') && !isBatchProcessing && !isKuromojiLoading && correctionsReady;

  return (
    <section className="relative flex min-h-0 flex-1 flex-col" onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
      <input ref={fileInputRef} type="file" multiple accept=".txt,.srt,.docx,.epub,.pdf" className="hidden" onChange={event => { handleFileSelect(event); event.target.value = ''; }} />

      <div className="pointer-events-none relative z-20 mb-3 flex items-center gap-2.5 [&>*]:pointer-events-auto">
        <GlassCapsule>
          <GlassButton disabled={isBatchProcessing} onClick={() => fileInputRef.current?.click()}>
            <IconPlus />
            <span>{t.batchAddFiles}</span>
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
              <button type="button" className="btn btn-ink" onClick={() => fileInputRef.current?.click()}><IconPlus size={17} />{t.batchAddFiles}</button>
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
        {(['txt', 'srt', 'docx'] as const).map(format => (
          <PopoverItem key={format} icon={<IconDoc size={17} />} onClick={() => { setExportOpen(false); processBatchQueue(format); }}>
            .{format.toUpperCase()}
          </PopoverItem>
        ))}
      </GlassPopover>
    </section>
  );
}
