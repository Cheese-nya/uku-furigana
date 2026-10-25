import type { AnalyzedToken } from '../utils/analyze';
import type { AnnotationInput, AnnotationChunk } from '../utils/annotationTask';

export type WorkerRequest =
  | { type: 'INIT'; dictionaryPath: string }
  | { type: 'ANNOTATE'; taskId: number; input: AnnotationInput }
  | { type: 'CANCEL'; taskId: number }
  | { type: 'ANALYZE'; taskId: number; text: string };

export type WorkerResponse =
  | { type: 'READY'; status: 'ready' | 'degraded'; error?: string }
  | { type: 'CHUNK'; taskId: number; chunk: AnnotationChunk }
  | { type: 'COMPLETE'; taskId: number }
  | { type: 'ERROR'; taskId: number; error: string }
  | { type: 'ANALYZED'; taskId: number; tokens: AnalyzedToken[] };
