import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { anchorDelta, fullyVisible, intersectsView, TranslationPublishQueue, ReaderMotionGate, visibleParagraphRange } = loadTypescript('../app/utils/readerTranslationAnchor.ts');
const rect = (top, bottom, left = 0, right = 100) => ({ top, bottom, left, right });

test('complete sentence requires every wrapped fragment inside the unobscured viewport', () => {
  const view = rect(70, 600, 20, 400);
  assert.equal(fullyVisible([rect(80, 110, 30, 380), rect(120, 150, 30, 200)], view), true);
  assert.equal(fullyVisible([rect(60, 90, 30, 380), rect(100, 130, 30, 200)], view), false);
  assert.equal(fullyVisible([], view), false);
  assert.equal(fullyVisible([rect(80, 900, 30, 200)], view), false);
  assert.equal(intersectsView(rect(80, 900, 30, 200), view), true, 'long sentence permits a visible-character fallback');
  assert.equal(intersectsView(rect(600, 630, 30, 200), view), false);
});

test('vertical visibility checks both axes and the right reading edge', () => {
  const view = rect(70, 600, 0, 330);
  assert.equal(fullyVisible([rect(80, 500, 300, 325), rect(80, 300, 270, 295)], view), true);
  assert.equal(fullyVisible([rect(80, 500, 320, 350)], view), false);
  assert.equal(intersectsView(rect(80, 500, -30, -1), view), false);
});

test('compensation adds signed displacement, including negative vertical-rl scrollLeft', () => {
  assert.equal(anchorDelta(rect(120, 140), rect(420, 440), false), 300);
  assert.equal(anchorDelta(rect(420, 440), rect(120, 140), false), -300);
  const before = rect(80, 400, 250, 280);
  const after = rect(80, 400, 50, 80);
  const oldScrollLeft = -500;
  assert.equal(oldScrollLeft + anchorDelta(before, after, true), -700);
  assert.equal(anchorDelta(after, before, true), 200);
});

test('touch hold, momentum and subsequent wheel input all delay publication until quiet', () => {
  const motion = new ReaderMotionGate(180);
  assert.equal(motion.busy(0), false);
  motion.touchStart(10);
  assert.equal(motion.busy(10000), true, 'stationary held finger still blocks');
  motion.touchEnd(10010);
  motion.move(10150);
  assert.equal(motion.busy(10329), true);
  assert.equal(motion.busy(10330), false);
  motion.move(10340);
  assert.equal(motion.busy(10400), true);
  assert.equal(motion.touchEnd(10400), false, 'unrelated touchend must not prolong a wheel gesture');
  assert.equal(motion.busy(10520), false);
});

test('deferred batches publish latest snapshot once per owner after momentum, preserving all owners', () => {
  const queue = new TranslationPublishQueue();
  const motion = new ReaderMotionGate(180);
  const owner = {}, other = {}, results = [];
  motion.touchStart(0);
  queue.enqueue(owner, () => results.push('partial'));
  queue.enqueue(other, () => results.push('other'));
  queue.enqueue(owner, () => results.push('merged success + failures'));
  assert.equal(queue.size, 2);
  assert.deepEqual(results, []);
  motion.touchEnd(100);
  motion.move(200);
  if (!motion.busy(379)) queue.drain();
  assert.deepEqual(results, []);
  if (!motion.busy(380)) queue.drain();
  assert.deepEqual(results, ['merged success + failures', 'other']);
  queue.drain();
  assert.equal(results.length, 2, 'drained batches cannot replay');
});

test('cancel and reset discard deferred results; reentrant batches wait for next drain', () => {
  const queue = new TranslationPublishQueue();
  const oldBook = {}, newBook = {}, results = [];
  queue.enqueue(oldBook, () => results.push('stale'));
  queue.cancel(oldBook);
  queue.enqueue(newBook, () => {
    results.push('new');
    queue.enqueue(newBook, () => results.push('next'));
  });
  queue.drain();
  assert.deepEqual(results, ['new']);
  assert.equal(queue.size, 1);
  queue.clear();
  queue.drain();
  assert.deepEqual(results, ['new']);
});


test('long books measure only logarithmic search plus visible paragraphs on either reading axis', () => {
  let measured = 0;
  const horizontal = index => { measured++; return rect(index * 100, index * 100 + 100); };
  assert.deepEqual(visibleParagraphRange(10000, horizontal, rect(500050, 500650), false), [5000, 5007]);
  assert.ok(measured < 30);
  measured = 0;
  const vertical = index => { measured++; return rect(0, 500, 1000000 - index * 100 - 100, 1000000 - index * 100); };
  assert.deepEqual(visibleParagraphRange(10000, vertical, rect(0, 500, 499350, 499950), true), [5000, 5007]);
  assert.ok(measured < 30);
  assert.deepEqual(visibleParagraphRange(0, horizontal, rect(0, 500), false), [0, 0]);
});


test('reattaching viewport policy keeps a held touch and momentum active', () => {
  const motion = new ReaderMotionGate(180);
  motion.touchStart(10);
  motion.setQuietPeriod(220);
  assert.equal(motion.busy(10000), true, 'new viewport must not release a held touch');
  motion.touchEnd(10010);
  motion.move(10050);
  motion.setQuietPeriod(180);
  assert.equal(motion.busy(10229), true);
  assert.equal(motion.busy(10230), false);
});
