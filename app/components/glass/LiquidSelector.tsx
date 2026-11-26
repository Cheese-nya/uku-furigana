'use client';

import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { SPRING_BOUNCY, prefersReducedMotion, useGlass, mergeRefs } from './hooks';

export interface LiquidOption<V extends string> {
  value: V;
  label: React.ReactNode;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
  className?: string;
  testId?: string;
}

export interface LiquidSelectorProps<V extends string> {
  options: Array<LiquidOption<V>>;
  value: V;
  onChange: (value: V) => void;
  axis?: 'x' | 'y';
  /**
   * - `glass`: the selector is its own glass capsule (toolbars)
   * - `solid`: grey track with a white thumb (content, popovers)
   * - `bare`: no track; caller styles the container (sidebar nav, tab bar)
   */
  variant?: 'glass' | 'solid' | 'bare';
  className?: string;
  /** Extra class for the moving indicator. */
  indicatorClassName?: string;
  ariaLabel?: string;
  /** role for the container: tablist (default) or radiogroup. */
  role?: 'tablist' | 'radiogroup';
  containerRef?: React.Ref<HTMLDivElement>;
  testId?: string;
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * Segmented control / nav / tab bar with a liquid indicator: on change the
 * thumb stretches toward the target and springs into place; pressing and
 * dragging the selected option turns the thumb into a clear lens that
 * follows the pointer and snaps to the nearest option on release.
 */
export function LiquidSelector<V extends string>({
  options,
  value,
  onChange,
  axis = 'x',
  variant = 'solid',
  className = '',
  indicatorClassName = '',
  ariaLabel,
  role = 'tablist',
  containerRef,
  testId,
}: LiquidSelectorProps<V>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const indRef = useRef<HTMLSpanElement | null>(null);
  const optRefs = useRef(new Map<V, HTMLButtonElement>());
  const anim = useRef<Animation | null>(null);
  const shown = useRef<V | null>(null);
  const drag = useRef<{ start: number; base: Box; now?: Box; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const glassRef = useGlass<HTMLDivElement>();

  const boxOf = (el: HTMLElement): Box => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  const place = (b: Box) => {
    const ind = indRef.current;
    if (!ind) return;
    ind.style.transform = `translate(${b.x}px, ${b.y}px)`;
    ind.style.width = `${b.w}px`;
    ind.style.height = `${b.h}px`;
  };
  const current = (): Box | null => {
    const ind = indRef.current;
    if (!ind || !ind.offsetWidth) return null;
    const m = new DOMMatrix(getComputedStyle(ind).transform);
    return { x: m.e, y: m.f, w: ind.offsetWidth, h: ind.offsetHeight };
  };
  const frame = (b: Box) => ({ transform: `translate(${b.x}px, ${b.y}px)`, width: `${b.w}px`, height: `${b.h}px` });

  const moveTo = useCallback((target: V, animate: boolean, from?: Box | null) => {
    const el = optRefs.current.get(target);
    const ind = indRef.current;
    const root = rootRef.current;
    if (!el || !ind || !root) return;
    const b = boxOf(el);
    const a = from ?? current();
    anim.current?.cancel();
    place(b);
    if (!animate || !a || prefersReducedMotion() || root.offsetParent === null) return;
    if (a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h) return;
    const ux = Math.min(a.x, b.x);
    const uy = Math.min(a.y, b.y);
    const uw = Math.max(a.x + a.w, b.x + b.w) - ux;
    const uh = Math.max(a.y + a.h, b.y + b.h) - uy;
    // stretch 55% of the way toward the union, leaning to the target
    const lead: Box = {
      x: a.x + (ux - a.x) * 0.55 + (b.x - a.x) * 0.25,
      y: a.y + (uy - a.y) * 0.55 + (b.y - a.y) * 0.25,
      w: a.w + (uw - a.w) * 0.55,
      h: a.h + (uh - a.h) * 0.55,
    };
    root.classList.add('moving');
    const animation = ind.animate([
      { ...frame(a), easing: 'cubic-bezier(.3,.7,.4,1)' },
      { ...frame(lead), offset: 0.26, easing: SPRING_BOUNCY },
      frame(b),
    ], { duration: 640 });
    const done = () => root.classList.remove('moving');
    animation.onfinish = done;
    animation.oncancel = done;
    anim.current = animation;
  }, []);

  // follow the controlled value
  useLayoutEffect(() => {
    const first = shown.current === null;
    moveTo(value, !first);
    shown.current = value;
  }, [value, moveTo]);

  // keep the thumb glued to its option when layout changes
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (anim.current?.playState === 'running' || drag.current?.moved) return;
      const el = shown.current && optRefs.current.get(shown.current);
      if (el) place(boxOf(el));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const opt = (event.target as HTMLElement).closest<HTMLElement>('[data-opt]');
    suppressClick.current = false;
    if (!opt || opt.dataset.opt !== value || event.button !== 0) return;
    const base = current();
    if (!base) return;
    drag.current = { start: axis === 'x' ? event.clientX : event.clientY, base, moved: false };
    rootRef.current?.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = (axis === 'x' ? event.clientX : event.clientY) - d.start;
    if (!d.moved && Math.abs(delta) < 4) return;
    if (!d.moved) {
      d.moved = true;
      anim.current?.cancel();
      rootRef.current?.classList.add('dragging');
    }
    const els = options.map(o => optRefs.current.get(o.value)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const first = boxOf(els[0]);
    const last = boxOf(els[els.length - 1]);
    const next = { ...d.base };
    if (axis === 'x') next.x = Math.max(first.x - 8, Math.min(last.x + last.w - next.w + 8, next.x + delta));
    else next.y = Math.max(first.y - 6, Math.min(last.y + last.h - next.h + 6, next.y + delta));
    place(next);
    d.now = next;
  };
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    rootRef.current?.classList.remove('dragging');
    if (!d?.moved || !d.now) return;
    suppressClick.current = true;
    const center = axis === 'x' ? d.now.x + d.now.w / 2 : d.now.y + d.now.h / 2;
    let best = options[0]?.value;
    let bestDist = Infinity;
    for (const o of options) {
      const el = optRefs.current.get(o.value);
      if (!el) continue;
      const b = boxOf(el);
      const c = axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2;
      if (Math.abs(c - center) < bestDist) { bestDist = Math.abs(c - center); best = o.value; }
    }
    if (best === undefined) return;
    if (best === value) moveTo(best, true, d.now);
    else { shown.current = best; moveTo(best, true, d.now); onChange(best); }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!options.length) return;
    const prevKey = axis === 'y' ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = axis === 'y' ? 'ArrowDown' : 'ArrowRight';
    const currentIndex = Math.max(0, options.findIndex(o => o.value === value));
    let targetIndex = -1;
    if (event.key === nextKey) targetIndex = (currentIndex + 1) % options.length;
    else if (event.key === prevKey) targetIndex = (currentIndex - 1 + options.length) % options.length;
    else if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = options.length - 1;
    if (targetIndex < 0) return;
    event.preventDefault();
    const next = options[targetIndex];
    if (!next) return;
    optRefs.current.get(next.value)?.focus();
    if (next.value !== value) onChange(next.value);
  };

  const rootMerged = useMemo(
    () => mergeRefs<HTMLDivElement>(rootRef, containerRef, variant === 'glass' ? glassRef : undefined),
    [containerRef, variant, glassRef],
  );
  const variantClass = variant === 'glass' ? 'seg glass' : variant === 'solid' ? 'seg seg-solid' : '';
  const isTab = role === 'tablist';
  return (
    <div
      ref={rootMerged}
      role={role}
      aria-label={ariaLabel}
      aria-orientation={axis === 'y' ? 'vertical' : undefined}
      data-testid={testId}
      className={`sel ${variantClass} ${axis === 'y' ? 'flex-col items-stretch' : ''} ${className}`}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span ref={indRef} className={`sel-ind ${indicatorClassName}`} aria-hidden />
      {options.map(o => (
        <button
          key={o.value}
          ref={el => { if (el) optRefs.current.set(o.value, el); else optRefs.current.delete(o.value); }}
          type="button"
          data-opt={o.value}
          data-testid={o.testId}
          role={isTab ? 'tab' : 'radio'}
          tabIndex={o.value === value ? 0 : -1}
          aria-selected={isTab ? o.value === value : undefined}
          aria-checked={isTab ? undefined : o.value === value}
          aria-label={o.ariaLabel}
          className={o.className}
          onClick={() => {
            if (suppressClick.current) { suppressClick.current = false; return; }
            if (o.value !== value) onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
