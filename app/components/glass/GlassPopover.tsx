'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SPRING_BOUNCY, prefersReducedMotion, useGlass, mergeRefs } from './hooks';
import { registerBackHandler } from '../../utils/backStack';

export interface GlassPopoverProps {
  open: boolean;
  onClose: () => void;
  /** Element the popover morphs out of. */
  anchor?: HTMLElement | null;
  /** Or a viewport point (context menus). */
  point?: { x: number; y: number } | null;
  /** Preferred side; flips when there is no room. */
  placement?: 'below' | 'above';
  /**
   * Material tier. `panel` (default) is the menu surface; `sheet` is the
   * denser one for large text-bearing cards. One surface, one tier.
   */
  tier?: 'panel' | 'sheet';
  className?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}

/**
 * Glass popover / context menu. Opens by morphing out of its anchor on a
 * spring; closes on outside press, Escape, or `onClose`.
 */
export function GlassPopover({ open, onClose, anchor, point, placement = 'below', tier = 'panel', className = '', ariaLabel, children }: GlassPopoverProps) {
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const glassRef = useGlass<HTMLDivElement>();
  const merged = useMemo(() => mergeRefs<HTMLDivElement>(panelRef, glassRef), [glassRef]);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      return;
    }
    const panel = panelRef.current;
    if (!panel || prefersReducedMotion()) { setMounted(false); return; }
    const out = panel.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.6)' }], { duration: 170, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    out.onfinish = () => setMounted(false);
    return () => out.cancel();
  }, [open]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !mounted || !panel) return;
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let ax: number, ay: number, aw = 0, ah = 0;
    if (point) { ax = point.x; ay = point.y; }
    else if (anchor) { const r = anchor.getBoundingClientRect(); ax = r.left; ay = r.top; aw = r.width; ah = r.height; }
    else { ax = vw / 2; ay = vh / 2; }
    let x = ax + aw / 2 - pw / 2;
    let y = placement === 'above' ? ay - ph - 8 : ay + ah + 8;
    if (y + ph > vh - 10) y = ay - ph - 8;
    if (y < 10) y = Math.min(ay + ah + 8, vh - ph - 10);
    x = Math.max(10, Math.min(vw - pw - 10, x));
    y = Math.max(10, y);
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.transformOrigin = `${ax + aw / 2 - x}px ${ay + ah / 2 - y}px`;
    if (!prefersReducedMotion()) {
      panel.animate([{ opacity: 0, transform: 'scale(0.35)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 560, easing: SPRING_BOUNCY });
    }
  }, [open, mounted, anchor, point, placement]);

  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => onCloseRef.current());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, anchor]);

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={merged}
      role="dialog"
      aria-label={ariaLabel}
      className={`glass ${tier === 'sheet' ? 'glass-sheet' : 'glass-solid'} fixed z-[80] min-w-[230px] rounded-[22px] p-1.5 text-sm text-[var(--label)] ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}

/** A row inside a GlassPopover. */
export function PopoverItem({ icon, children, detail, danger, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; detail?: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`flex h-10 w-full items-center gap-2.5 rounded-[14px] px-3 text-left font-medium transition-colors hover:bg-[var(--item-hover)] disabled:opacity-40 ${danger ? 'text-[var(--danger)]' : ''} ${className}`}
      {...rest}
    >
      {icon && <span className="flex w-[18px] justify-center">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {detail && <span className="text-xs text-[var(--label-2)]">{detail}</span>}
    </button>
  );
}

export function PopoverSeparator() {
  return <hr className="mx-2.5 my-1 h-px border-0 bg-[var(--sep)]" />;
}
