'use client';

import React from 'react';
import { Modal } from './Modal';
import { RELEASE_NOTES } from '../data/releaseNotes';
import { APP_VERSION } from '../utils/appInfo';
import type { Locale, Translations } from '../utils/i18n';

interface WhatsNewModalProps { isOpen: boolean; onClose: () => void; t: Translations; locale: Locale; }

/**
 * The card that gets the "当前版本" tag. Normally the entry whose version is this build's, but a
 * release that shipped without a note still has to be tagged, so it falls back to the newest entry.
 */
const CURRENT_INDEX = Math.max(0, RELEASE_NOTES.findIndex(note => note.version === APP_VERSION));

/** Release notes, newest first. Opened from Settings only — the app never shows it by itself. */
export function WhatsNewModal({ isOpen, onClose, t, locale }: WhatsNewModalProps) {
  return <Modal isOpen={isOpen} onClose={onClose} title={t.whatsNew} maxWidth="lg">
    <div className="space-y-3">
      {RELEASE_NOTES.map((note, index) => {
        const bullets = note.items[locale];
        return (
          <section key={note.version} className="rounded-[18px] bg-[var(--surface)] p-4 shadow-[var(--card-shadow)]">
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-sm font-semibold tabular-nums text-[var(--label)]">v{note.version}</h3>
              {index === CURRENT_INDEX && <span className="rounded-full bg-[var(--fill-2)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--label-2)]">{t.whatsNewCurrent}</span>}
              <span className="ml-auto text-[11px] font-medium tabular-nums text-[var(--label-3)]">{note.date}</span>
            </header>
            {bullets.length > 0 ? (
              <ul className="mt-2 space-y-1.5">{bullets.map(item => (
                <li key={item} className="flex gap-2 text-xs leading-relaxed text-[var(--label-2)]">
                  <span className="mt-[6px] h-[3px] w-[3px] shrink-0 rounded-full bg-[var(--label-3)]" aria-hidden />
                  <span className="min-w-0 flex-1">{item}</span>
                </li>
              ))}</ul>
            ) : <p className="mt-2 text-xs text-[var(--label-3)]">{t.whatsNewEmpty}</p>}
          </section>
        );
      })}
      <div className="flex justify-end border-t border-[var(--sep)] pt-4"><button type="button" onClick={onClose} className="btn btn-ink h-11">{t.confirm}</button></div>
    </div>
  </Modal>;
}
