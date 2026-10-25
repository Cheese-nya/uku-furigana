import type { WorkerRequest, WorkerResponse } from './protocol';
import type { createAnnotator } from '../utils/annotationTask';

// doublearray's browser UMD branch writes window.doublearray. Workers have no
// window, so provide only its global alias before evaluating Kuromoji imports.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
let annotator: ReturnType<typeof createAnnotator>;
const jobs = new Map<number, { cancelled: boolean }>();
let initialization: Promise<void> | undefined;
const send = (message: WorkerResponse) => postMessage(message);

onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'INIT') {
    initialization = (async () => {
      const [{ initKuromoji }, { createAnnotator }] = await Promise.all([
        import('../utils/kuromojiEngine'), import('../utils/annotationTask'),
      ]);
      annotator = createAnnotator();
      try {
        await initKuromoji(request.dictionaryPath);
        send({ type: 'READY', status: 'ready' });
      } catch (error) {
        send({ type: 'READY', status: 'degraded', error: String(error) });
      }
    })();
  } else if (request.type === 'ANALYZE') {
    try {
      await initialization;
      const [{ getTokenizer }, { toAnalyzedTokens }] = await Promise.all([import('../utils/kuromojiEngine'), import('../utils/analyze')]);
      send({ type: 'ANALYZED', taskId: request.taskId, tokens: toAnalyzedTokens(getTokenizer().tokenize(request.text)) });
    } catch (error) {
      send({ type: 'ERROR', taskId: request.taskId, error: String(error) });
    }
  } else if (request.type === 'CANCEL') {
    const job = jobs.get(request.taskId);
    if (job) job.cancelled = true;
  } else {
    const job = { cancelled: false };
    jobs.set(request.taskId, job);
    try {
      await initialization;
      await annotator.run(request.input, () => job.cancelled, chunk => send({ type: 'CHUNK', taskId: request.taskId, chunk }));
      send({ type: 'COMPLETE', taskId: request.taskId });
    } catch (error) {
      if (!job.cancelled) send({ type: 'ERROR', taskId: request.taskId, error: String(error) });
    } finally {
      jobs.delete(request.taskId);
    }
  }
};
