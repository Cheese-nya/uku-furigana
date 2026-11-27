'use client';

import React from 'react';
import { LiquidSelector } from './glass/LiquidSelector';
import { IconTranslate } from './glass/icons';
import { llmNeedsApiKey, type TranslationSettings, type TranslationTarget } from '../utils/translation';
import type { ExportMissingPolicy, ExportTranslationPrefs, ExportTranslationSummary } from '../utils/exportTranslations';
import type { Translations } from '../utils/i18n';

const TARGET_LABELS: Record<TranslationTarget, string> = {
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  en: 'English',
};

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

interface ExportTranslationOptionsProps {
  prefs: ExportTranslationPrefs;
  onChange: (next: ExportTranslationPrefs) => void;
  settings: TranslationSettings;
  engineLabel: string;
  cacheSummary?: ExportTranslationSummary | null;
  t: Translations;
}

export function ExportTranslationOptions({
  prefs,
  onChange,
  settings,
  engineLabel,
  cacheSummary,
  t,
}: ExportTranslationOptionsProps) {
  const targetLabel = TARGET_LABELS[settings.target] || settings.target;
  const needsKey =
    prefs.enabled &&
    prefs.missingPolicy === 'translate-missing' &&
    settings.engine === 'llm' &&
    !settings.llm.apiKey.trim() &&
    llmNeedsApiKey(settings.llm);

  const hintText = cacheSummary && cacheSummary.totalSentences > 0
    ? fill(t.exportTranslationCachedHint, {
        target: targetLabel,
        engine: engineLabel,
        cached: cacheSummary.cachedSentences,
        total: cacheSummary.totalSentences,
      })
    : fill(t.exportTranslationEngineHint, {
        target: targetLabel,
        engine: engineLabel,
      });

  return (
    <div className="px-1 py-1">
      <button
        type="button"
        role="switch"
        aria-checked={prefs.enabled}
        data-testid="export-include-translation-toggle"
        onClick={() => onChange({ ...prefs, enabled: !prefs.enabled })}
        className="flex h-10 w-full items-center gap-2.5 rounded-[14px] px-2.5 text-left font-medium transition-colors hover:bg-[var(--item-hover)]"
      >
        <span className="flex w-[18px] justify-center text-[var(--label)]">
          <IconTranslate size={17} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--label)]">
          {t.exportIncludeTranslation}
        </span>
        <span
          aria-hidden
          className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-0.5 transition-colors ${prefs.enabled ? 'bg-[var(--label)]' : 'bg-[var(--fill)]'}`}
        >
          <span
            className={`h-[18px] w-[18px] rounded-full bg-[var(--surface)] shadow-sm transition-transform ${prefs.enabled ? 'translate-x-4' : 'translate-x-0'}`}
          />
        </span>
      </button>

      {prefs.enabled && (
        <div className="mt-1.5 space-y-1.5 px-2 pb-1">
          <LiquidSelector<ExportMissingPolicy>
            variant="solid"
            className="flex w-full [&>[data-opt]]:h-7 [&>[data-opt]]:flex-1 [&>[data-opt]]:px-2 [&>[data-opt]]:text-[12px]"
            role="radiogroup"
            ariaLabel={t.exportIncludeTranslation}
            value={prefs.missingPolicy}
            onChange={missingPolicy => onChange({ ...prefs, missingPolicy })}
            options={[
              { value: 'translate-missing', label: t.exportMissingAuto, testId: 'export-policy-auto' },
              { value: 'cached-only', label: t.exportMissingCachedOnly, testId: 'export-policy-cached' },
            ]}
          />
          <p className="truncate px-0.5 text-[11px] tabular-nums text-[var(--label-2)]">
            {hintText}
          </p>
          {needsKey && (
            <p className="px-0.5 text-[11px] leading-snug text-[var(--danger)]">
              {t.exportTranslationNoKeyHint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
