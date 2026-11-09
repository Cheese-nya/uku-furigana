import json
from http.cookies import SimpleCookie
import sys
import types
import tempfile
import threading
import urllib.request
import unittest
from unittest.mock import patch

sys.modules.setdefault('webview', types.ModuleType('webview'))
from desktop_pixiv import DesktopPixivSession, NoRedirect


class Event:
    def __init__(self): self.handlers = []
    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self


class Window:
    def __init__(self):
        self.events = types.SimpleNamespace(closing=Event(), loaded=Event())
        self.cookies = []
        self.hidden = True
        self.url = ''
    def get_cookies(self): return self.cookies
    def clear_cookies(self): self.cookies = []
    def hide(self): self.hidden = True
    def show(self): self.hidden = False
    def load_url(self, url): self.url = url
    def load_html(self, html): self.url = 'about:blank'
    def destroy(self): pass


def cookie(domain, value='12345_test-local-session'):
    result = SimpleCookie()
    result['PHPSESSID'] = value
    result['PHPSESSID']['domain'] = domain
    result['PHPSESSID']['path'] = '/'
    return result


class DesktopPixivTest(unittest.TestCase):
    def test_local_server_routes_the_import_to_the_native_session_without_cors_exposure(self):
        import desktop_runner
        from http.server import ThreadingHTTPServer
        servers = []
        calls = []
        def factory(address, handler):
            server = ThreadingHTTPServer(address, handler)
            servers.append(server)
            return server
        session = types.SimpleNamespace(novel=lambda novel_id: (calls.append(novel_id) or 200, {'error': False, 'body': {'content': '本文'}}))
        ready = threading.Event()
        with tempfile.TemporaryDirectory() as directory, patch.object(desktop_runner, 'ThreadingHTTPServer', side_effect=factory):
            thread = threading.Thread(target=desktop_runner.start_http_server, args=(directory, 0, ready, session), daemon=True)
            thread.start()
            self.assertTrue(ready.wait(timeout=3))
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{servers[0].server_port}/api/pixiv-ajax?id=14910277', timeout=3) as response:
                    self.assertEqual(json.load(response)['body']['content'], '本文')
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))
                self.assertEqual(calls, ['14910277'])
            finally:
                servers[0].shutdown()
                servers[0].server_close()
                thread.join(timeout=3)

    def test_login_window_has_no_application_api_and_status_returns_no_cookie(self):
        session = DesktopPixivSession()
        window = Window()
        with patch('webview.create_window', create=True, return_value=window) as create:
            session.create_window()
            self.assertNotIn('js_api', create.call_args.kwargs)
            self.assertTrue(create.call_args.kwargs['hidden'])
            self.assertEqual(session.login(), {'supported': True, 'loggedIn': False})
            self.assertEqual(create.call_count, 1)
            self.assertIn('accounts.pixiv.net/login', window.url)
            self.assertFalse(window.hidden)
            window.cookies = [cookie('.pixiv.net')]
            self.assertEqual(session.status(), {'supported': True, 'loggedIn': True})
            self.assertFalse(session._hide_on_close())
            self.assertTrue(window.hidden)
            self.assertTrue(session.status()['loggedIn'])
            self.assertEqual(session.logout(), {'supported': True, 'loggedIn': False})
            self.assertFalse(session.status()['loggedIn'])

    def test_foreign_or_guest_cookie_does_not_claim_a_pixiv_account(self):
        session = DesktopPixivSession()
        session._window = Window()
        for cookies in ([cookie('evilpixiv.net')], [cookie('.pixiv.net', 'guest')], [cookie('.pixiv.net.evil.test')]):
            session._window.cookies = cookies
            self.assertFalse(session.status()['loggedIn'])

    def test_import_sends_local_session_only_to_fixed_pixiv_endpoint_without_redirects(self):
        session = DesktopPixivSession()
        session._window = Window()
        session._window.cookies = [cookie('.pixiv.net'), cookie('other.example', 'foreign')]
        payload = {'error': False, 'body': {'content': 'ログイン済み本文', 'isLoginOnly': True}}
        response = types.SimpleNamespace(read=lambda n: json.dumps(payload).encode())
        class Opener:
            def open(self, request, timeout):
                self.request = request
                self.timeout = timeout
                return self
            def __enter__(self): return response
            def __exit__(self, *args): pass
        opener = Opener()
        with patch('urllib.request.build_opener', return_value=opener) as build:
            self.assertEqual(session.novel('14910277'), (200, payload))
            self.assertIsInstance(build.call_args.args[0], NoRedirect)
        self.assertEqual(opener.request.full_url, 'https://www.pixiv.net/ajax/novel/14910277')
        self.assertEqual(opener.request.get_header('Cookie'), 'PHPSESSID=12345_test-local-session')
        self.assertEqual(NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.test'), None)
        with patch('urllib.request.build_opener') as build:
            self.assertEqual(session.novel('https://evil.test')[0], 400)
            build.assert_not_called()

    def test_transport_failure_does_not_expose_cookie_in_error(self):
        session = DesktopPixivSession()
        session._window = Window()
        session._window.get_cookies = lambda: (_ for _ in ()).throw(ValueError('PHPSESSID=secret'))
        self.assertNotIn('secret', json.dumps(session.status()))
        self.assertNotIn('secret', json.dumps(session.novel('14910277')))


if __name__ == '__main__': unittest.main()
