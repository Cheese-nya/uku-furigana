export type PageDirection = -1 | 1;
export const SIDE_PAGE_TURN_EDGE_PX = 20;

export function pageDestination(position: number, maximum: number, viewport: number, direction: PageDirection) {
  const max = Math.max(0, maximum);
  const current = Math.min(max, Math.max(0, position));
  return {
    position: Math.min(max, Math.max(0, current + direction * Math.max(1, viewport * 0.9))),
    crossChapter: direction === 1 ? current >= max - 1 : current <= 1,
  };
}

export function sidePageDirection(x: number, left: number, width: number, vertical: boolean): PageDirection | null {
  if (width <= 0 || x < left || x > left + width) return null;
  const edge = Math.min(SIDE_PAGE_TURN_EDGE_PX, width / 2);
  const offset = x - left;
  const direction = offset < edge ? -1 : offset >= width - edge ? 1 : null;
  return direction === null ? null : vertical ? (direction * -1) as PageDirection : direction;
}

/** Track the whole gesture, including a drag that returns to its starting point. */
export class ReaderTapGesture {
  private start: { x: number; y: number; time: number } | null = null;
  private valid = false;
  begin(x: number, y: number, time: number) { this.start = { x, y, time }; this.valid = true; }
  move(x: number, y: number) {
    if (this.start && Math.hypot(x - this.start.x, y - this.start.y) > 10) this.valid = false;
  }
  cancel() { this.valid = false; }
  finish(time: number) {
    const valid = this.valid && this.start !== null && time - this.start.time < 500;
    this.start = null;
    this.valid = false;
    return valid;
  }
}
