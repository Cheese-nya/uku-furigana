'use client';

import React from 'react';
import { Modal } from './Modal';
import { LiquidSelector } from './glass/LiquidSelector';
import type { Translations } from '../utils/i18n';

export interface EditingTokenState {
  lineId: string;
  tokenIndex: number;
  tokenEndIndex: number;
  surface: string;
  currentRuby: string;
  alternatives: string[];
  /** Exact character range when a search hit is only part of a token. */
  rangeStart?: number;
  rangeEnd?: number;
}

export type CorrectionScope = 'occurrence' | 'document' | 'glossary';

interface RubyCorrectionModalProps {
  editingToken: EditingTokenState | null;
  context: { before: string; word: string; after: string } | null;
  onClose: () => void;
  needsReview: boolean;
  customRubyInput: string;
  setCustomRubyInput: (value: string) => void;
  correctionScope: CorrectionScope;
  setCorrectionScope: (scope: CorrectionScope) => void;
  rubyCompositionRef: React.MutableRefObject<boolean>;
  saveTokenRuby: () => void;
  canRestoreAutomatic: boolean;
  restoreAutomatic: () => void;
  t: Translations;
}

/** Mockup "修改读音" sheet: the word, candidate readings, a custom reading, scope, cancel / apply. */
export function RubyCorrectionModal({
  editingToken, context, onClose, needsReview, customRubyInput, setCustomRubyInput, correctionScope, setCorrectionScope,
  rubyCompositionRef, saveTokenRuby, canRestoreAutomatic, restoreAutomatic, t,
}: RubyCorrectionModalProps) {
  const candidates = editingToken ? [...new Set([editingToken.currentRuby, ...editingToken.alternatives].filter(Boolean))] : [];

  return (
    <Modal isOpen={!!editingToken} onClose={onClose} title={t.rubySheetTitle} hideHeader maxWidth="sm">
      {editingToken && (
        <div data-correction-scope={correctionScope}>
          <div className="text-center text-xs font-semibold text-[var(--label-2)]">
            {t.rubySheetTitle}{needsReview ? ` · ${t.needsReviewBadge}` : ''}
          </div>
          {/* The ruby must stay inline: WebKit drops or misplaces <rt> when <ruby> is display:block. */}
          <div lang="ja" className="mb-0.5 mt-2 text-center text-[40px] leading-[1.5] text-[var(--label)] [font-family:var(--font-mincho)]">
            <ruby className="[ruby-align:center]">
              {editingToken.surface}
              <rt className="text-[16px] leading-none" style={{ color: needsReview ? 'var(--review)' : 'var(--ruby)' }}>{customRubyInput || editingToken.currentRuby}</rt>
            </ruby>
          </div>
          {context && (
            <p lang="ja" className="text-[13px] leading-relaxed text-[var(--label-2)] text-center [font-family:var(--font-mincho)] px-2">
              {context.before}
              <b className={`font-semibold ${needsReview ? 'text-[var(--review)]' : 'text-[var(--label)]'}`}>{context.word}</b>
              {context.after}
            </p>
          )}

          {candidates.length > 0 && (
            <div className="my-3.5 flex flex-wrap justify-center gap-2">
              {candidates.map(candidate => (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={customRubyInput === candidate}
                  onClick={() => setCustomRubyInput(candidate)}
                  className={`btn ${customRubyInput === candidate ? 'btn-ink' : ''}`}
                >
                  {candidate}
                </button>
              ))}
            </div>
          )}

          <label className="mb-3 flex h-[42px] items-center rounded-xl bg-[var(--fill-2)] px-3.5">
            <input
              value={customRubyInput}
              onChange={event => setCustomRubyInput(event.target.value)}
              onCompositionStart={() => { rubyCompositionRef.current = true; }}
              onCompositionEnd={() => { rubyCompositionRef.current = false; }}
              onKeyDown={event => {
                if (event.key === 'Enter' && !rubyCompositionRef.current && !event.nativeEvent.isComposing) saveTokenRuby();
              }}
              placeholder={t.customRubyPlaceholder}
              aria-label={t.customRubyPlaceholder}
              className="flex-1 border-0 bg-transparent text-[var(--label)] outline-none placeholder:text-[var(--label-3)]"
            />
          </label>

          <LiquidSelector
            variant="solid"
            role="radiogroup"
            className="flex w-full [&>[data-opt]]:flex-1"
            ariaLabel={t.rubySheetTitle}
            value={correctionScope}
            onChange={setCorrectionScope}
            options={[
              { value: 'occurrence', label: t.scopeOccurrence },
              { value: 'document', label: t.scopeDocument },
              { value: 'glossary', label: t.scopeRemember },
            ]}
          />

          {canRestoreAutomatic && (
            <button
              type="button"
              className="btn mt-4 h-10 w-full !text-[var(--ok)]"
              data-testid="restore-automatic-btn"
              onClick={restoreAutomatic}
            >
              {t.restoreAutomatic}
            </button>
          )}

          <div className="mt-2 flex gap-2">
            <button type="button" className="btn h-11 flex-1" onClick={onClose}>{t.cancel}</button>
            <button type="button" className="btn btn-ink h-11 flex-1" onClick={saveTokenRuby}>{t.applyButton}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
