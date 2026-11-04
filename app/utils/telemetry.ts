import { APP_VERSION, getPlatform } from './appInfo';
import { getInstallId, getVisitorId } from './telemetryIds';

const STATS_BASE = process.env.NEXT_PUBLIC_STATS_BASE || 'https://stats.saiaino.xyz';
const CHANNEL = 'normal';
const INSTALL_FLAG = 'uku.telemetry.installed.v1';
const PRESENCE_MS = 2 * 60 * 1000;
const FLUSH_MS = 10 * 1000;

interface TelemetryEvent {
  id: string;
  name: 'install' | 'session_start' | 'presence' | 'pageview' | 'app_close';
  ts: string;
  installId: string;
  sessionId: string;
  appVersion: string;
  platform: string;
  channel: string;
  osMajor: string;
  locale: string;
  path?: string;
  referrerHost?: string;
}

let started = false;
let sessionId = '';
let installId = '';
let visitorId = '';
let platform = 'web';
let flushTimer: ReturnType<typeof setInterval> | null = null;
let presenceTimer: ReturnType<typeof setInterval> | null = null;
const queue: TelemetryEvent[] = [];

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function osMajor(): string {
  if (typeof navigator === 'undefined') return '';
  const ua = navigator.userAgent;
  const android = /Android\s+(\d+)/.exec(ua);
  if (android) return `Android ${android[1]}`;
  const ios = /(?:iPhone|CPU) OS (\d+)/.exec(ua);
  if (ios) return `iOS ${ios[1]}`;
  const mac = /Mac OS X (\d+)/.exec(ua);
  if (mac) return `macOS ${mac[1]}`;
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows NT 6\.3/.test(ua)) return 'Windows 8.1';
  if (/Windows NT 6\.1/.test(ua)) return 'Windows 7';
  return platform;
}

function makeEvent(name: TelemetryEvent['name'], extra: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    id: uuid(),
    name,
    ts: new Date().toISOString(),
    installId,
    sessionId,
    appVersion: APP_VERSION,
    platform,
    channel: CHANNEL,
    osMajor: osMajor(),
    locale: typeof navigator !== 'undefined' ? (navigator.language || 'zh-CN').slice(0, 16) : '',
    ...extra,
  };
}

function enqueue(event: TelemetryEvent): void {
  queue.push(event);
  if (queue.length > 200) queue.splice(0, queue.length - 200);
}

async function flush(): Promise<void> {
  if (!installId || queue.length === 0) return;
  const batch = queue.splice(0, 50);
  try {
    const response = await fetch(`${STATS_BASE}/api/stat/v2/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 2, events: batch }),
      keepalive: true,
    });
    if (!response.ok) queue.unshift(...batch);
  } catch {
    queue.unshift(...batch);
  }
}

function sendNow(event: TelemetryEvent): void {
  if (!installId) return;
  try {
    fetch(`${STATS_BASE}/api/stat/v2/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 2, events: [event] }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    enqueue(event);
  }
}

function hasInstalledFlag(): boolean {
  try {
    return localStorage.getItem(INSTALL_FLAG) === '1';
  } catch {
    return false;
  }
}

function markInstalled(): void {
  try {
    localStorage.setItem(INSTALL_FLAG, '1');
  } catch {
    // Desktop preferences carry the install id; the flag is best-effort only.
  }
}

async function begin(): Promise<void> {
  installId = await getInstallId();
  visitorId = await getVisitorId();
  sessionId = uuid();
  platform = getPlatform();

  if (!hasInstalledFlag()) {
    enqueue(makeEvent('install'));
    markInstalled();
  }
  enqueue(makeEvent('session_start'));
  enqueue(makeEvent('presence'));

  if (platform === 'web' && typeof window !== 'undefined') {
    enqueue(makeEvent('pageview', {
      sessionId: visitorId,
      path: window.location.pathname.slice(0, 200),
      referrerHost: document.referrer ? new URL(document.referrer).hostname.slice(0, 120) : '',
    }));
  }

  void flush();
  flushTimer = setInterval(() => void flush(), FLUSH_MS);
  presenceTimer = setInterval(() => enqueue(makeEvent('presence')), PRESENCE_MS);
}

/** Starts the anonymous usage report once per page load. All editions report; there is no client opt-out. */
export function startTelemetry(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('pagehide', () => {
    if (installId) sendNow(makeEvent('app_close'));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') enqueue(makeEvent('presence'));
  });

  void begin().catch(() => {
    // Network or storage failure only disables reporting for this launch.
  });
}

/** Test/debug helper: stops the background timers without clearing the install id. */
export function stopTelemetry(): void {
  if (flushTimer) clearInterval(flushTimer);
  if (presenceTimer) clearInterval(presenceTimer);
  flushTimer = null;
  presenceTimer = null;
  started = false;
}
