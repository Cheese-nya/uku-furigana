"""Pixiv's official login window and device-local session, separate from the app JS API."""
import json
import re
import threading
import urllib.error
import urllib.request

LOGIN_URL = 'https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F'
PIXIV_ORIGIN = 'https://www.pixiv.net/'
PIXIV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class DesktopPixivSession:
    def __init__(self, changed=lambda: None):
        self._window = None
        self._changed = changed
        self._closing = False
        self._lock = threading.Lock()

    def create_window(self, hidden=True):
        import webview
        with self._lock:
            if self._window is None:
                # No js_api: remote Pixiv pages must never get the application's native API.
                self._window = webview.create_window('Pixiv — 关闭窗口返回 / Close to return',
                                                     PIXIV_ORIGIN, width=520, height=760, hidden=hidden)
                self._window.events.closing += self._hide_on_close
                self._window.events.loaded += self._changed
        return self._window

    def _hide_on_close(self):
        if self._closing:
            return True
        self._window.hide()
        self._changed()
        return False

    def close(self):
        self._closing = True
        if self._window is not None:
            self._window.destroy()

    def _cookie_header(self):
        if self._window is None:
            return ''
        pairs = []
        for cookie in self._window.get_cookies():
            for name, morsel in cookie.items():
                domain = morsel['domain'].lstrip('.').lower()
                if domain not in ('pixiv.net', 'www.pixiv.net'):
                    continue
                if any(char in morsel.value for char in ('\r', '\n', ';')):
                    continue
                pairs.append(f'{name}={morsel.value}')
        return '; '.join(pairs)

    def status(self):
        try:
            saved = bool(re.search(r'(?:^|;\s*)PHPSESSID=[1-9][0-9]*_[^;\s]+', self._cookie_header()))
            return {'supported': True, 'loggedIn': saved}
        except Exception:
            return {'supported': True, 'loggedIn': False, 'error': '无法读取 Pixiv 登录状态，请重试'}

    def login(self):
        window = self.create_window(hidden=False)
        window.load_url(LOGIN_URL)
        window.show()
        return self.status()

    def logout(self):
        try:
            if self._window is not None:
                self._window.clear_cookies()
                # Stop a page from continuing an in-flight sign-in after logout.
                self._window.load_html('<!doctype html><title>Pixiv</title>')
                self._window.hide()
            self._changed()
            return {'supported': True, 'loggedIn': False}
        except Exception:
            return {'supported': True, 'loggedIn': False, 'error': '无法退出 Pixiv，请重试'}

    def novel(self, novel_id):
        if not isinstance(novel_id, str) or not re.fullmatch(r'\d{4,15}', novel_id):
            return 400, {'error': True, 'message': 'Invalid Pixiv ID'}
        try:
            headers = {'User-Agent': PIXIV_UA, 'Referer': PIXIV_ORIGIN, 'Accept': 'application/json'}
            cookies = self._cookie_header()
            if cookies:
                headers['Cookie'] = cookies
            request = urllib.request.Request(f'{PIXIV_ORIGIN}ajax/novel/{novel_id}', headers=headers)
            # The Cookie header cannot follow a redirect onto a different host.
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise ValueError('response too large')
            return 200, json.loads(raw.decode('utf-8'))
        except urllib.error.HTTPError as error:
            return 502, {'error': True, 'message': f'Pixiv 请求失败 (HTTP {error.code})'}
        except Exception:
            return 502, {'error': True, 'message': '无法连接 Pixiv，请检查本机网络后重试'}
