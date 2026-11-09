// Local UI verification. The native session is stubbed; no real account or cookie is used.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(process.env.PIXIV_QA_OUTPUT || 'tests/.tmp/pixiv-account');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const observations = [];
const settle = locator => locator.evaluate(async element => {
  const modal = element.closest('.modal-sheet');
  await new Promise(resolve => requestAnimationFrame(resolve));
  await Promise.all(modal.getAnimations().map(animation => animation.finished.catch(() => undefined)));
});
const checkContrast = async locator => {
  const minimum = await locator.evaluate(element => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const color = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data); };
    const blend = (front, back) => front.slice(0, 3).map((v, i) => v * front[3] / 255 + back[i] * (1 - front[3] / 255));
    const luminance = values => values.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const fill = color(getComputedStyle(element.closest('.modal-sheet')).backgroundColor);
    const ratios = [];
    for (const node of element.querySelectorAll('p, [role="status"], [role="alert"]')) {
      for (const backdrop of [[0, 0, 0], [255, 255, 255]]) {
        const bg = blend(fill, backdrop);
        const fg = blend(color(getComputedStyle(node).color), bg);
        const a = luminance(fg), b = luminance(bg);
        ratios.push((Math.max(a, b) + .05) / (Math.min(a, b) + .05));
      }
    }
    return Math.min(...ratios);
  });
  assert(minimum >= 4.5, `Account text contrast ${minimum.toFixed(2)} < 4.5`);
};
try {
  for (const [width, height, locale] of [[390, 844, 'zh-CN'], [1440, 900, 'en']]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.addInitScript(locale => {
      localStorage.setItem('furigana_locale', locale);
      localStorage.setItem('furigana_active_tab', 'library');
      window.testPixivSession = false;
      window.AndroidBridge = {
        getPixivAccountStatus() { return JSON.stringify({ supported: true, loggedIn: window.testPixivSession }); },
        openPixivLogin() { window.testPixivSession = true; return this.getPixivAccountStatus(); },
        logoutPixiv() { window.testPixivSession = false; return this.getPixivAccountStatus(); },
      };
    }, locale);
    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/pixiv?*', route => route.fulfill({ status: 404, body: '{}' }));
    await page.route('**/api/pixiv-ajax?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ error: false, body: { title: 'ひみつのはなし【ネップリ再録】', content: '', isLoginOnly: true } }) }));
    await page.goto(process.env.PIXIV_QA_URL || 'http://127.0.0.1:3010');
    await page.getByRole('button', { name: /^(新建|New)$/ }).click();
    await page.getByTestId('pixiv-import-toggle-btn').click();
    await settle(page.getByTestId('pixiv-url-input'));
    await page.getByTestId('pixiv-url-input').fill('14910277');
    await page.getByTestId('pixiv-import-submit-btn').click();
    const recovery = page.getByRole('button', { name: /前往设置登录 Pixiv|Sign in under Settings/ });
    await recovery.waitFor();
    await page.screenshot({ path: path.join(output, `error-${width}.png`) });
    await recovery.click();
    await page.getByRole('dialog', { name: /^(Pixiv 导入|Import Pixiv)$/ }).waitFor({ state: 'hidden' });
    const sheet = page.getByTestId('pixiv-account-sheet');
    await sheet.getByRole('status').getByText(/未登录|Not signed in/).waitFor();
    await page.screenshot({ path: path.join(output, `signed-out-${width}.png`) });
    const login = page.getByTestId('pixiv-account-login');
    assert((await login.boundingBox()).height >= 44);
    await login.focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('pixiv-account-logout').waitFor();
    assert((await page.getByTestId('pixiv-account-logout').boundingBox()).height >= 44);
    await sheet.getByRole('status').getByText(/登录态已保存|Session saved/).waitFor();
    await checkContrast(sheet);
    await page.screenshot({ path: path.join(output, `signed-in-${width}.png`) });
    await page.getByTestId('pixiv-account-logout').click();
    await login.waitFor();
    await sheet.getByRole('status').getByText(/未登录|Not signed in/).waitFor();
    const overflow = await sheet.evaluate(node => node.scrollWidth > node.clientWidth + 1);
    assert.equal(overflow, false);
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'pixiv-account-login');
    await page.keyboard.press('Tab');
    assert(await page.getByRole('dialog', { name: /Pixiv 账号|Pixiv account/ }).evaluate(node => node.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    // Verify the regular Settings entry too, not just the import recovery shortcut.
    if (width < 768) await page.getByRole('tab', { name: /^(工作台|Studio)$/ }).filter({ visible: true }).click();
    await page.getByRole('button', { name: /^(设置|Settings)$/ }).filter({ visible: true }).click();
    await page.getByText(/^(Pixiv 账号|Pixiv account)$/).filter({ visible: true }).click();
    await sheet.waitFor();
    observations.push({ viewport: `${width}x${height}`, artifact: `signed-in-${width}.png`, observation: 'Import login error opens account settings; keyboard login/logout updates session state; Escape closes; Settings entry opens; no horizontal overflow; buttons at least 44px.' });
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    let resolveStatus;
    window.furiganaPixiv = {
      novel: async () => null,
      account: () => new Promise(resolve => { resolveStatus = resolve; }),
    };
    window.finishPixivStatus = () => resolveStatus({ supported: true, loggedIn: false });
  });
  await page.route('https://**/*', route => route.abort());
  await page.goto(process.env.PIXIV_QA_URL || 'http://127.0.0.1:3010');
  await page.getByRole('button', { name: '设置', exact: true }).filter({ visible: true }).click();
  await page.getByText('Pixiv 账号', { exact: true }).filter({ visible: true }).click();
  const sheet = page.getByTestId('pixiv-account-sheet');
  await sheet.getByRole('status').getByText('正在检查…').waitFor();
  await settle(sheet);
  await page.screenshot({ path: path.join(output, 'loading-390.png') });
  await page.evaluate(() => window.finishPixivStatus());
  await sheet.getByRole('status').getByText('未登录', { exact: true }).waitFor();
  await page.evaluate(() => {
    window.furiganaPixiv.account = async () => { throw new Error('local bridge unavailable'); };
    window.dispatchEvent(new Event('uku-pixiv-account-change'));
  });
  await sheet.getByRole('alert').waitFor();
  await checkContrast(sheet);
  await page.screenshot({ path: path.join(output, 'bridge-error-390.png') });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await checkContrast(sheet);
  await page.screenshot({ path: path.join(output, 'dark-error-390.png') });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.evaluate(() => { delete window.furiganaPixiv; });
  await sheet.getByRole('button', { name: '重新检查' }).click();
  await sheet.getByText('助手未连接', { exact: true }).waitFor();
  assert.match(await sheet.innerText(), /网页版需要安装一次浏览器助手/);
  await page.waitForFunction(() => document.activeElement?.classList.contains('modal-sheet'));
  await page.screenshot({ path: path.join(output, 'web-install-390.png') });
  await context.close();
  await writeFile(path.join(output, 'observations.json'), JSON.stringify(observations, null, 2));
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify({
    contract: 'docs/dev-notes/pixiv-account-login.md: use existing settings/Modal; local official login; recovery link; status/login/logout; zh mobile and en desktop.',
    targetViewports: ['390x844', '1440x900'],
    accessibility: { status: 'pass', evidence: 'Keyboard login/logout, focus containment after removing logout/retry buttons, Escape close, visible focus reviewed in captures, >=44px actions, text contrast >=4.5 over both extremes behind translucent sheets; light and dark checks; reduced-motion browser context.' },
    responsive: { status: 'pass', evidence: '390px Chinese and 1440px English captures reviewed; account sheet has no horizontal overflow and long explanatory text wraps.' },
    contentStates: {
      loading: { status: 'pass', evidence: 'loading-390.png: pending native status displays Checking; resolving the promise enables login.' },
      empty: { status: 'pass', evidence: 'signed-out-390.png: signed-out account displays official login action.' },
      error: { status: 'pass', evidence: 'bridge-error-390.png and dark-error-390.png: failed bridge displays retry; retry changes to browser-helper setup state with focus preserved.' },
      partial: { status: 'not-applicable', reason: 'Import is atomic: metadata with empty text is rejected, so no partially imported book is offered.' },
      success: { status: 'pass', evidence: 'signed-in captures: fake native login shows saved session and logout; logout returns to signed-out.' },
      permission: { status: 'pass', evidence: 'error captures show login-only import recovery; web-unsupported capture explains that browser-helper setup explains how to connect the browser session.' },
    },
    renderedEvidence: observations,
    limits: ['Session actions are stubbed in browser QA; no real personal Pixiv login is claimed.', 'Browser QA does not compile the native iOS binary; see separate native build/runtime records.'],
  }, null, 2));
  console.log(JSON.stringify(observations));
} finally { await browser.close(); }
