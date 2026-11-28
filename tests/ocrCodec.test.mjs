import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const {
  prepareDeimInput,
  parseDeimOutput,
  routeParseqTier,
  prepareParseqInput,
  decodeParseqLogits,
  mapNdlClassToRole,
  isRecognizableRole,
  detectionToRawBox,
} = loadTypescript('../app/utils/ndlocrCodec.ts');

test('prepareDeimInput top-left pads to square, resizes to 1024x1024, and applies ImageNet norm', () => {
  // 2x1 RGBA: white left pixel (255,255,255), black right pixel (0,0,0)
  const rgba = new Uint8ClampedArray([
    255, 255, 255, 255,
    0, 0, 0, 255,
  ]);
  const prep = prepareDeimInput(rgba, 2, 1, 2, 2);
  assert.equal(prep.maxWh, 2);
  assert.deepEqual(Array.from(prep.origTargetSizes), [2n, 2n]);
  assert.equal(prep.tensor.length, 3 * 2 * 2);

  // Bottom row (dx=0, dy=1) is zero-padded black
  const bottomPixelVal = prep.tensor[1 * 2 + 0];
  const expectedZeroNorm = (0 - 0.485) / 0.229;
  assert.ok(Math.abs(bottomPixelVal - expectedZeroNorm) < 1e-4);

  // 1:1 top-left pixel (dx=0, dy=0) maps cleanly to (x=0, y=0) = white (255)
  const topLeftR = prep.tensor[0];
  const expectedWhiteR = (1 - 0.485) / 0.229;
  assert.ok(Math.abs(topLeftR - expectedWhiteR) < 1e-4);
});

test('parseDeimOutput converts 1-based labels, clamps coordinates, and suppresses nested duplicates', () => {
  const classes = ['text_block', 'line_main', 'block_rubi', 'block_fig'];
  const outs = {
    labels: [2, 3, 2, 4, 1],
    scores: [0.92, 0.85, 0.6, 0.9, 0.1], // last entry below threshold 0.25
    // Input coords in 1024 space, origWidth=512 -> scale = maxWh/1024 = 0.5
    boxes: [
      100, 100, 300, 500, // large line_main -> 50..150 x 50..250
      140, 110, 170, 220, // block_rubi
      104, 104, 296, 496, // >90% nested duplicate of first line_main -> suppressed
      400, 400, 700, 700, // block_fig -> role 'figure'
      0, 0, 100, 100,     // dropped by confThreshold
    ],
    charCounts: [3, 3, 3, 1, 1],
  };

  const dets = parseDeimOutput(outs, {
    maxWh: 512,
    origWidth: 512,
    origHeight: 512,
    inputWidth: 1024,
    inputHeight: 1024,
    classes,
    confThreshold: 0.25,
    overlapThreshold: 0.9,
  });

  assert.equal(dets.length, 3);
  assert.equal(dets[0].className, 'line_main');
  assert.equal(dets[0].role, 'main');
  assert.deepEqual(dets[0].box, [50, 50, 150, 250]);
  assert.equal(dets[0].vertical, true);

  assert.equal(dets[1].className, 'block_rubi');
  assert.equal(dets[1].role, 'ruby');
  assert.equal(dets[2].className, 'block_fig');
  assert.equal(dets[2].role, 'figure');
});

test('mapNdlClassToRole & isRecognizableRole map all semantic roles properly', () => {
  assert.equal(mapNdlClassToRole('line_title'), 'title');
  assert.equal(mapNdlClassToRole('block_rubi'), 'ruby');
  assert.equal(mapNdlClassToRole('block_folio'), 'running-head');
  assert.equal(isRecognizableRole('main'), true);
  assert.equal(isRecognizableRole('ruby'), true);
  assert.equal(isRecognizableRole('figure'), false);
  assert.equal(isRecognizableRole('running-head'), false);

  assert.equal(routeParseqTier(3), 'parseq30');
  assert.equal(routeParseqTier(2), 'parseq50');
  assert.equal(routeParseqTier(1), 'parseq100');
  assert.equal(routeParseqTier(99), 'parseq100');
});

test('prepareParseqInput flips RGB->BGR and rotates tall vertical boxes 90deg CCW', () => {
  // 2x4 image: top row pure red (255,0,0), bottom rows pure blue (0,0,255)
  const w = 2;
  const h = 4;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = (y * w + x) * 4;
      if (y === 0) {
        rgba[idx] = 255; rgba[idx + 1] = 0; rgba[idx + 2] = 0; rgba[idx + 3] = 255;
      } else {
        rgba[idx] = 0; rgba[idx + 1] = 0; rgba[idx + 2] = 255; rgba[idx + 3] = 255;
      }
    }
  }
  // Vertical box [0,0,2,4] (h=4 > w*0.8) rotates 90 CCW so top row (y=0, red) moves to left edge (dx=0)
  const targetW = 4;
  const targetH = 2;
  const tensor = prepareParseqInput(rgba, w, h, [0, 0, 2, 4], targetW, targetH);
  const plane = targetW * targetH;
  // At dx=0, dy=0 (left edge = original y=0 red): B=0 -> -1.0, G=0 -> -1.0, R=255 -> +1.0
  assert.ok(Math.abs(tensor[0] - (-1)) < 1e-4, 'plane 0 is B channel');
  assert.ok(Math.abs(tensor[plane] - (-1)) < 1e-4, 'plane 1 is G channel');
  assert.ok(Math.abs(tensor[2 * plane] - 1) < 1e-4, 'plane 2 is R channel');
  // At dx=3, dy=0 (right edge = original y=3 blue): B=255 -> +1.0, R=0 -> -1.0
  assert.ok(Math.abs(tensor[3] - 1) < 1e-4);
  assert.ok(Math.abs(tensor[2 * plane + 3] - (-1)) < 1e-4);
});

test('decodeParseqLogits decodes tokens until EOS index 0 and computes confidence', () => {
  const charset = ['あ', 'い', '、', 'う']; // EOS=0, idx 1='あ', 2='い', 3='、', 4='う'
  const vocabSize = 5;
  const seqLen = 5;
  const logits = new Float32Array(seqLen * vocabSize).fill(-10);
  // step 0: 'あ' (idx 1)
  logits[0 * vocabSize + 1] = 5;
  // step 1: '、' (idx 3)
  logits[1 * vocabSize + 3] = 5;
  // step 2: 'い' (idx 2)
  logits[2 * vocabSize + 2] = 5;
  // step 3: EOS (idx 0) -> stops before step 4 ('う')
  logits[3 * vocabSize + 0] = 5;
  logits[4 * vocabSize + 4] = 5;

  const decoded = decodeParseqLogits(logits, seqLen, vocabSize, charset);
  assert.equal(decoded.text, 'あ、い');
  assert.equal(decoded.rawLength, 3);
  assert.ok(decoded.confidence > 0.99);

  const box = detectionToRawBox(
    {
      classIndex: 1,
      className: 'line_main',
      role: 'main',
      confidence: 0.85,
      box: [10, 20, 40, 220],
      predCharCount: 3,
      vertical: true,
    },
    decoded.text,
    decoded.confidence,
  );
  assert.equal(box.confidence, 0.85);
  assert.equal(box.vertical, true);
  assert.equal(box.width, 30);
  assert.equal(box.height, 200);
});
