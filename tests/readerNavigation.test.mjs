import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';
const { pageDestination, sidePageDirection, ReaderTapGesture } = loadTypescript('../app/utils/readerNavigation.ts');
const { parseReaderPrefs, DEFAULT_READER_PREFS } = loadTypescript('../app/utils/readerPreferences.ts');

test('page movement retains 10% context, clamps at ends and crosses only from a boundary', () => {
  assert.deepEqual(pageDestination(0, 2000, 800, 1), { position: 720, crossChapter: false });
  assert.deepEqual(pageDestination(1800, 2000, 800, 1), { position: 2000, crossChapter: false });
  assert.equal(pageDestination(2000, 2000, 800, 1).crossChapter, true);
  assert.deepEqual(pageDestination(100, 2000, 800, -1), { position: 0, crossChapter: false });
  assert.equal(pageDestination(0, 2000, 800, -1).crossChapter, true);
  assert.equal(pageDestination(0, 0, 800, 1).crossChapter, true);
  // Both physical axes normalize to positive reading progress before entering the shared core.
  assert.equal(pageDestination(Math.abs(-200), 2000, 400, 1).position, 560);
});

test('side regions follow writing direction and leave the middle available to word lookup', () => {
  assert.equal(sidePageDirection(15, 10, 100, false), -1);
  assert.equal(sidePageDirection(105, 10, 100, false), 1);
  assert.equal(sidePageDirection(15, 10, 100, true), 1);
  assert.equal(sidePageDirection(105, 10, 100, true), -1);
  assert.equal(sidePageDirection(60, 10, 100, true), null);
  assert.equal(sidePageDirection(0, 10, 100, false), null);
});

test('only clean short taps turn pages; dragging back, long press and cancellation do not', () => {
  const gesture = new ReaderTapGesture();
  gesture.begin(5, 5, 0); gesture.move(9, 8);
  assert.equal(gesture.finish(100), true);
  assert.equal(gesture.finish(110), false);
  gesture.begin(5, 5, 0); gesture.move(30, 5); gesture.move(5, 5);
  assert.equal(gesture.finish(100), false);
  gesture.begin(5, 5, 0); assert.equal(gesture.finish(600), false);
  gesture.begin(5, 5, 0); gesture.cancel(); assert.equal(gesture.finish(100), false);
});

test('old reader preferences migrate locally and invalid new settings are bounded', () => {
  assert.deepEqual(parseReaderPrefs('{}'), DEFAULT_READER_PREFS);
  assert.deepEqual(parseReaderPrefs('null'), DEFAULT_READER_PREFS);
  const prefs = parseReaderPrefs(JSON.stringify({fontSize: 22, autoMode:'page', autoSpeed:1000, autoInterval:-2, sidePageTurn:false, volumePageTurn:true}));
  assert.equal(prefs.fontSize, 22);
  assert.equal(prefs.autoMode, 'page');
  assert.equal(prefs.autoSpeed, 100);
  assert.equal(prefs.autoInterval, 3);
  assert.equal(prefs.sidePageTurn, false);
  assert.equal(prefs.volumePageTurn, true);
  assert.equal(parseReaderPrefs('{"autoMode":"bad","autoSpeed":"fast"}').autoSpeed,30);
});
