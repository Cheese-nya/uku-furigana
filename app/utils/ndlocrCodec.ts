import type { OcrLineRole, OcrRawBox } from './ocrTypes';
import type { OcrModelKey } from './ocrModelStore';

const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_INV_STD = [1 / 0.229, 1 / 0.224, 1 / 0.225] as const;

export interface DeimPreparedInput {
  tensor: Float32Array;
  origTargetSizes: BigInt64Array;
  maxWh: number;
  inputWidth: number;
  inputHeight: number;
}

export interface DeimDetection {
  classIndex: number;
  className: string;
  role: OcrLineRole;
  confidence: number;
  box: [number, number, number, number];
  predCharCount: number;
  vertical: boolean;
}

export function mapNdlClassToRole(className: string): OcrLineRole {
  switch (className) {
    case 'line_main':
      return 'main';
    case 'line_title':
      return 'title';
    case 'line_caption':
      return 'caption';
    case 'line_note':
    case 'line_note_tochu':
      return 'note';
    case 'block_rubi':
      return 'ruby';
    case 'line_ad':
    case 'block_ad':
      return 'ad';
    case 'block_fig':
    case 'block_chart':
    case 'block_table':
      return 'figure';
    case 'block_pillar':
    case 'block_folio':
      return 'running-head';
    default:
      return 'unknown';
  }
}

/**
 * Match `ndl-lab/ndlocr-lite/src/deim.py` (`DEIM.preprocess`):
 * 1. Top-left pad source RGB image into a black square of size `maxWh = max(width, height)`.
 * 2. Bilinear resize square to `(inputWidth, inputHeight)`.
 * 3. Normalize with ImageNet mean/std in NCHW RGB order.
 */
export function prepareDeimInput(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  inputWidth = 1024,
  inputHeight = 1024,
): DeimPreparedInput {
  const maxWh = Math.max(width, height, 1);
  const planeSize = inputWidth * inputHeight;
  const tensor = new Float32Array(3 * planeSize);
  const scaleX = maxWh / inputWidth;
  const scaleY = maxWh / inputHeight;
  const inv255 = 1 / 255;

  for (let dy = 0; dy < inputHeight; dy += 1) {
    const syFloat = (dy + 0.5) * scaleY - 0.5;
    const y0 = Math.floor(syFloat);
    const y1 = y0 + 1;
    const wy1 = syFloat - y0;
    const wy0 = 1 - wy1;

    for (let dx = 0; dx < inputWidth; dx += 1) {
      const sxFloat = (dx + 0.5) * scaleX - 0.5;
      const x0 = Math.floor(sxFloat);
      const x1 = x0 + 1;
      const wx1 = sxFloat - x0;
      const wx0 = 1 - wx1;

      const sampleChannel = (ch: number): number => {
        const p00 = x0 >= 0 && x0 < width && y0 >= 0 && y0 < height ? rgba[(y0 * width + x0) * 4 + ch] : 0;
        const p10 = x1 >= 0 && x1 < width && y0 >= 0 && y0 < height ? rgba[(y0 * width + x1) * 4 + ch] : 0;
        const p01 = x0 >= 0 && x0 < width && y1 >= 0 && y1 < height ? rgba[(y1 * width + x0) * 4 + ch] : 0;
        const p11 = x1 >= 0 && x1 < width && y1 >= 0 && y1 < height ? rgba[(y1 * width + x1) * 4 + ch] : 0;
        return (p00 * wx0 + p10 * wx1) * wy0 + (p01 * wx0 + p11 * wx1) * wy1;
      };

      const dst = dy * inputWidth + dx;
      tensor[dst] = (sampleChannel(0) * inv255 - IMAGENET_MEAN[0]) * IMAGENET_INV_STD[0];
      tensor[planeSize + dst] = (sampleChannel(1) * inv255 - IMAGENET_MEAN[1]) * IMAGENET_INV_STD[1];
      tensor[2 * planeSize + dst] = (sampleChannel(2) * inv255 - IMAGENET_MEAN[2]) * IMAGENET_INV_STD[2];
    }
  }

  return {
    tensor,
    origTargetSizes: new BigInt64Array([BigInt(inputHeight), BigInt(inputWidth)]),
    maxWh,
    inputWidth,
    inputHeight,
  };
}

export interface DeimRawOutputs {
  labels: ArrayLike<number | bigint>;
  boxes: ArrayLike<number>;
  scores: ArrayLike<number>;
  charCounts?: ArrayLike<number | bigint>;
}

/**
 * Match `DEIM.postprocess` & `_suppress_overlapping_regions` in `ndl-lab/ndlocr-lite/src/deim.py`.
 */
export function parseDeimOutput(
  outputs: DeimRawOutputs,
  options: {
    maxWh: number;
    origWidth: number;
    origHeight: number;
    inputWidth?: number;
    inputHeight?: number;
    classes: string[];
    confThreshold?: number;
    overlapThreshold?: number;
  },
): DeimDetection[] {
  const inputWidth = options.inputWidth ?? 1024;
  const confThreshold = options.confThreshold ?? 0.25;
  const overlapThreshold = options.overlapThreshold ?? 0.9;
  const scale = options.maxWh / inputWidth;
  const count = outputs.scores.length;
  const raw: DeimDetection[] = [];

  for (let i = 0; i < count; i += 1) {
    const score = Number(outputs.scores[i]);
    if (!(score > confThreshold)) continue;
    const rawLabel = Number(outputs.labels[i]);
    const classIndex = rawLabel - 1;
    if (classIndex < 0 || classIndex >= options.classes.length) continue;

    const base = i * 4;
    const x1 = Math.max(0, Math.min(options.origWidth, Math.trunc(Number(outputs.boxes[base]) * scale)));
    const y1 = Math.max(0, Math.min(options.origHeight, Math.trunc(Number(outputs.boxes[base + 1]) * scale)));
    const x2 = Math.max(0, Math.min(options.origWidth, Math.trunc(Number(outputs.boxes[base + 2]) * scale)));
    const y2 = Math.max(0, Math.min(options.origHeight, Math.trunc(Number(outputs.boxes[base + 3]) * scale)));
    const w = x2 - x1;
    const h = y2 - y1;
    if (w <= 0 || h <= 0) continue;

    const className = options.classes[classIndex];
    raw.push({
      classIndex,
      className,
      role: mapNdlClassToRole(className),
      confidence: score,
      box: [x1, y1, x2, y2],
      predCharCount: outputs.charCounts ? Number(outputs.charCounts[i]) : 100,
      vertical: h > w,
    });
  }

  if (overlapThreshold <= 0 || raw.length <= 1) return raw;

  const areas = raw.map(d => (d.box[2] - d.box[0]) * (d.box[3] - d.box[1]));
  const order = raw.map((_, idx) => idx).sort((a, b) => areas[b] - areas[a]);
  const keptByClass = new Map<number, number[]>();
  const suppressed = new Set<number>();

  for (const idx of order) {
    const area = areas[idx];
    if (area <= 0) continue;
    const det = raw[idx];
    const [x1, y1, x2, y2] = det.box;
    const kept = keptByClass.get(det.classIndex) ?? [];
    let drop = false;
    for (const otherIdx of kept) {
      if (areas[otherIdx] <= area) continue;
      const [ox1, oy1, ox2, oy2] = raw[otherIdx].box;
      const ix = Math.max(0, Math.min(x2, ox2) - Math.max(x1, ox1));
      const iy = Math.max(0, Math.min(y2, oy2) - Math.max(y1, oy1));
      if ((ix * iy) / area >= overlapThreshold) {
        drop = true;
        break;
      }
    }
    if (drop) {
      suppressed.add(idx);
    } else {
      kept.push(idx);
      keptByClass.set(det.classIndex, kept);
    }
  }

  return raw.filter((_, idx) => !suppressed.has(idx));
}

export function routeParseqTier(predCharCount: number): Exclude<OcrModelKey, 'deim'> {
  if (predCharCount === 3) return 'parseq30';
  if (predCharCount === 2) return 'parseq50';
  return 'parseq100';
}

/**
 * Match `ndl-lab/ndlocr-lite/src/parseq.py` (`PARSEQ.preprocess`):
 * 1. Crop `[x1, y1, x2, y2]`.
 * 2. If `cropH > cropW * 0.8`, rotate 90° counterclockwise (top-to-bottom becomes left-to-right).
 * 3. Bilinear resize to `(targetW, targetH)`.
 * 4. Flip RGB -> BGR (matching `resized[:, :, ::-1]` in `parseq.py` where `img` was RGB).
 * 5. Normalize `(v / 127.5) - 1.0` in NCHW Float32.
 */
export function prepareParseqInput(
  rgba: Uint8ClampedArray | Uint8Array,
  imgW: number,
  imgH: number,
  box: readonly [number, number, number, number],
  targetW: number,
  targetH: number,
): Float32Array {
  const x1 = Math.max(0, Math.min(imgW - 1, Math.trunc(box[0])));
  const y1 = Math.max(0, Math.min(imgH - 1, Math.trunc(box[1])));
  const x2 = Math.max(x1 + 1, Math.min(imgW, Math.trunc(box[2])));
  const y2 = Math.max(y1 + 1, Math.min(imgH, Math.trunc(box[3])));
  const cropW = x2 - x1;
  const cropH = y2 - y1;
  const rotated = cropH > cropW * 0.8;

  const srcW = rotated ? cropH : cropW;
  const srcH = rotated ? cropW : cropH;
  const scaleX = srcW / targetW;
  const scaleY = srcH / targetH;
  const plane = targetW * targetH;
  const tensor = new Float32Array(3 * plane);
  const invHalf = 1 / 127.5;

  const sampleRgb = (sx: number, sy: number, ch: number): number => {
    const cx = Math.max(0, Math.min(srcW - 1, sx));
    const cy = Math.max(0, Math.min(srcH - 1, sy));
    // 90° CCW mapping: (dx, dy) in rotated (cropH x cropW) comes from (cropW - 1 - dy, dx) in crop.
    const origX = x1 + (rotated ? cropW - 1 - cy : cx);
    const origY = y1 + (rotated ? cx : cy);
    return rgba[(origY * imgW + origX) * 4 + ch];
  };

  for (let dy = 0; dy < targetH; dy += 1) {
    const syFloat = Math.max(0, Math.min(srcH - 1, (dy + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(syFloat);
    const y1i = Math.min(srcH - 1, y0 + 1);
    const wy1 = syFloat - y0;
    const wy0 = 1 - wy1;

    for (let dx = 0; dx < targetW; dx += 1) {
      const sxFloat = Math.max(0, Math.min(srcW - 1, (dx + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sxFloat);
      const x1i = Math.min(srcW - 1, x0 + 1);
      const wx1 = sxFloat - x0;
      const wx0 = 1 - wx1;

      const interp = (ch: number): number => {
        const p00 = sampleRgb(x0, y0, ch);
        const p10 = sampleRgb(x1i, y0, ch);
        const p01 = sampleRgb(x0, y1i, ch);
        const p11 = sampleRgb(x1i, y1i, ch);
        return (p00 * wx0 + p10 * wx1) * wy0 + (p01 * wx0 + p11 * wx1) * wy1;
      };

      const dst = dy * targetW + dx;
      // Channel order is B, G, R (RGB flipped via `[:,:,::-1]` in parseq.py).
      tensor[dst] = interp(2) * invHalf - 1;
      tensor[plane + dst] = interp(1) * invHalf - 1;
      tensor[2 * plane + dst] = interp(0) * invHalf - 1;
    }
  }

  return tensor;
}

export function cleanParseqJapaneseSpaces(text: string): string {
  let out = text;
  for (const punct of ['、', '。']) {
    out = out.split(` ${punct}`).join(punct);
    out = out.split(`${punct} `).join(punct);
  }
  return out;
}

/**
 * Match `PARSEQ.read` in `ndl-lab/ndlocr-lite/src/parseq.py`:
 * argmax over vocab per step, stop at index `0` (EOS), map `charset[idx - 1]`.
 */
export function decodeParseqLogits(
  logits: ArrayLike<number>,
  seqLen: number,
  vocabSize: number,
  charset: readonly string[],
): { text: string; rawLength: number; confidence: number } {
  const chars: string[] = [];
  let confidenceSum = 0;
  let stepCount = 0;

  for (let t = 0; t < seqLen; t += 1) {
    const offset = t * vocabSize;
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let v = 0; v < vocabSize; v += 1) {
      const val = logits[offset + v];
      if (val > bestVal) {
        bestVal = val;
        bestIdx = v;
      }
    }
    if (bestIdx === 0) break;

    // Softmax probability of the chosen token as step confidence.
    let expSum = 0;
    for (let v = 0; v < vocabSize; v += 1) {
      expSum += Math.exp(logits[offset + v] - bestVal);
    }
    confidenceSum += 1 / expSum;
    stepCount += 1;

    const ch = charset[bestIdx - 1];
    if (ch !== undefined) chars.push(ch);
  }

  const rawText = chars.join('');
  return {
    text: cleanParseqJapaneseSpaces(rawText),
    rawLength: chars.length,
    confidence: stepCount > 0 ? confidenceSum / stepCount : 1,
  };
}

/** Whether a DEIM detection class represents text that should be recognized by PARSeq. */
export function isRecognizableRole(role: OcrLineRole): boolean {
  return role !== 'figure' && role !== 'running-head';
}

export function detectionToRawBox(det: DeimDetection, text: string, recConfidence: number): OcrRawBox {
  const [x1, y1, x2, y2] = det.box;
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    text,
    confidence: Math.min(det.confidence, recConfidence),
    role: det.role,
    vertical: det.vertical,
    predCharCount: det.predCharCount,
  };
}
