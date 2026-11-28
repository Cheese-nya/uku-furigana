import * as ort from 'onnxruntime-web/wasm';
import type { OcrWorkerRequest, OcrWorkerResponse } from './ocrProtocol';
import {
  decodeParseqLogits,
  detectionToRawBox,
  isRecognizableRole,
  parseDeimOutput,
  prepareDeimInput,
  prepareParseqInput,
  routeParseqTier,
  type DeimDetection,
} from '../utils/ndlocrCodec';
import { OcrModelStore, type OcrConfigData, type OcrModelKey } from '../utils/ocrModelStore';
import type { OcrRawBox } from '../utils/ocrTypes';

type ParseqTier = Exclude<OcrModelKey, 'deim'>;

interface ManagedSession {
  key: OcrModelKey;
  session: ort.InferenceSession;
  lastUsed: number;
}

const send = (msg: OcrWorkerResponse) => postMessage(msg);

let modelBaseUrl = './vendor/ndlocr-lite/';
let lowMemoryMode = false;
let configData: OcrConfigData | null = null;
let store: OcrModelStore | null = null;
let initPromise: Promise<void> | null = null;

const activeSessions = new Map<OcrModelKey, ManagedSession>();
const cancelledTasks = new Set<number>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_RELEASE_MS = 60_000;

function clearIdleTimer() {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleRelease() {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    void releaseAllSessions();
  }, IDLE_RELEASE_MS);
}

async function releaseSession(key: OcrModelKey) {
  const entry = activeSessions.get(key);
  if (!entry) return;
  activeSessions.delete(key);
  try {
    await entry.session.release();
  } catch {
    // Ignore session release errors on shutdown.
  }
}

async function releaseAllSessions() {
  clearIdleTimer();
  const keys = Array.from(activeSessions.keys());
  for (const key of keys) {
    await releaseSession(key);
  }
}

async function getSession(key: OcrModelKey): Promise<ort.InferenceSession> {
  clearIdleTimer();
  const existing = activeSessions.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.session;
  }

  // Low-memory devices hold at most 1 session at a time; desktops keep an LRU cap of 2.
  const maxCached = lowMemoryMode ? 0 : 1;
  while (activeSessions.size > maxCached) {
    let oldestKey: OcrModelKey | null = null;
    let oldestTime = Infinity;
    for (const [k, entry] of activeSessions) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) await releaseSession(oldestKey);
    else break;
  }

  if (!store) store = new OcrModelStore();
  const bytes = await store.loadAsset(modelBaseUrl, key);
  const session = await ort.InferenceSession.create(new Uint8Array(bytes), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  activeSessions.set(key, { key, session, lastUsed: Date.now() });
  return session;
}

function resolveInputDims(session: ort.InferenceSession, fallbackW: number, fallbackH: number): { width: number; height: number } {
  const meta = (session as unknown as {
    inputMetadata?: Array<{ shape?: Array<number | string>; dimensions?: Array<number | string> }>;
  }).inputMetadata;
  const dims = meta?.[0]?.shape ?? meta?.[0]?.dimensions;
  if (Array.isArray(dims) && dims.length >= 4) {
    const h = Number(dims[2]);
    const w = Number(dims[3]);
    if (Number.isFinite(h) && h > 0 && Number.isFinite(w) && w > 0) {
      return { width: w, height: h };
    }
  }
  return { width: fallbackW, height: fallbackH };
}

function readDeimOutputs(session: ort.InferenceSession, results: Record<string, ort.Tensor>) {
  const names = session.outputNames;
  const labelsTensor = results[names[0]];
  const boxesTensor = results[names[1]];
  const scoresTensor = results[names[2]];
  const charCountsTensor = names.length >= 4 ? results[names[3]] : undefined;
  return {
    labels: labelsTensor.data as Float32Array | Int32Array | BigInt64Array,
    boxes: boxesTensor.data as Float32Array,
    scores: scoresTensor.data as Float32Array,
    charCounts: charCountsTensor?.data as Float32Array | Int32Array | BigInt64Array | undefined,
  };
}

function disposeTensors(tensors: Record<string, ort.Tensor>) {
  for (const tensor of Object.values(tensors)) {
    try {
      tensor.dispose();
    } catch {
      // Ignore already disposed tensors.
    }
  }
}

async function runParseqOnCrop(
  session: ort.InferenceSession,
  rgba: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  box: readonly [number, number, number, number],
  charset: readonly string[],
  fallbackW: number,
  fallbackH: number,
) {
  const { width: targetW, height: targetH } = resolveInputDims(session, fallbackW, fallbackH);
  const inputData = prepareParseqInput(rgba, imgW, imgH, box, targetW, targetH);
  const inputName = session.inputNames[0];
  const inputTensor = new ort.Tensor('float32', inputData, [1, 3, targetH, targetW]);
  const outputs = await session.run({ [inputName]: inputTensor });
  inputTensor.dispose();
  try {
    const outTensor = outputs[session.outputNames[0]];
    const dims = outTensor.dims;
    const seqLen = dims[1];
    const vocabSize = dims[2];
    return decodeParseqLogits(outTensor.data as Float32Array, seqLen, vocabSize, charset);
  } finally {
    disposeTensors(outputs);
  }
}

const TIER_DIMS: Record<ParseqTier, [number, number]> = {
  parseq30: [256, 24],
  parseq50: [384, 24],
  parseq100: [768, 24],
};

async function handleRecognize(request: Extract<OcrWorkerRequest, { type: 'RECOGNIZE' }>) {
  const start = performance.now();
  await initPromise;
  if (!configData) throw new Error('OCR config not initialized');

  const rgba = new Uint8ClampedArray(request.rgbaBuffer);
  const { width, height, taskId } = request;
  if (cancelledTasks.has(taskId)) return;

  send({ type: 'PROGRESS', taskId, progress: { stage: 'detect', current: 0, total: 1 } });
  const deimSession = await getSession('deim');
  const { width: deimW, height: deimH } = resolveInputDims(deimSession, 800, 800);
  const prepared = prepareDeimInput(rgba, width, height, deimW, deimH);
  const imgTensor = new ort.Tensor('float32', prepared.tensor, [1, 3, deimH, deimW]);
  const sizeTensor = new ort.Tensor('int64', prepared.origTargetSizes, [1, 2]);
  const feeds: Record<string, ort.Tensor> = {
    [deimSession.inputNames[0]]: imgTensor,
  };
  if (deimSession.inputNames[1]) {
    feeds[deimSession.inputNames[1]] = sizeTensor;
  }

  let detections: DeimDetection[] = [];
  const deimOutputs = await deimSession.run(feeds);
  imgTensor.dispose();
  sizeTensor.dispose();
  try {
    detections = parseDeimOutput(readDeimOutputs(deimSession, deimOutputs), {
      maxWh: prepared.maxWh,
      origWidth: width,
      origHeight: height,
      inputWidth: deimW,
      inputHeight: deimH,
      classes: configData.classes,
    });
  } finally {
    disposeTensors(deimOutputs);
  }

  if (lowMemoryMode) {
    await releaseSession('deim');
  }
  if (cancelledTasks.has(taskId)) return;

  const textDetections = detections.filter(det => {
    if (!isRecognizableRole(det.role)) return false;
    if (request.filterRuby && (det.role === 'ruby' || det.role === 'ad')) return false;
    return true;
  });

  const totalLines = textDetections.length;
  send({ type: 'PROGRESS', taskId, progress: { stage: 'recognize', current: 0, total: totalLines } });

  const resultsByIndex = new Array<OcrRawBox | null>(textDetections.length).fill(null);
  const tierQueues: Record<ParseqTier, number[]> = { parseq30: [], parseq50: [], parseq100: [] };
  textDetections.forEach((det, idx) => {
    tierQueues[routeParseqTier(det.predCharCount)].push(idx);
  });

  let completed = 0;

  // Cascade sequentially by tier (`30 -> 50 -> 100`) so only one PARSeq session lives in WASM at once.
  if (tierQueues.parseq30.length > 0 && !cancelledTasks.has(taskId)) {
    const s30 = await getSession('parseq30');
    const [tw, th] = TIER_DIMS.parseq30;
    for (const idx of tierQueues.parseq30) {
      if (cancelledTasks.has(taskId)) return;
      const det = textDetections[idx];
      const rec = await runParseqOnCrop(s30, rgba, width, height, det.box, configData.charset, tw, th);
      if (rec.rawLength >= 25) {
        tierQueues.parseq50.push(idx);
      } else {
        resultsByIndex[idx] = detectionToRawBox(det, rec.text, rec.confidence);
        completed += 1;
        send({ type: 'PROGRESS', taskId, progress: { stage: 'recognize', current: completed, total: totalLines } });
      }
    }
    if (lowMemoryMode) await releaseSession('parseq30');
  }

  if (tierQueues.parseq50.length > 0 && !cancelledTasks.has(taskId)) {
    const s50 = await getSession('parseq50');
    const [tw, th] = TIER_DIMS.parseq50;
    for (const idx of tierQueues.parseq50) {
      if (cancelledTasks.has(taskId)) return;
      const det = textDetections[idx];
      const rec = await runParseqOnCrop(s50, rgba, width, height, det.box, configData.charset, tw, th);
      if (rec.rawLength >= 45) {
        tierQueues.parseq100.push(idx);
      } else {
        resultsByIndex[idx] = detectionToRawBox(det, rec.text, rec.confidence);
        completed += 1;
        send({ type: 'PROGRESS', taskId, progress: { stage: 'recognize', current: completed, total: totalLines } });
      }
    }
    if (lowMemoryMode) await releaseSession('parseq50');
  }

  if (tierQueues.parseq100.length > 0 && !cancelledTasks.has(taskId)) {
    const s100 = await getSession('parseq100');
    const [tw, th] = TIER_DIMS.parseq100;
    for (const idx of tierQueues.parseq100) {
      if (cancelledTasks.has(taskId)) return;
      const det = textDetections[idx];
      const rec = await runParseqOnCrop(s100, rgba, width, height, det.box, configData.charset, tw, th);
      const [x1, y1, x2, y2] = det.box;
      const boxW = x2 - x1;
      const boxH = y2 - y1;
      // Match `ocr.py` >= 98 char horizontal split fallback for extra-long horizontal lines.
      if (rec.rawLength >= 98 && boxH < boxW) {
        const midX = Math.floor((x1 + x2) / 2);
        const left = await runParseqOnCrop(s100, rgba, width, height, [x1, y1, midX, y2], configData.charset, tw, th);
        const right = await runParseqOnCrop(s100, rgba, width, height, [midX, y1, x2, y2], configData.charset, tw, th);
        resultsByIndex[idx] = detectionToRawBox(det, left.text + right.text, Math.min(left.confidence, right.confidence));
      } else {
        resultsByIndex[idx] = detectionToRawBox(det, rec.text, rec.confidence);
      }
      completed += 1;
      send({ type: 'PROGRESS', taskId, progress: { stage: 'recognize', current: completed, total: totalLines } });
    }
    if (lowMemoryMode) await releaseSession('parseq100');
  }

  if (cancelledTasks.has(taskId)) return;
  scheduleIdleRelease();

  const boxes = resultsByIndex.filter((b): b is OcrRawBox => b !== null && b.text.trim().length > 0);
  send({
    type: 'RESULT',
    taskId,
    result: {
      pageWidth: width,
      pageHeight: height,
      boxes,
      engineUsed: 'ndlocr-lite',
      elapsedMs: Math.round(performance.now() - start),
      warnings: [],
    },
  });
}

onmessage = async (event: MessageEvent<OcrWorkerRequest>) => {
  const req = event.data;
  if (req.type === 'INIT') {
    modelBaseUrl = req.modelBaseUrl;
    lowMemoryMode = req.lowMemory;
    // Force single-threaded WASM so Chrome 92 / HarmonyOS Chrome 99 never require SharedArrayBuffer/COOP.
    ort.env.wasm.wasmPaths = req.ortBaseUrl;
    ort.env.wasm.numThreads = 1;
    initPromise = (async () => {
      store = new OcrModelStore();
      configData = await store.loadConfig(modelBaseUrl);
    })();
    try {
      await initPromise;
      send({ type: 'READY', status: 'ready' });
    } catch (error) {
      send({ type: 'READY', status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.type === 'CANCEL') {
    cancelledTasks.add(req.taskId);
    return;
  }

  if (req.type === 'RELEASE') {
    await releaseAllSessions();
    return;
  }

  if (req.type === 'RECOGNIZE') {
    try {
      await handleRecognize(req);
    } catch (error) {
      if (!cancelledTasks.has(req.taskId)) {
        send({
          type: 'ERROR',
          taskId: req.taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      cancelledTasks.delete(req.taskId);
    }
  }
};
