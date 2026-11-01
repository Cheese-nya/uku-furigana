import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { defaultCoverEncoder, defaultEncodeImage, extractPageImages } = loadTypescript('../app/utils/pdfImageExtractor.ts');

const ops = { paintImageXObject: 1, paintJpegXObject: 2, paintInlineImageXObject: 3 };

test('extractPageImages waits for a page-local image the worker has not delivered yet', async () => {
  const page = {
    getOperatorList: async () => ({ fnArray: [ops.paintImageXObject], argsArray: [['img_p9_1']] }),
    objs: {
      get(name, callback) {
        if (callback) {
          setTimeout(() => callback({ width: 800, height: 1200, kind: 2, data: new Uint8Array(0) }), 0);
          return null;
        }
        throw new Error(`Requesting object that isn't resolved yet ${name}.`);
      },
    },
  };
  const result = await extractPageImages(page, 0, { width: 600, height: 800 }, {
    ops,
    encodeImage: async () => ({ mime: 'image/jpeg', data: new Uint8Array([7]) }),
  });
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].id, 'img-1-1');
  assert.equal(result.skipped, 0);
});

test('extractPageImages keeps distinct bitmap images that share dimensions', async () => {
  const images = [
    { width: 1133, height: 1600, kind: 2, bitmap: {} },
    { width: 1133, height: 1600, kind: 2, bitmap: {} },
  ];
  const page = {
    getOperatorList: async () => ({ fnArray: [ops.paintImageXObject, ops.paintImageXObject], argsArray: [['a'], ['b']] }),
    objs: { get: name => images[name === 'a' ? 0 : 1] },
  };
  const result = await extractPageImages(page, 0, { width: 612, height: 792 }, {
    ops,
    encodeImage: async () => ({ mime: 'image/jpeg', data: new Uint8Array([1]) }),
  });
  assert.equal(result.images.length, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
});

test('defaultEncodeImage draws the pdf.js 6 bitmap wrapper', async () => {
  const draws = [];
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (...args) => draws.push(args) }),
      toBlob: (callback, mime) => callback(new Blob([new Uint8Array([4, 5, 6])], { type: mime })),
    }),
  };
  try {
    const bitmap = { width: 800, height: 1200 };
    const encoded = await defaultEncodeImage({ width: 800, height: 1200, kind: 2, bitmap });
    assert.equal(encoded.mime, 'image/jpeg');
    assert.equal(draws.length, 1);
    assert.equal(draws[0][0], bitmap);
    assert.deepEqual(Array.from(encoded.data), [4, 5, 6]);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('extractPageImages looks up g_ images in commonObjs', async () => {
  const page = {
    getOperatorList: async () => ({ fnArray: [ops.paintImageXObject], argsArray: [['g_d0_img_p362_1']] }),
    objs: { get: () => { throw new Error('wrong store'); } },
    commonObjs: {
      get: () => ({ width: 1062, height: 1499, kind: 2, data: new Uint8Array(0) }),
    },
  };
  const result = await extractPageImages(page, 11, { width: 612, height: 792 }, {
    ops,
    encodeImage: async () => ({ mime: 'image/jpeg', data: new Uint8Array([8]) }),
  });
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].id, 'img-12-1');
  assert.equal(result.images[0].pageIndex, 11);
});

test('defaultCoverEncoder renders print intent so rAF scheduling cannot stall the import', async () => {
  const calls = [];
  const page = {
    getViewport({ scale }) {
      return { width: 595 * scale, height: 842 * scale };
    },
    render(params) {
      calls.push(params);
      return { promise: Promise.resolve() };
    },
  };
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext: () => ({}),
        toBlob(callback, mime) {
          callback(new Blob([new Uint8Array([1, 2, 3])], { type: mime }));
        },
      };
    },
  };
  try {
    const encoded = await defaultCoverEncoder(page);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].intent, 'print');
    assert.equal(calls[0].viewport.width, 595);
    assert.equal(calls[0].viewport.height, 842);
    assert.equal(encoded.mime, 'image/jpeg');
    assert.deepEqual(Array.from(encoded.data), [1, 2, 3]);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('defaultCoverEncoder degrades to null when the page cannot render', async () => {
  const originalDocument = globalThis.document;
  delete globalThis.document;
  try {
    assert.equal(await defaultCoverEncoder({ getViewport: () => ({ width: 595, height: 842 }) }), null);
  } finally {
    if (originalDocument !== undefined) globalThis.document = originalDocument;
  }
});
