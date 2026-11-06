'use client';

import { useRef, useState } from 'react';
import { Modal } from './Modal';
import { IconImport, IconShare } from './glass/icons';
import { validateGlossary, type ProperNounEntry } from '../utils/correctionDatabase';
import { saveBlob } from '../utils/fileSave';
import type { RubyType } from '../utils/furigana';
import type { Translations } from '../utils/i18n';

interface Props {
  isOpen: boolean;
  onClose(): void;
  entries: Record<string, ProperNounEntry>;
  onChange(entries: Record<string, ProperNounEntry>): void;
  t: Translations;
}

const inputClass = 'h-[42px] rounded-xl bg-[var(--fill-2)] px-3 text-sm text-[var(--label)] placeholder:text-[var(--label-3)] focus:outline-none focus:ring-2 focus:ring-[var(--fill)]';

export function GlossaryModal({ isOpen, onClose, entries, onChange, t }: Props) {
  const [surface, setSurface] = useState('');
  const [reading, setReading] = useState('');
  const [type, setType] = useState<RubyType>('hiragana');
  const [editingSurface, setEditingSurface] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = Object.values(entries).filter(entry => entry.surface.includes(search) || entry.reading.includes(search)).sort((a, b) => a.surface.localeCompare(b.surface, 'ja'));
  const reset = () => { setSurface(''); setReading(''); setEditingSurface(null); };
  const saveEntry = () => {
    const word = surface.trim();
    const kana = reading.trim();
    try {
      const next = { ...entries };
      if (editingSurface && editingSurface !== word) delete next[editingSurface];
      next[word] = { surface: word, reading: kana, type, createdAt: entries[editingSurface || word]?.createdAt || Date.now() };
      validateGlossary(next);
      onChange(next); reset(); setError(''); setMessage(t.glossaryUpdatedNotice);
    } catch (cause) { setError(String(cause)); }
  };
  const importFile = async (file: File) => {
    try {
      const value = JSON.parse(await file.text());
      if (value.version !== 1 || value.kind !== 'furigana-glossary') throw new Error(t.glossaryImportInvalid);
      const imported = validateGlossary(value.entries);
      onChange({ ...imported, ...entries }); setError(''); setMessage(t.glossaryImportSuccess.replace('{count}', String(Object.keys(imported).length)));
    } catch (cause) { setError(`${t.glossaryImportFailed}${String(cause)}`); }
  };
  const exportFile = async () => {
    setSaving(true);
    try {
      const content = JSON.stringify({ kind: 'furigana-glossary', version: 1, entries }, null, 2);
      const result = await saveBlob(new Blob([content], { type: 'application/json' }), 'proper-nouns.json');
      setMessage(result.success ? (result.downloadStarted ? t.downloadHandedOver : t.glossaryExportSuccess) : t.glossaryExportCancelled); setError('');
    } catch (cause) { setError(`${t.glossaryExportFailed}${String(cause)}`); } finally { setSaving(false); }
  };

  return <Modal isOpen={isOpen} onClose={onClose} title={t.glossaryModalTitle} maxWidth="lg">
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-[var(--label-2)]">{t.glossaryModalDesc}</p>
      <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} />
      <div className="flex flex-wrap gap-2"><button type="button" className="btn" onClick={() => inputRef.current?.click()}><IconImport size={15} />{t.importGlossaryButton}</button><button type="button" className="btn" disabled={saving} onClick={exportFile}><IconShare size={15} />{t.exportGlossaryButton}</button></div>
      <form onSubmit={event => { event.preventDefault(); saveEntry(); }} className="rounded-[18px] bg-[var(--surface)] p-4 shadow-[var(--card-shadow)]">
        <fieldset className="grid gap-3"><legend className="px-1 text-sm font-semibold text-[var(--label)]">{editingSurface ? t.editEntryLegend : t.addEntryLegend}</legend>
          <label className="grid gap-1.5 text-xs font-medium text-[var(--label)]">{t.sourceTextLabel}<input aria-label={t.sourceTextLabel} className={inputClass} value={surface} onChange={event => setSurface(event.target.value)} placeholder={t.sourceTextPlaceholder} /></label>
          <label className="grid gap-1.5 text-xs font-medium text-[var(--label)]">{t.readingLabel}<input aria-label={t.readingLabel} className={inputClass} value={reading} onChange={event => setReading(event.target.value)} placeholder={t.readingPlaceholder} /></label>
          <label className="grid gap-1.5 text-xs font-medium text-[var(--label)]">{t.readingFormatLabel}<select aria-label={t.readingFormatLabel} className={inputClass} value={type} onChange={event => setType(event.target.value as RubyType)}><option value="hiragana">{t.hiragana}</option><option value="katakana">{t.katakana}</option><option value="romaji">{t.romajiFormatOption}</option></select></label>
          <div className="flex gap-2"><button type="submit" className="btn btn-ink h-11" disabled={!surface.trim() || !reading.trim()}>{t.saveEntryButton}</button>{editingSurface && <button type="button" className="btn h-11" onClick={reset}>{t.cancelEditButton}</button>}</div>
        </fieldset>
      </form>
      <label className="grid gap-1.5 text-xs font-medium text-[var(--label)]">{t.searchEntryLabel}<input className={inputClass} value={search} onChange={event => setSearch(event.target.value)} placeholder={t.searchEntryPlaceholder} /></label>
      <p className="text-xs tabular-nums text-[var(--label-2)]">{t.entryCountSummary.replace('{total}', String(Object.keys(entries).length)).replace('{visible}', String(visible.length))}</p>
      <ul className="max-h-64 overflow-y-auto rounded-[18px] bg-[var(--surface)] shadow-[var(--card-shadow)]">{visible.map(entry => <li key={entry.surface} className="flex items-center justify-between gap-3 border-b border-[var(--sep)] p-3 last:border-b-0"><div lang="ja" className="min-w-0"><strong className="font-semibold text-[var(--label)]">{entry.surface}</strong><span className="ml-3 font-semibold text-[var(--ruby)]">{entry.reading}</span></div><div className="flex shrink-0 gap-2"><button type="button" aria-label={`${t.editButton} ${entry.surface}`} className="btn" onClick={() => { setSurface(entry.surface); setReading(entry.reading); setType(entry.type); setEditingSurface(entry.surface); }}>{t.editButton}</button><button type="button" aria-label={`${t.deleteButton} ${entry.surface}`} className="btn btn-danger" onClick={() => { const next = { ...entries }; delete next[entry.surface]; onChange(next); if (editingSurface === entry.surface) reset(); }}>{t.deleteButton}</button></div></li>)}</ul>
      {error && <p role="alert" className="rounded-xl bg-[var(--danger-soft)] p-3 text-xs font-medium text-[var(--danger)]">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-[var(--ok-wash)] p-3 text-xs font-medium text-[var(--ok)]">{message}</p>}
    </div>
  </Modal>;
}
