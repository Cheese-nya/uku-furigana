type WithResolvers = <T>() => {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};
type PromiseWithResolvers = PromiseConstructor & { withResolvers?: WithResolvers };

type AsyncIterableStreamPrototype = ReadableStream<unknown> & {
  [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown>;
};

/** pdf.js 6 calls Promise.withResolvers, which is Chrome 119+. HarmonyOS 4 ships Chrome 99. */
export function installPromiseWithResolvers(): void {
  const promiseConstructor = Promise as PromiseWithResolvers;
  if (typeof promiseConstructor.withResolvers === 'function') return;
  promiseConstructor.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

/**
 * pdf.js 6 reads text and operator lists with `for await` over a native ReadableStream.
 * ReadableStream only became async-iterable in Chrome 124, so Chrome 99 needs the standard
 * reader-backed iterator.
 */
export function installReadableStreamAsyncIterator(): void {
  if (typeof ReadableStream === 'undefined') return;
  const prototype = ReadableStream.prototype as AsyncIterableStreamPrototype;
  if (typeof prototype[Symbol.asyncIterator] === 'function') return;
  Object.defineProperty(prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: function asyncIterator(this: ReadableStream<unknown>): AsyncIterableIterator<unknown> {
      const reader = this.getReader();
      return {
        async next() {
          const result = await reader.read();
          if (result.done) reader.releaseLock();
          return result;
        },
        async return(value?: unknown) {
          try {
            await reader.cancel();
          } catch {
            // The stream may already be closed or errored; the lock still needs releasing.
          }
          reader.releaseLock();
          return { done: true, value };
        },
        async throw(error?: unknown) {
          reader.releaseLock();
          throw error;
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  });
}

/** Install the platform shims pdf.js 6 needs before its first dynamic import. */
export function installPdfJsCompat(): void {
  installPromiseWithResolvers();
  installReadableStreamAsyncIterator();
}
