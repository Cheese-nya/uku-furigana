export type OcrEnginePreference = 'auto' | 'ndlocr-lite' | 'apple-vision';
export type OcrEngineUsed = 'ndlocr-lite' | 'apple-vision';

export type OcrLineRole =
  | 'main'
  | 'title'
  | 'caption'
  | 'note'
  | 'ruby'
  | 'ad'
  | 'figure'
  | 'running-head'
  | 'unknown';

export interface OcrRawBox {
  /** Pixel coordinates in the source image (top-left origin). */
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence: number;
  role: OcrLineRole;
  vertical: boolean;
  /** Optional NDLOCR-Lite DEIM predicted character bucket (3: <=30, 2: <=50, 1: <=100). */
  predCharCount?: number;
}

export interface OcrPageResult {
  pageIndex?: number;
  pageWidth: number;
  pageHeight: number;
  boxes: OcrRawBox[];
  engineUsed: OcrEngineUsed;
  elapsedMs: number;
  warnings: string[];
}

export interface OcrSettings {
  engine: OcrEnginePreference;
  /** Filter out furigana / ruby printed on the source image. */
  filterRuby: boolean;
  /** Automatically invoke local OCR when importing a scanned or mixed PDF. */
  autoOcrScannedPdf: boolean;
}

export interface OcrProgress {
  stage: 'loading-model' | 'detect' | 'recognize';
  current: number;
  total?: number;
}
