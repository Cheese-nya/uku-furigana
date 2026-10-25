'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalyzedToken } from '../utils/analyze';
import type { Translations } from '../utils/i18n';
import { createReaderTools, ensureBuiltinDictionary, getDictionaryStore, type DictionaryInfo } from '../utils/readingTools';
import { loadTranslationSettings, saveTranslationSettings, type TranslationSettings } from '../utils/translation';

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
    tools, settings, changeSettings, dictionaries, dictTitles, engineLabel, sheetOpen, setSheetOpen,
    toggleDictionary, reorderDictionaries, removeDictionary, importDictionary, importProgress, importError,
  };
}
