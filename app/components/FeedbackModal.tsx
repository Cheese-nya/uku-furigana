'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { LiquidSelector } from './glass/LiquidSelector';
import { IconCheck, IconChevronDown } from './glass/icons';
import type { Translations } from '../utils/i18n';
import type { DiagnosticReport, FeedbackError, FeedbackKind, FeedbackPayload, FeedbackResult } from '../utils/updateTypes';

export interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  initialKind: FeedbackKind;
  /** Injected by the caller (`appLog.buildReport`). */
  buildReport: () => Promise<DiagnosticReport>;
  /** Injected by the caller (`feedback.submitFeedback`). */
  submit: (payload: FeedbackPayload) => Promise<FeedbackResult>;
  buildPayload: (
    input: { kind: FeedbackKind; title?: string; message?: string; contact?: string; includeLog: boolean },
    report?: DiagnosticReport,
  ) => FeedbackPayload;
  /** Opens the created issue after a successful submit. */
  onOpenUrl: (url: string) => void;
  t: Translations;
}

const TITLE_MAX = 80;
const BODY_MAX = 4000;
const NOTE_MAX = 1000;
const PREVIEW_ENTRIES = 8;

/** idle → sending → success | error. */
type FeedbackPhase = 'idle' | 'sending' | 'success' | 'error';

const fieldClass = 'w-full rounded-xl bg-[var(--fill-2)] px-3 text-[16px] text-[var(--label)] placeholder:text-[var(--label-3)] focus:outline-none focus:ring-2 focus:ring-[var(--fill)]';
const inputClass = `${fieldClass} h-[42px]`;
const areaClass = `${fieldClass} min-h-[96px] resize-none py-2.5 leading-relaxed`;
const cardClass = 'rounded-[18px] bg-[var(--surface)] p-4 shadow-[var(--card-shadow)]';
const countClass = 'text-[11px] tabular-nums text-[var(--label-3)]';

function errorText(error: FeedbackError | undefined, t: Translations): string {
  switch (error) {
    case 'rate-limited': return t.feedbackErrRateLimited;
    case 'too-large': return t.feedbackErrTooLarge;
    case 'invalid': return t.feedbackErrInvalid;
    case 'network': return t.feedbackErrNetwork;
    default: return t.feedbackErrServer;
  }
}

/** The same iOS-style switch the typography popover uses, as a labelled row. */
function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 text-[13px] font-medium leading-snug text-[var(--label)]">
      <span className="min-w-0">{label}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)}>
        <i />
      </button>
    </div>
  );
}

/** Feedback sheet shell. `Modal` unmounts the body once the sheet has closed, so every open starts from a clean draft. */
export function FeedbackModal({ open, onClose, initialKind, buildReport, submit, buildPayload, onOpenUrl, t }: FeedbackModalProps) {
  const title = initialKind === 'log' ? t.feedbackTitleLog : t.feedbackTitleText;
  // The body mirrors its send state here so the shell can swallow close presses (backdrop, Escape) mid-request.
  const sendingRef = useRef(false);
  const close = () => { if (!sendingRef.current) onClose(); };
  return (
    <Modal isOpen={open} onClose={close} title={title} maxWidth="lg">
      <FeedbackForm
        buildReport={buildReport} submit={submit} buildPayload={buildPayload} onOpenUrl={onOpenUrl}
        onClose={close} initialKind={initialKind} t={t} sendingRef={sendingRef}
      />
    </Modal>
  );
}

/** Everything below the title bar. */
function FeedbackForm({
  initialKind, onClose, buildReport, submit, buildPayload, onOpenUrl, t, sendingRef,
}: Omit<FeedbackModalProps, 'open'> & { sendingRef: { current: boolean } }) {
  const [kind, setKind] = useState<FeedbackKind>(initialKind);
  const [note, setNote] = useState('');
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [contact, setContact] = useState('');
  const [includeLog, setIncludeLog] = useState(true);
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<FeedbackPhase>('idle');
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [reportFailed, setReportFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    sendingRef.current = phase === 'sending';
    return () => { sendingRef.current = false; };
  }, [phase, sendingRef]);

  // Callers may pass an inline builder; keep the latest one but only fetch on mount.
  const buildReportRef = useRef(buildReport);
  useEffect(() => { buildReportRef.current = buildReport; }, [buildReport]);
  useEffect(() => {
    let alive = true;
    void buildReportRef.current().then(
      value => { if (alive) setReport(value); },
      () => { if (alive) setReportFailed(true); },
    );
    return () => { alive = false; };
  }, []);

  // The result banner sits at the end of a scrolling form with the footer pinned over it: bring it into view.
  useEffect(() => {
    if (phase === 'success' || phase === 'error') statusRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [phase]);

  const sending = phase === 'sending';
  const trimmedTitle = issueTitle.trim();
  const trimmedBody = issueBody.trim();
  const formValid = kind === 'log'
    ? true
    : trimmedTitle.length > 0 && trimmedTitle.length <= TITLE_MAX && trimmedBody.length > 0;
  const showPreview = kind === 'log' || includeLog;
  // Never send a log report before the collector finished (or gave up).
  const reportPending = showPreview && !report && !reportFailed;
  const canSend = consent && formValid && !sending && phase !== 'success' && !reportPending;

  const send = async () => {
    if (!canSend) return;
    setPhase('sending');
    setResult(null);
    try {
      const logReport = showPreview ? report : null;
      const payload = buildPayload({
        kind,
        title: kind === 'text' ? trimmedTitle : undefined,
        message: kind === 'text' ? trimmedBody : (note.trim() || undefined),
        contact: contact.trim() || undefined,
        includeLog: logReport !== null,
      }, logReport ?? undefined);
      const value = await submit(payload);
      setResult(value);
      setPhase(value.ok ? 'success' : 'error');
    } catch {
      setResult({ ok: false, error: 'network' });
      setPhase('error');
    }
  };

  const modeSelector = (
    <LiquidSelector
      variant="solid"
      role="radiogroup"
      className="mb-3.5 flex w-full [&>[data-opt]]:h-8 [&>[data-opt]]:flex-1 [&>[data-opt]]:text-[13px]"
      ariaLabel={`${t.feedbackModeLog} / ${t.feedbackModeText}`}
      value={kind}
      onChange={setKind}
      options={[{ value: 'log', label: t.feedbackModeLog }, { value: 'text', label: t.feedbackModeText }]}
    />
  );

  const preview = showPreview && !reportFailed && (
    <div className={`${cardClass} !p-0`}>
      <button
        type="button"
        aria-expanded={previewOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] font-semibold text-[var(--label)]"
        onClick={() => setPreviewOpen(open => !open)}
      >
        {t.feedbackLogPreview}
        <IconChevronDown
          size={16}
          className={`feedback-chevron shrink-0 text-[var(--label-3)] transition-transform duration-[420ms] [transition-timing-function:var(--spring-bouncy)] ${previewOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <div className={`disclosure ${previewOpen ? 'is-open' : ''}`}>
        <div>
          <div className="space-y-2 px-4 pb-4">
            {report ? (
              <>
                <p className="text-[11px] text-[var(--label-2)]">
                  {t.feedbackLogEntries.replace('{count}', String(report.entries.length))}
                  {' · '}v{report.version}{' · '}{report.device.platform}{' · '}{report.device.screen}{' · '}{report.device.language}
                </p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--fill-2)] p-2.5 text-[11px] leading-relaxed text-[var(--label-2)]">
                  {report.entries.slice(-PREVIEW_ENTRIES).map(entry => (
                    `${new Date(entry.t).toLocaleTimeString()} [${entry.level}] ${entry.source}: ${entry.message}`
                  )).join('\n') || '—'}
                </pre>
              </>
            ) : (
              <p className="text-[11px] text-[var(--label-2)]">{t.feedbackLogLoading}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const issueUrl = result?.url;
  const footer = phase === 'success' && result?.ok ? (
    <>
      <button type="button" className="btn h-11 flex-1 sm:flex-none" onClick={onClose}>{t.done}</button>
      {issueUrl && (
        <button type="button" className="btn btn-ink h-11 flex-1 sm:flex-none" onClick={() => onOpenUrl(issueUrl)}>{t.feedbackViewIssue}</button>
      )}
    </>
  ) : (
    <>
      <button type="button" className="btn h-11 flex-1 sm:flex-none" disabled={sending} onClick={onClose}>{t.cancel}</button>
      <button type="button" className="btn btn-ink h-11 flex-1 sm:flex-none" disabled={!canSend} onClick={() => void send()}>
        {sending && <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        {phase === 'error' ? t.feedbackRetry : sending ? t.feedbackSending : t.feedbackSend}
      </button>
    </>
  );

  return (
    <div className="space-y-3.5">
      {modeSelector}

      {/* keyed so switching mode replays the entrance, like the sheet itself */}
      <div key={kind} className="rise-in space-y-3.5">
        {kind === 'log' ? (
          <>
            <p className="px-1 text-sm leading-relaxed text-[var(--label-2)]">{t.feedbackLogIntro}</p>
            <div className={`${cardClass} grid gap-3`}>
              <label className="grid gap-1.5 text-xs font-medium text-[var(--label)]">
                <span className="flex items-baseline justify-between gap-2">
                  {t.feedbackNoteLabel}
                  <span className={countClass}>{note.length}/{NOTE_MAX}</span>
                </span>
                <textarea className={areaClass} value={note} maxLength={NOTE_MAX} onChange={event => setNote(event.target.value)} />
              </label>
              <label className="grid gap-1.5 text-xs font-medium text-[var(--label)]">
                {t.feedbackContactLabel}
                <input className={inputClass} value={contact} maxLength={80} onChange={event => setContact(event.target.value)} />
              </label>
            </div>
          </>
        ) : (
          <div className={`${cardClass} grid gap-3`}>
            <label className="grid gap-1.5 text-xs font-medium text-[var(--label)]">
              <span className="flex items-baseline justify-between gap-2">
                {t.feedbackIssueTitleLabel}
                <span className={countClass}>{issueTitle.length}/{TITLE_MAX}</span>
              </span>
              <input className={inputClass} value={issueTitle} maxLength={TITLE_MAX} onChange={event => setIssueTitle(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-xs font-medium text-[var(--label)]">
              <span className="flex items-baseline justify-between gap-2">
                {t.feedbackIssueBodyLabel}
                <span className={countClass}>{issueBody.length}/{BODY_MAX}</span>
              </span>
              <textarea className={areaClass} value={issueBody} maxLength={BODY_MAX} onChange={event => setIssueBody(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-xs font-medium text-[var(--label)]">
              {t.feedbackContactLabel}
              <input className={inputClass} value={contact} maxLength={80} onChange={event => setContact(event.target.value)} />
            </label>
            <SwitchRow label={t.feedbackAttachLog} checked={includeLog} onChange={setIncludeLog} />
          </div>
        )}
      </div>

      {preview}

      <p className="rounded-[18px] bg-[var(--review-soft)] p-3.5 text-xs leading-relaxed text-[var(--label-2)]">{t.feedbackPrivacy}</p>

      <div className={cardClass}>
        <SwitchRow label={t.feedbackConsent} checked={consent} onChange={setConsent} />
      </div>

      {phase === 'success' && result?.ok && (
        <p ref={statusRef} role="status" className="rise-in scroll-mb-20 flex items-center gap-2 rounded-[18px] bg-[var(--ok-wash)] p-3.5 text-xs font-medium text-[var(--ok)]">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--ok)] text-white"><IconCheck size={13} /></span>
          {t.feedbackSuccess.replace('{number}', String(result.number ?? ''))}
        </p>
      )}
      {phase === 'error' && (
        <p ref={statusRef} role="alert" className="rise-in scroll-mb-20 rounded-[18px] bg-[var(--danger-soft)] p-3.5 text-xs font-medium text-[var(--danger)]">
          {errorText(result?.error, t)}
        </p>
      )}

      {/* pinned to the bottom of the sheet while the form scrolls, like the footer of the other sheets */}
      <div className="sticky bottom-0 z-10 -mb-px flex gap-2 border-t border-[var(--sep)] bg-[var(--sheet-fill)] pt-3 backdrop-blur-xl sm:justify-end">{footer}</div>
    </div>
  );
}
