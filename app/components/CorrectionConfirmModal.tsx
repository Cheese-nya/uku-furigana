'use client';

import React, { useState } from 'react';
import { Modal } from './Modal';
import type { CorrectionMutation } from '../utils/readingHistory';
import type { Translations } from '../utils/i18n';

export interface PendingCorrectionChange {
  mutation: CorrectionMutation;
  /** Any manual reading on this range, including a longer word that contains it. */
  manual: boolean;
  /** The target is only part of a larger token, e.g. 人 inside 人生. */
  longWord: boolean;
}

export interface PendingCorrection {
  mode: 'bulk' | 'glossary' | 'restore';
  surface: string;
  reading: string;
  changes: PendingCorrectionChange[];
  manualCount: number;
  longWordCount: number;
  totalMatches: number;
}

interface CorrectionConfirmModalProps {
  correction: PendingCorrection | null;
  onCancel: () => void;
  onConfirm: (overwriteManual: boolean) => void;
  t: Translations;
}

function contextOf(line: string, start: number, surface: string) {
  return {
    before: line.slice(Math.max(0, start - 16), start),
    after: line.slice(start + surface.length, start + surface.length + 16),
  };
}

/**
 * Preview before a bulk correction. The literal substring can fall inside a longer word, so the
 * confirmation lists the real targets and defaults to leaving manual readings alone.
 */
export function CorrectionConfirmModal({ correction, onCancel, onConfirm, t }: CorrectionConfirmModalProps) {
  const [overwriteManual, setOverwriteManual] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  if (!correction) return null;

  const restore = correction.mode === 'restore';
  const willChange = restore
    ? correction.changes.length
    : correction.totalMatches - (overwriteManual ? 0 : correction.manualCount);
  const title = restore ? t.restoreAutomatic : t.bulkConfirmTitle;

  return (
    <Modal
      isOpen
      onClose={onCancel}
      title={title}
      maxWidth="sm"
      footer={(
        <>
          <button type="button" className="btn h-11 flex-1" onClick={onCancel}>{t.cancel}</button>
          <button
            type="button"
            className="btn btn-ink h-11 flex-1"
            disabled={willChange === 0}
            onClick={() => onConfirm(overwriteManual)}
          >
            {t.bulkConfirmApply.replace('{count}', String(willChange))}
          </button>
        </>
      )}
    >
      <div data-testid="bulk-correction-confirm" className="space-y-3">
        {restore ? (
          <p className="text-sm leading-relaxed text-[var(--label)]">
            {t.restoreConfirmText.replace('{count}', String(willChange))}
          </p>
        ) : (
          <p lang="ja" className="text-sm leading-relaxed text-[var(--label)]">
            {t.bulkConfirmText.replace('{surface}', correction.surface).replace('{reading}', correction.reading)}
          </p>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-xl bg-[var(--fill-2)] px-3 py-2 text-xs text-[var(--label-2)]">
          <span>{t.readingHistoryChanged.replace('{count}', String(willChange))}</span>
          {!restore && correction.manualCount > 0 && (
            <span>{overwriteManual
              ? t.bulkConfirmOverwriteCount.replace('{count}', String(correction.manualCount))
              : t.bulkConfirmSkip.replace('{count}', String(correction.manualCount))}</span>
          )}
          {correction.longWordCount > 0 && (
            <span className="text-[var(--review)]">{t.bulkConfirmLong.replace('{count}', String(correction.longWordCount))}</span>
          )}
        </div>

        {!restore && correction.manualCount > 0 && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--sep)] px-3 py-2.5">
            <input
              type="checkbox"
              checked={overwriteManual}
              onChange={event => setOverwriteManual(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--label)]"
            />
            <span className="text-sm">
              <b className="block font-semibold text-[var(--label)]">{t.bulkConfirmOverwrite}</b>
              <span className="text-xs text-[var(--label-2)]">
                {t.bulkConfirmOverwriteCount.replace('{count}', String(correction.manualCount))}
              </span>
            </span>
          </label>
        )}

        <button
          type="button"
          className="text-xs font-semibold text-[var(--label-2)] underline-offset-4 hover:underline"
          aria-expanded={showDetails}
          onClick={() => setShowDetails(value => !value)}
        >
          {t.bulkConfirmPreview} · {correction.changes.length}
        </button>

        {showDetails && (
          <div className="max-h-[34vh] space-y-1.5 overflow-y-auto pr-1">
            {correction.changes.map((change, index) => {
              const { line, start, surface } = change.mutation;
              const context = contextOf(line, start, surface);
              return (
                <div key={`${line}\0${change.mutation.lineOccurrence}\0${start}\0${surface}\0${index}`}
                  className="rounded-lg bg-[var(--fill-2)] px-2.5 py-2 text-xs">
                  <div lang="ja" className="leading-relaxed text-[var(--label-2)]">
                    {context.before}
                    <b className={change.longWord ? 'bg-[var(--review-wash)] px-0.5 font-semibold text-[var(--label)]' : 'px-0.5 font-semibold text-[var(--label)]'}>
                      {surface}
                    </b>
                    {context.after}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-[var(--label-3)]">
                    {change.manual && <span>· {t.statManual}</span>}
                    {change.longWord && <span className="text-[var(--review)]">· {t.readingHistoryLongWord.replace('{count}', '1')}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
