// Uses an actual unpacked Chromium MV3 extension and a local HTTPS Pixiv fixture.
// All cookies are synthetic; no real Pixiv account or remote Pixiv request is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd(), output = path.join(root, 'tests/.tmp/pixiv-browser-helper');
await mkdir(output, { recursive: true });
const temp = await mkdtemp(path.join(tmpdir(), 'uku-browser-helper-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(temp, 'key.pem'), '-out', path.join(temp, 'cert.pem'), '-days', '1', '-subj', '/CN=www.pixiv.net'], { stdio: 'ignore' });
let cookieRequests = 0, sameOriginReads = 0, forceSameOrigin = false;
const server = createServer({ key: await readFile(path.join(temp, 'key.pem')), cert: await readFile(path.join(temp, 'cert.pem')) }, (req, res) => {
  const url = new URL(req.url, 'https://www.pixiv.net');
  const hasCookie = req.headers.cookie?.includes('PHPSESSID=12345_test_browser_session') === true;
  if (hasCookie) cookieRequests++;
  if (url.pathname.startsWith('/ajax/novel/')) {
    const sameOrigin = req.headers['sec-fetch-site'] === 'same-origin';
    if (sameOrigin) sameOriginReads++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: false, body: { title: '浏览器登录作品 QA', userName: 'QA', description: '<b>测试说明</b>', content: hasCookie && (!forceSameOrigin || sameOrigin) ? '[[rb:漢字 > かんじ]]の本文' : '', isLoginOnly: true, coverUrl: '' } }));
  } else if (url.pathname === '/qa-login') {
    res.setHeader('Set-Cookie', 'PHPSESSID=12345_test_browser_session; Domain=.pixiv.net; Path=/; Secure; HttpOnly; SameSite=Strict');
    res.end('<!doctype html><p>Signed in to fixture. Close this tab.</p>');
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Pixiv fixture login</title><form action="https://www.pixiv.net/qa-login"><button>Sign in fixture</button></form>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const extension = path.join(root, 'extensions/pixiv-helper');
const context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
  headless: true, channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE,
  viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-proxy-server', '--ignore-certificate-errors', `--host-resolver-rules=MAP *.pixiv.net 127.0.0.1:${port}`],
});
const settle = locator => locator.evaluate(async element => {
  await new Promise(resolve => requestAnimationFrame(resolve));
  await Promise.all(element.closest('.modal-sheet').getAnimations().map(a => a.finished.catch(() => {})));
});
async function account(page) {
  if ((await page.viewportSize()).width < 768) await page.getByRole('tab', { name: /^(工作台|Studio)$/ }).filter({ visible: true }).click();
  await page.getByRole('button', { name: /^(设置|Settings)$/ }).filter({ visible: true }).click();
  await page.getByRole('button', { name: /^(Pixiv 账号|Pixiv account)$/ }).click();
  return page.getByTestId('pixiv-account-sheet');
}
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert(worker.url().startsWith('chrome-extension://'));
  let anonymousAppRequests = 0;
  await context.route('**/api/pixiv?*', route => { anonymousAppRequests++; return route.abort(); });
  await context.route('https://**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname.endsWith('.pixiv.net') ? route.continue() : route.abort();
  });
  await context.addInitScript(() => { if (!localStorage.getItem('furigana_locale')) localStorage.setItem('furigana_locale', 'en'); });
  const page = await context.newPage();
  await page.goto(process.env.PIXIV_QA_URL || 'http://127.0.0.1:3010');
  await page.waitForFunction(() => !!document.querySelector('meta[name="uku-pixiv-helper"]'));
  let sheet = await account(page);
  await sheet.getByRole('status').getByText('Not signed in', { exact: true }).waitFor();
  await settle(sheet);
  await page.screenshot({ path: path.join(output, 'connected-signed-out-1440.png') });
  const opened = context.waitForEvent('page');
  await page.getByTestId('pixiv-account-login').click();
  const login = await opened;
  await login.waitForLoadState();
  assert.equal(new URL(login.url()).hostname, 'accounts.pixiv.net');
  await login.getByRole('button', { name: 'Sign in fixture' }).click();
  await login.waitForURL(url => url.hostname === 'www.pixiv.net' && url.pathname === '/qa-login');
  await login.close();
  await page.bringToFront();
  await sheet.getByRole('status').getByText('Session saved', { exact: true }).waitFor();
  assert(!(await page.evaluate(() => document.cookie)).includes('test_browser_session'));
  await page.screenshot({ path: path.join(output, 'connected-signed-in-1440.png') });
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: /^Script Library/ }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByTestId('pixiv-import-toggle-btn').click();
  await page.getByTestId('pixiv-url-input').fill('14910277');
  forceSameOrigin = true;
  await page.getByTestId('pixiv-import-submit-btn').click();
  await page.getByText('浏览器登录作品 QA', { exact: true }).first().waitFor();
  await page.waitForFunction(() => {
    const database = JSON.parse(localStorage.getItem('furigana-library-v1') || '{}');
    return Object.values(database.books || {}).some(book => book.title === '浏览器登录作品 QA' && book.content === '漢字(かんじ)の本文');
  });
  assert(cookieRequests > 0, 'real browser must send the synthetic HttpOnly session');
  assert(sameOriginReads > 0, 'same-origin fallback must run when extension requests return empty content');
  assert.equal(anonymousAppRequests, 0);
  await page.screenshot({ path: path.join(output, 'imported-1440.png') });
  sheet = await account(page);
  await page.getByTestId('pixiv-account-logout').click();
  await sheet.getByRole('status').getByText('Not signed in', { exact: true }).waitFor();
  assert.equal((await context.cookies('https://www.pixiv.net/')).some(c => c.name === 'PHPSESSID'), false);
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });
  await page.evaluate(() => localStorage.setItem('furigana_locale', 'zh-CN'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  sheet = await account(page);
  await sheet.getByRole('status').getByText('未登录', { exact: true }).waitFor();
  await settle(sheet);
  await page.screenshot({ path: path.join(output, 'connected-390.png') });
  // Removing the readiness marker exercises the real disconnected/download UI.
  await page.evaluate(() => { document.querySelector('meta[name="uku-pixiv-helper"]').remove(); window.dispatchEvent(new Event('uku-pixiv-account-change')); });
  await sheet.getByRole('status').getByText('助手未连接', { exact: true }).waitFor();
  const downloadEvent = page.waitForEvent('download');
  await sheet.getByRole('link', { name: '下载 Pixiv 浏览器助手' }).click();
  const download = await downloadEvent;
  await download.saveAs(path.join(output, 'downloaded-helper.zip'));
  await page.screenshot({ path: path.join(output, 'install-390.png') });
  assert.equal(await sheet.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ pass: true, realExtension: true, syntheticHttpOnlyCookieSent: cookieRequests > 0, sameOriginFallback: sameOriginReads > 0, noAnonymousServerRequest: anonymousAppRequests === 0, bookContentPersisted: true, loginTab: true, logoutClearedCookie: true, download: download.suggestedFilename(), viewports: ['390x844', '1440x900'], realAccountUsed: false }, null, 2));
  console.log(await readFile(path.join(output, 'report.json'), 'utf8'));
} finally { await context.close(); await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); }
