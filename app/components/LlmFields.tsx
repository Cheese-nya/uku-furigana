'use client';

import React, { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconLink } from './glass/icons';
import { AI_PROVIDERS, listModels, probeModels, providerById, startOpenRouterLogin, testConnection, type ModelInfo, type ProbeResult } from '../utils/aiProviders';
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
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [probes, setProbes] = useState<Record<string, ProbeResult | 'running'>>({});
  const [detectRound, setDetectRound] = useState(0);
  const probeAbort = useRef<AbortController | null>(null);
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

  // Once a key is in (OpenRouter lists without one), load the platform's models by themselves and quietly
  // try the free ones — at most ten, two at a time — so the list shows which actually work with this key.
  // Paid models are never probed automatically: the check must not cost anything.
  const { provider: llmProvider, baseUrl, apiKey } = settings.llm;
  const target = settings.target;
  useEffect(() => {
    probeAbort.current?.abort();
    if (!baseUrl || (!apiKey && llmProvider !== 'openrouter')) return;
    const controller = new AbortController();
    probeAbort.current = controller;
    const timer = window.setTimeout(() => {
      setModelsError('');
      listModels({ provider: llmProvider, baseUrl, apiKey, model: '' }).then(list => {
        if (controller.signal.aborted) return;
        setModels(list);
        if (!apiKey) { setProbes({}); return; }
        const candidates = list.filter(model => model.price === 'free' || model.price === 'quota').slice(0, 10).map(model => model.id);
        setProbes(Object.fromEntries(candidates.map(id => [id, 'running' as const])));
        void probeModels({ provider: llmProvider, baseUrl, apiKey, model: '' }, candidates, target,
          (id, result) => setProbes(previous => ({ ...previous, [id]: result })), controller.signal);
      }, (error: unknown) => {
        if (controller.signal.aborted) return;
        setModels(null);
        setModelsError(fill(t.toolsModelsFailed, { error: error instanceof Error ? error.message : String(error) }));
      });
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [llmProvider, baseUrl, apiKey, target, detectRound, t.toolsModelsFailed]);

  const pickModels = () => setListOpen(open => !open);
  const counts = models && {
    total: models.length,
    free: models.filter(model => model.price === 'free' || model.price === 'quota').length,
    ok: Object.values(probes).filter(result => result !== 'running' && result.state === 'ok').length,
  };
  const reasonText = (result: ProbeResult) => result.state === 'ok' ? '' : ({
    key: t.toolsProbeKey, limit: t.toolsProbeLimit, missing: t.toolsProbeMissing, paid: t.toolsProbePaid, timeout: t.toolsProbeTimeout, other: t.toolsProbeOther,
  })[result.reason];

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
        <button type="button" aria-label={t.toolsPickModel} aria-expanded={listOpen} className="shrink-0 p-1 text-[var(--label-2)]" onClick={pickModels}>
          <IconChevronDown size={16} />
        </button>
      </Field>
      {modelsError && <p role="alert" className="-mt-1.5 mb-3 text-xs text-[var(--danger)]">{modelsError}</p>}
      {listOpen && models && counts && (
        <div className="-mt-1.5 mb-3 max-h-[220px] overflow-y-auto rounded-xl bg-[var(--fill-2)] p-1">
          <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1.5 text-xs text-[var(--label-2)]">
            <span>{fill(apiKey ? t.toolsModelSummary : t.toolsModelSummaryNoKey, counts)}</span>
            {apiKey && <button type="button" className="shrink-0 font-semibold text-[var(--label)]" onClick={() => setDetectRound(round => round + 1)}>{t.toolsRedetect}</button>}
          </div>
          {models.map(model => {
            const probe = probes[model.id];
            return (
              <button
                key={model.id}
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--label)] hover:bg-[var(--item-hover)]"
                onClick={() => { setLlm({ model: model.id }); setListOpen(false); }}
              >
                <span className="min-w-0 truncate">{model.id}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
                  {model.price === 'free' && <span className="font-semibold text-[var(--ok)]">{t.toolsFree}</span>}
                  {model.price === 'quota' && <span className="font-semibold text-[var(--ok)]">{t.toolsFreeQuota}</span>}
                  {model.price === 'paid' && <span className="text-[var(--label-3)]">{t.toolsPaid}</span>}
                  {probe === 'running' && <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-[var(--fill)] border-t-[var(--label)]" aria-hidden />}
                  {probe && probe !== 'running' && (probe.state === 'ok'
                    ? <span className="text-[var(--ok)]">{t.toolsProbeOk}</span>
                    : <span className="text-[var(--danger)]" title={probe.detail}>✗ {reasonText(probe)}</span>)}
                </span>
              </button>
            );
          })}
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
