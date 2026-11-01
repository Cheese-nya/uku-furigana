/** Stable import failure codes: the UI translates them instead of showing parser messages. */
export type ImportErrorCode =
  | 'password-required'
  | 'password-wrong'
  | 'drm-protected'
  | 'scanned-pdf'
  | 'empty-book'
  | 'corrupt-file'
  | 'unsupported-format'
  | 'out-of-memory'
  | 'io-error'
  | 'cancelled'
  | 'unknown';

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly detail?: string;
  /** Whether retrying the same file can plausibly succeed (wrong password, transient I/O). */
  readonly retryable: boolean;

  constructor(code: ImportErrorCode, message: string, options: { detail?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    this.detail = options.detail;
    this.retryable = options.retryable ?? false;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/** Throw a browser-compatible AbortError; `AbortSignal.throwIfAborted` is Chrome 100+, too new for HarmonyOS 4. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Import aborted', 'AbortError');
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Normalise anything a parser or pdf.js throws into an {@link ImportError}.
 * pdf.js reports password failures as `PasswordException` with code 1 (needs one) or 2 (wrong one).
 */
export function toImportError(error: unknown): ImportError {
  if (error instanceof ImportError) return error;
  if (isAbortError(error)) {
    return new ImportError('cancelled', 'Import cancelled', { detail: errorMessage(error) });
  }

  const name = errorName(error);
  const message = errorMessage(error);
  const code = (error as { code?: unknown } | null)?.code;

  if (name === 'PasswordException' || /password/i.test(message) && /encrypt/i.test(message)) {
    return new ImportError(code === 2 ? 'password-wrong' : 'password-required', 'Password required', {
      detail: message,
      retryable: true,
    });
  }
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) {
    return new ImportError('corrupt-file', 'Invalid PDF', { detail: message });
  }
  if (/central directory|corrupt|unexpected end|end of data|invalid zip/i.test(message)) {
    return new ImportError('corrupt-file', 'Corrupt archive', { detail: message });
  }
  if (name === 'MissingPDFException' || /missing pdf/i.test(message)) {
    return new ImportError('io-error', 'PDF data is missing', { detail: message, retryable: true });
  }
  if (name === 'UnexpectedResponseException') {
    return new ImportError('io-error', 'PDF could not be read', { detail: message, retryable: true });
  }
  if (name === 'NotReadableError' || name === 'DataError') {
    return new ImportError('io-error', 'File could not be read', { detail: message, retryable: true });
  }
  if (name === 'RangeError' || /out of memory|allocation failed/i.test(message)) {
    return new ImportError('out-of-memory', 'Not enough memory', { detail: message });
  }
  if (/加密|encrypted|drm/i.test(message)) {
    return new ImportError('drm-protected', 'DRM protected', { detail: message });
  }
  return new ImportError('unknown', 'Import failed', { detail: message || name });
}
