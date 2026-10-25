'use client';

import React, { useRef, useState } from 'react';
import { Modal } from './Modal';
import { LiquidSelector } from './glass/LiquidSelector';
import { IconDictionary, IconImport, IconTrash } from './glass/icons';
import type { Translations } from '../utils/i18n';
import type { DictionaryInfo } from '../utils/readingTools';
import type { TranslationSettings } from '../utils/translation';

export interface ReadingToolsSheetProps {
  open: boolean;
  onClose: () => void;
  t: Translations;
  locale: string;
  settings: TranslationSettings;
  onSettingsChange: (settings: TranslationSettings) => void;
  dictionaries: DictionaryInfo[];
  onToggleDictionary: (id: string, enabled: boolean) => void;
  onReorderDictionaries: (ids: string[]) => void;
  onRemoveDictionary: (id: string) => void;
  onImportDictionary: (file: File) => void;
  /** 0–1 while a dictionary zip is being imported. */
  importProgress: number | null;
  importError: string;
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

export function entryCount(t: Translations, locale: string, count: number): string {
  return fill(t.toolsDictCount, { count: locale === 'en' ? Math.round(count / 1000) : (count / 10000).toFixed(1) });
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="mx-0.5 mb-2 mt-4 text-xs font-semibold text-[var(--label-2)] first:mt-0">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 flex h-[42px] items-center gap-2.5 rounded-xl bg-[var(--fill-2)] px-3.5">
      <span className="w-16 shrink-0 text-[13px] text-[var(--label-2)]">{label}</span>
      {children}
    </label>
  );
}

const inputClass = 'min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--label)] outline-none placeholder:text-[var(--label-3)]';

/** Translation & lookup settings (mockup v3 sheet): engine, LLM endpoint, target language, dictionaries. */
export function ReadingToolsSheet({
  open, onClose, t, locale, settings, onSettingsChange, dictionaries, onToggleDictionary, onReorderDictionaries,
  onRemoveDictionary, onImportDictionary, importProgress, importError,
}: ReadingToolsSheetProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [order, setOrder] = useState<DictionaryInfo[]>(dictionaries);
  const drag = useRef<{ id: string; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [source, setSource] = useState(dictionaries);
  if (source !== dictionaries) { setSource(dictionaries); setOrder(dictionaries); }

  const set = (patch: Partial<TranslationSettings>) => onSettingsChange({ ...settings, ...patch });
  const setLlm = (patch: Partial<TranslationSettings['llm']>) => onSettingsChange({ ...settings, llm: { ...settings.llm, ...patch } });

  // Drag a row by its icon: rows swap as the pointer crosses a neighbour's middle; the order is saved on release.
  const onDragMove = (event: React.PointerEvent) => {
    const current = drag.current;
    const list = listRef.current;
    if (!current || !list) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-dict]'));
    const index = order.findIndex(item => item.id === current.id);
    const target = rows.findIndex(row => {
      const rect = row.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY < rect.bottom;
    });
    if (target < 0 || target === index) return;
    const next = [...order];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setOrder(next);
  };
  const onDragEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    onReorderDictionaries(order.map(item => item.id));
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={t.toolsTitle} maxWidth="sm" hideHeader>
      <h3 className="mb-3.5 text-center text-lg font-semibold text-[var(--label)]">{t.toolsTitle}</h3>
      <Section>{t.toolsEngine}</Section>
      <LiquidSelector
        variant="solid"
        className="flex w-full [&>[data-opt]]:flex-1"
        ariaLabel={t.toolsEngine}
        value={settings.engine}
        onChange={engine => set({ engine })}
        options={[{ value: 'microsoft', label: t.toolsEngineMicrosoft }, { value: 'llm', label: t.toolsEngineLlm }]}
      />
      {settings.engine === 'llm' ? (
        <div className="mt-3">
          <Field label={t.toolsLlmUrl}><input className={inputClass} spellCheck={false} value={settings.llm.baseUrl} onChange={event => setLlm({ baseUrl: event.target.value })} /></Field>
          <Field label={t.toolsLlmModel}><input className={inputClass} spellCheck={false} value={settings.llm.model} onChange={event => setLlm({ model: event.target.value })} /></Field>
          <Field label={t.toolsLlmKey}><input className={inputClass} type="password" spellCheck={false} placeholder="sk-…" value={settings.llm.apiKey} onChange={event => setLlm({ apiKey: event.target.value })} /></Field>
          <p className="mx-0.5 -mt-1 mb-1 text-xs leading-normal text-[var(--label-3)]">{t.toolsLlmNote}</p>
        </div>
      ) : (
        <p className="mx-0.5 mt-2 text-xs leading-normal text-[var(--label-3)]">{t.toolsMsNote}</p>
      )}

      <Section>{t.toolsTarget}</Section>
      <LiquidSelector
        variant="solid"
        className="flex w-full [&>[data-opt]]:flex-1"
        ariaLabel={t.toolsTarget}
        value={settings.target}
        onChange={target => set({ target })}
        options={[{ value: 'zh-Hans', label: '简体中文' }, { value: 'zh-Hant', label: '繁體中文' }, { value: 'en', label: 'English' }]}
      />

      <Section>{t.toolsDicts}</Section>
      <div ref={listRef} className="rounded-[14px] bg-[var(--fill-2)]" onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
        {order.map((dict, index) => (
          <div key={dict.id} data-dict={dict.id} className={`flex min-h-[52px] items-center gap-2.5 px-3 py-2.5 ${index ? 'border-t border-[var(--sep)]' : ''}`}>
            <span
              className="flex cursor-grab touch-none text-[var(--label)] active:cursor-grabbing"
              onPointerDown={event => { if (order.length > 1) { drag.current = { id: dict.id, y: event.clientY }; (event.currentTarget.parentElement?.parentElement as HTMLElement | null)?.setPointerCapture(event.pointerId); } }}
            >
              <IconDictionary size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-[var(--label)]">{dict.title}</div>
              <div className="truncate text-xs text-[var(--label-2)]">
                {dict.builtin
                  ? fill(t.toolsDictBuiltin, { count: entryCount(t, locale, dict.count), license: dict.license || 'CC BY-SA' })
                  : fill(t.toolsDictImported, { count: entryCount(t, locale, dict.count) })}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={dict.enabled}
              aria-label={dict.title}
              className="switch shrink-0 origin-right scale-[.85]"
              onClick={() => onToggleDictionary(dict.id, !dict.enabled)}
            ><i /></button>
            {!dict.builtin && (
              <button type="button" aria-label={t.toolsDeleteDict} className="shrink-0 p-1 text-[var(--label-3)]" onClick={() => onRemoveDictionary(dict.id)}>
                <IconTrash size={18} />
              </button>
            )}
          </div>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={event => { const file = event.target.files?.[0]; if (file) onImportDictionary(file); event.target.value = ''; }}
      />
      <div className="mb-1 mt-3 flex justify-center">
        <button type="button" className="btn" disabled={importProgress !== null} onClick={() => fileRef.current?.click()}>
          <IconImport size={17} />
          {importProgress !== null ? fill(t.toolsImportingDict, { percent: Math.round(importProgress * 100) }) : t.toolsImportDict}
        </button>
      </div>
      {importError && <p role="alert" className="text-center text-xs text-[var(--danger)]">{importError}</p>}
      {order.length > 1 && <p className="text-center text-xs text-[var(--label-3)]">{t.toolsDictOrderNote}</p>}
      <div className="mt-4 flex">
        <button type="button" className="btn btn-ink h-11 flex-1 justify-center" onClick={onClose}>{t.toolsDone}</button>
      </div>
    </Modal>
  );
}
