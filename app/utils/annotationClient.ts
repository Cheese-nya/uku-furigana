import type { AnalyzedToken } from './analyze';
import type { ScriptLine } from './furigana';
import type { AnnotationChunk, AnnotationInput, createAnnotator } from './annotationTask';
import type { WorkerRequest, WorkerResponse } from '../workers/protocol';

export interface EngineState {
  status: 'loading' | 'ready' | 'degraded';
  mode: 'worker' | 'fallback';
  error?: string;
}
interface PendingJob {
  input: AnnotationInput;
  lines: ScriptLine[];
  onChunk?: (chunk: AnnotationChunk) => void;
  resolve: (lines: ScriptLine[]) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}

export class AnnotationClient {
  private worker: Worker | null = null;
  private fallback: ReturnType<typeof createAnnotator> | null = null;
  private jobs = new Map<number, PendingJob>();
  private analyses = new Map<number, { resolve: (tokens: AnalyzedToken[]) => void; reject: (error: unknown) => void }>();
  private sequence = 0;
  private disposed = false;
  private bootingFallback = false;
  private bootTimer?: ReturnType<typeof setTimeout>;
  private ready: Promise<void>;
  private resolveReady!: () => void;

  constructor(private dictionaryPath: string, private onState: (state: EngineState) => void) {
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
    onState({ status: 'loading', mode: 'worker' });
    try {
      this.worker = new Worker(new URL('../workers/furigana.worker.ts', import.meta.url));
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
      this.worker.onerror = event => { event.preventDefault(); void this.startFallback('异步注音线程不可用'); };
      this.worker.onmessageerror = () => { void this.startFallback('异步注音结果无法读取'); };
      this.bootTimer = setTimeout(() => { void this.startFallback('异步注音线程加载超时'); }, 60000);
      this.send({ type: 'INIT', dictionaryPath });
    } catch (error) {
      void this.startFallback(String(error));
    }
  }

  private send(message: WorkerRequest) { this.worker?.postMessage(message); }

  private receive(message: WorkerResponse) {
    if (this.disposed) return;
    if (message.type === 'READY') {
      clearTimeout(this.bootTimer);
      this.onState({ status: message.status, mode: 'worker', error: message.error });
      this.resolveReady();
      return;
    }
    const analysis = this.analyses.get(message.taskId);
    if (analysis) {
      this.analyses.delete(message.taskId);
      if (message.type === 'ANALYZED') analysis.resolve(message.tokens);
      else if (message.type === 'ERROR') analysis.reject(new Error(message.error));
      return;
    }
    const job = this.jobs.get(message.taskId);
    if (!job || message.type === 'ANALYZED') return;
    if (message.type === 'CHUNK') {
      job.lines.splice(message.chunk.offset, message.chunk.lines.length, ...message.chunk.lines);
      job.onChunk?.(message.chunk);
    } else {
      this.jobs.delete(message.taskId);
      job.cleanup();
      if (message.type === 'ERROR') job.reject(new Error(message.error));
      else job.resolve(job.lines);
    }
  }

  private async startFallback(reason: string) {
    if (this.disposed || this.bootingFallback) return;
    this.bootingFallback = true;
    clearTimeout(this.bootTimer);
    this.worker?.terminate();
    this.worker = null;
    this.onState({ status: 'loading', mode: 'fallback', error: reason });
    try {
      const [{ initKuromoji }, { createAnnotator }] = await Promise.all([import('./kuromojiEngine'), import('./annotationTask')]);
      let error = '';
      try { await initKuromoji(this.dictionaryPath); } catch (cause) { error = String(cause); }
      if (this.disposed) return;
      this.fallback = createAnnotator();
      this.onState({ status: error ? 'degraded' : 'ready', mode: 'fallback', error: error || reason });
      this.resolveReady();
      for (const [id, job] of this.jobs) void this.runFallback(id, job);
      // Analyses sent to the dead worker would never be answered; the reader taps again.
      for (const analysis of this.analyses.values()) analysis.reject(new Error('查词引擎已重启，请再点一次'));
      this.analyses.clear();
    } catch (error) {
      this.onState({ status: 'degraded', mode: 'fallback', error: String(error) });
      this.dispose();
    }
  }

  private async runFallback(id: number, job: PendingJob) {
    try {
      await this.fallback!.run(job.input, () => !this.jobs.has(id) || this.disposed,
        chunk => this.receive({ type: 'CHUNK', taskId: id, chunk }));
      this.receive({ type: 'COMPLETE', taskId: id });
    } catch (error) {
      if (this.jobs.has(id)) this.receive({ type: 'ERROR', taskId: id, error: String(error) });
    }
  }

  async annotate(input: AnnotationInput, onChunk?: (chunk: AnnotationChunk) => void, signal?: AbortSignal): Promise<ScriptLine[]> {
    await this.ready;
    if (this.disposed || signal?.aborted) throw new DOMException('注音任务已取消', 'AbortError');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.send({ type: 'CANCEL', taskId: id });
        this.jobs.delete(id);
        cleanup();
        reject(new DOMException('注音任务已取消', 'AbortError'));
      };
      const cleanup = () => signal?.removeEventListener('abort', cancel);
      const job: PendingJob = { input, lines: [], onChunk, resolve, reject, cleanup };
      this.jobs.set(id, job);
      signal?.addEventListener('abort', cancel, { once: true });
      if (this.fallback) void this.runFallback(id, job);
      else this.send({ type: 'ANNOTATE', taskId: id, input });
    });
  }

  /** Kuromoji tokens with dictionary forms, for word lookup. */
  async analyze(text: string): Promise<AnalyzedToken[]> {
    await this.ready;
    if (this.disposed) throw new DOMException('注音引擎已关闭', 'AbortError');
    if (this.fallback) {
      const [{ getTokenizer }, { toAnalyzedTokens }] = await Promise.all([import('./kuromojiEngine'), import('./analyze')]);
      return toAnalyzedTokens(getTokenizer().tokenize(text));
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.analyses.set(id, { resolve, reject });
      this.send({ type: 'ANALYZE', taskId: id, text });
    });
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.bootTimer);
    this.worker?.terminate();
    this.resolveReady();
    for (const job of this.jobs.values()) {
      job.cleanup();
      job.reject(new DOMException('注音任务已取消', 'AbortError'));
    }
    this.jobs.clear();
    for (const analysis of this.analyses.values()) analysis.reject(new DOMException('注音引擎已关闭', 'AbortError'));
    this.analyses.clear();
  }
}
