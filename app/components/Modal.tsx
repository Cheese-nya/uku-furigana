'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { IconClose } from './glass/icons';
import { registerBackHandler } from '../utils/backStack';
import { dragOffset, dragProgress, shouldDismiss } from '../utils/sheetDrag';
import { prefersReducedMotion } from './glass/hooks';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
  /** Sheets that carry their own heading (e.g. the reading-correction sheet) hide the title bar. */
  hideHeader?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'md',
  hideHeader = false,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  // The Android back key closes the newest open sheet first.
  useEffect(() => {
    if (!isOpen) return;
    return registerBackHandler(() => closeRef.current());
  }, [isOpen]);

  // Phone sheets: drag the handle or the title bar down to dismiss. The sheet follows the finger and the
  // backdrop fades with it; on release it closes (far or fast enough) or springs back on the sheet's own transition.
  const backdropRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; startY: number; samples: Array<{ y: number; t: number }>; zone: HTMLElement; height: number } | null>(null);

  const applyDrag = (offset: number, height: number) => {
    const sheet = modalRef.current;
    const backdrop = backdropRef.current;
    if (!sheet || !backdrop) return;
    sheet.style.transition = 'none';
    sheet.style.translate = `0 ${offset}px`;
    // Chromium <104 ignores individual transform properties. A legacy drag
    // owns the whole transform, then clears it before closing / springing back.
    const legacyTransform = typeof CSS !== 'undefined' && !CSS.supports?.('translate', '0');
    const scale = prefersReducedMotion() ? 1 : 1 - Math.min(0.04, dragProgress(offset, height) * 0.08);
    if (legacyTransform) sheet.style.transform = `translateY(${offset}px) scale(${scale})`;
    else sheet.style.scale = String(scale);
    backdrop.style.transition = 'none';
    backdrop.style.opacity = String(1 - dragProgress(offset, height));
  };

  const clearDrag = () => {
    for (const el of [modalRef.current, backdropRef.current]) {
      if (!el) continue;
      el.style.transition = '';
      el.style.translate = '';
      el.style.scale = '';
      el.style.transform = '';
      el.style.opacity = '';
    }
  };

  const onDragStart = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!window.matchMedia('(max-width: 639px)').matches) return;
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    const sheet = modalRef.current;
    if (!sheet) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: event.pointerId, startY: event.clientY, samples: [{ y: event.clientY, t: event.timeStamp }],
      zone: event.currentTarget, height: sheet.getBoundingClientRect().height,
    };
    document.getElementById(`${titleId}-grab`)?.setAttribute('data-dragging', 'true');
  };

  const onDragMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    drag.samples.push({ y: event.clientY, t: event.timeStamp });
    if (drag.samples.length > 6) drag.samples.shift();
    applyDrag(dragOffset(event.clientY - drag.startY), drag.height);
  };

  const onDragEnd = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragRef.current = null;
    document.getElementById(`${titleId}-grab`)?.removeAttribute('data-dragging');
    const first = drag.samples[0];
    const last = drag.samples[drag.samples.length - 1];
    const velocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    const offset = dragOffset(event.clientY - drag.startY);
    clearDrag();
    if (event.type !== 'pointercancel' && shouldDismiss({ offset, velocity, height: drag.height })) closeRef.current();
  };
  const dragHandlers = { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragEnd };

  useEffect(() => {
    if (isOpen) {
      // Mount first, then flip `visible` next frame so the entrance transition runs.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), 560);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      if (!modalRef.current?.contains(document.activeElement)) modalRef.current?.focus();
    }, 0);
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
      )).filter(element => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) {
        event.preventDefault();
        modalRef.current.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modalRef.current)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  if (!mounted) return null;

  const maxWidthClasses = {
    sm: 'max-w-[420px]',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div
        ref={backdropRef}
        className={`fixed inset-0 bg-black/20 transition-opacity duration-[260ms] ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        tabIndex={-1}
        data-visible={visible ? 'true' : 'false'}
        className={`modal-sheet glass glass-sheet relative flex w-full ${maxWidthClasses[maxWidth]} flex-col overflow-hidden rounded-[30px] bg-[var(--sheet-fill)] p-[22px] text-[var(--label)] shadow-[var(--glass-shadow)] outline-none transition-[scale,opacity,translate] max-sm:rounded-t-[34px] max-sm:rounded-b-none max-sm:pb-[max(22px,env(safe-area-inset-bottom))] sm:duration-[560ms,200ms,560ms] sm:[transition-timing-function:var(--spring-bouncy),ease,var(--spring-smooth)] max-sm:scale-100 max-sm:opacity-100 max-sm:duration-[560ms] max-sm:[transition-timing-function:var(--spring-smooth)] ${visible ? 'sm:scale-100 sm:opacity-100 max-sm:translate-y-0' : 'sm:scale-90 sm:opacity-0 max-sm:translate-y-full'}`}
      >
        {/* the whole top strip is the grab area (not just the 5px pill), and the pill swells under the finger */}
        <div
          id={`${titleId}-grab`}
          {...dragHandlers}
          className="group sm:hidden -mx-[22px] -mt-[22px] flex h-[29px] shrink-0 cursor-grab touch-none items-start justify-center pt-3 active:cursor-grabbing"
          aria-hidden="true"
        >
          <i className="block h-[5px] w-9 rounded-full bg-[var(--label-3)] transition-[width,background-color] duration-[420ms] [transition-timing-function:var(--spring-bouncy)] group-data-[dragging=true]:w-14 group-data-[dragging=true]:bg-[var(--label-2)]" />
        </div>
        {hideHeader ? <h2 id={titleId} className="sr-only">{title}</h2> : (
        <header {...dragHandlers} className="mb-4 flex shrink-0 touch-none items-center justify-between gap-4 border-b border-[var(--sep)] pb-3 sm:touch-auto">
          <h2 id={titleId} className="text-[17px] font-semibold tracking-tight text-[var(--label)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="关闭" className="btn h-8 w-8 justify-center !p-0" >
            <IconClose size={16} />
          </button>
        </header>
        )}
        <div className="modal-body overflow-y-auto text-[var(--label-2)]">{children}</div>
        {footer && <footer className="mt-4 flex shrink-0 justify-end gap-3 border-t border-[var(--sep)] pt-4">{footer}</footer>}
      </div>
    </div>
  );
};
