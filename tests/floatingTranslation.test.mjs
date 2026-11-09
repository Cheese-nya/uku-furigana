import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';
const f = loadTypescript('../app/utils/floatingTranslation.ts');

test('corrupt storage defaults safely and orientation positions are independently validated', () => {
  assert.deepEqual(f.parseFloatingTranslation('{'), { floating: false, positions: {} });
  assert.deepEqual(f.parseFloatingTranslation(JSON.stringify({ floating: true, positions: {
    portrait: { x: -.2, y: 2 }, landscape: { x: 'bad', y: .5 },
  } })), { floating: true, positions: { portrait: { x: 0, y: 1 } } });
});

test('free placement round trips without snapping, including inset and keyboard bounds', () => {
  const bounds = { left: 32, top: 60, right: 300, bottom: 700 };
  const point = { x: 137, y: 313 };
  assert.deepEqual(f.positionFromRatio(f.positionToRatio(point, bounds), bounds), point);
  assert.deepEqual(f.clampPoint({ x: -50, y: 900 }, bounds), { x: 32, y: 700 });
  const saved = f.positionToRatio(point, bounds);
  const temporary = f.positionFromRatio(saved, { ...bounds, bottom: 220 });
  assert.ok(temporary.y <= 220);
  assert.deepEqual(f.positionFromRatio(saved, bounds), point);
});

test('tiny viewports never produce coordinates outside the leading safe inset', () => {
  const bounds = { left: 20, top: 30, right: 5, bottom: 10 };
  assert.deepEqual(f.positionFromRatio({ x: 1, y: 1 }, bounds), { x: 20, y: 30 });
  assert.deepEqual(f.positionToRatio({ x: 20, y: 30 }, bounds), { x: 0, y: 0 });
});

test('float/dock persist across hydration without losing either orientation; blocked storage still works', () => {
  const previousWindow = globalThis.window;
  let raw = null, notifications = 0;
  globalThis.window = { localStorage: { getItem: () => raw, setItem: (_key, value) => { raw = value; } } };
  const unsubscribe = f.subscribeFloatingTranslation(() => notifications++);
  try {
    const positions = { portrait: { x: .23, y: .71 }, landscape: { x: .62, y: .18 } };
    f.updateFloatingTranslation({ floating: true, positions });
    f.dockTranslation();
    assert.deepEqual(f.getFloatingTranslation(), { floating: false, positions });
    f.hydrateFloatingTranslation();
    f.floatTranslation();
    assert.deepEqual(JSON.parse(raw), { floating: true, positions });
    globalThis.window.localStorage.setItem = () => { throw Error('blocked'); };
    assert.doesNotThrow(() => f.dockTranslation());
    assert.equal(f.getFloatingTranslation().floating, false);
    assert.ok(notifications >= 5);
  } finally { unsubscribe(); globalThis.window = previousWindow; }
});


test('approach is continuous, reversible and bounded, while the commit radius stays small', () => {
  assert.equal(f.translationApproach(56), 0);
  assert.equal(f.translationApproach(18), 1);
  assert.equal(f.translationApproach(1000), 0);
  assert.equal(f.translationApproach(0), 1);
  const distances = [55, 48, 40, 32, 24, 19];
  const values = distances.map(f.translationApproach);
  for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1]);
  assert.ok(Math.abs(f.translationApproach(37) - .5) < .00001);
  assert.equal(f.canDockTranslation(32, true), true);
  assert.equal(f.canDockTranslation(32.01, true), false);
  assert.equal(f.canDockTranslation(0, false), false, 'a newly lifted button cannot immediately re-dock');
});

test('docking uses the button center and current home, independently of finger offset or scrolling', () => {
  assert.equal(f.translationHomeDistance({ x: 80, y: 680 }, { x: 102, y: 702 }), 0);
  assert.equal(f.translationHomeDistance({ x: 80, y: 680 }, { x: 102, y: 722 }), 20);
  assert.equal(f.canDockTranslation(f.translationHomeDistance({ x: 80, y: 680 }, { x: 102, y: 722 }), true), true);
});

test('the one-time guide is recognized only after it is marked seen', () => {
  assert.equal(f.translationGuideSeen(null), false);
  assert.equal(f.translationGuideSeen('dismissed'), false);
  assert.equal(f.translationGuideSeen('furigana_reader_translation_guide_v1'), false);
  assert.equal(f.translationGuideSeen('seen'), true);
  assert.equal(f.TRANSLATION_GUIDE_KEY, 'furigana_reader_translation_guide_v1');
});

test('the one-time guide stays on screen and points at the docked translation button', () => {
  const bounds = { left: 12, top: 12, right: 360, bottom: 720 };
  const size = { width: 260, height: 92 };
  const above = f.translationGuidePosition({ x: 280, y: 620 }, bounds, size);
  assert.equal(above.side, 'above');
  assert.equal(above.y, 620 - 92 - 14);
  assert.ok(above.x >= bounds.left + 12 && above.x + size.width <= bounds.right - 12);
  assert.ok(above.arrowX >= 18 && above.arrowX <= size.width - 18);
  const below = f.translationGuidePosition({ x: 20, y: 50 }, bounds, size);
  assert.equal(below.side, 'below');
  assert.equal(below.y, 50 + 44 + 14);
  const compact = f.translationGuidePosition({ x: 100, y: 300 }, { left: 20, top: 30, right: 220, bottom: 390 }, { width: 170, height: 80 });
  assert.ok(compact.x >= 32 && compact.x + 170 <= 208);
  assert.ok(compact.y >= 38 && compact.y + 80 <= 370);
});
