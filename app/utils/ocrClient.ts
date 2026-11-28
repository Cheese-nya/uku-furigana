import type { OcrWorkerRequest, OcrWorkerResponse } from '../workers/ocrProtocol';
import type { OcrPageResult, OcrProgress } from './ocrTypes';

interface PendingTask {
  resolve: (result: OcrPageResult) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: OcrProgress) => void;
  cleanup: () => void;
}

function resolveVendorUrl(subpath: string): string {
  if (typeof window !== 'undefined' && window.location?.href) {
    return new URL(`./vendor/${subpath}/`, window.location.href.split(/[?#]/)[0]).href;
  }
  return `./vendor/${subpath}/`;
}

function detectLowMemory(): boolean {
  if (typeof navigator === 'undefined') return true;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (typeof mem === 'number' && mem < 8) return true;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|HarmonyOS|Mobile/i.test(ua);
}

/**
 * Lazy-started singleton client for the NDLOCR-Lite Web Worker. Spawns nothing until the first
 * OCR call so users who never import images or scanned PDFs pay zero memory/startup cost.
 */
export class OcrWorkerClient {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private tasks = new Map<number, PendingTask>();
  private sequence = 0;

  private ensureWorker(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      try {
        const worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url));
        this.worker = worker;
        let settled = false;

        worker.onmessage = (event: MessageEvent<OcrWorkerResponse>) => {
          const msg = event.data;
          if (msg.type === 'READY') {
            if (!settled) {
              settled = true;
              if (msg.status === 'ready') resolve();
              else {
                this.resetWorker(new Error(msg.error || 'OCR worker initialization failed'));
                reject(new Error(msg.error || 'OCR worker initialization failed'));
              }
            }
            return;
          }

          const task = this.tasks.get(msg.taskId);
          if (!task) return;

          if (msg.type === 'PROGRESS') {
            task.onProgress?.(msg.progress);
            return;
          }
          this.tasks.delete(msg.taskId);
          task.cleanup();
          if (msg.type === 'RESULT') task.resolve(msg.result);
          else if (msg.type === 'ERROR') task.reject(new Error(msg.error));
        };

        worker.onerror = event => {
          event.preventDefault();
          const err = new Error('本地 OCR 线程异常退出');
          if (!settled) {
            settled = true;
            reject(err);
          }
          this.resetWorker(err);
        };

        worker.onmessageerror = () => {
          const err = new Error('无法读取 OCR 线程消息');
          if (!settled) {
            settled = true;
            reject(err);
          }
          this.resetWorker(err);
        };

        const initReq: OcrWorkerRequest = {
          type: 'INIT',
          modelBaseUrl: resolveVendorUrl('ndlocr-lite'),
          ortBaseUrl: resolveVendorUrl('ort'),
          lowMemory: detectLowMemory(),
        };
        worker.postMessage(initReq);
      } catch (error) {
        this.readyPromise = null;
        reject(error);
      }
    });
    return this.readyPromise;
  }

  private resetWorker(error: unknown) {
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    for (const task of this.tasks.values()) {
      task.cleanup();
      task.reject(error);
    }
    this.tasks.clear();
  }

  async recognizeRgba(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    options: { filterRuby?: boolean; signal?: AbortSignal; onProgress?: (progress: OcrProgress) => void } = {},
  ): Promise<OcrPageResult> {
    if (options.signal?.aborted) {
      throw new DOMException('OCR aborted', 'AbortError');
    }
    await this.ensureWorker();
    if (options.signal?.aborted) {
      throw new DOMException('OCR aborted', 'AbortError');
    }
    const worker = this.worker;
    if (!worker) throw new Error('OCR worker unavailable');

    const taskId = ++this.sequence;
    // Copy into an independent ArrayBuffer so Transferable transfer never detaches caller's backing store if shared.
    const bufferCopy = rgba.slice().buffer;

    return new Promise<OcrPageResult>((resolve, reject) => {
      const onAbort = () => {
        this.tasks.delete(taskId);
        this.worker?.postMessage({ type: 'CANCEL', taskId } satisfies OcrWorkerRequest);
        cleanup();
        reject(new DOMException('OCR aborted', 'AbortError'));
      };
      const cleanup = () => options.signal?.removeEventListener('abort', onAbort);

      this.tasks.set(taskId, {
        resolve,
        reject,
        onProgress: options.onProgress,
        cleanup,
      });
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const req: OcrWorkerRequest = {
        type: 'RECOGNIZE',
        taskId,
        rgbaBuffer: bufferCopy,
        width,
        height,
        filterRuby: options.filterRuby ?? true,
      };
      worker.postMessage(req, [bufferCopy]);
    });
  }

  release(): void {
    this.worker?.postMessage({ type: 'RELEASE' } satisfies OcrWorkerRequest);
  }

  dispose(): void {
    this.resetWorker(new DOMException('OCR client disposed', 'AbortError'));
  }
}

let sharedClient: OcrWorkerClient | null = null;
export const getOcrWorkerClient = () => (sharedClient ??= new OcrWorkerClient());
