'use client';

import React from 'react';
import { GlassPopover, PopoverItem, PopoverSeparator } from './glass/GlassPopover';
import { LiquidSelector } from './glass/LiquidSelector';
import { IconBug, IconCheck, IconDictionary, IconDownload, IconList, IconMessage, IconUsers, IconTranslate } from './glass/icons';
import { UpdateDot } from './UpdateDot';
import { getPlatform } from '../utils/appInfo';
import { QQ_GROUP, type UpdateState } from '../utils/updateTypes';
import type { ThemeMode } from '../hooks/useThemeMode';
import type { Locale, Translations } from '../utils/i18n';

export interface SettingsMenuProps {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  placement?: 'below' | 'above';
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  learnedCount: number;
  glossaryCount: number;
  onOpenLearned: () => void;
  onOpenGlossary: () => void;
  /** Release notes sheet; the row carries the yellow dot until the newest version has been opened once. */
  onOpenWhatsNew?: () => void;
  hasUnseenNotes?: boolean;
  /** Translation & lookup sheet; the row shows the engine and how many dictionaries there are. */
  onOpenReadingTools?: () => void;
  readingToolsDetail?: string;
  dictionaryStatus: 'loading' | 'ready' | 'degraded';
  dictionaryLabel: string;
  /** Extra controls shown above the settings (the phone workbench puts ruby mode and typography here). */
  extra?: React.ReactNode;
  t: Translations;
  /** From `useUpdater()`. The update row only renders when this is given. */
  update?: UpdateState;
  onCheckUpdate?: () => void;
  /** Manual download (metered connection, or a retry after a failed check). */
  onDownloadUpdate?: () => void;
  /** Download finished: install (Android) or restart into the new build (desktop). */
  onApplyUpdate?: () => void;
  /** `manualOnly` builds (iOS, web, stores) point at the Releases page instead. */
  onOpenReleases?: () => void;
  onOpenFeedback?: (kind: 'log' | 'text') => void;
  onCopyQqGroup?: () => void;
  /** Store builds pass false: self-update is not allowed there. */
  showUpdate?: boolean;
}

/** Settings popover — exactly the mockup: language, appearance, learned readings, glossary, feedback & update, engine status. */
export function SettingsMenu({
  open,
  onClose,
  anchor,
  placement,
  locale,
  onLocaleChange,
  themeMode,
  onThemeModeChange,
  learnedCount,
  glossaryCount,
  onOpenLearned,
  onOpenGlossary,
  onOpenWhatsNew,
  hasUnseenNotes = false,
  onOpenReadingTools,
  readingToolsDetail,
  dictionaryStatus,
  dictionaryLabel,
  extra,
  t,
  update,
  onCheckUpdate,
  onDownloadUpdate,
  onApplyUpdate,
  onOpenReleases,
  onOpenFeedback,
  onCopyQqGroup,
  showUpdate = true,
}: SettingsMenuProps) {
  const dot = dictionaryStatus === 'ready' ? 'bg-[var(--ok)]' : dictionaryStatus === 'loading' ? 'bg-[var(--label-3)] animate-pulse' : 'bg-[var(--danger)]';
  const segClass = 'flex w-full [&>[data-opt]]:h-7 [&>[data-opt]]:flex-1 [&>[data-opt]]:px-2 [&>[data-opt]]:text-[13px]';

  // Read on every render: pywebview attaches a moment after load, so a value cached at mount would say "web".
  // The label only exists inside the open popover, which never renders on the server.
  const desktop = getPlatform() === 'desktop';

  const updateRow = update && showUpdate ? (() => {
    let label = '';
    let onClick: (() => void) | undefined;
    let disabled = false;
    switch (update.status) {
      case 'checking':
        label = t.updateChecking;
        disabled = true;
        break;
      case 'up-to-date':
        label = t.updateUpToDate;
        onClick = onCheckUpdate;
        break;
      case 'available': {
        const available = t.updateAvailable.replace('{version}', update.latest?.version ?? '');
        if (update.manualOnly) {
          label = `${available} · ${t.updateOpenReleases}`;
          onClick = onOpenReleases;
        } else {
          label = `${available} · ${t.updateMeteredHint}`;
          onClick = onDownloadUpdate;
        }
        break;
      }
      case 'downloading':
        label = t.updateDownloading.replace('{percent}', String(Math.round(update.progress * 100)));
        disabled = true;
        break;
      case 'ready':
        label = desktop ? t.updateReadyDesktop : t.updateReady;
        onClick = onApplyUpdate;
        break;
      case 'error':
        label = t.updateFailed;
        onClick = onCheckUpdate;
        break;
      default:
        onClick = onCheckUpdate;
        break;
    }
    // Title, status and version stack in three tight rows: 260px never fits them side by side.
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex w-full items-center gap-2.5 rounded-[14px] px-3 py-1.5 text-left font-medium transition-colors hover:bg-[var(--item-hover)] disabled:opacity-40"
      >
        <span className="flex w-[18px] shrink-0 justify-center"><IconDownload size={17} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate">{t.updateCheck}</span>
            {/* UpdateDot stays absolutely positioned; this 8px box keeps it inline after the title. */}
            {update.hasUpdate && <span className="relative inline-block h-2 w-2 shrink-0"><UpdateDot /></span>}
          </span>
          {label && <span className="mt-0.5 block truncate text-[11px] font-normal leading-tight text-[var(--label-2)]">{label}</span>}
          <span className="mt-0.5 block text-[10.5px] font-normal tabular-nums leading-tight text-[var(--label-3)]">
            {t.updateCurrentVersion.replace('{version}', update.current)}
          </span>
        </span>
      </button>
    );
  })() : null;
  const hasFeedbackGroup = Boolean(updateRow || onOpenFeedback || onCopyQqGroup);

  return (
    <GlassPopover open={open} onClose={onClose} anchor={anchor} placement={placement} ariaLabel={t.settingsTitle} className="w-[260px]">
      {extra}
      <div className="px-2.5 pb-1.5 pt-2">
        <div className="mb-1.5 text-xs font-semibold text-[var(--label-2)]">{t.languageLabel}</div>
        <LiquidSelector
          variant="solid"
          className={segClass}
          role="radiogroup"
          ariaLabel={t.languageLabel}
          value={locale}
          onChange={onLocaleChange}
          options={[{ value: 'zh-CN', label: '中文' }, { value: 'en', label: 'English' }]}
        />
      </div>
      <div className="px-2.5 pb-2 pt-1.5">
        <div className="mb-1.5 text-xs font-semibold text-[var(--label-2)]">{t.appearanceLabel}</div>
        <LiquidSelector
          variant="solid"
          className={segClass}
          role="radiogroup"
          ariaLabel={t.navDarkModeToggle}
          testId="dark-mode-toggle"
          value={themeMode}
          onChange={onThemeModeChange}
          options={[
            { value: 'auto', label: t.themeAuto },
            { value: 'light', label: t.themeLight },
            { value: 'dark', label: t.themeDark },
          ]}
        />
      </div>
      <PopoverSeparator />
      <PopoverItem icon={<IconCheck size={17} />} detail={learnedCount} onClick={() => { onClose(); onOpenLearned(); }}>{t.learnedReadingsMenu}</PopoverItem>
      <PopoverItem icon={<IconDictionary size={17} />} detail={glossaryCount} onClick={() => { onClose(); onOpenGlossary(); }}>{t.properNounGlossary}</PopoverItem>
      {onOpenReadingTools && (
        <PopoverItem icon={<IconTranslate size={17} />} detail={readingToolsDetail} onClick={() => { onClose(); onOpenReadingTools(); }}>{t.toolsTitle}</PopoverItem>
      )}
      {onOpenWhatsNew && (
        <PopoverItem icon={<IconList size={17} />} onClick={() => { onClose(); onOpenWhatsNew(); }}>
          {t.whatsNew}
          {/* UpdateDot stays absolutely positioned; this 8px box keeps it inline after the title. */}
          {hasUnseenNotes && <span className="relative ml-1.5 inline-block h-2 w-2 shrink-0 align-middle"><UpdateDot /></span>}
        </PopoverItem>
      )}
      {hasFeedbackGroup && (
        <>
          <PopoverSeparator />
          <div className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-[var(--label-2)]">{t.feedbackSection}</div>
          {onOpenFeedback && (
            <PopoverItem icon={<IconBug size={17} />} onClick={() => { onClose(); onOpenFeedback('log'); }}>{t.feedbackUploadLog}</PopoverItem>
          )}
          {onOpenFeedback && (
            <PopoverItem icon={<IconMessage size={17} />} onClick={() => { onClose(); onOpenFeedback('text'); }}>{t.feedbackSubmitIssue}</PopoverItem>
          )}
          {onCopyQqGroup && (
            <PopoverItem icon={<IconUsers size={17} />} detail={QQ_GROUP} onClick={onCopyQqGroup}>{t.feedbackJoinQq}</PopoverItem>
          )}
          {updateRow}
        </>
      )}
      <PopoverSeparator />
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-2 text-xs text-[var(--label-2)]">
        <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1 truncate" title={dictionaryLabel}>{dictionaryLabel}</span>
      </div>
    </GlassPopover>
  );
}
