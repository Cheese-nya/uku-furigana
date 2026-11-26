import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

function loadHookWithHarness(relativePath) {
  let states = [];
  let refs = [];
  let cleanups = [];
  let effects = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effectCursor = 0;
  let hookFn = null;
  let hookArgs = [];
  let latestReturn = null;

  const reactStub = {
    useState(initial) {
      const idx = stateCursor++;
      if (!(idx in states)) {
        states[idx] = typeof initial === 'function' ? initial() : initial;
      }
      const setState = (updater) => {
        states[idx] = typeof updater === 'function' ? updater(states[idx]) : updater;
        render();
      };
      return [states[idx], setState];
    },
    useRef(initial) {
      const idx = refCursor++;
      if (!(idx in refs)) refs[idx] = { current: initial };
      return refs[idx];
    },
    useCallback(fn) {
      return fn;
    },
    useEffect(fn, deps) {
      const idx = effectCursor++;
      const prev = effects[idx];
      const changed = !prev || !deps || deps.some((d, i) => !Object.is(d, prev.deps?.[i]));
      if (changed) {
        effects[idx] = { deps };
        cleanups[idx]?.();
        const cleanup = fn();
        cleanups[idx] = typeof cleanup === 'function' ? cleanup : undefined;
      }
    },
  };

  function render() {
    stateCursor = 0;
    refCursor = 0;
    effectCursor = 0;
    latestReturn = hookFn(...hookArgs);
    return latestReturn;
  }

  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'react') return reactStub;
    return origLoad.call(this, request, parent, isMain);
  };
  let mod;
  try {
    mod = loadTypescript(relativePath);
  } finally {
    Module._load = origLoad;
  }

  return {
    mount(name, ...args) {
      states = [];
      refs = [];
      cleanups = [];
      effects = [];
      hookFn = mod[name];
      hookArgs = args;
      return render();
    },
    latest: () => latestReturn,
    unmount() {
      for (const cleanup of cleanups) cleanup?.();
    },
  };
}

const harness = loadHookWithHarness('../app/hooks/useImportQueue.ts');

test('useImportQueue marks commit-review cancel as cancelled (not failed) and aborts in-flight parses on unmount', async () => {
  let finishedSummary = null;
  let abortedOnSignal = false;
  let resolveSlowParse;

  const queue = harness.mount('useImportQueue', {
    parse: async (file, opts) => {
      if (file.name === 'slow.txt') {
        opts?.signal?.addEventListener('abort', () => { abortedOnSignal = true; }, { once: true });
        return new Promise((resolve) => { resolveSlowParse = resolve; });
      }
      return {
        title: file.name,
        content: '本文',
        format: 'txt',
        category: 'script',
        sourceOverrides: [],
        srtCues: [],
        images: [],
        warnings: [],
      };
    },
    fingerprint: async () => 'sha256:0',
    findDuplicate: () => null,
    buildPreview: (file, parsed) => ({
      fileName: file.name,
      fileSize: file.size,
      format: parsed.format,
      title: parsed.title,
      author: '',
      category: parsed.category,
      folderId: null,
      description: '',
      language: '',
      publisher: '',
      publishedAt: '',
      series: '',
      seriesIndex: '',
      identifier: '',
      stats: { characters: 2, lines: 1, chapters: 0, images: 0, rubies: 0, pages: 0 },
      chapters: [],
      sampleLines: ['本文'],
      warnings: [],
      duplicate: null,
    }),
    commit: async () => {
      throw new Error('QuotaExceededError');
    },
    onFinished: (summary) => { finishedSummary = summary; },
  });

  // 1. Single-file commit failure -> user cancels during commit error review
  queue.enqueue([new File(['本文'], 'a.txt'), new File(['次'], 'b.txt')]);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(harness.latest().review?.error);
  harness.latest().cancel();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(harness.latest().items.map(i => i.status), ['cancelled', 'cancelled']);
  assert.deepEqual(finishedSummary, { total: 2, success: 0, failed: 0, skipped: 0, cancelled: 2, failedNames: [] });

  // 2. Unmounting while a parse is active aborts its AbortSignal
  harness.latest().enqueue([new File(['遅い'], 'slow.txt')]);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(abortedOnSignal, false);
  harness.unmount();
  assert.equal(abortedOnSignal, true);
  resolveSlowParse?.({
    title: 'slow',
    content: '遅い',
    format: 'txt',
    category: 'script',
    sourceOverrides: [],
    srtCues: [],
    images: [],
    warnings: [],
  });
});
