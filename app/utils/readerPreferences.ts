export type ReaderFontFamily = 'serif' | 'sans';
export type ReaderWritingMode = 'horizontal' | 'vertical';

export interface ReaderPrefs {
  fontFamily: ReaderFontFamily;
  fontSize: number;
  showRuby: boolean;
  writingMode: ReaderWritingMode;
  bilingual: boolean;
}

export const READER_PREFS_KEY = 'furigana_reader_prefs_v3';
export const READER_FONT_SIZE_MIN = 14;
export const READER_FONT_SIZE_MAX = 40;

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontFamily: 'serif',
  fontSize: 19,
  showRuby: true,
  writingMode: 'horizontal',
  bilingual: false,
};

export function clampReaderFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_READER_PREFS.fontSize;
  return Math.min(READER_FONT_SIZE_MAX, Math.max(READER_FONT_SIZE_MIN, Math.round(value)));
}

/** Parses the stored JSON without touching storage, clamping old values to the current range. */
export function parseReaderPrefs(raw: string | null): ReaderPrefs {
  if (!raw) return { ...DEFAULT_READER_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      fontFamily: parsed.fontFamily === 'sans' ? 'sans' : 'serif',
      fontSize: clampReaderFontSize(parsed.fontSize),
      showRuby: typeof parsed.showRuby === 'boolean' ? parsed.showRuby : true,
      writingMode: parsed.writingMode === 'vertical' ? 'vertical' : 'horizontal',
      bilingual: parsed.bilingual === true,
    };
  } catch {
    return { ...DEFAULT_READER_PREFS };
  }
}

export function loadReaderPrefs(): ReaderPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_READER_PREFS };
  try {
    return parseReaderPrefs(window.localStorage.getItem(READER_PREFS_KEY));
  } catch {
    return { ...DEFAULT_READER_PREFS };
  }
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(READER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable in private or embedded webviews.
  }
}
