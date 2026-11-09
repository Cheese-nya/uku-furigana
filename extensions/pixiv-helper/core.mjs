const PIXIV = 'https://www.pixiv.net/';
const LOGIN = 'https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F';
const trusted = new Set(['https://uku.saiaino.xyz', 'https://cloud.saiaino.xyz', 'http://localhost', 'http://127.0.0.1']);
const fail = code => { throw new Error(code); };

export function trustedSender(sender) {
  try {
    const url = new URL(sender.url || sender.tab?.url);
    return sender.frameId === 0 && trusted.has(`${url.protocol}//${url.hostname}`) &&
      (!['uku.saiaino.xyz', 'cloud.saiaino.xyz'].includes(url.hostname) || !url.port);
  } catch { return false; }
}

function waitForTab(api, id) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); api.tabs.onUpdated.removeListener(updated); };
    const updated = (tabId, info) => { if (tabId === id && info.status === 'complete') { cleanup(); resolve(); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error('PIXIV_NETWORK_ERROR')); }, 10_000);
    api.tabs.onUpdated.addListener(updated);
    api.tabs.get(id).then(tab => { if (tab.status === 'complete') { cleanup(); resolve(); } }, () => { cleanup(); reject(new Error('PIXIV_NETWORK_ERROR')); });
  });
}

/** Same-origin fallback also works when browser settings block extension third-party cookies. */
async function readInPixivTab(api, novelId) {
  const existing = await api.tabs.query({ url: 'https://www.pixiv.net/*' });
  const created = existing.length === 0;
  const tab = existing[0] || await api.tabs.create({ url: PIXIV, active: false });
  try {
    await waitForTab(api, tab.id);
    const results = await api.scripting.executeScript({
      target: { tabId: tab.id },
      args: [novelId],
      func: async id => {
        if (location.origin !== 'https://www.pixiv.net') throw new Error('PIXIV_NETWORK_ERROR');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
          const res = await fetch(`/ajax/novel/${id}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, redirect: 'error' });
          return { status: res.status, data: await res.json() };
        } finally { clearTimeout(timer); }
      },
    });
    if (!results[0]?.result) fail('PIXIV_NETWORK_ERROR');
    return results[0].result;
  } finally {
    if (created) await api.tabs.remove(tab.id).catch(() => {});
  }
}

/** Return only the fields required for import, never cookies or arbitrary upstream JSON. */
export function novelPayload(response) {
  const data = response?.data;
  const body = data?.body;
  if (!response || response.status < 200 || response.status >= 300 || data?.error !== false || !body) fail('PIXIV_WORK_UNAVAILABLE');
  const text = key => typeof body[key] === 'string' ? body[key] : '';
  if (!text('content').trim()) fail(body.isLoginOnly ? 'PIXIV_LOGIN_REQUIRED' : 'PIXIV_EMPTY_CONTENT');
  return { title: text('title'), userName: text('userName'), description: text('description'), content: text('content'), coverUrl: text('coverUrl'), isLoginOnly: body.isLoginOnly === true };
}

export function createPixivHandler(api, fetcher = fetch) {
  const status = async () => {
    const cookie = await api.cookies.get({ url: PIXIV, name: 'PHPSESSID' });
    return { supported: true, loggedIn: !!cookie && /^[1-9]\d*_[^;\s]+$/.test(cookie.value) };
  };
  let imports = 0;
  return async (message, sender) => {
    if (!trustedSender(sender)) return { ok: false, error: 'PIXIV_HELPER_FORBIDDEN' };
    try {
      switch (message?.action) {
        case 'status': return { ok: true, data: await status() };
        case 'login':
          await api.tabs.create({ url: LOGIN, active: true });
          return { ok: true, data: await status() };
        case 'logout': {
          const cookies = await api.cookies.getAll({ domain: 'pixiv.net' });
          await Promise.all(cookies.filter(cookie => {
            const domain = cookie.domain.replace(/^\./, '');
            return domain === 'pixiv.net' || domain.endsWith('.pixiv.net');
          }).map(cookie => api.cookies.remove({
            url: `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`, name: cookie.name, storeId: cookie.storeId,
            ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
          })));
          return { ok: true, data: await status() };
        }
        case 'novel': {
          if (typeof message.novelId !== 'string' || !/^\d{4,15}$/.test(message.novelId)) fail('PIXIV_INVALID_ID');
          if (imports >= 2) fail('PIXIV_HELPER_BUSY');
          imports++;
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10_000);
            let response;
            try {
              const res = await fetcher(`${PIXIV}ajax/novel/${message.novelId}`, { credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal });
              response = { status: res.status, data: await res.json() };
            } catch { /* Browser privacy settings may require an actual same-origin Pixiv tab. */ }
            finally { clearTimeout(timer); }
            if (!response?.data?.body?.content?.trim()) response = await readInPixivTab(api, message.novelId);
            return { ok: true, data: novelPayload(response) };
          } finally { imports--; }
        }
        default: fail('PIXIV_HELPER_FORBIDDEN');
      }
    } catch (error) {
      const code = error instanceof Error && /^PIXIV_[A-Z_]+$/.test(error.message) ? error.message : 'PIXIV_NETWORK_ERROR';
      return { ok: false, error: code };
    }
  };
}
