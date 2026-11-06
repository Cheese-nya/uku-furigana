import {
  setScriptOverrides,
  type CorrectionDatabaseV2,
  type LearnedReading,
  type ReadingHistoryChange,
  type ReadingHistoryEntry,
  type ReadingHistoryKind,
  type ScriptCorrectionEntry,
} from './correctionDatabase';
import { readingContext } from './review';
import type { RubyType } from './furigana';
import { validateRubyOverrides, type RubyOverride } from './rubyOverrides';

export const READING_HISTORY_LIMIT = 500;

export interface CorrectionMutation {
  line: string;
  lineOccurrence: number;
  start: number;
  surface: string;
  /** null restores the automatic reading; '' explicitly suppresses ruby. */
  reading: string | null;
  type: RubyType;
  removeLearned?: boolean;
}

export interface CorrectionOperationMeta {
  skippedManual?: number;
  totalMatches?: number;
}

function normalizedLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function rangesOverlap(left: { start: number; surface: string }, right: { start: number; surface: string }) {
  return left.start < right.start + right.surface.length && right.start < left.start + left.surface.length;
}

/** The nth occurrence of `text` in the document, or -1 when the document no longer has it. */
export function occurrenceStart(lines: string[], line: string, occurrence: number): number {
  let seen = 0;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index] !== line) continue;
    if (seen === occurrence) return index;
    seen++;
  }
  return -1;
}

export function lineOccurrenceAt(lines: string[], index: number): number {
  const line = lines[index];
  let seen = 0;
  for (let cursor = 0; cursor < index; cursor++) if (lines[cursor] === line) seen++;
  return seen;
}

/**
 * Turn old line-wide manual overrides into one entry per identical-line occurrence. The visible
 * reading stays the same; the conversion is what lets a later "this occurrence only" edit or
 * restore leave the other identical lines alone.
 */
export function materializeLegacyOverrides(overrides: RubyOverride[], text: string, lineTexts: string[]): RubyOverride[] {
  const lines = normalizedLines(text);
  let next = overrides;
  for (const line of new Set(lineTexts)) {
    const legacy = next.filter(entry => entry.line === line && entry.lineOccurrence === undefined);
    if (!legacy.length) continue;
    const indexes = lines.flatMap((value, index) => value === line ? [index] : []);
    if (!indexes.length) continue;
    next = next.filter(entry => !legacy.includes(entry));
    next = [...next, ...indexes.flatMap((_, occurrence) =>
      legacy.map(entry => ({ ...entry, lineOccurrence: occurrence })))];
  }
  return next;
}

function specificEntries(overrides: RubyOverride[], target: ReadingHistoryChange['target']): RubyOverride[] {
  return overrides.filter(entry => entry.line === target.line &&
    entry.lineOccurrence === target.lineOccurrence && rangesOverlap(entry, target));
}

function sameEntries(left: RubyOverride[], right: RubyOverride[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutLearned(learned: LearnedReading[], removed: LearnedReading[]): LearnedReading[] {
  return learned.filter(item => !removed.some(value =>
    value.surface === item.surface && value.reading === item.reading && value.type === item.type &&
    value.before === item.before && value.after === item.after));
}

function withLearned(learned: LearnedReading[], added: LearnedReading[]): LearnedReading[] {
  let next = learned;
  for (const item of added) {
    const exists = next.some(value => value.surface === item.surface && value.reading === item.reading &&
      value.type === item.type && value.before === item.before && value.after === item.after);
    if (!exists) next = [...next, item];
  }
  return next;
}

function learnedForTarget(learned: LearnedReading[], mutation: CorrectionMutation): LearnedReading[] {
  if (!mutation.removeLearned) return [];
  const context = readingContext(mutation.line, mutation.start, mutation.surface.length);
  return learned.filter(entry => entry.surface === mutation.surface &&
    entry.before === context.before && entry.after === context.after);
}

function appendHistory(script: ScriptCorrectionEntry, entry: ReadingHistoryEntry): ReadingHistoryEntry[] {
  return [...(script.history || []), entry].slice(-READING_HISTORY_LIMIT);
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Apply one user operation atomically and append a single history record, even when it changes
 * hundreds of occurrences. Returns the original database when nothing actually changed.
 */
export function applyCorrectionOperation(
  database: CorrectionDatabaseV2,
  scriptId: string,
  documentText: string,
  mutations: CorrectionMutation[],
  kind: ReadingHistoryKind,
  meta: CorrectionOperationMeta = {},
  now = Date.now(),
): { database: CorrectionDatabaseV2; entry: ReadingHistoryEntry | null } {
  const script = database.scripts[scriptId];
  if (!script || mutations.length === 0) return { database, entry: null };
  const lines = normalizedLines(documentText);
  const valid = mutations.filter(mutation => {
    const index = occurrenceStart(lines, mutation.line, mutation.lineOccurrence);
    return index >= 0 && mutation.line.slice(mutation.start, mutation.start + mutation.surface.length) === mutation.surface;
  });
  if (!valid.length) return { database, entry: null };

  let overrides = materializeLegacyOverrides(script.overrides, documentText, valid.map(value => value.line));
  let learned = script.learned;
  const changes: ReadingHistoryChange[] = [];

  for (const mutation of valid) {
    const target = {
      line: mutation.line,
      lineOccurrence: mutation.lineOccurrence,
      start: mutation.start,
      surface: mutation.surface,
    };
    const before = specificEntries(overrides, target);
    const after: RubyOverride[] = mutation.reading === null ? [] : [{
      line: mutation.line,
      lineOccurrence: mutation.lineOccurrence,
      start: mutation.start,
      surface: mutation.surface,
      reading: mutation.reading,
      type: mutation.type,
    }];
    const removedLearned = learnedForTarget(learned, mutation);
    if (sameEntries(before, after) && removedLearned.length === 0) continue;
    overrides = [...overrides.filter(entry => !before.includes(entry)), ...after];
    learned = withoutLearned(learned, removedLearned);
    changes.push({
      target,
      before,
      after,
      ...(removedLearned.length ? { learnedBefore: removedLearned, learnedAfter: [] } : {}),
    });
  }

  if (!changes.length) return { database, entry: null };
  const entry: ReadingHistoryEntry = {
    id: newId(),
    kind,
    createdAt: now,
    changes,
    ...(meta.skippedManual !== undefined ? { skippedManual: meta.skippedManual } : {}),
    ...(meta.totalMatches !== undefined ? { totalMatches: meta.totalMatches } : {}),
  };
  let updated = setScriptOverrides(database, scriptId, overrides);
  const latest = updated.scripts[scriptId];
  updated = {
    ...updated,
    scripts: {
      ...updated.scripts,
      [scriptId]: { ...latest, learned, history: appendHistory(latest, entry) },
    },
  };
  return { database: updated, entry };
}

/**
 * Reverse one history entry on top of the current state. Entries whose target has since been
 * changed are skipped instead of overwriting the newer work.
 */
export function revertHistoryEntry(
  database: CorrectionDatabaseV2,
  scriptId: string,
  documentText: string,
  historyId: string,
  onlyChange?: number,
): { database: CorrectionDatabaseV2; applied: number; skipped: number; entry: ReadingHistoryEntry | null } {
  const script = database.scripts[scriptId];
  const source = script?.history?.find(entry => entry.id === historyId);
  if (!script || !source) return { database, applied: 0, skipped: 0, entry: null };
  const selected = onlyChange === undefined ? source.changes : source.changes.slice(onlyChange, onlyChange + 1);
  if (!selected.length) return { database, applied: 0, skipped: 0, entry: null };

  const lines = normalizedLines(documentText);
  let overrides = materializeLegacyOverrides(script.overrides, documentText, selected.map(change => change.target.line));
  let learned = script.learned;
  const changes: ReadingHistoryChange[] = [];
  let skipped = 0;

  for (const change of selected) {
    if (occurrenceStart(lines, change.target.line, change.target.lineOccurrence) < 0 ||
      !sameEntries(specificEntries(overrides, change.target), change.after)) {
      skipped++;
      continue;
    }
    const current = specificEntries(overrides, change.target);
    overrides = [...overrides.filter(entry => !current.includes(entry)), ...change.before];
    const removedLearned = change.learnedAfter || [];
    learned = withoutLearned(learned, removedLearned);
    learned = withLearned(learned, change.learnedBefore || []);
    changes.push({
      target: change.target,
      before: current,
      after: change.before,
      learnedBefore: change.learnedAfter,
      learnedAfter: change.learnedBefore,
    });
  }

  if (!changes.length) return { database, applied: 0, skipped, entry: null };
  let updated = setScriptOverrides(database, scriptId, overrides);
  const latest = updated.scripts[scriptId];
  const entry: ReadingHistoryEntry = {
    id: newId(),
    kind: source.kind === 'undo' ? 'redo' : 'undo',
    createdAt: Date.now(),
    changes,
    supersedes: source.id,
    ...(skipped ? { skipped } : {}),
  };
  updated = {
    ...updated,
    scripts: {
      ...updated.scripts,
      [scriptId]: { ...latest, learned, history: appendHistory(latest, entry) },
    },
  };
  return { database: updated, applied: changes.length, skipped, entry };
}

/**
 * Current target snapshot used by the UI to explain a conflict. Specific entries only: legacy
 * entries are materialized by the history command before it compares.
 */
export function targetSnapshot(overrides: RubyOverride[], target: ReadingHistoryChange['target']): RubyOverride[] {
  return specificEntries(validateRubyOverrides(overrides), target);
}
