import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTypescript } from './loadTypescript.mjs';

const { translations } = loadTypescript('../app/utils/i18n.ts');
const zh = translations['zh-CN'];
const en = translations.en;

/** Keys added by the feedback & update UI. */
const KEYS = [
  'feedbackSection', 'feedbackUploadLog', 'feedbackSubmitIssue', 'feedbackJoinQq', 'qqCopied',
  'updateCheck', 'updateChecking', 'updateUpToDate', 'updateAvailable', 'updateDownloading',
  'updateReady', 'updateReadyDesktop', 'updateFailed', 'updateMeteredHint', 'updateOpenReleases',
  'updateCurrentVersion', 'whatsNew', 'whatsNewCurrent', 'whatsNewEmpty',
  'feedbackTitleLog', 'feedbackTitleText', 'feedbackModeLog', 'feedbackModeText',
  'feedbackLogIntro', 'feedbackNoteLabel', 'feedbackIssueTitleLabel', 'feedbackIssueBodyLabel',
  'feedbackContactLabel', 'feedbackAttachLog', 'feedbackLogPreview', 'feedbackLogEntries',
  'feedbackLogLoading', 'feedbackPrivacy', 'feedbackConsent', 'feedbackSend', 'feedbackSending',
  'feedbackSuccess', 'feedbackViewIssue', 'feedbackErrRateLimited', 'feedbackErrTooLarge',
  'feedbackErrInvalid', 'feedbackErrNetwork', 'feedbackErrServer', 'feedbackRetry',
];

test('feedback & update copy exists in both locales', () => {
  for (const key of KEYS) {
    assert.equal(typeof zh[key], 'string', `zh-CN ${key}`);
    assert.ok(zh[key].length > 0, `zh-CN ${key} is empty`);
    assert.ok(en[key].length > 0, `en ${key} is empty`);
  }
});

test('placeholders match between locales', () => {
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const key of KEYS) {
    assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), `placeholders of ${key}`);
  }
});

test('placeholder-bearing copy keeps its tokens', () => {
  for (const key of ['updateAvailable', 'updateDownloading', 'updateCurrentVersion', 'feedbackLogEntries', 'feedbackSuccess']) {
    assert.match(zh[key], /\{\w+\}/, `zh-CN ${key}`);
    assert.match(en[key], /\{\w+\}/, `en ${key}`);
  }
});
