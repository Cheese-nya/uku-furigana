import { uniqueId } from './uniqueId';
import type { RubyType } from './furigana';
import { validateRubyOverrides, type RubyOverride } from './rubyOverrides';

export interface ProperNounEntry {
  surface: string;
  reading: string;
  type: RubyType;
  createdAt: number;
}

export interface LearnedReading {
  surface: string;
  reading: string;
  alternatives: string[];
  type: RubyType;
  before: string;
  after: string;
  createdAt: number;
}

export interface ReadingHistoryTarget {
  line: string;
  lineOccurrence: number;
  start: number;
  surface: string;
}

export interface ReadingHistoryChange {
  target: ReadingHistoryTarget;
  /** All occurrence-scoped manual entries removed by the operation, in stored order. */
  before: RubyOverride[];
  /** All occurrence-scoped manual entries written by the operation. */
  after: RubyOverride[];
  /** Context-learned readings before and after the change (restore operations only). */
  learnedBefore?: LearnedReading[];
  learnedAfter?: LearnedReading[];
}

export type ReadingHistoryKind = 'edit' | 'bulk-edit' | 'restore' | 'bulk-restore' | 'undo' | 'redo';

export interface ReadingHistoryEntry {
  id: string;
  kind: ReadingHistoryKind;
  createdAt: number;
  changes: ReadingHistoryChange[];
  /** Occurrences deliberately left alone because they already had a manual reading. */
  skippedManual?: number;
  /** Literal substring hits considered by a bulk operation, including skipped ones. */
  totalMatches?: number;
  /** Operation this one reverses (undo/redo only). */
  supersedes?: string;
  /** Applied when reversing this entry was blocked because the current values differ. */
  skipped?: number;
}

export interface ScriptCorrectionEntry {
  scriptId: string;
  title: string;
  // Keep previous fingerprints so re-importing an earlier revision retains identity.
  fingerprints: string[];
  updatedAt: number;
  overrides: RubyOverride[];
  learned: LearnedReading[];
  /** Newest-last operations; capped by the app. Older databases simply have no field. */
  history?: ReadingHistoryEntry[];
  legacy?: boolean;
  adoptedBy?: string;
}

export interface CorrectionDatabaseV2 {
  version: 2;
  glossary: Record<string, ProperNounEntry>;
  scripts: Record<string, ScriptCorrectionEntry>;
}

export function emptyDatabase(): CorrectionDatabaseV2 {
  return { version: 2, glossary: {}, scripts: {} };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validOverrides(value: unknown): RubyOverride[] {
  const entries = validateRubyOverrides(value);
  if (!Array.isArray(value) || entries.length !== value.length) throw new Error('校对记录格式损坏，原数据已保留');
  return entries;
}

function validateLearned(value: unknown): LearnedReading[] {
  if (!Array.isArray(value)) throw new Error('学习读音格式无效');
  return value.filter((item): item is LearnedReading => {
    if (!object(item) || typeof item.surface !== 'string' || !item.surface || typeof item.reading !== 'string' || !item.reading ||
      !Array.isArray(item.alternatives) || !item.alternatives.every(value => typeof value === 'string') ||
      typeof item.before !== 'string' || typeof item.after !== 'string' ||
      !['hiragana', 'katakana', 'romaji'].includes(String(item.type)) || !Number.isFinite(item.createdAt)) {
      throw new Error('学习读音条目无效');
    }
    return true;
  });
}

const HISTORY_KINDS = ['edit', 'bulk-edit', 'restore', 'bulk-restore', 'undo', 'redo'] as const;

function validateHistory(value: unknown): ReadingHistoryEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('注音修改历史格式无效');
  return value.map((raw, index) => {
    if (!object(raw) || typeof raw.id !== 'string' || !raw.id ||
      !HISTORY_KINDS.includes(raw.kind as typeof HISTORY_KINDS[number]) || !Number.isFinite(raw.createdAt) ||
      !Array.isArray(raw.changes) || (raw.supersedes !== undefined && typeof raw.supersedes !== 'string') ||
      (raw.skippedManual !== undefined && (!Number.isInteger(raw.skippedManual) || (raw.skippedManual as number) < 0)) ||
      (raw.totalMatches !== undefined && (!Number.isInteger(raw.totalMatches) || (raw.totalMatches as number) < 0)) ||
      (raw.skipped !== undefined && (!Number.isInteger(raw.skipped) || (raw.skipped as number) < 0))) {
      throw new Error(`注音修改历史条目无效：${index}`);
    }
    const changes = raw.changes.map((change, changeIndex): ReadingHistoryChange => {
      if (!object(change) || !object(change.target)) throw new Error(`注音修改历史变更无效：${index}.${changeIndex}`);
      const target = change.target;
      if (typeof target.line !== 'string' || !Number.isInteger(target.lineOccurrence) || (target.lineOccurrence as number) < 0 ||
        !Number.isInteger(target.start) || (target.start as number) < 0 || typeof target.surface !== 'string' || !target.surface ||
        target.line.slice(target.start as number, (target.start as number) + target.surface.length) !== target.surface ||
        !Array.isArray(change.before) || !Array.isArray(change.after)) {
        throw new Error(`注音修改历史定位无效：${index}.${changeIndex}`);
      }
      const before = validOverrides(change.before);
      const after = validOverrides(change.after);
      if (before.length !== change.before.length || after.length !== change.after.length) {
        throw new Error(`注音修改历史注音无效：${index}.${changeIndex}`);
      }
      const learnedBefore = change.learnedBefore === undefined ? undefined : validateLearned(change.learnedBefore);
      const learnedAfter = change.learnedAfter === undefined ? undefined : validateLearned(change.learnedAfter);
      return {
        target: { line: target.line, lineOccurrence: target.lineOccurrence as number,
          start: target.start as number, surface: target.surface },
        before,
        after,
        ...(learnedBefore ? { learnedBefore } : {}),
        ...(learnedAfter ? { learnedAfter } : {}),
      };
    });
    return {
      id: raw.id as string,
      kind: raw.kind as ReadingHistoryKind,
      createdAt: raw.createdAt as number,
      changes,
      ...(raw.skippedManual !== undefined ? { skippedManual: raw.skippedManual as number } : {}),
      ...(raw.totalMatches !== undefined ? { totalMatches: raw.totalMatches as number } : {}),
      ...(raw.supersedes !== undefined ? { supersedes: raw.supersedes as string } : {}),
      ...(raw.skipped !== undefined ? { skipped: raw.skipped as number } : {}),
    };
  });
}

export function validateGlossary(value: unknown): Record<string, ProperNounEntry> {
  if (!object(value)) throw new Error('专名词典格式无效');
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (!object(item) || typeof item.surface !== 'string' || !item.surface.trim() || item.surface.includes('\n') ||
      key !== item.surface || typeof item.reading !== 'string' || !item.reading.trim() || item.reading.includes('\n') ||
      !['hiragana', 'katakana', 'romaji'].includes(String(item.type)) || !Number.isFinite(item.createdAt)) {
      throw new Error(`专名词典条目无效：${key}`);
    }
    return [key, { surface: item.surface, reading: item.reading, type: item.type as RubyType, createdAt: item.createdAt as number }];
  }));
}

/** Strict validation: never turn an unreadable database into an empty writable one. */
export function migrateDatabase(value: unknown): CorrectionDatabaseV2 {
  if (!object(value)) throw new Error('校对数据库格式无效');
  if (value.version === 2) {
    if (!object(value.scripts)) throw new Error('台本校对格式无效');
    const scripts = Object.fromEntries(Object.entries(value.scripts).map(([id, item]) => {
      if (!object(item) || item.scriptId !== id || typeof item.title !== 'string' ||
        !Array.isArray(item.fingerprints) || !item.fingerprints.every(fp => typeof fp === 'string' && /^sha256:[a-f0-9]{64}$/.test(fp)) ||
        !Number.isFinite(item.updatedAt) || (item.legacy !== undefined && typeof item.legacy !== 'boolean') ||
        (item.adoptedBy !== undefined && typeof item.adoptedBy !== 'string')) throw new Error(`台本记录无效：${id}`);
      const history = validateHistory(item.history);
      return [id, { scriptId: id, title: item.title, fingerprints: item.fingerprints as string[],
        updatedAt: item.updatedAt as number, overrides: validOverrides(item.overrides), learned: validateLearned(item.learned || []),
        ...(history ? { history } : {}),
        ...(item.legacy ? { legacy: true } : {}), ...(item.adoptedBy ? { adoptedBy: item.adoptedBy as string } : {}) }];
    }));
    return { version: 2, glossary: validateGlossary(value.glossary), scripts };
  }
  // v1 keys are arbitrary titles, including the literal title "version".
  if (typeof value.version === 'number' && value.version !== 1) throw new Error(`不支持校对数据库版本：${String(value.version)}`);
  const library = value.version === 1 ? value.scripts : value;
  if (!object(library)) throw new Error('旧版校对格式无效');
  const scripts = Object.fromEntries(Object.entries(library).map(([title, entries]) => {
    const id = `legacy:${title}`;
    return [id, { scriptId: id, title, fingerprints: [], updatedAt: 0, overrides: validOverrides(entries), learned: [], legacy: true }];
  }));
  return { version: 2, glossary: {}, scripts };
}

export async function fingerprintText(text: string): Promise<string> {
  // Preserve spaces and empty lines; offsets and identical-line matching depend on them.
  const bytes = new TextEncoder().encode(text.replace(/\r\n?/g, '\n'));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function findScript(database: CorrectionDatabaseV2, fingerprint: string): ScriptCorrectionEntry | undefined {
  return Object.values(database.scripts).find(script => !script.legacy && script.fingerprints.includes(fingerprint));
}

export function resolveScript(database: CorrectionDatabaseV2, title: string, text: string, fingerprint: string, id = `script:${uniqueId()}`) {
  const known = findScript(database, fingerprint);
  if (known) return { database, scriptId: known.scriptId };
  const legacy = Object.values(database.scripts).find(script => script.legacy && !script.adoptedBy && script.title === title &&
    script.overrides.some(entry => text.split('\n').includes(entry.line)));
  const script: ScriptCorrectionEntry = { scriptId: id, title, fingerprints: [fingerprint], updatedAt: Date.now(),
    overrides: legacy?.overrides || [], learned: legacy?.learned || [], history: [] };
  return { scriptId: id, database: { ...database, scripts: { ...database.scripts,
    ...(legacy ? { [legacy.scriptId]: { ...legacy, adoptedBy: id } } : {}), [id]: script } } };
}

export function updateScript(database: CorrectionDatabaseV2, scriptId: string, title: string, fingerprint: string): CorrectionDatabaseV2 {
  const script = database.scripts[scriptId];
  if (!script) return database;
  if (script.title === title && script.fingerprints.includes(fingerprint)) return database;
  return { ...database, scripts: { ...database.scripts, [scriptId]: { ...script, title, updatedAt: Date.now(),
    fingerprints: script.fingerprints.includes(fingerprint) ? script.fingerprints : [...script.fingerprints, fingerprint] } } };
}

export function setScriptOverrides(database: CorrectionDatabaseV2, scriptId: string, overrides: RubyOverride[]): CorrectionDatabaseV2 {
  const script = database.scripts[scriptId];
  if (!script) return database;
  return { ...database, scripts: { ...database.scripts, [scriptId]: { ...script, overrides, updatedAt: Date.now() } } };
}

export function learnReading(database: CorrectionDatabaseV2, scriptId: string, learned: LearnedReading): CorrectionDatabaseV2 {
  const script = database.scripts[scriptId];
  if (!script) return database;
  const same = (value: LearnedReading) => value.surface === learned.surface && value.type === learned.type &&
    value.before === learned.before && value.after === learned.after;
  const learnedList = [...script.learned.filter(value => !same(value)), learned];
  return { ...database, scripts: { ...database.scripts, [scriptId]: { ...script, learned: learnedList, updatedAt: Date.now() } } };
}

export function deleteLearnedReading(database: CorrectionDatabaseV2, scriptId: string, index: number): CorrectionDatabaseV2 {
  const script = database.scripts[scriptId];
  if (!script) return database;
  const learnedList = script.learned.filter((_, i) => i !== index);
  return { ...database, scripts: { ...database.scripts, [scriptId]: { ...script, learned: learnedList, updatedAt: Date.now() } } };
}
