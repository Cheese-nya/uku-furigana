'use client';

import React from 'react';
import { LiquidSelector } from './glass/LiquidSelector';
import { useGlass } from './glass/hooks';
import { IconBooks, IconEdit, IconRead, IconStack } from './glass/icons';
import type { Translations } from '../utils/i18n';

export type AppTab = 'editor' | 'library' | 'reader' | 'batch_files';

export interface MobileNavBarProps {
  activeTab: AppTab;
  onChange: (tab: AppTab) => void;
  bookCount?: number;
  /** Slides away (reader immersion). */
  hidden?: boolean;
  t: Translations;
}

/** Phone tab bar (mockup): one 52px glass capsule with four tabs and a liquid selection. */
export function MobileNavBar({ activeTab, onChange, hidden = false, t }: MobileNavBarProps) {
  const glassRef = useGlass<HTMLElement>();

  const tab = (icon: React.ReactNode, label: string) => (
    <span className="flex flex-col items-center justify-center gap-px">
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </span>
  );

  return (
    <nav
      ref={glassRef}
      data-testid="mobile-nav-bar"
      aria-label={t.sidebarTitle}
      aria-hidden={hidden || undefined}
      className={`mobile-nav-bar glass glass-solid glass-nav fixed bottom-[max(24px,env(safe-area-inset-bottom))] left-1/2 z-40 flex h-[52px] -translate-x-1/2 items-center rounded-full p-[3px] transition-[translate,opacity] duration-[600ms] [transition-timing-function:var(--spring-smooth)] md:hidden ${
        hidden ? 'pointer-events-none translate-y-[160%] opacity-0' : ''
      }`}
    >
      <LiquidSelector
        variant="bare"
        ariaLabel={t.sidebarTitle}
        className="h-full [&>[data-opt]]:flex [&>[data-opt]]:h-[46px] [&>[data-opt]]:w-[80px] [&>[data-opt]]:items-center [&>[data-opt]]:justify-center [&>[data-opt]]:rounded-full [&>[data-opt]]:text-[10px] [&>[data-opt]]:font-semibold [&>[data-opt][aria-selected=false]]:text-[var(--label-2)]"
        value={activeTab}
        onChange={onChange}
        options={[
          { value: 'editor', label: tab(<IconEdit size={20} />, t.mobileNavEditor) },
          { value: 'library', label: tab(<IconBooks size={20} />, t.mobileNavLibrary) },
          { value: 'reader', label: tab(<IconRead size={20} />, t.mobileNavReader) },
          { value: 'batch_files', label: tab(<IconStack size={20} />, t.mobileNavBatch) },
        ]}
      />
    </nav>
  );
}
