import type { OcrPageResult, OcrProgress } from '../utils/ocrTypes';

export type OcrWorkerRequest =
  | {
      type: 'INIT';
      modelBaseUrl: string;
      ortBaseUrl: string;
      lowMemory: boolean;
    }
  | {
      type: 'RECOGNIZE';
      taskId: number;
      rgbaBuffer: ArrayBuffer;
      width: number;
      height: number;
      filterRuby: boolean;
    }
  | {
      type: 'CANCEL';
      taskId: number;
    }
  | {
      type: 'RELEASE';
    };

export type OcrWorkerResponse =
  | {
      type: 'READY';
      status: 'ready' | 'error';
      error?: string;
    }
  | {
      type: 'PROGRESS';
      taskId: number;
      progress: OcrProgress;
    }
  | {
      type: 'RESULT';
      taskId: number;
      result: OcrPageResult;
    }
  | {
      type: 'ERROR';
      taskId: number;
      error: string;
    };
