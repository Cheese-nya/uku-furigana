// Optional browser QA: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
// Serve a fresh static export and set FURIGANA_TEST_URL (defaults to port 8765).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.FURIGANA_TEST_URL || 'http://127.0.0.1:8765/';
const shot = suffix => `/tmp/${process.env.FURIGANA_SCREENSHOT_PREFIX || ''}reader-translation-${suffix}.png`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const content = Array.from({ length: 70 }, (_, i) => i === 29
  ? '長い段落の始まりです。' + 'これは画面をまたぐ長い段落で、原文を見失わないための確認です。'.repeat(24)
  : `第${i}行。今日はいい天気ですね。学校の帰りに友達と長い道を歩きました。`).join('\n');
const book = { bookId: 'book:translation-qa', title: '翻译位置测试', author: 'QA', content,
  fingerprint: `sha256:${createHash('sha256').update(content).digest('hex')}`, category: 'script', format: 'txt', coverTheme: 'indigo',
  sourceOverrides: [], chapters: [], readingProgress: { chapterIndex: 0, lineIndex: 0, percentage: 0, updatedAt: Date.now() },
  bookmarks: [], favorite: false, createdAt: Date.now(), updatedAt: Date.now(), lastReadAt: 0 };
await context.addInitScript(book => {
  if (localStorage.getItem('reader-qa-seeded')) return;
  localStorage.clear();
  // This regression uses edge taps to reveal chrome; side navigation is covered separately.
  localStorage.setItem('furigana_reader_prefs_v3', JSON.stringify({ sidePageTurn: false }));
  localStorage.setItem('furigana-library-v1', JSON.stringify({ version: 2, books: { [book.bookId]: book }, folders: {} }));
  localStorage.setItem('furigana_active_tab', 'library');
  localStorage.setItem('reader-qa-seeded', '1');
}, book);
let delay = 0;
await context.route('https://**/*', async route => {
  if (!route.request().url().includes('edge.microsoft.com/translate')) return route.abort();
  const texts = route.request().postDataJSON();
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  await route.fulfill({ json: texts.map(text => ({ translations: [{ text: `译文：${text}这是用于验证不同高度的译文。`.repeat(2) }] })) });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = [];
try {
  await page.goto(`${origin}#library`);
  await page.getByRole('button', { name: book.title, exact: true }).click();
  const article = page.getByTestId('reader-script-canvas');
  await article.locator('[data-line="65"] [data-o]').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1700); // Let the pre-existing book-open/font restore settle.
  await article.evaluate(el => { const line = el.querySelector('[data-line="30"]'); el.parentElement.scrollTop += line.getBoundingClientRect().top - 100; });
  await page.waitForTimeout(300);
  const position = () => article.locator('[data-line="30"] [data-o="0"]').evaluate(el => {
    const r = document.createRange(); r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 1); return r.getBoundingClientRect().top;
  });
  const showToolbar = async () => {
    const visible = await page.locator('.reader-capsule').evaluate(el => el.getBoundingClientRect().top < innerHeight && Number(getComputedStyle(el).opacity) > .5);
    if (!visible) {
      const box = await article.boundingBox();
      const vertical = await article.getAttribute('data-writing-mode') === 'vertical';
      await page.mouse.click(box.x + 2, vertical ? box.y + 8 : 150);
      await page.waitForTimeout(700);
    }
  };
  await showToolbar();
  await page.screenshot({ path: shot('before') });
  const before = await position();
  console.log('before', before, 'toolbar', await page.locator('.reader-capsule').boundingBox());
  delay = 500;
  await page.locator('.ft-button:not(.ft-floating)').click();
  await page.waitForTimeout(1600);
  assert.ok(Math.abs(await position() - before) <= 3, 'async translation preserves visible original');
  await page.locator('.ft-button:not(.ft-floating)').click();
  await page.waitForTimeout(250);
  assert.ok(Math.abs(await position() - before) <= 3, 'turning translation off preserves original');
  checks.push('translation on, async arrival, and off retain original character position within 3 px');
  // New remote results must not change layout under a held touch or continuing momentum.
  await page.locator('.ft-button:not(.ft-floating)').click();
  await page.waitForTimeout(300);
  await article.evaluate(el => {
    el.dispatchEvent(new Event('touchstart', { bubbles: true }));
    el.parentElement.scrollTop += el.querySelector('[data-line="55"]').getBoundingClientRect().top - 100;
  });
  // content-visibility estimates settle after jumping across many unrendered paragraphs.
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(120);
    await article.evaluate(el => { el.parentElement.scrollTop += el.querySelector('[data-line="55"]').getBoundingClientRect().top - 100; });
  }
  await page.waitForTimeout(1400);
  assert.equal(await article.locator('[data-line="55"] .reader-tr-skel').first().count(), 1, 'touch holds new translation publication');
  await showToolbar();
  await page.getByRole('button', { name: '排版', exact: true }).click();
  await page.getByRole('radio', { name: '竖向排版', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  assert.equal(await article.locator('[data-line="55"] .reader-tr-skel').first().count(), 1, 'writing-mode reattachment must not release a held touch');
  await page.evaluate(() => window.dispatchEvent(new Event('touchend')));
  await page.waitForFunction(() => !document.querySelector('[data-line="55"] .reader-tr-skel'), null, { timeout: 7000 });
  checks.push('remote translations wait until held touch settles, including a writing-mode change');
  await showToolbar();
  await page.locator('.ft-button:not(.ft-floating)').click();
  await page.getByRole('button', { name: '排版', exact: true }).click();
  await page.getByRole('radio', { name: '竖向排版', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  await article.evaluate(el => { el.scrollLeft += el.querySelector('[data-line="30"]').getBoundingClientRect().right - (innerWidth - 100); });
  await page.waitForTimeout(250);
  await showToolbar();
  const right = () => article.locator('[data-line="30"] [data-o="0"]').evaluate(el => {
    const r = document.createRange(); r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 1); return r.getBoundingClientRect().right;
  });
  const originalRight = await right();
  await page.locator('.ft-button:not(.ft-floating)').click();
  await page.waitForTimeout(1300);
  assert.ok(Math.abs(await right() - originalRight) <= 3, 'vertical translation retains original column');
  await page.locator('.ft-button:not(.ft-floating)').click();
  await page.waitForTimeout(250);
  assert.ok(Math.abs(await right() - originalRight) <= 3, 'vertical translation off retains original column');
  checks.push('vertical bilingual on/off retains source column within 3 px');
  await page.getByRole('button', { name: '排版', exact: true }).click();
  await page.getByRole('radio', { name: '横向排版', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await showToolbar();
  const toolbarButton = page.locator('.ft-button:not(.ft-floating)');
  const dockedBox = await toolbarButton.boundingBox();
  await page.mouse.move(dockedBox.x + dockedBox.width / 2, dockedBox.y + dockedBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(520);
  await page.mouse.move(190, 320, { steps: 12 });
  await page.mouse.up();
  const floating = page.locator('.ft-floating');
  await floating.waitFor();
  assert.equal(await toolbarButton.count(), 0, 'floating removes duplicate toolbar control');
  assert.equal(await floating.getAttribute('aria-pressed'), 'false', 'drag does not toggle translation');
  const freeBox = await floating.boundingBox();
  const floatingStyle = await floating.evaluate(el => ({ position: getComputedStyle(el).position, radius: getComputedStyle(el).borderRadius }));
  assert.equal(floatingStyle.position, 'fixed', 'global glass styles must not override fixed placement');
  assert.notEqual(floatingStyle.radius, '0px', 'global reset must not erase the circular shape');
  assert.ok(Math.abs(freeBox.width - freeBox.height) <= 1, 'floating control is circular');
  assert.equal((await floating.innerText()).trim(), '', 'floating state has no visible On/Off text');
  const face = await floating.locator('.ft-face').boundingBox();
  assert.equal(face.width, 36); assert.equal(face.height, 36);
  assert.equal(await floating.evaluate(el => getComputedStyle(el).borderWidth), '0px');
  assert.ok(freeBox.x > 80 && freeBox.x < 240, 'free drop does not snap to an edge');
  checks.push('long press detaches without toggling; free drop stays away from edges');
  await floating.dispatchEvent('pointercancel', { pointerId: 99, pointerType: 'touch' });
  await floating.click();
  assert.equal(await floating.getAttribute('aria-pressed'), 'true', 'next click after pointer cancellation is not swallowed');
  await floating.click();
  assert.equal(await floating.evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'pointer use has no persistent dark focus ring');
  await floating.focus();
  await page.keyboard.press('Alt+m');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  assert.equal(await floating.getAttribute('aria-pressed'), 'false', 'keyboard position save does not toggle');
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  assert.equal(await floating.getAttribute('aria-pressed'), 'true', 'next keyboard activation is not swallowed');
  await floating.evaluate(el => el.blur());
  await page.screenshot({ path: shot('floating-on') });
  await floating.click();
  await page.screenshot({ path: shot('floating-off') });
  const portraitBox = await floating.boundingBox();
  await page.evaluate(() => history.replaceState(null, '', '#reader'));
  await page.reload();
  await floating.waitFor();
  const restoredBox = await floating.boundingBox();
  assert.ok(Math.abs(restoredBox.x - portraitBox.x) < 2 && Math.abs(restoredBox.y - portraitBox.y) < 2, 'position survives reload');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  const landscapeBox = await floating.boundingBox();
  assert.ok(landscapeBox.x >= 0 && landscapeBox.y >= 0 && landscapeBox.x + landscapeBox.width <= 844 && landscapeBox.y + landscapeBox.height <= 390);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const backBox = await floating.boundingBox();
  assert.ok(Math.abs(backBox.x - portraitBox.x) < 2 && Math.abs(backBox.y - portraitBox.y) < 2, 'portrait placement survives rotation');
  checks.push('keyboard move, subsequent toggle, reload persistence, orientation safety and portrait restore');
  await page.screenshot({ path: shot('floating') });
  await page.mouse.move(backBox.x + 20, backBox.y + 20);
  await page.mouse.down(); await page.waitForTimeout(520);
  const aa = await page.locator('.reader-tools-right > button:last-child').boundingBox();
  await page.mouse.move(aa.x - 20, aa.y + aa.height / 2, { steps: 12 });
  await page.mouse.up();
  await toolbarButton.waitFor();
  assert.equal(await floating.count(), 0, 'original slot returns control to toolbar');
  checks.push('drag into original slot returns control to toolbar');
  console.log(JSON.stringify({ checks, errors }, null, 2));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: shot('qa') });
} catch (error) {
  await page.screenshot({ path: shot('failure') });
  console.error((await page.locator('body').innerText()).slice(-3500));
  console.error('PAGE ERRORS', errors);
  throw error;
} finally { await browser.close(); }
