import { RELEASE_NOTES } from '../data/releaseNotes';

/** Set to the version of the notes the user has already looked at. */
export const WHATS_NEW_SEEN_KEY = 'uku.whatsNew.seen';

/** `null` = nothing stored yet, `undefined` = storage unavailable (SSR, private mode, quota). */
function readSeenVersion(): string | null | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage.getItem(WHATS_NEW_SEEN_KEY);
  } catch {
    return undefined;
  }
}

/**
 * True while the newest release note has not been opened yet. An unreadable localStorage
 * answers false: a dot nobody can clear would be worse than a missing one.
 */
export function hasUnseenNotes(currentVersion: string = RELEASE_NOTES[0]?.version ?? ''): boolean {
  if (!currentVersion) return false;
  const seen = readSeenVersion();
  if (seen === undefined) return false;
  return seen !== currentVersion;
}

/** Remember that the notes were opened. Called when the sheet opens, not when it closes. */
export function markNotesSeen(currentVersion: string = RELEASE_NOTES[0]?.version ?? ''): void {
  if (!currentVersion) return;
  try {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, currentVersion);
  } catch {
    // A full or unavailable localStorage only means the dot comes back next launch.
  }
}
