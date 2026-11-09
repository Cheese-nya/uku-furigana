/** Geometry is in viewport coordinates; vertical-rl advances from right to left. */
export interface AnchorRect { top: number; bottom: number; left: number; right: number }
export function intersectsView(rect: AnchorRect, view: AnchorRect): boolean {
  return rect.bottom > view.top && rect.top < view.bottom && rect.right > view.left && rect.left < view.right;
}
export function fullyVisible(rects: AnchorRect[], view: AnchorRect): boolean {
  return rects.length > 0 && rects.every(r => r.top >= view.top && r.bottom <= view.bottom && r.left >= view.left && r.right <= view.right);
}
export function anchorDelta(before: AnchorRect, after: AnchorRect, vertical: boolean): number {
  return vertical ? after.right - before.right : after.top - before.top;
}

/** No timers here: the owner decides when touch/momentum has stopped. Last update per key wins. */
export class TranslationPublishQueue {
  private pending = new Map<object, () => void>();
  enqueue(owner: object, publish: () => void) { this.pending.set(owner, publish); }
  cancel(owner: object) { this.pending.delete(owner); }
  clear() { this.pending.clear(); }
  get size() { return this.pending.size; }
  drain() {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    callbacks.forEach(publish => publish());
  }
}

/** Gesture remains active through momentum: every genuine scroll restarts the quiet period. */
export class ReaderMotionGate {
  private touched = false;
  private lastMotion = -Infinity;
  constructor(private quietMs: number) {}
  setQuietPeriod(quietMs: number) { this.quietMs = quietMs; }
  move(now: number) { this.lastMotion = now; }
  touchStart(now: number) { this.touched = true; this.move(now); }
  touchEnd(now: number) {
    if (!this.touched) return false;
    this.touched = false; this.move(now); return true;
  }
  busy(now: number) { return this.touched || now - this.lastMotion < this.quietMs; }
}

/** Paragraphs are monotonic along the reading axis; avoid measuring an entire long book. */
export function visibleParagraphRange(length: number, measure: (index: number) => AnchorRect, view: AnchorRect, vertical: boolean): [number, number] {
  let low = 0, high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const rect = measure(middle);
    if (vertical ? rect.left >= view.right : rect.bottom <= view.top) low = middle + 1;
    else high = middle;
  }
  const start = low;
  while (low < length) {
    const rect = measure(low);
    if (vertical ? rect.right <= view.left : rect.top >= view.bottom) break;
    low++;
  }
  return [start, low];
}
