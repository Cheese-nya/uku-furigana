import { getPlatform } from './appInfo';
import { waitForPywebviewApi } from './pywebviewReady';

interface DesktopTelemetryApi {
  load_telemetry_preferences?: () => Promise<unknown>;
  save_telemetry_preferences?: (data: unknown) => Promise<{ success: boolean; error?: string }>;
}

const INSTALL_KEY = 'uku.telemetry.installId.v1';
const VISITOR_KEY = 'uku.telemetry.visitorId.v1';

const memory: Record<string, string> = {};
let desktopLoaded = false;

function browserDesktop(): DesktopTelemetryApi | undefined {
  return (globalThis as { window?: { pywebview?: { api?: DesktopTelemetryApi } } }).window?.pywebview?.api;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or a full quota: the in-memory copy still serves this launch.
  }
}

async function ensureDesktopStore(): Promise<void> {
  if (desktopLoaded || getPlatform() !== 'desktop') return;
  const browser = (globalThis as { window?: Window }).window;
  if (!browser) return;
  await waitForPywebviewApi(browser, () => {
    const api = browserDesktop();
    return Boolean(api?.load_telemetry_preferences && api?.save_telemetry_preferences);
  });
  const api = browserDesktop();
  if (!api?.load_telemetry_preferences || !api.save_telemetry_preferences) return;
  desktopLoaded = true;
  try {
    const data = await api.load_telemetry_preferences();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (typeof value === 'string') memory[key] = value;
      }
    }
  } catch {
    // An older desktop shell keeps localStorage; ids may reset per launch there.
  }
}

async function readPreference(key: string): Promise<string | null> {
  await ensureDesktopStore();
  if (Object.prototype.hasOwnProperty.call(memory, key)) return memory[key] || null;
  const local = readLocal(key);
  if (local) {
    memory[key] = local;
    return local;
  }
  return null;
}

async function writePreference(key: string, value: string): Promise<void> {
  await ensureDesktopStore();
  memory[key] = value;
  writeLocal(key, value);
  const api = browserDesktop();
  if (!desktopLoaded || !api?.save_telemetry_preferences) return;
  try {
    await api.save_telemetry_preferences({ ...memory });
  } catch {
    // Persisting is best-effort; the current launch still reports.
  }
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

/** Stable per-install id: native preferences on desktop, localStorage elsewhere. */
export async function getInstallId(): Promise<string> {
  const existing = await readPreference(INSTALL_KEY);
  if (existing) return existing;
  const value = uuid();
  await writePreference(INSTALL_KEY, value);
  return value;
}

/** Stable per-browser id used for website unique-visitor counts. */
export async function getVisitorId(): Promise<string> {
  const existing = await readPreference(VISITOR_KEY);
  if (existing) return existing;
  const value = uuid();
  await writePreference(VISITOR_KEY, value);
  return value;
}
