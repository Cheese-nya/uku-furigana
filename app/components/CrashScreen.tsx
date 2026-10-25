'use client';

import React, { useEffect, useState } from 'react';
import { IconWarning } from './glass/icons';
import { buildReport, logEvent } from '../utils/appLog';
import { buildFeedbackPayload, submitFeedback } from '../utils/feedback';
import { translations, type Locale } from '../utils/i18n';

function currentLocale(): Locale {
  try {
    return window.localStorage.getItem('furigana_locale') === 'en' ? 'en' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

/**
 * Shown instead of the framework's bare "This page couldn't load" when rendering throws. The error goes
 * into the app log first, so the user can send it from here: the feedback screen is out of reach now.
 */
export function CrashScreen({ error }: { error: Error & { digest?: string } }) {
  const [t] = useState(() => translations[typeof window === 'undefined' ? 'zh-CN' : currentLocale()]);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<{ phase: 'idle' | 'sending' | 'done' | 'failed'; text: string }>({ phase: 'idle', text: '' });

  useEffect(() => {
    const stack = (error.stack ?? '').split('\n').slice(1, 6).map(line => line.trim()).join(' | ');
    logEvent('error', 'crash', `${error.name}: ${error.message}${error.digest ? ` (digest ${error.digest})` : ''} @ ${stack}`);
  }, [error]);

  const send = async () => {
    setState({ phase: 'sending', text: t.feedbackSending });
    try {
      const report = await buildReport();
      const result = await submitFeedback(buildFeedbackPayload({ kind: 'log', message: `crash: ${error.name}: ${error.message}`.slice(0, 500), includeLog: true }, report));
      if (result.ok) setState({ phase: 'done', text: t.feedbackSuccess.replace('{number}', String(result.number ?? '')) });
      else {
        const messages: Record<string, string> = {
          'rate-limited': t.feedbackErrRateLimited, 'too-large': t.feedbackErrTooLarge, invalid: t.feedbackErrInvalid, network: t.feedbackErrNetwork,
        };
        setState({ phase: 'failed', text: messages[result.error ?? ''] ?? t.feedbackErrServer });
      }
    } catch {
      setState({ phase: 'failed', text: t.feedbackErrNetwork });
    }
  };

  return (
    <main className="fixed inset-0 grid place-items-center overflow-auto bg-[var(--bg)] p-6 text-[var(--label)]">
      <div className="w-full max-w-[420px] rounded-[24px] bg-[var(--surface)] p-6 shadow-[var(--card-shadow)]">
        <IconWarning size={40} className="text-[var(--danger)]" />
        <h1 className="mb-2 mt-3 text-xl font-bold">{t.crashTitle}</h1>
        <p className="mb-4 text-sm leading-relaxed text-[var(--label-2)]">{t.crashBody}</p>
        <p className="mb-5 break-all rounded-xl bg-[var(--fill-2)] px-3 py-2 font-mono text-xs text-[var(--label-2)]">
          {error.name}: {error.message || '—'}
        </p>
        <button type="button" className="btn btn-ink mb-5 h-11 w-full justify-center" onClick={() => window.location.reload()}>{t.crashReload}</button>

        <div className="border-t border-[var(--sep)] pt-4">
          <p className="mb-3 text-xs leading-relaxed text-[var(--label-3)]">{t.feedbackPrivacy}</p>
          <label className="mb-3 flex items-center justify-between gap-3 text-sm font-medium">
            {t.feedbackConsent}
            <button type="button" role="switch" aria-checked={consent} aria-label={t.feedbackConsent} className="switch shrink-0" onClick={() => setConsent(value => !value)}><i /></button>
          </label>
          <button
            type="button"
            className="btn h-11 w-full justify-center"
            disabled={!consent || state.phase === 'sending' || state.phase === 'done'}
            onClick={() => { void send(); }}
          >
            {t.feedbackUploadLog}
          </button>
          {state.text && (
            <p role="status" className={`mt-2 text-center text-xs ${state.phase === 'failed' ? 'text-[var(--danger)]' : state.phase === 'done' ? 'text-[var(--ok)]' : 'text-[var(--label-2)]'}`}>{state.text}</p>
          )}
        </div>
      </div>
    </main>
  );
}
