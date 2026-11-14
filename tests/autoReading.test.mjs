import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';
const { startAutoReading } = loadTypescript('../app/utils/autoReading.ts');

function harness({ speed = 30, maximum = 10000, round = false } = {}) {
  let position = 0, ended = 0, callback, paused = false, cancelled = false;
  const stop = startAutoReading({
    getPosition: () => position,
    getMaximum: () => maximum,
    setPosition: value => { position = round ? Math.round(value) : value; },
    pixelsPerSecond: speed,
    isPaused: () => paused,
    requestFrame: next => { callback = next; return 1; },
    cancelFrame: () => { cancelled = true; },
    onEnd: () => { ended++; },
  });
  return { tick: time => callback(time), stop, pause: value => { paused = value; },
    move: value => { position = value; }, get position() { return position; },
    get ended() { return ended; }, get cancelled() { return cancelled; } };
}

test('auto-reading speed is independent of refresh rate, including rounded low-speed scroll positions', () => {
  for (const hz of [30, 60, 120]) {
    const h = harness({ speed: 10, round: true });
    for (let frame = 0; frame <= hz * 2; frame++) h.tick(frame * 1000 / hz);
    assert.equal(h.position, 20);
    h.stop();
  }
});

test('auto-reading cancels queued work and limits long-frame jumps', () => {
  const h = harness();
  h.tick(0); h.tick(10000);
  assert.ok(h.position < 2);
  h.stop();
  const position = h.position;
  h.tick(10016);
  assert.equal(h.position, position);
  assert.equal(h.cancelled, true);
});

test('end fires once after a reading delay, including chapters shorter than a screen', () => {
  for (const maximum of [0, 20]) {
    const h = harness({ maximum });
    for (let time = 0; time <= 1000; time += 20) h.tick(time);
    assert.equal(h.ended, 0);
    for (let time = 1020; time <= 4000; time += 20) h.tick(time);
    assert.equal(h.position, maximum);
    assert.equal(h.ended, 1);
  }
});

test('translation/font anchoring suspends motion and resumes from the adjusted position', () => {
  const h = harness();
  h.tick(0); h.tick(20);
  h.pause(true); h.move(300);
  for (let time = 40; time <= 2040; time += 20) h.tick(time);
  assert.equal(h.position, 300);
  assert.equal(h.ended, 0);
  h.pause(false); h.tick(2060);
  assert.ok(h.position > 300 && h.position < 301);
});

const { startTimedReading } = loadTypescript('../app/utils/autoReading.ts');
test('timed pages wait the full interval after completion, pause resets timing, cancellation prevents continuation', async () => {
  let callback, turns = 0, paused = false, resolveTurn, ended = 0;
  const stop = startTimedReading({intervalSeconds:3, isPaused:()=>paused,
    requestFrame: cb => { callback=cb; return 1; }, cancelFrame:()=>{},
    turnPage:()=>{ turns++; return new Promise(resolve=>{resolveTurn=resolve;}); }, onEnd:()=>ended++ });
  for (let t=0;t<=2000;t+=20) callback(t);
  paused=true; callback(2020); paused=false;
  for (let t=2040;t<5000;t+=20) callback(t);
  assert.equal(turns,0);
  callback(5020); assert.equal(turns,1);
  resolveTurn(true); await Promise.resolve();
  for (let t=6000;t<9000;t+=20) callback(t);
  assert.equal(turns,1);
  callback(9000); assert.equal(turns,2);
  stop(); resolveTurn(false); await Promise.resolve();
  assert.equal(ended,0);
});

test('timed pages stop at book end without repeatedly requesting another turn', async () => {
  let callback, ended=0;
  startTimedReading({intervalSeconds:3,isPaused:()=>false,
    requestFrame:cb=>{callback=cb;return 1;},cancelFrame:()=>{},
    turnPage:async()=>false,onEnd:()=>ended++});
  for(let t=0;t<=3000;t+=20) callback(t);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ended,1);
  callback(3020); assert.equal(ended,1);
});
