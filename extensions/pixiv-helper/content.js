(() => {
  if (window !== window.top) return;
  const channel = 'uku-pixiv-helper-v1';
  const actions = new Set(['status', 'login', 'logout', 'novel']);
  const mark = () => {
    if (!document.head) return false;
    const marker = document.createElement('meta');
    marker.name = 'uku-pixiv-helper';
    marker.content = '1';
    document.head.appendChild(marker);
    window.dispatchEvent(new Event('uku-pixiv-account-change'));
    return true;
  };
  if (!mark()) {
    const observer = new MutationObserver(() => { if (mark()) observer.disconnect(); });
    observer.observe(document, { childList: true, subtree: true });
  }
  window.addEventListener('message', event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || !request ||
        request.channel !== channel || request.direction !== 'request' ||
        typeof request.id !== 'string' || request.id.length > 100 || !actions.has(request.action)) return;
    chrome.runtime.sendMessage({ action: request.action, novelId: request.novelId }).then(
      result => window.postMessage({ channel, direction: 'response', id: request.id, result }, location.origin),
      () => window.postMessage({ channel, direction: 'response', id: request.id, result: { ok: false, error: 'PIXIV_HELPER_FAILED' } }, location.origin),
    );
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.accountChanged) window.dispatchEvent(new Event('uku-pixiv-account-change'));
  });
})();
