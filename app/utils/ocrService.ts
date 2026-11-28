import { getPlatform } from './appInfo';
import { logEvent } from './appLog';
import { throwIfAborted } from './importErrors';
import { loadOcrSettings } from './ocrSettings';
import type { OcrEngineUsed, OcrPageResult, OcrProgress, OcrRawBox } from './ocrTypes';

let ocrClientModulePromise: Promise<typeof import('./ocrClient')> | null = null;
let loadedOcrClientModule: typeof import('./ocrClient') | null = null;

async function getLazyOcrWorkerClient() {
  if (!ocrClientModulePromise) {
    ocrClientModulePromise = import('./ocrClient').then(mod => {
      loadedOcrClientModule = mod;
      return mod;
    });
  }
  const mod = await ocrClientModulePromise;
  return mod.getOcrWorkerClient();
}

interface NativeOcrBoxPayload {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence?: number;
  vertical?: boolean;
}

interface NativeOcrResponse {
  width: number;
  height: number;
  boxes: NativeOcrBoxPayload[];
  elapsedMs?: number;
}

interface IosOcrBridge {
  isNative?: boolean;
  engine?: string;
  recognize(base64Image: string): Promise<NativeOcrResponse>;
}

let cachedMacVisionAvailable: boolean | null = null;

function getIosOcrBridge(): IosOcrBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { furiganaOcr?: IosOcrBridge }).furiganaOcr;
  return bridge && bridge.isNative && typeof bridge.recognize === 'function' ? bridge : null;
}

export async function isAppleVisionAvailable(): Promise<boolean> {
  if (getIosOcrBridge()) return true;
  if (getPlatform() !== 'desktop') return false;
  if (cachedMacVisionAvailable !== null) return cachedMacVisionAvailable;
  try {
    const res = await fetch('/api/native-ocr/status', { cache: 'no-store' });
    if (!res.ok) {
      cachedMacVisionAvailable = false;
      return false;
    }
    const json = (await res.json()) as { available?: boolean };
    cachedMacVisionAvailable = Boolean(json.available);
    return cachedMacVisionAvailable;
  } catch {
    cachedMacVisionAvailable = false;
    return false;
  }
}

function toVisionPageResult(data: NativeOcrResponse, elapsedFallbackMs: number): OcrPageResult {
  const boxes: OcrRawBox[] = (data.boxes || []).map(box => ({
    x: Number(box.x) || 0,
    y: Number(box.y) || 0,
    width: Math.max(0, Number(box.width) || 0),
    height: Math.max(0, Number(box.height) || 0),
    text: String(box.text || ''),
    confidence: typeof box.confidence === 'number' ? box.confidence : 0.9,
    role: 'unknown',
    vertical: typeof box.vertical === 'boolean' ? box.vertical : (Number(box.height) || 0) > (Number(box.width) || 0) * 1.15,
  }));
  return {
    pageWidth: Number(data.width) || 0,
    pageHeight: Number(data.height) || 0,
    boxes,
    engineUsed: 'apple-vision',
    elapsedMs: data.elapsedMs ?? elapsedFallbackMs,
    warnings: [],
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob(blob => resolve(blob), mime, quality);
  });
}

async function recognizeCanvasWithAppleVision(
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<OcrPageResult> {
  throwIfAborted(signal);
  const start = performance.now();
  const iosBridge = getIosOcrBridge();
  if (iosBridge) {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const response = await iosBridge.recognize(dataUrl);
    throwIfAborted(signal);
    return toVisionPageResult(response, Math.round(performance.now() - start));
  }

  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  if (!blob) throw new Error('Failed to encode image for Apple Vision');
  throwIfAborted(signal);
  const res = await fetch('/api/native-ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
    signal,
  });
  if (!res.ok) {
    throw new Error(`macOS Apple Vision HTTP ${res.status}`);
  }
  const payload = (await res.json()) as NativeOcrResponse & { ok?: boolean; error?: string };
  if (payload.ok === false) {
    throw new Error(payload.error || 'macOS Apple Vision failed');
  }
  return toVisionPageResult(payload, Math.round(performance.now() - start));
}

export interface RecognizeCanvasOptions {
  signal?: AbortSignal;
  onProgress?: (progress: OcrProgress) => void;
  filterRuby?: boolean;
  /** Override engine preference (tests or explicit caller choice). */
  engine?: 'auto' | OcrEngineUsed;
}

/**
 * Unified local OCR entrypoint: routes to iOS/macOS Apple Vision when preferred & available,
 * otherwise runs bundled NDLOCR-Lite inside the ONNX Runtime Web Worker.
 */
export async function recognizeCanvas(
  canvas: HTMLCanvasElement,
  options: RecognizeCanvasOptions = {},
): Promise<OcrPageResult> {
  throwIfAborted(options.signal);
  const settings = loadOcrSettings();
  const enginePref = options.engine ?? settings.engine;
  const filterRuby = options.filterRuby ?? settings.filterRuby;

  const tryVision = enginePref === 'apple-vision' || (enginePref === 'auto' && await isAppleVisionAvailable());
  if (tryVision) {
    try {
      options.onProgress?.({ stage: 'detect', current: 0, total: 1 });
      const visionResult = await recognizeCanvasWithAppleVision(canvas, options.signal);
      options.onProgress?.({ stage: 'recognize', current: 1, total: 1 });
      return visionResult;
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
      if (enginePref === 'apple-vision') {
        throw error;
      }
      logEvent('warn', 'ocr', `Apple Vision fallback to NDLOCR-Lite: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable for OCR');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const client = await getLazyOcrWorkerClient();
  return client.recognizeRgba(imageData.data, width, height, {
    filterRuby,
    signal: options.signal,
    onProgress: options.onProgress,
  });
}

export function releaseOcrResources(): void {
  loadedOcrClientModule?.getOcrWorkerClient().release();
}
