'use client';

import { isPixivLoginRequired } from '../utils/pixivErrors';
import type { Translations } from '../utils/i18n';

export function ImportErrorNotice({ message, onOpenPixivAccount, t }: { message: string; onOpenPixivAccount?: () => void; t: Translations }) {
  if (!message) return null;
  const needsLogin = isPixivLoginRequired(message);
  return <div role="alert" className="mb-3 text-xs font-medium text-red-800 dark:text-red-200">
    <p>{needsLogin ? t.pixivAccountImportHint : message}</p>
    {needsLogin && onOpenPixivAccount && <button type="button" className="btn mt-2 min-h-11 text-[var(--label)]" onClick={onOpenPixivAccount}>{t.pixivAccountOpenSettings}</button>}
  </div>;
}
