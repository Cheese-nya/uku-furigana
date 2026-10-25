'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalyzedToken } from '../utils/analyze';
import type { Translations } from '../utils/i18n';
import { createReaderTools, ensureBuiltinDictionary, getDictionaryStore, type DictionaryInfo } from '../utils/readingTools';
import { loadTranslationSettings, saveTranslationSettings, type TranslationSettings } from '../utils/translation';
import { completeOpenRouterLogin, providerById } from '../utils/aiProviders';

/** Translation settings, the dictionaries list and the reader's lookup/translation tools. */
export function useReadingTools({ analyze, t, engineReady, readerOpen }: {
  analyze: (text: string) => Promise<AnalyzedToken[]>;
  t: Translations;
  engineReady: boolean;
  /** The reader is on screen: the time to install the bundled dictionary, so the first lookup is quick. */
  readerOpen: boolean;
}) {
  const [settings, setSettings] = useState<TranslationSettings>(loadTranslationSettings);
  const [dictionaries, setDictionaries] = useState<DictionaryInfo[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [importError, setImportError] = useState('');

  const refresh = useCallback(() => getDictionaryStore().list().then(
    list => setDictionaries([...list].sort((a, b) => a.order - b.order)),
    () => setDictionaries([]),
  ), []);

  useEffect(() => { void refresh(); }, [refresh]);

  // The bundled dictionary installs itself in the background the first time the reader opens (and after an upgrade).
  // The settings sheet lists it too, so opening the sheet installs it as well.
  useEffect(() => {
    if (readerOpen || sheetOpen) void ensureBuiltinDictionary(undefined, () => void refresh()).then(refresh, refresh);
  }, [readerOpen, sheetOpen, refresh]);

  const changeSettings = useCallback((next: TranslationSettings) => {
    setSettings(next);
    saveTranslationSettings(next);
  }, []);

  // Back from openrouter.ai with ?code=: exchange it for the user's key and switch translation to OpenRouter.
  const [loginNotice, setLoginNotice] = useState<{ ok: boolean; text: string } | undefined>(undefined);
  useEffect(() => {
    let active = true;
    completeOpenRouterLogin().then(key => {
      if (!active || !key) return;
      const current = loadTranslationSettings();
      const preset = providerById('openrouter');
      const previous = current.llm.provider === 'openrouter' ? current.llm : current.saved?.openrouter;
      changeSettings({
        ...current,
        engine: 'llm',
        saved: { ...(current.saved ?? {}), ...(current.llm.provider ? { [current.llm.provider]: current.llm } : {}) },
        llm: { provider: 'openrouter', baseUrl: preset.baseUrl, model: previous?.model || preset.model, apiKey: key },
      });
      setLoginNotice({ ok: true, text: t.toolsLoggedIn });
      setSheetOpen(true);
    }, (error: unknown) => {
      if (!active) return;
      // Show the failure where it happened: the sheet, on the OpenRouter platform.
      const current = loadTranslationSettings();
      if (current.llm.provider !== 'openrouter') {
        const preset = providerById('openrouter');
        const saved = { ...(current.saved ?? {}), ...(current.llm.provider ? { [current.llm.provider]: current.llm } : {}) };
        changeSettings({ ...current, engine: 'llm', saved, llm: saved.openrouter ?? { provider: 'openrouter', baseUrl: preset.baseUrl, model: preset.model, apiKey: '' } });
      } else if (current.engine !== 'llm') changeSettings({ ...current, engine: 'llm' });
      setLoginNotice({ ok: false, text: t.toolsLoginFailed.replace('{error}', error instanceof Error ? error.message : String(error)) });
      setSheetOpen(true);
    });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const engineLabel = settings.engine === 'llm' ? `${t.engineLlm} · ${settings.llm.model}` : t.engineMicrosoft;
  const tools = useMemo(
    () => (engineReady ? createReaderTools({ analyze, settings, engineLabel }) : null),
    [analyze, settings, engineLabel, engineReady],
  );

  const dictTitles = useMemo(() => Object.fromEntries(dictionaries.map(dict => [dict.id, dict.title])), [dictionaries]);

  const toggleDictionary = async (id: string, enabled: boolean) => { await getDictionaryStore().setEnabled(id, enabled); await refresh(); };
  const reorderDictionaries = async (ids: string[]) => { await getDictionaryStore().setOrder(ids); await refresh(); };
  const removeDictionary = async (id: string) => { await getDictionaryStore().remove(id); await refresh(); };
  const importDictionary = async (file: File) => {
    setImportError('');
    setImportProgress(0);
    try {
      await getDictionaryStore().importZip(await file.arrayBuffer(), setImportProgress);
      await refresh();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImportProgress(null);
    }
  };

  return {
    tools, settings, changeSettings, loginNotice, dictionaries, dictTitles, engineLabel, sheetOpen, setSheetOpen,
    toggleDictionary, reorderDictionaries, removeDictionary, importDictionary, importProgress, importError,
  };
}
