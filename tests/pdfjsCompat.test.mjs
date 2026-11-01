import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { installPromiseWithResolvers, installReadableStreamAsyncIterator, installPdfJsCompat } =
  loadTypescript('../app/utils/pdfjsCompat.ts');

test('installPromiseWithResolvers provides the Chrome 99 shim and is a no-op once present', async () => {
  const original = Promise.withResolvers;
  try {
    delete Promise.withResolvers;
    installPromiseWithResolvers();
    assert.equal(typeof Promise.withResolvers, 'function');

    const fulfilled = Promise.withResolvers();
    assert.ok(fulfilled.promise instanceof Promise);
    fulfilled.resolve(42);
    assert.equal(await fulfilled.promise, 42);

    const rejected = Promise.withResolvers();
    const reason = new Error('nope');
    rejected.reject(reason);
    await assert.rejects(rejected.promise, reason);

    const existing = Promise.withResolvers;
    installPromiseWithResolvers();
    assert.equal(Promise.withResolvers, existing);
  } finally {
    Promise.withResolvers = original;
  }
});

test('installReadableStreamAsyncIterator makes a Chrome 99 stream usable with for-await', async () => {
  const original = Object.getOwnPropertyDescriptor(ReadableStream.prototype, Symbol.asyncIterator);
  try {
    delete ReadableStream.prototype[Symbol.asyncIterator];
    installReadableStreamAsyncIterator();
    assert.equal(typeof ReadableStream.prototype[Symbol.asyncIterator], 'function');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue('first');
        controller.enqueue('second');
        controller.close();
      },
    });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.deepEqual(chunks, ['first', 'second']);

    const existing = ReadableStream.prototype[Symbol.asyncIterator];
    installReadableStreamAsyncIterator();
    assert.equal(ReadableStream.prototype[Symbol.asyncIterator], existing);
  } finally {
    if (original) {
      Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, original);
    } else {
      delete ReadableStream.prototype[Symbol.asyncIterator];
    }
  }
});

test('installPdfJsCompat installs both shims', async () => {
  const promiseOriginal = Promise.withResolvers;
  const streamOriginal = Object.getOwnPropertyDescriptor(ReadableStream.prototype, Symbol.asyncIterator);
  try {
    delete Promise.withResolvers;
    delete ReadableStream.prototype[Symbol.asyncIterator];
    installPdfJsCompat();
    assert.equal(typeof Promise.withResolvers, 'function');
    assert.equal(typeof ReadableStream.prototype[Symbol.asyncIterator], 'function');
  } finally {
    Promise.withResolvers = promiseOriginal;
    if (streamOriginal) {
      Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, streamOriginal);
    } else {
      delete ReadableStream.prototype[Symbol.asyncIterator];
    }
  }
});
