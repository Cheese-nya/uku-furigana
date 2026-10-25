'use client';

import React, { useState } from 'react';
import { IconChevronDown, IconLink } from './glass/icons';
import { AI_PROVIDERS, listModels, providerById, startOpenRouterLogin, testConnection } from '../utils/aiProviders';
import { getPlatform } from '../utils/appInfo';
import type { Translations } from '../utils/i18n';
import type { LlmSettings, TranslationSettings } from '../utils/translation';

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

const inputClass = 'min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--label)] outline-none placeholder:text-[var(--label-3)]';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 flex h-[42px] items-center gap-2.5 rounded-xl bg-[var(--fill-2)] px-3.5">
      <span className="w-16 shrink-0 text-[13px] text-[var(--label-2)]">{label}</span>
      {children}
    </label>
  );
}

/** "大模型 API" part of the translation sheet (mockup v3.2): platform presets, key, model picker, test, OpenRouter sign-in. */
export function LlmFields({ settings, onSettingsChange, locale, t, loginNotice }: {
  settings: TranslationSettings;
  onSettingsChange: (settings: TranslationSettings) => void;
  locale: string;
  t: Translations;
  loginNotice?: { ok: boolean; text: string };
}) {
  const provider = providerById(settings.llm.provider ?? 'custom');
  const en = locale === 'en';
  const [models, setModels] = useState<{ id: string; free: boolean }[] | null>(null);
  const [modelsError, setModelsError] = useState('');
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'fail'; text: string }>({ state: 'idle', text: '' });
  // Signing in leaves the page for openrouter.ai, which the app shells (Capacitor) open outside the app.
  const canLogin = provider.login && (getPlatform() === 'web' || getPlatform() === 'desktop');

  const setLlm = (patch: Partial<LlmSettings>) => {
    setTest({ state: 'idle', text: '' });
    onSettingsChange({ ...settings, llm: { ...settings.llm, ...patch } });
  };

  // Switching platform keeps what was entered for the old one and brings back what the new one had.
  const choose = (id: string) => {
    if (id === provider.id) return;
    const next = providerById(id);
    const saved = { ...(settings.saved ?? {}), [provider.id]: settings.llm };
    const previous = saved[id];
    setModels(null);
    setModelsError('');
    setTest({ state: 'idle', text: '' });
    onSettingsChange({
      ...settings,
      saved,
      llm: previous ? { ...previous, provider: id } : { provider: id, baseUrl: next.baseUrl, model: next.model, apiKey: '' },
    });
  };

  const pickModels = async () => {
    if (models) { setModels(null); return; }
    setModelsError('');
    try {
      setModels(await listModels(settings.llm));
    } catch (error) {
      setModelsError(fill(t.toolsModelsFailed, { error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const runTest = async () => {
    setTest({ state: 'running', text: t.toolsTesting });
    try {
      const text = await testConnection(settings.llm, settings.target);
      setTest({ state: 'ok', text: fill(t.toolsTestOk, { text }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTest({ state: 'fail', text: fill(t.toolsTestFail, { error: /HTTP 40[13]/.test(message) ? t.toolsBadKey : message }) });
    }
  };

  const status = test.state === 'idle' && loginNotice ? { state: loginNotice.ok ? 'ok' as const : 'fail' as const, text: loginNotice.text } : test;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">
        {AI_PROVIDERS.map(item => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === provider.id}
            onClick={() => choose(item.id)}
            className={`btn h-[30px] px-3 text-[13px] ${item.id === provider.id ? '!bg-[var(--ink)] !text-[var(--on-ink)]' : ''}`}
          >
            {en ? item.nameEn : item.name}
          </button>
        ))}
      </div>
      <p className="mx-0.5 mb-2.5 mt-2 text-xs leading-normal text-[var(--label-2)]">
        {provider.id !== 'custom' && (
          <b className={`font-semibold ${provider.direct ? 'text-[var(--ok)]' : 'text-[var(--review)]'}`}>{provider.direct ? t.toolsDirect : t.toolsProxy} · </b>
        )}
        {en ? provider.note.en : provider.note.zh}
      </p>

      {canLogin && (
        <button type="button" className="btn btn-ink mb-3 h-[42px] w-full justify-center" onClick={() => { void startOpenRouterLogin(); }}>
          <IconLink size={17} />{t.toolsLoginOpenRouter}
        </button>
      )}

      <Field label={t.toolsLlmKey}>
        <input className={inputClass} type="password" spellCheck={false} placeholder={t.toolsKeyPlaceholder} value={settings.llm.apiKey} onChange={event => setLlm({ apiKey: event.target.value })} />
        {provider.keyUrl && (
          <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="shrink-0 whitespace-nowrap text-xs font-semibold text-[var(--label)] no-underline">{t.toolsGetKey}</a>
        )}
      </Field>
      <Field label={t.toolsLlmModel}>
        <input className={inputClass} spellCheck={false} value={settings.llm.model} onChange={event => setLlm({ model: event.target.value })} />
        <button type="button" aria-label={t.toolsPickModel} aria-expanded={Boolean(models)} className="shrink-0 p-1 text-[var(--label-2)]" onClick={() => { void pickModels(); }}>
          <IconChevronDown size={16} />
        </button>
      </Field>
      {modelsError && <p role="alert" className="-mt-1.5 mb-3 text-xs text-[var(--danger)]">{modelsError}</p>}
      {models && (
        <div className="-mt-1.5 mb-3 max-h-[180px] overflow-y-auto rounded-xl bg-[var(--fill-2)] p-1">
          {models.map(model => (
            <button
              key={model.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--label)] hover:bg-[var(--item-hover)]"
              onClick={() => { setLlm({ model: model.id }); setModels(null); }}
            >
              <span className="min-w-0 truncate">{model.id}</span>
              {model.free && <span className="shrink-0 text-[11px] font-semibold text-[var(--ok)]">{t.toolsFree}</span>}
            </button>
          ))}
        </div>
      )}
      {provider.id === 'custom' && (
        <Field label={t.toolsLlmUrl}>
          <input className={inputClass} spellCheck={false} value={settings.llm.baseUrl} onChange={event => setLlm({ baseUrl: event.target.value })} />
        </Field>
      )}

      <div className="mb-2 flex items-center gap-2.5 text-xs">
        <button type="button" className="btn shrink-0" disabled={status.state === 'running'} onClick={() => { void runTest(); }}>{t.toolsTest}</button>
        <span className={`min-w-0 ${status.state === 'ok' ? 'text-[var(--ok)]' : status.state === 'fail' ? 'text-[var(--danger)]' : 'text-[var(--label-2)]'}`}>{status.text}</span>
      </div>
      <p className="mx-0.5 mb-1 text-xs leading-normal text-[var(--label-3)]">{t.toolsLlmNote}</p>
    </div>
  );
}
