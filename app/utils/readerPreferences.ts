export type ReaderFontFamily = 'serif' | 'sans';
export type ReaderWritingMode = 'horizontal' | 'vertical';
export type ReaderTheme = 'system' | 'paper' | 'sepia' | 'night';
export type ReaderContentWidth = 'narrow' | 'medium' | 'wide';

export interface ReaderPrefs {
  fontFamily: ReaderFontFamily;
  fontSize: number;
  lineHeight: number;
  contentWidth: ReaderContentWidth;
  readerTheme: ReaderTheme;
  showRuby: boolean;
  writingMode: ReaderWritingMode;
  bilingual: boolean;
  sidePageTurn: boolean;
  volumePageTurn: boolean;
  autoMode: 'scroll' | 'page';
  autoSpeed: number;
  autoInterval: number;
}

export const READER_PREFS_KEY = 'furigana_reader_prefs_v3';
export const READER_FONT_SIZE_MIN = 14;
export const READER_FONT_SIZE_MAX = 40;
export const READER_LINE_HEIGHT_MIN = 1.6;
export const READER_LINE_HEIGHT_MAX = 3.0;

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontFamily: 'serif',
  fontSize: 19,
  lineHeight: 2.35,
  contentWidth: 'medium',
  readerTheme: 'system',
  showRuby: true,
  writingMode: 'horizontal',
  bilingual: false,
  sidePageTurn: false,
  volumePageTurn: false,
  autoMode: 'scroll',
  autoSpeed: 30,
  autoInterval: 10,
};

export function clampReaderFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_READER_PREFS.fontSize;
  return Math.min(READER_FONT_SIZE_MAX, Math.max(READER_FONT_SIZE_MIN, Math.round(value)));
}

export function clampReaderLineHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_READER_PREFS.lineHeight;
  const clamped = Math.min(READER_LINE_HEIGHT_MAX, Math.max(READER_LINE_HEIGHT_MIN, value));
  return Math.round(clamped * 20) / 20;
}

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function validContentWidth(value: unknown): ReaderContentWidth {
  return value === 'narrow' || value === 'wide' ? value : 'medium';
}

function validReaderTheme(value: unknown): ReaderTheme {
  return value === 'paper' || value === 'sepia' || value === 'night' ? value : 'system';
}

/** Parses the stored JSON without touching storage, clamping old values to the current range. */
export function parseReaderPrefs(raw: string | null): ReaderPrefs {
  if (!raw) return { ...DEFAULT_READER_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      fontFamily: parsed.fontFamily === 'sans' ? 'sans' : 'serif',
      fontSize: clampReaderFontSize(parsed.fontSize),
      lineHeight: clampReaderLineHeight(parsed.lineHeight),
      contentWidth: validContentWidth(parsed.contentWidth),
      readerTheme: validReaderTheme(parsed.readerTheme),
      showRuby: typeof parsed.showRuby === 'boolean' ? parsed.showRuby : true,
      writingMode: parsed.writingMode === 'vertical' ? 'vertical' : 'horizontal',
      bilingual: parsed.bilingual === true,
      sidePageTurn: parsed.sidePageTurn === true,
      volumePageTurn: parsed.volumePageTurn === true,
      autoMode: parsed.autoMode === 'page' ? 'page' : 'scroll',
      autoSpeed: bounded(parsed.autoSpeed, 30, 10, 100),
      autoInterval: bounded(parsed.autoInterval, 10, 3, 60),
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
