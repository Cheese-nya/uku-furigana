import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { ImportError, toImportError, isAbortError, throwIfAborted } = loadTypescript('../app/utils/importErrors.ts');

test('toImportError maps pdf.js password exceptions to retryable password codes', () => {
  const required = Object.assign(new Error('No password given'), { name: 'PasswordException', code: 1 });
  const wrong = Object.assign(new Error('Incorrect Password'), { name: 'PasswordException', code: 2 });
  const first = toImportError(required);
  assert.equal(first.code, 'password-required');
  assert.equal(first.retryable, true);
  assert.equal(first.detail, 'No password given');
  assert.equal(toImportError(wrong).code, 'password-wrong');
  assert.equal(toImportError(wrong).retryable, true);
});

test('toImportError maps corrupt, I/O, memory and DRM failures', () => {
  assert.equal(toImportError(Object.assign(new Error('Invalid PDF structure'), { name: 'InvalidPDFException' })).code, 'corrupt-file');
  assert.equal(toImportError(new Error('Corrupt ZIP: central directory not found')).code, 'corrupt-file');
  assert.equal(toImportError(Object.assign(new Error('Missing PDF'), { name: 'MissingPDFException' })).code, 'io-error');
  assert.equal(toImportError(Object.assign(new Error('Unexpected server response'), { name: 'UnexpectedResponseException' })).code, 'io-error');
  assert.equal(toImportError(Object.assign(new Error('File is not readable'), { name: 'NotReadableError' })).code, 'io-error');
  assert.equal(toImportError(new RangeError('Array buffer allocation failed')).code, 'out-of-memory');
  assert.equal(toImportError(new Error('This book is encrypted with Adobe DRM')).code, 'drm-protected');
  assert.equal(toImportError(new Error('something odd')).code, 'unknown');
});

test('an ImportError passes through untouched and aborts become cancelled', () => {
  const original = new ImportError('scanned-pdf', 'No text');
  assert.equal(toImportError(original), original);
  const abort = new DOMException('stopped', 'AbortError');
  assert.equal(isAbortError(abort), true);
  assert.equal(isAbortError(new Error('nope')), false);
  const cancelled = toImportError(abort);
  assert.equal(cancelled.code, 'cancelled');
  assert.equal(cancelled.detail, 'stopped');
});

test('throwIfAborted throws a Chrome-99-compatible AbortError only after abort', () => {
  const controller = new AbortController();
  assert.doesNotThrow(() => throwIfAborted(controller.signal));
  assert.doesNotThrow(() => throwIfAborted(undefined));
  controller.abort();
  assert.throws(() => throwIfAborted(controller.signal), error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error instanceof DOMException, true);
    return true;
  });
});
