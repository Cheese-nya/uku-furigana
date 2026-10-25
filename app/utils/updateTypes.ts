/**
 * Shared contract for bug feedback and online update. Every worker codes against
 * this file; change it only through the leader.
 */

export type Platform = 'android' | 'desktop' | 'ios' | 'web';
export type Distribution = 'website' | 'play' | 'appstore';

export const GITHUB_REPO = 'Cheese-nya/uku-furigana';
export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
/** NEXT_PUBLIC_RELAY_BASE points a test build at a local relay; production builds leave it unset. */
export const RELAY_BASE = process.env.NEXT_PUBLIC_RELAY_BASE || 'https://uku.saiaino.xyz';
export const QQ_GROUP = '1040467160';

/* ───────────── Logging & feedback ───────────── */

export type LogLevel = 'error' | 'warn' | 'info';

export interface LogEntry {
  /** Epoch milliseconds. */
  t: number;
  level: LogLevel;
  /** Short origin tag, e.g. 'console', 'window', 'engine', 'export', 'update'. */
  source: string;
  /** Already redacted and truncated (see redactText in appLog.ts). */
  message: string;
}

export interface DeviceInfo {
  platform: Platform;
  userAgent: string;
  /** e.g. "412x915@2.6". */
  screen: string;
  language: string;
  theme: 'light' | 'dark';
  online: boolean;
}

export interface DiagnosticReport {
  app: 'uku-furigana';
  version: string;
  platform: Platform;
  distribution: Distribution;
  device: DeviceInfo;
  entries: LogEntry[];
  /** Android: files/native.log; desktop: tail of logs/uku.log. Redacted like entries. */
  nativeLog?: string;
}

export type FeedbackKind = 'log' | 'text';

/** Body of POST {RELAY_BASE}/api/feedback. The relay accepts at most 64 KB. */
export interface FeedbackPayload {
  kind: FeedbackKind;
  /** Required when kind === 'text' (1–80 chars). */
  title?: string;
  /** Free text, up to 4000 chars. */
  message?: string;
  /** Optional QQ / mail, up to 80 chars. */
  contact?: string;
  includeLog: boolean;
  /**
   * Random per-install id (16–64 chars of [A-Za-z0-9-]) the relay rate-limits on.
   * The relay sits behind an SNI router and cannot see client IPs.
   */
  clientId?: string;
  /** Present when includeLog is true. */
  log?: DiagnosticReport;
}

export type FeedbackError = 'rate-limited' | 'too-large' | 'invalid' | 'network' | 'server';

export interface FeedbackResult {
  ok: boolean;
  /** Created issue number and URL when ok. */
  number?: number;
  url?: string;
  error?: FeedbackError;
}

/* ───────────── Update ───────────── */

export interface ReleaseAsset {
  name: string;
  size: number;
  /** Direct GitHub download URL. */
  url: string;
  /** Same file via the relay mirror (fallback when GitHub is unreachable). */
  mirrorUrl?: string;
  /** Lower-case hex SHA-256 from SHA256SUMS.txt. */
  sha256?: string;
}

export interface ReleaseInfo {
  /** Without the leading "v", e.g. "1.3.0". */
  version: string;
  tag: string;
  notes: string;
  assets: ReleaseAsset[];
}

/**
 * GET {RELAY_BASE}/api/update/latest answers `ReleaseInfo` (sha256 and mirrorUrl
 * filled in by the relay). The client can also build the same shape from
 * https://api.github.com/repos/{GITHUB_REPO}/releases/latest plus SHA256SUMS.txt.
 */

export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  current: string;
  latest?: ReleaseInfo;
  /** 0..1, meaningful while downloading. */
  progress: number;
  error?: string;
  /** True when this platform/distribution can only point at the Releases page (iOS, web, store builds). */
  manualOnly: boolean;
  /** True while there is something to show the yellow dot for (available, downloading or ready). */
  hasUpdate: boolean;
}

export interface DriverState {
  phase: 'idle' | 'downloading' | 'ready' | 'error';
  progress: number;
  /** Version of the file being downloaded / ready to install. */
  version?: string;
  error?: string;
}

/** Platform adapter used by updater.ts; one implementation per platform. */
export interface UpdateDriver {
  /** False means "show the yellow dot and open RELEASES_URL". */
  readonly canAutoDownload: boolean;
  /**
   * Start (or resume) the background download of `asset`. Resolves once it has started. `userInitiated`:
   * the user tapped download, so Android may use mobile data (automatic downloads wait for Wi-Fi).
   */
  start(release: ReleaseInfo, asset: ReleaseAsset, userInitiated?: boolean): Promise<void>;
  poll(): Promise<DriverState>;
  /** Android: launch the system installer. Desktop: quit, replace the exe and relaunch. */
  apply(): Promise<void>;
  cancel(): Promise<void>;
}

/* ───────────── Native bridge contracts ───────────── */

/**
 * `window.AndroidBridge` additions. Every method returns a JSON string and never
 * throws; failures are `{"success":false,"error":"..."}`.
 */
export interface AndroidUpdateBridge {
  /** `{"versionName":"1.2.1","versionCode":5}` */
  getAppVersion(): string;
  /** Plain text, newest last, at most 64 KB. */
  getNativeLog(): string;
  /**
   * `args` = JSON `{version, url, mirrorUrl?, sha256, size, wifiOnly}`.
   * Idempotent: a second call for the same version resumes/keeps the current download.
   * Returns `{"success":true}`.
   */
  startUpdateDownload(args: string): string;
  /** `{"phase":"idle|downloading|ready|error","progress":0.42,"version":"1.3.0","error":"..."}` */
  getUpdateState(): string;
  /** Launch the system installer for the verified APK; asks for "install unknown apps" first if needed. */
  installUpdate(): string;
  cancelUpdateDownload(): string;
  /** Open the QQ "join group" page; `{"success":false}` when QQ is not installed. */
  openQqGroup(uin: string): string;
}

/** `window.pywebview.api` additions (desktop_runner.py `Api`). Unlike the Android bridge these return objects, not JSON strings. */
export interface DesktopUpdateApi {
  /** Tail (≤ 64 KB) of logs/uku.log. */
  get_log(): Promise<string>;
  /** `args` = {version, url, mirrorUrl?, sha256, size}. Returns {success, error?}. */
  update_download(args: { version: string; url: string; mirrorUrl?: string; sha256: string; size: number }): Promise<{ success: boolean; error?: string }>;
  /** {phase, progress, version?, error?} */
  update_state(): Promise<DriverState>;
  /** Quits the app, swaps the exe via a detached helper and relaunches. {success:false} in dev (non-frozen) runs. */
  update_apply(): Promise<{ success: boolean; error?: string }>;
  update_cancel(): Promise<{ success: boolean }>;
}
