'use client';

import React from 'react';
import { Modal } from './Modal';
import { IconCheck } from './glass/icons';
import type { Translations } from '../utils/i18n';

export interface BatchDoneResults {
  total: number;
  success: number;
  failed: number;
  cancelled: number;
  filenames: string[];
}
interface BatchDoneModalProps { isOpen: boolean; onClose: () => void; results: BatchDoneResults; onSaveAgain?: () => void; t: Translations; }

/** Safari can need a fresh user gesture after a long annotation job; retry from a real button click. */
function resultStats(results: BatchDoneResults, t: Translations) {
  return [
    [results.total, t.totalFiles, 'text-[var(--label)]'], [results.success, t.successExport, 'text-[var(--ok)]'],
    [results.failed, t.failed, 'text-[var(--danger)]'], [results.cancelled, t.cancelledSave, 'text-[var(--label-2)]'],
  ];
}

export function BatchDoneModal({ isOpen, onClose, results, onSaveAgain, t }: BatchDoneModalProps) {
  const stats = resultStats(results, t);
  return <Modal isOpen={isOpen} onClose={onClose} title={t.batchDoneTitle}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 tabular-nums">{stats.map(([value, label, color]) => <div key={String(label)} className="rounded-[18px] bg-[var(--surface)] p-4 text-center shadow-[var(--card-shadow)]"><div className={`text-2xl font-bold ${color}`}>{value}</div><div className="mt-0.5 text-[11px] font-medium text-[var(--label-2)]">{label}</div></div>)}</div>
      {results.filenames.length > 0 && <div><h4 className="mb-2 text-xs font-semibold text-[var(--label)]">{t.exportedFilesLabel}</h4><ul className="max-h-[160px] overflow-y-auto rounded-[18px] bg-[var(--surface)] shadow-[var(--card-shadow)]">{results.filenames.map(name => <li key={name} className="flex items-center gap-2 border-b border-[var(--sep)] px-3 py-2 text-xs last:border-b-0"><IconCheck size={15} className="text-[var(--ok)]" /><span className="truncate text-[var(--label)]">{name}</span></li>)}</ul></div>}
      <p className="rounded-xl bg-[var(--fill-2)] p-3 text-center text-xs font-medium text-[var(--label-2)]">{t.batchDoneNotice.replace('{count}', String(results.success))}</p>
      <div className="flex justify-end gap-3 border-t border-[var(--sep)] pt-4">
        {onSaveAgain && <button type="button" onClick={onSaveAgain} className="btn h-11">{t.batchSaveAgain}</button>}
        <button type="button" onClick={onClose} className="btn btn-ink h-11">{t.confirm}</button>
      </div>
    </div>
  </Modal>;
}
