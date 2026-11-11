import type { AnnotationInput } from './annotationTask';

/**
 * A text edit is still the same open document: keep the last complete preview mounted while
 * the new annotation streams in. An import/library load changes `documentId`, so its old
 * lines must not be retained. Before the initial document resolves, compare text as before.
 */
export function sameAnnotationDocument(left: AnnotationInput, right: AnnotationInput): boolean {
  if (left.documentId && right.documentId) return left.documentId === right.documentId;
  return left.text === right.text && (left.documentId || '') === (right.documentId || '');
}
