import type { WorkerRequest, WorkerResponse } from './protocol';
import type { createAnnotator } from '../utils/annotationTask';
import type { ReadingTable } from '../utils/readingCheck';

// doublearray's browser UMD branch writes window.doublearray. Workers have no
// window, so provide only its global alias before evaluating Kuromoji imports.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
let annotator: ReturnType<typeof createAnnotator>;
const jobs = new Map<number, { cancelled: boolean }>();
let initialization: Promise<void> | undefined;
// Cross-check table for automatic readings; null until (or unless) it loads.
let readings: ReadingTable | null = null;
const send = (message: WorkerResponse) => postMessage(message);

onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'INIT') {
    initialization = (async () => {
      const [{ initKuromoji, resolveDictionaryPath }, { createAnnotator }, { loadReadingTable }] = await Promise.all([
        import('../utils/kuromojiEngine'), import('../utils/annotationTask'), import('../utils/readingCheck'),
      ]);
      annotator = createAnnotator(() => readings);
      // The table lives next to the kuromoji dictionary and loads alongside it: annotation
      // starts without it and picks it up as soon as it is ready.
      void loadReadingTable(resolveDictionaryPath(request.dictionaryPath)).then(
        // Lines annotated before the table arrived were cached unchecked: drop them.
        table => { readings = table; annotator?.clear(); },
        error => console.warn('读音对照表加载失败，跳过词典校对：', error),
      );
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
