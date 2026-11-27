'use client';

import React from 'react';
import { GlassPopover } from './glass/GlassPopover';
import { LiquidSelector } from './glass/LiquidSelector';
import type { Translations } from '../utils/i18n';
import type { PretranslateState } from '../hooks/useBilingual';
import { IconCheck } from './glass/icons';
import { READER_LINE_HEIGHT_MAX, READER_LINE_HEIGHT_MIN, type ReaderContentWidth, type ReaderPrefs, type ReaderTheme } from '../utils/readerPreferences';

type RubyMode = 'hiragana' | 'katakana' | 'romaji';

export interface TypographyPopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  placement?: 'below' | 'above';
  fontFamily: 'serif' | 'sans';
  onFontFamilyChange: (value: 'serif' | 'sans') => void;
  fontSize: number;
  onFontSizeChange: (value: number) => void;
  /** The reader goes larger than the editor, whose size also drives export. */
  minFontSize?: number;
  maxFontSize?: number;
  showRuby: boolean;
  onShowRubyChange: (value: boolean) => void;
  /** Ruby mode row (phones, where the toolbar has no room for it). */
  rubyType?: RubyMode;
  onRubyTypeChange?: (value: RubyMode) => void;
  /** Writing direction row (reader only). */
  writingMode?: 'horizontal' | 'vertical';
  onWritingModeChange?: (value: 'horizontal' | 'vertical') => void;
  readerTheme?: ReaderTheme;
  onReaderThemeChange?: (value: ReaderTheme) => void;
  lineHeight?: number;
  onLineHeightChange?: (value: number) => void;
  contentWidth?: ReaderContentWidth;
  onContentWidthChange?: (value: ReaderContentWidth) => void;
  aiReview?: {
    status: 'idle' | 'running' | 'done' | 'error';
    completed: number;
    total: number;
    error: string;
    onRun: () => void;
    onCancel: () => void;
  };
  /** Bilingual reading (reader only): the switch plus the whole-book translation row. */
  bilingual?: {
    on: boolean;
    onChange: (value: boolean) => void;
    pretranslate: PretranslateState;
    engineLabel: string;
    onStart: () => void;
    onPause: () => void;
  };
  /** Local-only placement of the reader's quick translation switch. */
  floatingTranslation?: { floating: boolean; onFloat: () => void; onDock: () => void };
  autoReading?: {
    mode: 'scroll' | 'page'; speed: number; interval: number;
    sidePageTurn: boolean; volumePageTurn: boolean; nativeAvailable: boolean;
    onChange: (patch: Partial<ReaderPrefs>) => void;
  };
  t: Translations;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

function PretranslateRow({ state, engineLabel, onStart, onPause, t }: { state: PretranslateState; engineLabel: string; onStart: () => void; onPause: () => void; t: Translations }) {
  if (state.status === 'done') {
    return (
      <div className="px-3 pb-2.5 pt-2">
        <div className="flex items-center justify-between font-medium">
          {t.pretranslateTitle}
          <span className="flex items-center gap-1 text-[13px] text-[var(--ok)]"><IconCheck size={15} />{t.pretranslateDone}</span>
        </div>
        <div className="mt-0.5 text-xs text-[var(--label-2)]">{fill(t.pretranslateDoneDetail, { total: state.total })}</div>
      </div>
    );
  }
  const running = state.status === 'running';
  const percent = state.total ? Math.round((state.done / state.total) * 100) : 0;
  const started = state.done > 0;
  return (
    <div className="px-3 pb-2.5 pt-2">
      <div className="flex items-center justify-between font-medium">
        {t.pretranslateTitle}
        <button type="button" className="btn h-7 px-3 text-xs" onClick={running ? onPause : onStart}>
          {running ? t.pretranslatePause : started ? t.pretranslateResume : t.pretranslateStart}
        </button>
      </div>
      <div className={`mt-0.5 text-xs ${state.status === 'error' ? 'text-[var(--danger)]' : 'text-[var(--label-2)]'}`}>
        {state.status === 'error'
          ? fill(t.pretranslateFailed, { error: state.error ?? '' })
          : `${running ? fill(t.pretranslateRunning, { percent }) : fill(t.pretranslateIdle, { done: state.done, total: state.total })} · ${engineLabel}`}
      </div>
      {(running || started) && (
        <span className="mt-2 block h-1 w-full overflow-hidden rounded-sm bg-[var(--fill)]"><i className="block h-full rounded-sm bg-[var(--label)]" style={{ width: `${percent}%` }} /></span>
      )}
    </div>
  );
}

const SEG = 'flex w-full [&>[data-opt]]:h-7 [&>[data-opt]]:flex-1 [&>[data-opt]]:px-2 [&>[data-opt]]:text-[13px]';

function Group({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1.5 pt-2">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs font-semibold text-[var(--label-2)]">
        <span>{label}</span>
        {value && <span className="tabular-nums font-medium">{value}</span>}
      </div>
      {children}
    </div>
  );
}

/** Mockup "排版" popover: ruby mode (phones), font, size, show-ruby switch. */
export function TypographyPopover({
  open, onClose, anchor, placement, fontFamily, onFontFamilyChange, fontSize, onFontSizeChange, minFontSize = 14, maxFontSize = 26,
  showRuby, onShowRubyChange, rubyType, onRubyTypeChange, writingMode, onWritingModeChange,
  readerTheme, onReaderThemeChange, lineHeight, onLineHeightChange, contentWidth, onContentWidthChange,
  aiReview, bilingual, floatingTranslation, autoReading, t,
}: TypographyPopoverProps) {
  const size = Math.min(maxFontSize, Math.max(minFontSize, fontSize));
  return (
    <GlassPopover open={open} onClose={onClose} anchor={anchor} placement={placement} ariaLabel={t.typographySettings} className="max-h-[calc(100vh-20px)] w-[280px] overflow-y-auto overscroll-contain">
      {rubyType && onRubyTypeChange && (
        <Group label={t.rubyLabel}>
          <LiquidSelector
            variant="solid"
            className={SEG}
            role="radiogroup"
            ariaLabel={t.rubyLabel}
            value={rubyType}
            onChange={onRubyTypeChange}
            options={[
              { value: 'hiragana', label: t.hiragana },
              { value: 'katakana', label: t.katakana },
              { value: 'romaji', label: t.romaji },
            ]}
          />
        </Group>
      )}
      {readerTheme && onReaderThemeChange && (
        <Group label={t.readerThemeLabel}>
          <LiquidSelector
            variant="solid"
            className={SEG}
            role="radiogroup"
            ariaLabel={t.readerThemeLabel}
            value={readerTheme}
            onChange={onReaderThemeChange}
            options={[
              { value: 'system', label: t.readerThemeSystem },
              { value: 'paper', label: t.readerThemePaper },
              { value: 'sepia', label: t.readerThemeSepia },
              { value: 'night', label: t.readerThemeNight },
            ]}
          />
        </Group>
      )}
      {writingMode && onWritingModeChange && (
        <Group label={t.writingModeShort}>
          <LiquidSelector
            variant="solid"
            className={SEG}
            role="radiogroup"
            ariaLabel={t.writingModeShort}
            testId="reader-writing-mode-toggle"
            value={writingMode}
            onChange={onWritingModeChange}
            options={[
              { value: 'horizontal', label: t.writingModeHorizontal },
              { value: 'vertical', label: t.writingModeVertical },
            ]}
          />
        </Group>
      )}
      <Group label={t.fontLabel}>
        <LiquidSelector
          variant="solid"
          className={SEG}
          role="radiogroup"
          ariaLabel={t.fontLabel}
          value={fontFamily}
          onChange={onFontFamilyChange}
          options={[
            { value: 'serif', label: t.fontMinchoShort },
            { value: 'sans', label: t.fontGothicShort },
          ]}
        />
      </Group>
      <Group label={t.fontSizeLabel} value={`${size} px`}>
        <input
          type="range"
          min={minFontSize}
          max={maxFontSize}
          step={1}
          value={size}
          aria-label={t.fontSizeLabel}
          aria-valuetext={`${size} px`}
          data-testid="font-size-slider"
          onChange={event => onFontSizeChange(Number(event.target.value))}
          className="w-full accent-[var(--label)]"
        />
      </Group>
      {lineHeight !== undefined && onLineHeightChange && (
        <Group label={t.readerLineHeightLabel} value={lineHeight.toFixed(1)}>
          <input
            type="range"
            min={READER_LINE_HEIGHT_MIN}
            max={READER_LINE_HEIGHT_MAX}
            step={0.1}
            value={lineHeight}
            aria-label={t.readerLineHeightLabel}
            aria-valuetext={lineHeight.toFixed(1)}
            onChange={event => onLineHeightChange(Number(event.target.value))}
            className="w-full accent-[var(--label)]"
          />
        </Group>
      )}
      {writingMode !== 'vertical' && contentWidth && onContentWidthChange && (
        <Group label={t.readerWidthLabel}>
          <LiquidSelector
            variant="solid"
            className={SEG}
            role="radiogroup"
            ariaLabel={t.readerWidthLabel}
            value={contentWidth}
            onChange={onContentWidthChange}
            options={[
              { value: 'narrow', label: t.readerWidthNarrow },
              { value: 'medium', label: t.readerWidthMedium },
              { value: 'wide', label: t.readerWidthWide },
            ]}
          />
        </Group>
      )}
      <div className="flex items-center justify-between px-3 py-2 font-medium">
        {t.showRubyLabel}
        <button type="button" role="switch" aria-checked={showRuby} aria-label={t.showRubyLabel} className="switch" onClick={() => onShowRubyChange(!showRuby)}>
          <i />
        </button>
      </div>
      {aiReview && (
        <div className="px-3 pb-2.5 pt-1.5">
          <div className="flex items-center justify-between gap-2 font-medium">
            <span>{t.readerAiChapterTitle}</span>
            <button
              type="button"
              className="btn h-7 px-3 text-xs"
              onClick={aiReview.status === 'running' ? aiReview.onCancel : aiReview.onRun}
            >
              {aiReview.status === 'running' ? t.readerAiChapterCancel : t.readerAiChapterAction}
            </button>
          </div>
          <div className={`mt-0.5 text-xs ${aiReview.status === 'error' ? 'text-[var(--danger)]' : 'text-[var(--label-2)]'}`}>
            {aiReview.status === 'running'
              ? fill(t.readerAiChapterRunning, { done: aiReview.completed, total: aiReview.total })
              : aiReview.status === 'done'
                ? fill(t.readerAiChapterDone, { count: aiReview.completed })
                : aiReview.status === 'error'
                  ? aiReview.error
                  : t.readerAiChapterIdle}
          </div>
        </div>
      )}
      {autoReading && (
        <>
          <Group label={t.readerAutoMode}>
            <LiquidSelector variant="solid" className={SEG} role="radiogroup" ariaLabel={t.readerAutoMode}
              value={autoReading.mode} onChange={autoMode => autoReading.onChange({ autoMode })}
              options={[{ value: 'scroll', label: t.readerAutoScroll }, { value: 'page', label: t.readerAutoPage }]} />
          </Group>
          <Group label={autoReading.mode === 'scroll' ? t.readerAutoSpeed : t.readerAutoInterval}
            value={autoReading.mode === 'scroll' ? `${autoReading.speed} px/s` : `${autoReading.interval} s`}>
            <input type="range" min={autoReading.mode === 'scroll' ? 10 : 3} max={autoReading.mode === 'scroll' ? 100 : 60}
              step={1} value={autoReading.mode === 'scroll' ? autoReading.speed : autoReading.interval}
              aria-label={autoReading.mode === 'scroll' ? t.readerAutoSpeed : t.readerAutoInterval}
              aria-valuetext={autoReading.mode === 'scroll' ? `${autoReading.speed} px/s` : `${autoReading.interval} s`}
              onChange={event => autoReading.onChange(autoReading.mode === 'scroll' ? { autoSpeed: Number(event.target.value) } : { autoInterval: Number(event.target.value) })}
              className="w-full accent-[var(--label)]" />
            <p className="mt-1 text-xs leading-relaxed text-[var(--label-2)]">{t.readerAutoHint}</p>
          </Group>
          <div className="flex items-center justify-between px-3 py-2 font-medium">
            {t.readerSidePageTurn}
            <button type="button" role="switch" aria-checked={autoReading.sidePageTurn} aria-label={t.readerSidePageTurn}
              className="switch" onClick={() => autoReading.onChange({ sidePageTurn: !autoReading.sidePageTurn })}><i /></button>
          </div>
          {autoReading.nativeAvailable && (
            <div className="flex items-center justify-between px-3 py-2 font-medium">
              {t.readerVolumePageTurn}
              <button type="button" role="switch" aria-checked={autoReading.volumePageTurn} aria-label={t.readerVolumePageTurn}
                className="switch" onClick={() => autoReading.onChange({ volumePageTurn: !autoReading.volumePageTurn })}><i /></button>
            </div>
          )}
        </>
      )}
      {bilingual && (
        <>
          <hr className="mx-2.5 my-1 h-px border-0 bg-[var(--sep)]" />
          <div className="flex items-center justify-between px-3 py-2 font-medium">
            {t.bilingualLabel}
            <button type="button" role="switch" aria-checked={bilingual.on} aria-label={t.bilingualLabel} className="switch" onClick={() => bilingual.onChange(!bilingual.on)}>
              <i />
            </button>
          </div>
          {floatingTranslation && (
            <div className="px-3 pb-2">
              <button
                type="button"
                className="btn min-h-[44px] w-full px-3 text-[13px]"
                onClick={() => { onClose(); (floatingTranslation.floating ? floatingTranslation.onDock : floatingTranslation.onFloat)(); }}
              >
                {floatingTranslation.floating ? t.readerDockTranslation : t.readerFloatTranslation}
              </button>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--label-2)]">
                {t.readerFloatHint}
              </p>
            </div>
          )}
          <PretranslateRow state={bilingual.pretranslate} engineLabel={bilingual.engineLabel} onStart={bilingual.onStart} onPause={bilingual.onPause} t={t} />
        </>
      )}
    </GlassPopover>
  );
}
