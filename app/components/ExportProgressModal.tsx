'use client';

import React from 'react';
import { Modal } from './Modal';
import type { Translations } from '../utils/i18n';

interface ExportProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCancel?: () => void;
  isExporting: boolean;
  exportFormat: 'docx' | 'srt' | 'txt';
  exportProgress: number;
  exportOutcome: 'processing' | 'saved' | 'download' | 'cancelled' | 'error';
  exportError: string;
  stageMessage?: string;
  completionNotice?: string;
  t: Translations;
}

export function ExportProgressModal({
  isOpen,
  onClose,
  onCancel,
  isExporting,
  exportFormat,
  exportProgress,
  exportOutcome,
  exportError,
  stageMessage,
  completionNotice,
  t,
}: ExportProgressModalProps) {
  const title = exportOutcome === 'processing'
    ? t.exportModalProcessing
    : exportOutcome === 'cancelled'
      ? t.exportModalCancelled
      : exportOutcome === 'error'
        ? t.exportModalFailed
        : exportOutcome === 'download'
          ? t.exportModalDownload
          : t.exportModalDone;

  const baseMessage = exportOutcome === 'processing'
    ? (stageMessage || (exportProgress < 80 ? t.generatingFile.replace('{format}', exportFormat.toUpperCase()) : t.waitingForSave))
    : exportOutcome === 'saved'
      ? t.fileSaved
      : exportOutcome === 'download'
        ? t.downloadHandedOver
        : exportOutcome === 'cancelled'
          ? t.saveCancelled
          : `${t.exportModalFailed}: ${exportError}`;

  const showNotice = Boolean(completionNotice) && (exportOutcome === 'saved' || exportOutcome === 'download');

  return (
    <Modal isOpen={isOpen} onClose={() => !isExporting && onClose()} title={title}>
      <div className="space-y-4 py-1">
        <div className="flex items-center justify-between text-xs font-medium text-[var(--label-2)]">
          <span>{t.generatingProgress} ({exportFormat.toUpperCase()})</span>
          <span className="tabular-nums text-[var(--label)]">{exportProgress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--fill)]">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${exportOutcome === 'error' ? 'bg-[var(--danger)]' : 'bg-[var(--label)]'}`}
            style={{ width: `${exportProgress}%` }}
          />
        </div>
        <div
          role={exportOutcome === 'error' ? 'alert' : 'status'}
          className={`space-y-1.5 rounded-xl bg-[var(--fill-2)] p-3 text-center text-xs leading-relaxed ${exportOutcome === 'error' ? 'text-[var(--danger)]' : 'text-[var(--label-2)]'}`}
        >
          <p>{baseMessage}</p>
          {showNotice && <p className="text-[var(--review)]">{completionNotice}</p>}
        </div>
        <div className="flex justify-end gap-2.5 border-t border-[var(--sep)] pt-4">
          {isExporting && onCancel && (
            <button type="button" onClick={onCancel} className="btn h-11">
              {t.exportCancelButton}
            </button>
          )}
          <button type="button" disabled={isExporting} onClick={onClose} className="btn btn-ink h-11 disabled:opacity-50">
            {isExporting ? t.processing : t.done}
          </button>
        </div>
      </div>
    </Modal>
  );
}
