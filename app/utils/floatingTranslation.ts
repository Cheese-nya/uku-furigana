export const FLOATING_TRANSLATION_KEY = 'furigana_floating_translation_v1';
export const TRANSLATION_GUIDE_KEY = 'furigana_reader_translation_guide_v1';
export const LONG_PRESS_MS = 450;
export const MOVE_TOLERANCE = 10;
export type Orientation = 'portrait' | 'landscape';
export interface Point { x: number; y: number }
export interface Bounds { left: number; top: number; right: number; bottom: number }
export interface FloatingTranslationState {
  floating: boolean;
  positions: Partial<Record<Orientation, Point>>;
}
export const DEFAULT_FLOATING_STATE: FloatingTranslationState = { floating: false, positions: {} };
const unit = (n: number) => Math.max(0, Math.min(1, n));
export function parseFloatingTranslation(raw: string | null): FloatingTranslationState {
  try {
    const value = JSON.parse(raw || 'null');
    const positions: FloatingTranslationState['positions'] = {};
    for (const orientation of ['portrait', 'landscape'] as const) {
      const p = value?.positions?.[orientation];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) positions[orientation] = { x: unit(p.x), y: unit(p.y) };
    }
    return { floating: value?.floating === true, positions };
  } catch { return { floating: false, positions: {} }; }
}
export function clampPoint(p: Point, b: Bounds): Point {
  return { x: Math.max(b.left, Math.min(Math.max(b.left, b.right), p.x)), y: Math.max(b.top, Math.min(Math.max(b.top, b.bottom), p.y)) };
}
export function positionFromRatio(p: Point, b: Bounds): Point {
  return clampPoint({ x: b.left + unit(p.x) * Math.max(0, b.right - b.left), y: b.top + unit(p.y) * Math.max(0, b.bottom - b.top) }, b);
}
export function positionToRatio(p: Point, b: Bounds): Point {
  const q = clampPoint(p, b);
  return { x: b.right > b.left ? (q.x - b.left) / (b.right - b.left) : 0, y: b.bottom > b.top ? (q.y - b.top) / (b.bottom - b.top) : 0 };
}
let state = DEFAULT_FLOATING_STATE;
const listeners = new Set<() => void>();
export function getFloatingTranslation() { return state; }
export function subscribeFloatingTranslation(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function hydrateFloatingTranslation() {
  try { state = parseFloatingTranslation(window.localStorage.getItem(FLOATING_TRANSLATION_KEY)); } catch { return; }
  listeners.forEach(listener => listener());
}
export function updateFloatingTranslation(patch: Partial<FloatingTranslationState>) {
  state = { ...state, ...patch };
  try { window.localStorage.setItem(FLOATING_TRANSLATION_KEY, JSON.stringify(state)); } catch { /* Session state still works when storage is unavailable. */ }
  listeners.forEach(listener => listener());
}
export function floatTranslation() { updateFloatingTranslation({ floating: true }); }
export function dockTranslation() { updateFloatingTranslation({ floating: false }); }

/** Center-to-center distance; the pointer need not touch the icon's center. */
export function translationHomeDistance(point: Point, home: Point): number {
  return Math.hypot(point.x + 22 - home.x, point.y + 22 - home.y);
}
export function translationApproach(distance: number): number {
  const t = unit((56 - distance) / 38);
  return t * t * (3 - 2 * t);
}
export function canDockTranslation(distance: number, armed: boolean): boolean {
  return armed && distance <= 32;
}

/** A single value keeps a missing, corrupt or disabled store from repeating the guide. */
export function translationGuideSeen(raw: string | null): boolean {
  return raw === 'seen';
}

export interface GuidePlacement {
  x: number;
  y: number;
  side: 'above' | 'below';
  /** Offset of the button from the guide's left edge, for the pointer. */
  arrowX: number;
}

const between = (value: number, lo: number, hi: number) => hi <= lo ? lo : Math.min(hi, Math.max(lo, value));
const axis = (center: number, size: number, lo: number, hi: number, margin: number) => {
  // Shrink the inset instead of pushing the hint outside a cramped viewport.
  const inset = between((hi - lo - size) / 2, 0, margin);
  const min = Math.min(lo + inset, hi - size - inset);
  const max = Math.max(lo + inset, hi - size - inset);
  return between(center - size / 2, min, max);
};

/** Places a one-time hint beside the 44px button, flipping below it near the top edge. */
export function translationGuidePosition(button: Point, bounds: Bounds, size: { width: number; height: number }): GuidePlacement {
  const margin = 12;
  const gap = 14;
  const centerX = button.x + 22;
  const x = axis(centerX, size.width, bounds.left, bounds.right, margin);
  const arrowX = between(centerX - x, 18, size.width - 18);
  const above = button.y - size.height - gap;
  const side: GuidePlacement['side'] = above >= bounds.top + margin ? 'above' : 'below';
  const desiredY = side === 'above' ? above : button.y + 44 + gap;
  const y = axis(desiredY + size.height / 2, size.height, bounds.top, bounds.bottom, margin);
  return { x, y, side, arrowX };
}
