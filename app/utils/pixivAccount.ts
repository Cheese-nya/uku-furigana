import { getNativePixivBridge } from './pixivNativeBridge';
import { hasPixivWebHelper, requestPixivWeb } from './pixivWebBridge';

export interface PixivAccountStatus {
  supported: boolean;
  /** A local session is saved; Pixiv can still expire it or reject access to a work. */
  loggedIn: boolean;
}

interface AccountReply extends PixivAccountStatus { error?: string }
interface AndroidAccountBridge {
  getPixivAccountStatus?: () => string;
  openPixivLogin?: () => string;
  logoutPixiv?: () => string;
}
interface DesktopAccountBridge {
  pixiv_account_status?: () => Promise<AccountReply>;
  pixiv_account_login?: () => Promise<AccountReply>;
  pixiv_account_logout?: () => Promise<AccountReply>;
}

export const PIXIV_ACCOUNT_CHANGED = 'uku-pixiv-account-change';

/** Credentials never cross this boundary: the UI only receives session presence. */
async function accountAction(action: 'status' | 'login' | 'logout'): Promise<PixivAccountStatus> {
  if (typeof window === 'undefined') return { supported: false, loggedIn: false };
  const native = getNativePixivBridge();
  const target = window as unknown as {
    AndroidBridge?: AndroidAccountBridge;
    pywebview?: { api?: DesktopAccountBridge };
  };
  const android = target.AndroidBridge;
  const desktop = target.pywebview?.api;
  let reply: AccountReply;
  if (native?.account) reply = await native.account(action);
  else if (android?.getPixivAccountStatus && android.openPixivLogin && android.logoutPixiv) {
    const method = action === 'status' ? android.getPixivAccountStatus : action === 'login' ? android.openPixivLogin : android.logoutPixiv;
    reply = JSON.parse(method.call(android));
  } else if (desktop?.pixiv_account_status && desktop.pixiv_account_login && desktop.pixiv_account_logout) {
    const method = action === 'status' ? desktop.pixiv_account_status : action === 'login' ? desktop.pixiv_account_login : desktop.pixiv_account_logout;
    reply = await method.call(desktop);
  } else if (hasPixivWebHelper()) reply = await requestPixivWeb<AccountReply>(action);
  else return { supported: false, loggedIn: false };
  if (!reply || reply.error) throw new Error(reply?.error || 'Pixiv account unavailable');
  return { supported: reply.supported === true, loggedIn: reply.loggedIn === true };
}

async function boundedAccountAction(action: 'status' | 'logout'): Promise<PixivAccountStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      accountAction(action),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Pixiv account request timed out')), 10_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export const getPixivAccountStatus = () => boundedAccountAction('status');
export const loginPixivAccount = () => accountAction('login');
export const logoutPixivAccount = () => boundedAccountAction('logout');
