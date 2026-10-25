import { DISTRIBUTION, getPlatform } from './appInfo';
import { logEvent } from './appLog';
import {
  GITHUB_REPO,
  RELAY_BASE,
  type AndroidUpdateBridge,
  type DesktopUpdateApi,
  type Distribution,
  type DriverState,
  type Platform,
  type ReleaseAsset,
  type ReleaseInfo,
  type UpdateDriver,
  type UpdateState,
} from './updateTypes';

export const UPDATE_LAST_CHECK_KEY = 'uku.update.lastCheck';
export const UPDATE_DISMISSED_KEY = 'uku.update.dismissed';
/** Version of the newest release we found but the user has not installed yet; keeps the dot across restarts. */
export const UPDATE_PENDING_KEY = 'uku.update.pending';
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_POLL_MS = 1_000;

export function compareVersions(a: string, b: string): number {
  const cleanA = String(a ?? '').trim().replace(/^[vV]/, '');
  const cleanB = String(b ?? '').trim().replace(/^[vV]/, '');
  const partsA = cleanA.length > 0 ? cleanA.split('.') : [];
  const partsB = cleanB.length > 0 ? cleanB.split('.') : [];
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const segA = (partsA[i] ?? '').trim();
    const segB = (partsB[i] ?? '').trim();
    const numA = /^\d+$/.test(segA) ? parseInt(segA, 10) : 0;
    const numB = /^\d+$/.test(segB) ? parseInt(segB, 10) : 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

function isSupportedAssetName(name: unknown): name is string {
  return typeof name === 'string' && (name.endsWith('.apk') || name.endsWith('-windows.exe'));
}

export function selectAsset(release: ReleaseInfo, platform: Platform): ReleaseAsset | undefined {
  if (!release || !Array.isArray(release.assets)) return undefined;
  if (platform === 'android') {
    return release.assets.find(a => typeof a?.name === 'string' && a.name.endsWith('.apk'));
  }
  if (platform === 'desktop') {
    return release.assets.find(a => typeof a?.name === 'string' && a.name.endsWith('-windows.exe'));
  }
  return undefined;
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        try {
          controller.abort();
        } catch {}
        reject(new Error(`Timeout fetching ${url}`));
      }, timeoutMs);
    });

    return await Promise.race([
      fetchFn(url, { ...init, signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export function parseSha256Sums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match) {
      const hash = match[1].toLowerCase();
      const filename = match[2].trim().split('/').pop() ?? '';
      if (filename) {
        map.set(filename, hash);
      }
    }
  }
  return map;
}

async function fetchFromGitHub(fetchFn: typeof fetch, timeoutMs: number): Promise<ReleaseInfo> {
  const releaseUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const res = await fetchWithTimeout(fetchFn, releaseUrl, timeoutMs, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`GitHub release HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    tag_name?: string;
    tag?: string;
    version?: string;
    body?: string;
    notes?: string;
    assets?: Array<{
      name?: string;
      size?: number;
      browser_download_url?: string;
      url?: string;
    }>;
  };

  const tag = String(data?.tag_name || data?.tag || '').trim();
  if (!tag) {
    throw new Error('Missing release tag');
  }
  const version = String(data?.version || tag).trim().replace(/^[vV]/, '');
  const notes = typeof data?.body === 'string' ? data.body : typeof data?.notes === 'string' ? data.notes : '';
  const rawAssets = Array.isArray(data?.assets) ? data.assets : [];

  const sumsAsset = rawAssets.find(a => a?.name === 'SHA256SUMS.txt');
  const sumsUrl = sumsAsset?.browser_download_url || sumsAsset?.url;
  if (!sumsAsset || !sumsUrl) {
    throw new Error('Missing SHA256SUMS.txt asset');
  }

  const sumsRes = await fetchWithTimeout(fetchFn, sumsUrl, timeoutMs);
  if (!sumsRes.ok) {
    throw new Error(`SHA256SUMS.txt HTTP ${sumsRes.status}`);
  }
  const sumsText = await sumsRes.text();
  const sums = parseSha256Sums(sumsText);
  if (sums.size === 0) {
    throw new Error('Empty SHA256SUMS.txt');
  }

  const assets: ReleaseAsset[] = [];
  for (const item of rawAssets) {
    if (!isSupportedAssetName(item?.name)) continue;
    const url = String(item.browser_download_url || item.url || '');
    const sha256 = sums.get(item.name);
    if (!url || !sha256) {
      throw new Error(`Missing sha256 or url for ${item.name}`);
    }
    assets.push({
      name: item.name,
      size: Number(item.size) || 0,
      url,
      mirrorUrl: `${RELAY_BASE}/api/update/dl/${tag}/${item.name}`,
      sha256,
    });
  }

  return {
    version,
    tag,
    notes,
    assets,
  };
}

async function fetchFromRelay(fetchFn: typeof fetch, timeoutMs: number): Promise<ReleaseInfo> {
  const relayUrl = `${RELAY_BASE}/api/update/latest`;
  const res = await fetchWithTimeout(fetchFn, relayUrl, timeoutMs);
  if (!res.ok) {
    throw new Error(`Relay release HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    version?: string;
    tag?: string;
    tag_name?: string;
    notes?: string;
    body?: string;
    sums?: Record<string, string>;
    assets?: Array<{
      name?: string;
      size?: number;
      url?: string;
      browser_download_url?: string;
      mirrorUrl?: string;
      sha256?: string;
    }>;
  };

  const tag = String(data?.tag || data?.tag_name || '').trim();
  const version = String(data?.version || tag).trim().replace(/^[vV]/, '');
  if (!version) {
    throw new Error('Invalid relay release response');
  }
  const notes = typeof data?.notes === 'string' ? data.notes : typeof data?.body === 'string' ? data.body : '';
  const rawAssets = Array.isArray(data?.assets) ? data.assets : [];

  const assets: ReleaseAsset[] = [];
  for (const item of rawAssets) {
    if (!isSupportedAssetName(item?.name)) continue;
    const url = String(item.url || item.browser_download_url || '');
    const sha256Raw = item.sha256 || data?.sums?.[item.name];
    assets.push({
      name: item.name,
      size: Number(item.size) || 0,
      url,
      mirrorUrl: item.mirrorUrl || (tag ? `${RELAY_BASE}/api/update/dl/${tag}/${item.name}` : undefined),
      sha256: typeof sha256Raw === 'string' ? sha256Raw.toLowerCase() : undefined,
    });
  }

  return {
    version,
    tag: tag || `v${version}`,
    notes,
    assets,
  };
}

export interface FetchLatestReleaseDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Swap each asset's primary and fallback download URLs so the mirror is tried first. */
export function preferMirror(release: ReleaseInfo): ReleaseInfo {
  return {
    ...release,
    assets: release.assets.map(asset => (
      asset.mirrorUrl && asset.url ? { ...asset, url: asset.mirrorUrl, mirrorUrl: asset.url } : asset
    )),
  };
}

export async function fetchLatestRelease(deps?: FetchLatestReleaseDeps): Promise<ReleaseInfo> {
  const fetchFn = deps?.fetch ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch is not available');
  }
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  let githubErr: unknown = 'skipped';
  // Test builds (NEXT_PUBLIC_UPDATE_SOURCE=relay) go straight to the relay so a fake release can be served.
  if (process.env.NEXT_PUBLIC_UPDATE_SOURCE !== 'relay') {
    try {
      return await fetchFromGitHub(fetchFn, timeoutMs);
    } catch (err) {
      githubErr = err;
    }
  }

  try {
    const release = await fetchFromRelay(fetchFn, timeoutMs);
    // GitHub just failed us (blocked or stalling, as it often does in mainland China), so downloading from it
    // first would only cost a stall before the mirror; put the mirror first.
    return githubErr === 'skipped' ? release : preferMirror(release);
  } catch (relayErr) {
    const ghMsg = githubErr instanceof Error ? githubErr.message : String(githubErr);
    const rlMsg = relayErr instanceof Error ? relayErr.message : String(relayErr);
    throw new Error(`Failed to fetch latest release (GitHub: ${ghMsg}; Relay: ${rlMsg})`);
  }
}

export const checkForUpdate = fetchLatestRelease;

export function shouldAutoCheck(lastCheckedAt: number | null, now: number): boolean {
  if (lastCheckedAt === null || lastCheckedAt === undefined || !Number.isFinite(lastCheckedAt)) {
    return true;
  }
  return now - lastCheckedAt >= AUTO_CHECK_INTERVAL_MS;
}

export function createAndroidDriver(
  bridge: AndroidUpdateBridge,
  opts?: { wifiOnly?: boolean },
): UpdateDriver {
  const wifiOnly = opts?.wifiOnly ?? true;
  return {
    canAutoDownload: true,
    async start(release: ReleaseInfo, asset: ReleaseAsset, userInitiated = false): Promise<void> {
      const args = JSON.stringify({
        version: release.version,
        url: asset.url,
        mirrorUrl: asset.mirrorUrl,
        sha256: asset.sha256 ?? '',
        size: asset.size,
        // Only the automatic download waits for Wi-Fi; a tap on 下载 means the user accepts mobile data.
        wifiOnly: wifiOnly && !userInitiated,
      });
      let parsed: { success?: boolean; error?: string };
      try {
        parsed = JSON.parse(bridge.startUpdateDownload(args));
      } catch {
        throw new Error('Invalid JSON from AndroidBridge.startUpdateDownload');
      }
      if (parsed?.success === false) {
        throw new Error(parsed.error || 'Android startUpdateDownload failed');
      }
    },
    async poll(): Promise<DriverState> {
      try {
        const raw = bridge.getUpdateState();
        const parsed = JSON.parse(raw) as {
          success?: boolean;
          phase?: string;
          progress?: number;
          version?: string;
          error?: string;
        };
        if (!parsed || typeof parsed !== 'object') {
          return { phase: 'error', progress: 0, error: 'Empty update state' };
        }
        if (parsed.success === false) {
          return { phase: 'error', progress: 0, error: parsed.error || 'Bridge error' };
        }
        if (
          parsed.phase !== 'idle' &&
          parsed.phase !== 'downloading' &&
          parsed.phase !== 'ready' &&
          parsed.phase !== 'error'
        ) {
          return { phase: 'error', progress: 0, error: 'Invalid update phase' };
        }
        return {
          phase: parsed.phase,
          progress: typeof parsed.progress === 'number' ? parsed.progress : 0,
          version: parsed.version,
          error: parsed.error,
        };
      } catch (err) {
        return {
          phase: 'error',
          progress: 0,
          error: err instanceof Error ? err.message : 'Failed to parse Android update state',
        };
      }
    },
    async apply(): Promise<void> {
      let parsed: { success?: boolean; error?: string };
      try {
        parsed = JSON.parse(bridge.installUpdate());
      } catch {
        throw new Error('Invalid JSON from AndroidBridge.installUpdate');
      }
      if (parsed?.success === false) {
        throw new Error(parsed.error || 'Android installUpdate failed');
      }
    },
    async cancel(): Promise<void> {
      try {
        bridge.cancelUpdateDownload();
      } catch {
        // Ignore cancel errors
      }
    },
  };
}

export function createDesktopDriver(api: DesktopUpdateApi): UpdateDriver {
  return {
    canAutoDownload: true,
    async start(release: ReleaseInfo, asset: ReleaseAsset): Promise<void> {
      const res = await api.update_download({
        version: release.version,
        url: asset.url,
        mirrorUrl: asset.mirrorUrl,
        sha256: asset.sha256 ?? '',
        size: asset.size,
      });
      if (!res || res.success === false) {
        throw new Error(res?.error || 'Desktop update_download failed');
      }
    },
    async poll(): Promise<DriverState> {
      try {
        const res = await api.update_state();
        if (
          !res ||
          typeof res !== 'object' ||
          (res.phase !== 'idle' &&
            res.phase !== 'downloading' &&
            res.phase !== 'ready' &&
            res.phase !== 'error')
        ) {
          return { phase: 'error', progress: 0, error: 'Invalid desktop update state' };
        }
        return {
          phase: res.phase,
          progress: typeof res.progress === 'number' ? res.progress : 0,
          version: res.version,
          error: res.error,
        };
      } catch (err) {
        return {
          phase: 'error',
          progress: 0,
          error: err instanceof Error ? err.message : 'Failed to poll desktop update state',
        };
      }
    },
    async apply(): Promise<void> {
      const res = await api.update_apply();
      if (!res || res.success === false) {
        throw new Error(res?.error || 'Desktop update_apply failed');
      }
    },
    async cancel(): Promise<void> {
      try {
        if (typeof api.update_cancel === 'function') {
          await api.update_cancel();
        }
      } catch {
        // Ignore cancel errors
      }
    },
  };
}

export function createManualDriver(): UpdateDriver {
  const fail = async (): Promise<never> => {
    throw new Error('manual only');
  };
  return {
    canAutoDownload: false,
    start: fail,
    poll: fail,
    apply: fail,
    cancel: fail,
  };
}

export interface PickDriverDeps {
  window?: unknown;
  platform?: Platform;
  distribution?: Distribution;
  wifiOnly?: boolean;
}

/**
 * pywebview attaches `window.pywebview.api` a moment after the page loads (`pywebviewready`). A desktop
 * build must wait for it before choosing a driver, or it pins the manual one and never downloads.
 */
export function desktopBridgeMissing(win: { pywebview?: { api?: Partial<DesktopUpdateApi> } } | undefined, platform: Platform): boolean {
  return platform === 'desktop' && typeof win?.pywebview?.api?.update_download !== 'function';
}

export function pickDriver(deps?: PickDriverDeps): UpdateDriver {
  const dist = deps?.distribution ?? DISTRIBUTION;
  if (dist !== 'website') {
    return createManualDriver();
  }

  const win = (
    deps && 'window' in deps
      ? deps.window
      : typeof window !== 'undefined'
        ? window
        : undefined
  ) as {
    AndroidBridge?: Partial<AndroidUpdateBridge>;
    pywebview?: { api?: Partial<DesktopUpdateApi> };
  } | undefined;

  const platform = deps?.platform ?? getPlatform(win as Parameters<typeof getPlatform>[0]);

  if (platform === 'android' && typeof win?.AndroidBridge?.startUpdateDownload === 'function') {
    return createAndroidDriver(win.AndroidBridge as AndroidUpdateBridge, {
      wifiOnly: deps?.wifiOnly ?? true,
    });
  }

  if (platform === 'desktop' && typeof win?.pywebview?.api?.update_download === 'function') {
    return createDesktopDriver(win.pywebview.api as DesktopUpdateApi);
  }

  return createManualDriver();
}

export interface UpdateControllerDeps {
  driver: UpdateDriver;
  currentVersion: string;
  platform: Platform;
  fetchRelease?: () => Promise<ReleaseInfo>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
  pollMs?: number;
}

export interface UpdateController {
  getState(): UpdateState;
  subscribe(fn: (state: UpdateState) => void): () => void;
  check(opts?: { auto?: boolean; force?: boolean }): Promise<void>;
  startDownload(): Promise<void>;
  apply(): Promise<void>;
  dismiss(): void;
  dispose(): void;
}

function getDefaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {}
  try {
    if (typeof window !== 'undefined' && (window as unknown as { localStorage?: Storage }).localStorage) {
      return (window as unknown as { localStorage: Storage }).localStorage;
    }
  } catch {}
  return undefined;
}

export function createUpdateController(deps: UpdateControllerDeps): UpdateController {
  const { driver, currentVersion, platform } = deps;
  const fetchRelease = deps.fetchRelease ?? (() => fetchLatestRelease());
  const storage = 'storage' in deps ? deps.storage : getDefaultStorage();
  const now = deps.now ?? Date.now;
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const manualOnly = !driver.canAutoDownload;

  let state: UpdateState = {
    status: 'idle',
    current: currentVersion,
    latest: undefined,
    progress: 0,
    error: undefined,
    manualOnly,
    hasUpdate: false,
  };

  const listeners = new Set<(s: UpdateState) => void>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let pollInFlight = false;

  function emit(): void {
    if (disposed) return;
    const snapshot = { ...state };
    listeners.forEach(fn => {
      try {
        fn(snapshot);
      } catch {
        // Ignore subscriber errors
      }
    });
  }

  function updateState(patch: Partial<UpdateState>, preserveHasUpdateOnError = false): void {
    const nextStatus = patch.status ?? state.status;
    let nextHasUpdate: boolean;
    if ('hasUpdate' in patch && typeof patch.hasUpdate === 'boolean') {
      nextHasUpdate = patch.hasUpdate;
    } else if (nextStatus === 'error' && preserveHasUpdateOnError) {
      nextHasUpdate = state.hasUpdate;
    } else {
      nextHasUpdate =
        nextStatus === 'available' || nextStatus === 'downloading' || nextStatus === 'ready';
    }

    state = {
      ...state,
      ...patch,
      status: nextStatus,
      manualOnly,
      hasUpdate: nextHasUpdate,
    };
    emit();
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    pollInFlight = false;
  }

  async function pollOnce(): Promise<void> {
    if (disposed || pollInFlight) return;
    pollInFlight = true;
    try {
      const ds = await driver.poll();
      if (disposed) return;
      if (ds.phase === 'downloading') {
        updateState({
          status: 'downloading',
          progress: ds.progress,
          error: undefined,
        });
      } else if (ds.phase === 'ready') {
        stopPolling();
        logEvent('info', 'update', `update ready v${ds.version || state.latest?.version || ''}`);
        updateState({
          status: 'ready',
          progress: 1,
          error: undefined,
        });
      } else if (ds.phase === 'error') {
        stopPolling();
        const errMsg = ds.error || 'Update download failed';
        logEvent('warn', 'update', `download error: ${errMsg}`);
        updateState(
          {
            status: 'error',
            error: errMsg,
          },
          true,
        );
      }
    } catch (err) {
      if (disposed) return;
      stopPolling();
      const errMsg = err instanceof Error ? err.message : String(err);
      logEvent('warn', 'update', `poll error: ${errMsg}`);
      updateState(
        {
          status: 'error',
          error: errMsg,
        },
        true,
      );
    } finally {
      pollInFlight = false;
    }
  }

  function startPolling(): void {
    stopPolling();
    pollTimer = setInterval(() => {
      void pollOnce();
    }, pollMs);
  }

  async function startDownload(userInitiated = true): Promise<void> {
    if (disposed || !driver.canAutoDownload || !state.latest) return;
    const asset = selectAsset(state.latest, platform);
    if (!asset) return;

    updateState({
      status: 'downloading',
      progress: 0,
      error: undefined,
    });
    logEvent('info', 'update', `start download v${state.latest.version}`);

    try {
      await driver.start(state.latest, asset, userInitiated);
      if (disposed) return;
      startPolling();
    } catch (err) {
      if (disposed) return;
      stopPolling();
      const errMsg = err instanceof Error ? err.message : String(err);
      logEvent('warn', 'update', `start download failed: ${errMsg}`);
      updateState(
        {
          status: 'error',
          error: errMsg,
        },
        true,
      );
    }
  }

  function setPending(version: string | null): void {
    try {
      if (version) storage?.setItem(UPDATE_PENDING_KEY, version);
      else storage?.setItem(UPDATE_PENDING_KEY, '');
    } catch {}
  }

  async function check(opts?: { auto?: boolean; force?: boolean }): Promise<void> {
    if (disposed) return;
    const isAuto = Boolean(opts?.auto);
    const isForce = Boolean(opts?.force);

    if (isAuto) {
      let lastCheckedAt: number | null = null;
      try {
        const raw = storage?.getItem(UPDATE_LAST_CHECK_KEY);
        if (raw !== null && raw !== undefined && raw !== '') {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) {
            lastCheckedAt = parsed;
          }
        }
      } catch {}
      let pending: string | null = null;
      try { pending = storage?.getItem(UPDATE_PENDING_KEY) ?? null; } catch {}
      // A known-but-uninstalled update bypasses the throttle on the first check after a restart, so the dot comes back.
      const hasPending = !state.latest && !!pending && compareVersions(pending, currentVersion) > 0;
      if (!hasPending && !shouldAutoCheck(lastCheckedAt, now())) {
        return;
      }
    }

    const prevState = { ...state };
    updateState({
      status: 'checking',
      error: undefined,
      hasUpdate: prevState.hasUpdate,
    });

    let release: ReleaseInfo;
    try {
      release = await fetchRelease();
    } catch (err) {
      if (disposed) return;
      const errMsg = err instanceof Error ? err.message : String(err);
      logEvent('warn', 'update', `check update failed: ${errMsg}`);
      if (isAuto) {
        state = { ...prevState };
        emit();
      } else {
        updateState({
          status: 'error',
          error: errMsg,
          hasUpdate: prevState.hasUpdate,
        });
      }
      return;
    }

    if (disposed) return;

    try {
      storage?.setItem(UPDATE_LAST_CHECK_KEY, String(now()));
    } catch {}

    let dismissedVersion: string | null = null;
    if (!isForce) {
      try {
        dismissedVersion = storage?.getItem(UPDATE_DISMISSED_KEY) ?? null;
      } catch {}
    }

    if (
      compareVersions(release.version, currentVersion) <= 0 ||
      (!isForce && dismissedVersion === release.version)
    ) {
      setPending(null);
      updateState({
        status: 'up-to-date',
        latest: release,
        progress: 0,
        error: undefined,
      });
      return;
    }

    setPending(release.version);
    if (manualOnly) {
      logEvent('info', 'update', `update available (manual) v${release.version}`);
      updateState({
        status: 'available',
        latest: release,
        progress: 0,
        error: undefined,
      });
      return;
    }

    const asset = selectAsset(release, platform);
    if (!asset) {
      setPending(null);
      updateState({
        status: 'up-to-date',
        latest: release,
        progress: 0,
        error: undefined,
      });
      return;
    }

    logEvent('info', 'update', `update available v${release.version}`);
    updateState({
      status: 'available',
      latest: release,
      progress: 0,
      error: undefined,
    });

    if (isAuto && driver.canAutoDownload) {
      await startDownload(false);
    }
  }

  async function apply(): Promise<void> {
    if (disposed) return;
    try {
      logEvent('info', 'update', `apply update v${state.latest?.version || ''}`);
      await driver.apply();
    } catch (err) {
      if (disposed) return;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg === 'need-install-permission') {
        // The system sent the user to "install unknown apps"; the download is still good, so stay
        // `ready` and let the next tap install it once they have allowed it.
        logEvent('info', 'update', 'install needs the unknown-apps permission first');
        return;
      }
      logEvent('warn', 'update', `apply failed: ${errMsg}`);
      updateState(
        {
          status: 'error',
          error: errMsg,
        },
        true,
      );
    }
  }

  function dismiss(): void {
    if (disposed) return;
    if (state.latest?.version) {
      try {
        storage?.setItem(UPDATE_DISMISSED_KEY, state.latest.version);
      } catch {}
    }
    setPending(null);
    stopPolling();
    if (driver.canAutoDownload && state.status === 'downloading') {
      void driver.cancel().catch(() => {});
    }
    updateState({
      status: 'up-to-date',
      progress: 0,
      error: undefined,
      hasUpdate: false,
    });
  }

  function dispose(): void {
    disposed = true;
    stopPolling();
    listeners.clear();
  }

  return {
    getState(): UpdateState {
      return { ...state };
    },
    subscribe(fn: (s: UpdateState) => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    check,
    startDownload,
    apply,
    dismiss,
    dispose,
  };
}
