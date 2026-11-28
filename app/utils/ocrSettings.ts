import type { OcrSettings } from './ocrTypes';

const STORAGE_KEY = 'uku_ocr_settings_v1';

export const DEFAULT_OCR_SETTINGS: OcrSettings = {
  engine: 'auto',
  filterRuby: true,
  autoOcrScannedPdf: true,
};

export function loadOcrSettings(): OcrSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_OCR_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OCR_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<OcrSettings>;
    const engine =
      parsed.engine === 'auto' || parsed.engine === 'ndlocr-lite' || parsed.engine === 'apple-vision'
        ? parsed.engine
        : DEFAULT_OCR_SETTINGS.engine;
    return {
      engine,
      filterRuby: typeof parsed.filterRuby === 'boolean' ? parsed.filterRuby : DEFAULT_OCR_SETTINGS.filterRuby,
      autoOcrScannedPdf:
        typeof parsed.autoOcrScannedPdf === 'boolean'
          ? parsed.autoOcrScannedPdf
          : DEFAULT_OCR_SETTINGS.autoOcrScannedPdf,
    };
  } catch {
    return { ...DEFAULT_OCR_SETTINGS };
  }
}

export function saveOcrSettings(next: OcrSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing or quota errors should never block OCR usage.
  }
}
