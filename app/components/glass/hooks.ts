'use client';

import { useCallback, useRef, type MutableRefObject, type Ref } from 'react';
import { registerGlass, type GlassOptions } from './refraction';

const SPRING_BOUNCY_LINEAR = 'linear(0, 0.0374, 0.1314, 0.2581, 0.3989, 0.5394, 0.6698, 0.7841, 0.879, 0.9536, 1.009, 1.0469, 1.0701, 1.0813, 1.0833, 1.0789, 1.0703, 1.0593, 1.0474, 1.0358, 1.0252, 1.016, 1.0085, 1.0026, 0.9984, 0.9955, 0.9938, 0.9931, 0.9931, 0.9936, 0.9943, 0.9953, 0.9963, 0.9972, 0.9981, 0.9988, 1)';

/**
 * Easing for Web Animations. `linear()` needs Chromium 113; older WebViews (HarmonyOS 4 ships Chrome 99) make
 * `animate()` throw on it, which crashed the whole app from a layout effect, so they get a plain overshoot curve.
 */
export const SPRING_BOUNCY = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)')
  ? SPRING_BOUNCY_LINEAR
  : 'cubic-bezier(0.34, 1.4, 0.64, 1)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Ref callback that turns an element into refracting glass (Chromium) — pair with the `glass` class. */
export function useGlass<T extends HTMLElement>(options: GlassOptions = {}) {
  const cleanup = useRef<(() => void) | null>(null);
  const lens = !!options.lens;
  return useCallback((node: T | null) => {
    cleanup.current?.();
    cleanup.current = node ? registerGlass(node, { lens }) : null;
  }, [lens]);
}

/**
 * Ref callback for iOS 26 press physics on a `.gbtn`: the control swells
 * under the finger, a glow follows the touch point, dragging stretches it
 * toward the pointer, and release springs it back (CSS transition).
 */
export function usePressPhysics<T extends HTMLElement>() {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((node: T | null) => {
    cleanup.current?.();
    cleanup.current = node ? bindPress(node) : null;
  }, []);
}

export function bindPress(node: HTMLElement): () => void {
  let state: { x: number; y: number; rect: DOMRect; big: number } | null = null;
  const glow = (event: PointerEvent, rect: DOMRect) => {
    node.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    node.style.setProperty('--my', `${event.clientY - rect.top}px`);
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || (node as HTMLButtonElement).disabled) return;
    const rect = node.getBoundingClientRect();
    const big = Math.min(1.1, 1 + 14 / Math.max(rect.width, 40));
    state = { x: event.clientX, y: event.clientY, rect, big };
    glow(event, rect);
    if (prefersReducedMotion()) return;
    node.classList.add('is-pressed');
    node.style.setProperty('--sx', String(big));
    node.style.setProperty('--sy', String(big));
  };
  const move = (event: PointerEvent) => {
    if (!state) return;
    glow(event, state.rect);
    if (prefersReducedMotion()) return;
    const ax = Math.tanh((event.clientX - state.x) / 70);
    const ay = Math.tanh((event.clientY - state.y) / 70);
    node.style.setProperty('--tx', `${ax * 7}px`);
    node.style.setProperty('--ty', `${ay * 5}px`);
    node.style.setProperty('--sx', String(state.big + Math.abs(ax) * 0.07 - Math.abs(ay) * 0.03));
    node.style.setProperty('--sy', String(state.big + Math.abs(ay) * 0.07 - Math.abs(ax) * 0.03));
  };
  const end = () => {
    if (!state) return;
    state = null;
    node.classList.remove('is-pressed');
    for (const prop of ['--tx', '--ty', '--sx', '--sy']) node.style.removeProperty(prop);
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('pointerleave', end);
  return () => {
    node.removeEventListener('pointerdown', down);
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', end);
    node.removeEventListener('pointercancel', end);
    node.removeEventListener('pointerleave', end);
  };
}

/** Merge several refs (callback or object) into one ref callback. */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as MutableRefObject<T | null>).current = node;
    }
  };
}
