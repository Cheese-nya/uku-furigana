'use client';

import React, { useState } from 'react';
import { Modal } from './Modal';
import type { ReadingHistoryEntry, ReadingHistoryKind, ReadingHistoryTarget } from '../utils/correctionDatabase';
import { occurrenceStart, targetSnapshot } from '../utils/readingHistory';
import type { RubyOverride } from '../utils/rubyOverrides';
import type { Translations } from '../utils/i18n';

interface ReadingHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: ReadingHistoryEntry[];
  currentOverrides: RubyOverride[];
  documentLines: string[];
  manualOverrideCount: number;
  onLocate: (target: ReadingHistoryTarget) => void;
  onRevert: (historyId: string, onlyChange?: number) => void;
  t: Translations;
}

function entryKindLabel(kind: ReadingHistoryKind, t: Translations) {
  switch (kind) {
    case 'edit': return t.readingHistoryEntryEdit;
    case 'bulk-edit': return t.readingHistoryEntryBulkEdit;
    case 'restore': return t.readingHistoryEntryRestore;
    case 'bulk-restore': return t.readingHistoryEntryBulkRestore;
    case 'undo': return t.readingHistoryEntryUndo;
    case 'redo': return t.readingHistoryEntryRedo;
  }
}

function readings(entries: RubyOverride[], t: Translations) {
  if (!entries.length) return t.readingHistoryAuto;
  return [...new Set(entries.map(entry => entry.reading || '∅'))].join(' / ');
}

function when(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

/**
 * Reverse-chronological reading-edit timeline. Each operation is one row; its per-occurrence
 * changes stay collapsed until the user asks for them. Reverting an operation never touches a
 * target that has been edited since.
 */
export function ReadingHistoryModal({
  isOpen, onClose, history, currentOverrides, documentLines, manualOverrideCount, onLocate, onRevert, t,
}: ReadingHistoryModalProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const entries = [...history].reverse();

  const toggle = (id: string) => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t.readingHistoryTitle} maxWidth="lg">
      {entries.length === 0 && manualOverrideCount === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--label-2)]">{t.readingHistoryEmpty}</p>
      ) : (
        <div className="space-y-2.5 pb-1" data-testid="reading-history-list">
          {manualOverrideCount > 0 && (
            <p className="rounded-xl bg-[var(--fill-2)] px-3 py-2.5 text-xs leading-relaxed text-[var(--label-2)]">
              {t.readingHistoryLegacyNote.replace('{count}', String(manualOverrideCount))}
            </p>
          )}

          {entries.map(entry => {
            const isOpen = expanded.has(entry.id);
            const actionLabel = entry.kind === 'undo' ? t.readingHistoryEntryRedo : t.readingHistoryEntryUndo;
            return (
              <article key={entry.id} className="rounded-[16px] border border-[var(--sep)] bg-[var(--surface)]/60 p-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <b className="text-sm font-semibold text-[var(--label)]">{entryKindLabel(entry.kind, t)}</b>
                  <span className="text-[11px] tabular-nums text-[var(--label-3)]">{when(entry.createdAt)}</span>
                  <span className="text-xs text-[var(--label-2)]">
                    {t.readingHistoryChanged.replace('{count}', String(entry.changes.length))}
                  </span>
                  {(entry.skippedManual || 0) > 0 && (
                    <span className="text-xs text-[var(--label-2)]">
                      {t.readingHistorySkippedManual.replace('{count}', String(entry.skippedManual))}
                    </span>
                  )}
                  {(entry.skipped || 0) > 0 && (
                    <span className="text-xs text-[var(--review)]">
                      {t.readingHistorySkippedConflicts.replace('{count}', String(entry.skipped))}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn h-8 !px-3 text-xs" onClick={() => onRevert(entry.id)}>
                    {actionLabel}
                  </button>
                  <button
                    type="button"
                    className="btn h-8 !px-3 text-xs"
                    aria-expanded={isOpen}
                    onClick={() => toggle(entry.id)}
                  >
                    {t.readingHistoryDetails} · {entry.changes.length}
                  </button>
                </div>

                {isOpen && (
                  <div className="mt-2.5 max-h-[36vh] space-y-1.5 overflow-y-auto border-t border-[var(--sep)] pt-2.5">
                    {entry.changes.map((change, index) => {
                      const lineIndex = occurrenceStart(documentLines, change.target.line, change.target.lineOccurrence);
                      const current = targetSnapshot(currentOverrides, change.target);
                      const changedLater = JSON.stringify(current) !== JSON.stringify(change.after);
                      const context = change.target.line;
                      const start = Math.max(0, change.target.start - 14);
                      const end = Math.min(context.length, change.target.start + change.target.surface.length + 14);
                      return (
                        <div key={`${entry.id}:${index}`} className="rounded-lg bg-[var(--fill-2)] px-2.5 py-2 text-xs">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--label-3)]">
                            <span>{lineIndex >= 0 ? `#${lineIndex + 1}` : t.readingHistoryOriginalChanged}</span>
                            <span lang="ja" className="min-w-0 truncate text-[var(--label-2)]">
                              {start > 0 ? '…' : ''}
                              {context.slice(start, end)}
                              {end < context.length ? '…' : ''}
                            </span>
                          </div>
                          <div className="mt-1 font-medium text-[var(--label)]">
                            <span lang="ja">{change.target.surface}</span>
                            <span className="mx-1.5 text-[var(--label-3)]" aria-hidden>·</span>
                            <span>{readings(change.before, t)}</span>
                            <span className="mx-1 text-[var(--label-3)]" aria-hidden>→</span>
                            <span>{readings(change.after, t)}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className="font-semibold text-[var(--label-2)] underline-offset-4 hover:underline disabled:opacity-40"
                              disabled={lineIndex < 0}
                              onClick={() => onLocate(change.target)}
                            >
                              {t.readingHistoryLocate}
                            </button>
                            <button
                              type="button"
                              className="font-semibold text-[var(--label-2)] underline-offset-4 hover:underline disabled:opacity-40"
                              disabled={lineIndex < 0 || changedLater}
                              onClick={() => onRevert(entry.id, index)}
                            >
                              {t.readingHistoryRestoreItem}
                            </button>
                            {changedLater && <span className="text-[var(--review)]">{t.readingHistoryChangedLater}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
