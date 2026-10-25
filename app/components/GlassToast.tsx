'use client';

import React from 'react';
import { GlassButton } from './glass/GlassButton';
import { useGlass } from './glass/hooks';
import { IconCheck, IconWarning } from './glass/icons';

export interface ToastState {
  kind: 'progress' | 'done' | 'error' | 'info';
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}

/**
 * Status toast (mockup v3): a glass pill at the bottom centre, a full-width card above the tab bar on
 * phones. Progress shows a spinner, success a check, failure a warning with the title in red.
 */
export function GlassToast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  const ref = useGlass<HTMLDivElement>();
  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      className={`glass glass-sheet fixed bottom-[max(24px,env(safe-area-inset-bottom))] left-4 right-4 z-[65] flex min-h-[44px] items-center gap-2.5 rounded-[22px] py-1 pl-4 pr-2 text-[13px] font-medium max-md:bottom-[calc(92px+env(safe-area-inset-bottom))] md:left-1/2 md:right-auto md:max-w-[min(560px,calc(100%-24px))] md:-translate-x-1/2 md:rounded-full ${
        toast
          ? 'translate-y-0 opacity-100 transition-[translate,opacity] duration-[560ms,200ms] [transition-timing-function:var(--spring-bouncy),ease]'
          : 'pointer-events-none translate-y-[160%] opacity-0 transition-[translate,opacity] duration-[300ms,200ms]'
      }`}
    >
      {toast?.kind === 'progress' && <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--fill)] border-t-[var(--label)]" aria-hidden />}
      {toast?.kind === 'done' && <IconCheck size={18} className="shrink-0 text-[var(--ok)]" />}
      {toast?.kind === 'error' && <IconWarning size={18} className="shrink-0 text-[var(--danger)]" />}
      <span className="flex min-w-0 flex-col py-1.5 leading-[1.35]">
        <b className={`truncate font-semibold ${toast?.kind === 'error' ? 'text-[var(--danger)]' : ''}`}>{toast?.title}</b>
        {toast?.detail && <span className="truncate text-xs font-normal text-[var(--label-2)]">{toast.detail}</span>}
      </span>
      {toast?.action && (
        <GlassButton className="ml-auto !h-8 shrink-0 !px-3 text-xs" onClick={() => { toast.action?.onClick(); onDismiss(); }}>
          {toast.action.label}
        </GlassButton>
      )}
    </div>
  );
}
