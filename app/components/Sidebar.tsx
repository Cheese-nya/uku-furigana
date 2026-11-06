'use client';

import React, { useState } from 'react';
import { LiquidSelector } from './glass/LiquidSelector';
import { GlassButton } from './glass/GlassButton';
import { useGlass } from './glass/hooks';
import { IconBooks, IconEdit, IconGear, IconRead, IconStack } from './glass/icons';
import { UpdateDot } from './UpdateDot';
import type { AppTab } from './MobileNavBar';
import type { Translations } from '../utils/i18n';

export interface SidebarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  libraryBookCount: number;
  batchCount: number;
  /** Slides away (reader immersion). */
  hidden?: boolean;
  /** Renders the settings popover; receives the gear button as anchor. */
  renderSettings: (anchor: HTMLElement | null, open: boolean, close: () => void) => React.ReactNode;
  /** Yellow dot on the settings button: an update is available. */
  updateDot?: boolean;
  t: Translations;
}

export const SIDEBAR_WIDTH = 214;

/** Floating glass sidebar for md+ screens (phones use MobileNavBar). */
export function Sidebar({ activeTab, onSelectTab, libraryBookCount, batchCount, hidden = false, renderSettings, updateDot = false, t }: SidebarProps) {
  const glassRef = useGlass<HTMLElement>();
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const row = (icon: React.ReactNode, label: string, badge?: number) => (
    <span className="flex w-full items-center gap-[11px]">
      {icon}
      <span className="truncate">{label}</span>
      {badge ? <span className="ml-auto text-[11px] font-semibold tabular-nums text-[var(--label-2)]">{badge}</span> : null}
    </span>
  );

  return (
    <aside
      ref={glassRef}
      data-testid="sidebar"
      aria-hidden={hidden || undefined}
      style={{ width: SIDEBAR_WIDTH }}
      className={`sidebar glass fixed bottom-2.5 left-2.5 top-[max(10px,env(safe-area-inset-top))] z-40 hidden flex-col rounded-[24px] px-2.5 py-3.5 overscroll-none touch-none transition-[translate,opacity] duration-[620ms] [transition-timing-function:var(--spring-smooth)] md:flex ${
        hidden ? 'pointer-events-none -translate-x-[calc(100%+20px)] opacity-0' : ''
      }`}
    >
      <div className="flex items-center gap-2.5 px-2 pb-4 pt-1">
        <span aria-hidden className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-[var(--ink)] text-[15px] font-semibold text-[var(--on-ink)] [font-family:var(--font-mincho)]">ふ</span>
        <span data-testid="app-brand-title" className="text-base font-bold tracking-tight">{t.appTitle}</span>
      </div>

      <LiquidSelector
        axis="y"
        variant="bare"
        ariaLabel={t.sidebarTitle}
        className="gap-0.5 [&>[data-opt]]:flex [&>[data-opt]]:h-[38px] [&>[data-opt]]:items-center [&>[data-opt]]:rounded-xl [&>[data-opt]]:px-3 [&>[data-opt]]:text-left [&>[data-opt]]:text-sm [&>[data-opt]]:font-medium [&>[data-opt]]:text-[var(--label)] [&>[data-opt]]:transition-colors [&>[data-opt][aria-selected=false]:hover]:bg-[var(--item-hover)]"
        indicatorClassName="!rounded-xl"
        value={activeTab}
        onChange={onSelectTab}
        options={[
          { value: 'editor', label: row(<IconEdit />, t.mobileNavEditor) },
          { value: 'library', label: row(<IconBooks />, t.mobileNavLibrary, libraryBookCount) },
          { value: 'reader', label: row(<IconRead />, t.mobileNavReader) },
          { value: 'batch_files', label: row(<IconStack />, t.mobileNavBatch, batchCount) },
        ]}
      />

      <div className="relative mt-auto">
        <GlassButton
          ref={setSettingsAnchor}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(open => !open)}
          className="!h-[38px] w-full !justify-start !gap-[11px] !rounded-xl !px-3 text-sm"
        >
          <IconGear />
          <span>{t.settingsTitle}</span>
        </GlassButton>
        {updateDot && <UpdateDot className="update-dot !right-3 !top-1/2 -translate-y-1/2" />}
      </div>
      {renderSettings(settingsAnchor, settingsOpen, () => setSettingsOpen(false))}
    </aside>
  );
}
