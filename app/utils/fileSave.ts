import JSZip from 'jszip';

export interface SaveResult {
  success: boolean;
  path?: string;
  downloadStarted?: boolean;
}

export interface SaveFileOptions {
  /** Batch downloads skip the per-file save picker and use a direct download (or native save). */
  skipFilePicker?: boolean;
  /** Long-running exports keep the final save on a plain download instead of the disappearing share sheet. */
  skipShare?: boolean;
}

export type BatchSaveMode = 'zip' | 'folder' | 'direct';

export interface BatchOutputFile {
  filename: string;
  blob: Blob;
  mimeType?: string;
}

export interface DirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(blob: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}

interface SaveWindow extends Omit<Window, 'showSaveFilePicker' | 'matchMedia'> {
  pywebview?: { api?: { save_file(filename: string, data: string): Promise<{ success: boolean; path?: string; error?: string }> } };
  AndroidBridge?: { saveFile?: (filename: string, base64Data: string) => string };
  showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
    name: string;
    createWritable(): Promise<{ write(blob: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>;
  matchMedia?: (query: string) => MediaQueryList | { matches: boolean };
}

type ShareNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
  standalone?: boolean;
};

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;

/**
 * Mobile share sheet (Web Share API Level 2) is only preferred on hand-held
 * devices, so desktop browsers without `showSaveFilePicker` still fall through
 * to a plain direct download.
 */
export function isMobileSharePreferred(target: SaveWindow): boolean {
  const nav = (target.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined)) as ShareNavigator | undefined;
  if (!nav || typeof File !== 'function') return false;
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  if (MOBILE_UA.test(nav.userAgent || '')) return true;
  if (target.matchMedia?.('(pointer: coarse)')?.matches) return true;
  if (nav.standalone) return true;
  return false;
}

/** Only fall back when a save API is unavailable or the share sheet rejects the file, never after a failed write. */
export async function saveBlob(blob: Blob, filename: string, options?: SaveFileOptions): Promise<SaveResult> {
  const target = window as SaveWindow;
  const api = target.pywebview?.api;
  if (api?.save_file) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
      reader.readAsDataURL(blob);
    });
    const result = await api.save_file(filename, base64);
    if (result?.success) return { success: true, path: result.path };
    if (result?.error === 'Cancelled') return { success: false };
    throw new Error(result?.error || '文件保存失败');
  }

  const androidSave = target.AndroidBridge?.saveFile;
  if (typeof androidSave === 'function') {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
      reader.readAsDataURL(blob);
    });
    let parsed: { success?: boolean; path?: string; error?: string } | null = null;
    try {
      const raw = androidSave.call(target.AndroidBridge, filename, base64);
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
    if (parsed?.success) return { success: true, path: parsed.path };
    throw new Error(parsed?.error || '文件保存失败');
  }

  if (target.showSaveFilePicker && !options?.skipFilePicker) {
    const ext = filename.split('.').pop()?.toLowerCase() || 'txt';
    const types: Record<string, { description: string; accept: Record<string, string[]> }> = {
      txt: { description: 'TXT 文本文件', accept: { 'text/plain': ['.txt'] } },
      json: { description: 'JSON 专名词典', accept: { 'application/json': ['.json'] } },
      srt: { description: 'SRT 字幕文件', accept: { 'application/x-subrip': ['.srt'] } },
      docx: { description: 'Word 文档', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } },
    };
    let handle;
    try {
      handle = await target.showSaveFilePicker({ suggestedName: filename, types: [types[ext] || types.txt] });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return { success: false };
      throw error;
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { success: true, path: handle.name };
  }

  if (!options?.skipShare && isMobileSharePreferred(target)) {
    const nav = (target.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined)) as ShareNavigator;
    const file = new File([blob], filename, { type: blob.type || 'text/plain' });
    try {
      if (nav.canShare?.({ files: [file] })) {
        try {
          await nav.share?.({ files: [file], title: filename });
          return { success: true, path: filename };
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return { success: false };
          // Safari can reject a generated EPUB or lose activation after a long annotation job.
          // A plain download is still usable; cancellation is the only share result that stays cancelled.
        }
      }
    } catch {
      // canShare can throw on an unsupported MIME type; fall through to the ordinary download.
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try {
    anchor.click();
    return { success: true, path: filename, downloadStarted: true };
  } finally {
    anchor.remove();
    // Safari may consume a generated blob after the click has returned; keep its URL alive long enough.
    const timer = setTimeout(() => URL.revokeObjectURL(url), 60_000);
    timer.unref?.();
  }
}

function safeFileName(filename: string): string {
  const cleaned = filename.replace(/[\\/]/g, '_').replace(/\u0000/g, '').trim();
  return cleaned || 'untitled';
}

/**
 * Ask once for a read-write directory. User cancellation (AbortError) propagates.
 * Returns null when the File System Access API is unavailable.
 */
export async function pickBatchDirectory(): Promise<DirectoryHandleLike | null> {
  const picker = (window as SaveWindow).showDirectoryPicker;
  if (typeof picker !== 'function') return null;
  return picker.call(window, { mode: 'readwrite' });
}

/** Write one blob into an already-chosen directory handle, with no extra picker. */
export async function saveBlobToDirectory(dirHandle: DirectoryHandleLike, filename: string, blob: Blob): Promise<void> {
  const handle = await dirHandle.getFileHandle(safeFileName(filename), { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function uniqueZipName(filename: string, used: Set<string>): string {
  const safe = safeFileName(filename);
  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let index = 2;
  let candidate = `${stem} (${index})${ext}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${stem} (${index})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/** Bundle batch outputs into one zip. Duplicate names become `name (2).ext`. */
export async function buildBatchZipBlob(files: BatchOutputFile[]): Promise<Blob> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const file of files) {
    zip.file(uniqueZipName(file.filename, used), file.blob);
  }
  return zip.generateAsync({ type: 'blob' });
}

/** A single generated output is saved as itself; a real batch remains one ZIP. */
export async function buildBatchSaveOutput(files: BatchOutputFile[]): Promise<BatchOutputFile> {
  if (files.length === 1) return files[0];
  return { filename: '台本批量导出.zip', blob: await buildBatchZipBlob(files) };
}
