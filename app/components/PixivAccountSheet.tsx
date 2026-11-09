'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { getPlatform } from '../utils/appInfo';
import { getNativePixivBridge } from '../utils/pixivNativeBridge';
import { PIXIV_HELPER_DOWNLOAD } from '../utils/pixivWebBridge';
import { getPixivAccountStatus, loginPixivAccount, logoutPixivAccount, PIXIV_ACCOUNT_CHANGED, type PixivAccountStatus } from '../utils/pixivAccount';
import type { Translations } from '../utils/i18n';

export function PixivAccountSheet({ open, onClose, t }: { open: boolean; onClose: () => void; t: Translations }) {
  const [status, setStatus] = useState<PixivAccountStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const loginRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isBrowser = getPlatform() === 'web' || (getPlatform() === 'ios' && !getNativePixivBridge() && !(window as unknown as { Capacitor?: unknown }).Capacitor);
  const restoreFocus = () => requestAnimationFrame(() => {
    (loginRef.current || contentRef.current?.closest<HTMLElement>('.modal-sheet'))?.focus();
  });
  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = () => {
      void getPixivAccountStatus().then(value => { if (active) { setStatus(value); setError(false); } })
        .catch(() => { if (active) setError(true); });
    };
    refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener(PIXIV_ACCOUNT_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pywebviewready', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.removeEventListener(PIXIV_ACCOUNT_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pywebviewready', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open]);
  const act = async (action: 'login' | 'logout') => {
    setBusy(true);
    setError(false);
    try { setStatus(await (action === 'login' ? loginPixivAccount() : logoutPixivAccount())); }
    catch { setError(true); }
    finally {
      setBusy(false);
      // Logout removes its own button; keep keyboard focus inside the account sheet.
      restoreFocus();
    }
  };
  const retry = async () => {
    setBusy(true);
    try { setStatus(await getPixivAccountStatus()); setError(false); }
    catch { setError(true); }
    finally { setBusy(false); restoreFocus(); }
  };
  return (
    <Modal isOpen={open} onClose={onClose} title={t.pixivAccountTitle} maxWidth="sm">
      <div ref={contentRef} className="flex flex-col gap-4 text-[14px] leading-relaxed" data-testid="pixiv-account-sheet">
        <p>{t.pixivAccountDescription}</p>
        <div className="flex items-center justify-between gap-3 border-y border-[var(--sep)] py-3">
          <span className="font-medium text-[var(--label)]">{t.pixivAccountStatus}</span>
          <span role="status" aria-live="polite">{!status ? error ? t.pixivAccountUnavailable : t.pixivAccountChecking : !status.supported ? isBrowser ? t.pixivBrowserDisconnected : t.pixivAccountUnavailable : status.loggedIn ? t.pixivAccountSaved : t.pixivAccountSignedOut}</span>
        </div>
        {isBrowser && <div className="flex flex-col gap-3 text-xs text-[var(--label-2)]" data-testid="pixiv-browser-setup">
          <p>{status?.supported ? t.pixivBrowserConnected : t.pixivBrowserDescription}</p>
          {!status?.supported && <>
            <a className="btn btn-ink min-h-11 w-full" href={PIXIV_HELPER_DOWNLOAD} download>{t.pixivBrowserDownload}</a>
            <ol className="list-decimal space-y-2 pl-5">
              <li>{t.pixivBrowserInstallOne}</li>
              <li>{t.pixivBrowserInstallTwo}<code className="mt-1 block break-all">chrome://extensions · edge://extensions</code></li>
              <li>{t.pixivBrowserInstallThree}</li>
            </ol>
            <button type="button" className="btn min-h-11 w-full" onClick={() => window.location.reload()}>{t.pixivBrowserReload}</button>
          </>}
          {status?.supported && <button type="button" className="btn min-h-11 w-full" disabled={busy} onClick={() => { void retry(); }}>{t.pixivBrowserCheck}</button>}
        </div>}
        {status?.supported ? (
          <>
            <p className="text-xs text-[var(--label-2)]">{t.pixivAccountPrivacy}</p>
            {isBrowser && <p className="text-xs text-[var(--label-2)]">{t.pixivBrowserLogoutHint}</p>}
            <p className="text-xs text-[var(--label-2)]">{t.pixivAccountNetworkHint}</p>
            <button ref={loginRef} type="button" className="btn btn-ink min-h-11 w-full" disabled={busy} onClick={() => { void act('login'); }} data-testid="pixiv-account-login">
              {busy ? t.pixivAccountWorking : status.loggedIn ? t.pixivAccountRelogin : t.pixivAccountLogin}
            </button>
            {status.loggedIn && <button type="button" className="btn min-h-11 w-full" disabled={busy} onClick={() => { void act('logout'); }} data-testid="pixiv-account-logout">{t.pixivAccountLogout}</button>}
            <p className="text-xs text-[var(--label-3)]">{t.pixivAccountRetryHint}</p>
          </>
        ) : status && !isBrowser && <p>{t.pixivAccountUpgradeHint}</p>}
        {error && <div role="alert" className="text-xs text-red-800 dark:text-red-200">{t.pixivAccountError}<button type="button" disabled={busy} className="btn mt-2 min-h-11 w-full" onClick={() => { void retry(); }}>{t.pixivAccountRefresh}</button></div>}
      </div>
    </Modal>
  );
}
