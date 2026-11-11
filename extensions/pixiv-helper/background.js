import { createPixivHandler } from './core.mjs';

const handle = createPixivHandler(chrome);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  handle(message, sender).then(reply, () => reply({ ok: false, error: 'PIXIV_HELPER_FAILED' }));
  return true;
});

// A human login can outlive the service worker. Query matching tabs on each
// cookie event instead of keeping a subscription list only in worker memory.
chrome.cookies.onChanged.addListener(({ cookie }) => {
  const domain = cookie.domain.replace(/^\./, '');
  if (cookie.name !== 'PHPSESSID' || !(domain === 'pixiv.net' || domain.endsWith('.pixiv.net'))) return;
  const matches = chrome.runtime.getManifest().content_scripts[0].matches;
  chrome.tabs.query({ url: matches }).then(tabs => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { accountChanged: true }).catch(() => {});
  }).catch(() => {});
});
