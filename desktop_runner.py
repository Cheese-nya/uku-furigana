"""
Uku Furigana (浮く) - Native Standalone Windows Desktop Launcher
Bundles static Next.js export with built-in HTTP server & PyWebView Window mode.
"""

import sys
import ntpath
import os
import re
import time
import socket
import hashlib
import logging
import subprocess
import threading
import urllib.request
import json
from logging.handlers import RotatingFileHandler
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, HTTPServer
import webview


# Version of the running build; the packaging script can override it.
APP_VERSION = os.environ.get('UKU_APP_VERSION', '').strip() or 'unknown'

LOG_FORMAT = '%(asctime)s %(levelname)s %(name)s: %(message)s'
LOG_FILENAME = 'uku.log'
LOG_MAX_BYTES = 512 * 1024
LOG_BACKUP_COUNT = 2
LOG_TAIL_BYTES = 64 * 1024

UPDATE_VERSION_RE = re.compile(r'^\d+\.\d+\.\d+$')
SHA256_RE = re.compile(r'^[0-9a-f]{64}$')
UPDATE_FILENAME = 'UkuFurigana-v{version}.exe'
APPLY_SCRIPT_NAME = 'apply_update.bat'
CONNECT_TIMEOUT = 10
READ_TIMEOUT = 15
DOWNLOAD_CHUNK = 64 * 1024
APPLY_WAIT_SECONDS = 30


def log_file(data_dir):
    return Path(data_dir) / 'logs' / LOG_FILENAME


def setup_logging(data_dir, level=logging.INFO):
    """Send logs to <data_dir>/logs/uku.log, rotating at 512 KB with two backups."""
    path = log_file(data_dir)
    root = logging.getLogger()
    root.setLevel(level)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        print(f'Logging disabled, cannot create {path.parent}: {error}', file=sys.stderr)
        return None
    formatter = logging.Formatter(LOG_FORMAT)
    for handler in root.handlers:
        if isinstance(handler, RotatingFileHandler) and os.path.abspath(handler.baseFilename) == os.path.abspath(path):
            handler.setFormatter(formatter)
            return path
    try:
        handler = RotatingFileHandler(path, maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUP_COUNT, encoding='utf-8')
    except OSError as error:
        print(f'Logging disabled, cannot open {path}: {error}', file=sys.stderr)
        return None
    handler.setFormatter(formatter)
    root.addHandler(handler)
    return path


def install_exception_logging():
    """Record crashes in the log file instead of losing them with the window."""
    logger = logging.getLogger('uku.crash')

    def handle_uncaught(exc_type, exc_value, traceback):
        logger.critical('Uncaught exception', exc_info=(exc_type, exc_value, traceback))

    def handle_thread_exception(args):
        name = args.thread.name if args.thread is not None else 'unknown'
        logger.critical('Uncaught exception in thread %s', name, exc_info=(args.exc_type, args.exc_value, args.exc_traceback))

    sys.excepthook = handle_uncaught
    threading.excepthook = handle_thread_exception


def read_log_tail(path, limit=LOG_TAIL_BYTES):
    """Return the last `limit` bytes of the log as text; empty when unreadable."""
    try:
        with open(path, 'rb') as handle:
            handle.seek(0, os.SEEK_END)
            start = max(0, handle.tell() - limit)
            handle.seek(start)
            data = handle.read(limit)
    except (OSError, ValueError):
        return ''
    if start > 0:
        # Drop the partially captured first line.
        newline = data.find(b'\n')
        if newline >= 0:
            data = data[newline + 1:]
    return data.decode('utf-8', 'replace')


def cleanup_stale_backup(exe_path):
    """Remove the `.old` copy a previous self-update left next to the exe."""
    exe = Path(exe_path)
    backup = exe.parent / (exe.name + '.old')
    if not backup.is_file() or not exe.is_file():
        return False
    try:
        # A copy the previous run could not delete is only safe to remove once the
        # current exe is usable; a broken install keeps its backup.
        with open(exe, 'rb') as handle:
            if handle.read(2) != b'MZ':
                return False
        backup.unlink()
        return True
    except OSError:
        return False


def cleanup_update_dir(updates_dir):
    """Drop the helper script and half-finished downloads left by a previous run."""
    directory = Path(updates_dir)
    if not directory.is_dir():
        return
    leftovers = [directory / APPLY_SCRIPT_NAME, directory / 'apply_update.pid'] + sorted(directory.glob('*.exe.part'))
    for path in leftovers:
        try:
            path.unlink()
        except OSError:
            pass


def get_free_port():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def get_bundle_dir():
    if getattr(sys, 'frozen', False):
        # Running inside PyInstaller EXE bundle
        return os.path.join(sys._MEIPASS, 'out')
    else:
        # Running in regular Python dev environment
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')


def start_http_server(web_dir, port, ready_event):
    """Start HTTP server and signal when ready."""
    class QuietHandler(SimpleHTTPRequestHandler):
        # The Windows registry can map .js/.mjs to text/plain, and module workers (pdf.js) refuse
        # anything but a JavaScript type; the dictionary shards must arrive as plain bytes.
        extensions_map = {
            **SimpleHTTPRequestHandler.extensions_map,
            '.js': 'text/javascript',
            '.mjs': 'text/javascript',
            '.json': 'application/json',
            '.gz': 'application/octet-stream',
            '.wasm': 'application/wasm',
        }

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=web_dir, **kwargs)

        def log_message(self, format, *args):
            pass  # Suppress HTTP request logs

    server = HTTPServer(('127.0.0.1', port), QuietHandler)
    ready_event.set()  # Signal that server is bound and listening
    server.serve_forever()


def wait_for_server(port, timeout=10):
    """Block until the HTTP server responds on the given port."""
    url = f"http://127.0.0.1:{port}/"
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = urllib.request.urlopen(url, timeout=2)
            if resp.status == 200:
                return True
        except Exception:
            pass
        time.sleep(0.2)
    return False


import base64

# Library data versions the frontend reads (app/utils/libraryDatabase.ts); it migrates 1 and writes 2.
LIBRARY_VERSIONS = (1, 2)


def default_data_dir(base=None):
    base = Path(base) if base else Path(os.environ.get('LOCALAPPDATA') or Path.home() / '.local' / 'share')
    root = base / 'UkuFurigana'
    # Carry over data saved before the app was renamed from Furigana Dubbing Studio.
    legacy = base / 'FuriganaDubbingStudio'
    if not root.exists() and legacy.is_dir():
        try:
            legacy.rename(root)
        except OSError:
            return legacy
    return root


def _is_https_url(value):
    if not isinstance(value, str) or any(ch.isspace() for ch in value):
        return False
    if value.startswith('https://') and len(value) > len('https://'):
        return True
    # Test setup only: UKU_UPDATE_TEST_HOST=<host:port> lets the VM fetch from the host's fake release server.
    test_host = os.environ.get('UKU_UPDATE_TEST_HOST', '').strip()
    return bool(test_host) and value.startswith(f'http://{test_host}/')


def validate_update_args(args):
    """Normalise the JS download request or raise ValueError with a short error code."""
    if isinstance(args, str):
        # pywebview normally hands over an object, but accept a JSON string too.
        try:
            args = json.loads(args)
        except ValueError:
            raise ValueError('invalid-args') from None
    if not isinstance(args, dict):
        raise ValueError('invalid-args')
    version = args.get('version')
    if not isinstance(version, str) or not UPDATE_VERSION_RE.match(version):
        raise ValueError('invalid-version')
    url = args.get('url')
    if not _is_https_url(url):
        raise ValueError('invalid-url')
    mirror = args.get('mirrorUrl')
    if mirror in (None, ''):
        mirror = None
    elif not _is_https_url(mirror):
        raise ValueError('invalid-mirror-url')
    sha256 = args.get('sha256')
    if not isinstance(sha256, str) or not SHA256_RE.match(sha256):
        raise ValueError('invalid-sha256')
    size = args.get('size')
    # JS numbers arrive as int or float depending on how they were produced.
    if isinstance(size, float) and size.is_integer():
        size = int(size)
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
        raise ValueError('invalid-size')
    return {'version': version, 'url': url, 'mirrorUrl': mirror, 'sha256': sha256, 'size': size}


class UpdateCancelled(Exception):
    pass


def http_download(url, destination, on_progress, is_cancelled):
    """Stream `url` into `destination`, reporting byte counts; raise on failure."""
    request = urllib.request.Request(url, headers={'User-Agent': f'UkuFurigana/{APP_VERSION}'})
    # The connect timeout doubles as the socket timeout, so raise it afterwards and
    # give reads 15 s: a mirror that stops sending is abandoned instead of hanging.
    with urllib.request.urlopen(request, timeout=CONNECT_TIMEOUT) as response:
        _set_read_timeout(response, READ_TIMEOUT)
        with open(destination, 'wb') as handle:
            while True:
                if is_cancelled():
                    raise UpdateCancelled()
                chunk = response.read(DOWNLOAD_CHUNK)
                if not chunk:
                    break
                handle.write(chunk)
                on_progress(len(chunk))


def _set_read_timeout(response, seconds):
    try:
        stream = getattr(response, 'fp', None)
        socket_holder = getattr(stream, '_sock', None)
        if socket_holder is None:
            socket_holder = getattr(getattr(stream, 'raw', None), '_sock', None)
        if socket_holder is not None:
            socket_holder.settimeout(seconds)
    except Exception:
        pass


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(DOWNLOAD_CHUNK), b''):
            digest.update(chunk)
    return digest.hexdigest()


def has_mz_header(path):
    with open(path, 'rb') as handle:
        return handle.read(2) == b'MZ'


def _bat_quote(path):
    return '"' + str(path).replace('%', '%%') + '"'


def relaunch_environment(environ=None):
    """Environment for the helper that restarts this onefile exe.

    A PyInstaller onefile app passes its extraction directory to the process it spawns through
    _MEIPASS2 / _PYI_* variables. A new instance that inherits them looks for DLLs in the old
    directory, which is gone by then ("Unable to load DLL 'WebView2Loader.dll'"), so strip them
    and ask the bootloader to start from a clean slate.
    """
    env = dict(os.environ if environ is None else environ)
    for key in [k for k in env if k == '_MEIPASS2' or k.startswith('_PYI_')]:
        del env[key]
    env['PYINSTALLER_RESET_ENVIRONMENT'] = '1'
    return env


def build_apply_script(pid, current_exe, new_exe):
    """Batch helper that swaps the exe once this process has exited.

    Only paths derived from sys.executable and the updates directory are
    interpolated; nothing here comes from the web page.

    The wait loop must not use a pipe (`tasklist | find`): the helper runs detached from a windowed
    app with no console, and a pipeline there aborts the whole script before it reaches the swap.
    """
    target = _bat_quote(current_exe)
    backup = _bat_quote(f'{current_exe}.old')
    package = _bat_quote(new_exe)
    pid_file = _bat_quote(ntpath.join(ntpath.dirname(str(new_exe)), 'apply_update.pid'))
    return '\r\n'.join([
        '@echo off',
        'setlocal',
        'set "TRIES=0"',
        ':wait',
        f'tasklist /NH /FI "PID eq {int(pid)}" > {pid_file} 2>nul',
        f'findstr /C:" {int(pid)} " {pid_file} >nul',
        'if errorlevel 1 goto swap',
        'set /a TRIES+=1',
        f'if %TRIES% GEQ {APPLY_WAIT_SECONDS} goto swap',
        # `timeout` fails without a console, so the detached helper sleeps with ping.
        'ping -n 2 127.0.0.1 >nul',
        'goto wait',
        ':swap',
        # Give the old WebView2 browser process time to exit: the new instance shares its user data
        # folder, and starting during that shutdown made the first page load fail.
        'ping -n 5 127.0.0.1 >nul',
        f'del /f /q {pid_file} >nul 2>&1',
        f'del /f /q {backup} >nul 2>&1',
        f'move /y {target} {backup} >nul 2>&1',
        'if errorlevel 1 goto relaunch_old',
        f'copy /y {package} {target} >nul 2>&1',
        'if errorlevel 1 goto rollback',
        f'start "" {target}',
        # The renamed old exe may still be loaded for a moment, so clean up after a short wait.
        'ping -n 5 127.0.0.1 >nul',
        f'del /f /q {package} >nul 2>&1',
        f'del /f /q {backup} >nul 2>&1',
        'del /f /q "%~f0" >nul 2>&1',
        'exit /b 0',
        ':rollback',
        f'move /y {backup} {target} >nul 2>&1',
        ':relaunch_old',
        f'if exist {target} start "" {target}',
        'del /f /q "%~f0" >nul 2>&1',
        'exit /b 1',
        '',
    ])


class UpdateDownloader:
    """One background download at a time, with hash and header verification."""

    def __init__(self, directory, fetch=None):
        self._directory = Path(directory)
        self._fetch = fetch or http_download
        self._lock = threading.Lock()
        self._state = {'phase': 'idle', 'progress': 0.0}
        self._thread = None
        self._cancel = threading.Event()
        self._logger = logging.getLogger('uku.update')

    def state(self):
        with self._lock:
            return dict(self._state)

    def package_path(self):
        with self._lock:
            version = self._state.get('version')
            ready = self._state.get('phase') == 'ready'
        if not ready or not version:
            return None
        return self._directory / UPDATE_FILENAME.format(version=version)

    def join(self, timeout=None):
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    def start(self, spec):
        version = spec['version']
        with self._lock:
            phase = self._state.get('phase')
            if self._state.get('version') == version and phase == 'ready':
                # Keep an already verified package instead of downloading it again.
                if (self._directory / UPDATE_FILENAME.format(version=version)).is_file():
                    return {'success': True}
            elif phase == 'downloading':
                if self._state.get('version') == version:
                    return {'success': True}
                return {'success': False, 'error': 'busy'}
        # A just-cancelled run may still be closing its part file; let it finish so two
        # threads never write the same file.
        running = self._thread
        if running is not None and running.is_alive() and running is not threading.current_thread():
            running.join(3.0)
            if running.is_alive():
                return {'success': False, 'error': 'busy'}
        with self._lock:
            if self._state.get('phase') == 'downloading':
                return {'success': False, 'error': 'busy'}
            self._cancel.clear()
            self._state = {'phase': 'downloading', 'progress': 0.0, 'version': version}
        try:
            self._directory.mkdir(parents=True, exist_ok=True)
            self._discard_other_versions(version)
        except OSError as error:
            self._fail(version, 'download-failed')
            self._logger.error('Cannot prepare update directory %s: %s', self._directory, error)
            return {'success': False, 'error': str(error)}
        self._logger.info('Downloading update %s', version)
        self._thread = threading.Thread(target=self._run, args=(spec,), name=f'update-{version}', daemon=True)
        self._thread.start()
        return {'success': True}

    def cancel(self):
        self._cancel.set()
        with self._lock:
            if self._state.get('phase') == 'downloading':
                self._state = {'phase': 'idle', 'progress': 0.0}
        return {'success': True}

    def _discard_other_versions(self, version):
        keep = UPDATE_FILENAME.format(version=version)
        for path in self._directory.iterdir():
            name = path.name
            if not name.startswith('UkuFurigana-v') or not (name.endswith('.exe') or name.endswith('.exe.part')):
                continue
            if name in (keep, keep + '.part'):
                continue
            try:
                path.unlink()
            except OSError:
                pass

    def _fail(self, version, error):
        with self._lock:
            self._state = {'phase': 'error', 'progress': 0.0, 'version': version, 'error': error}

    def _discard(self, path):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    def _run(self, spec):
        version = spec['version']
        final_path = self._directory / UPDATE_FILENAME.format(version=version)
        partial_path = final_path.with_name(final_path.name + '.part')
        total = spec['size']
        received = [0]

        def on_progress(count):
            received[0] += count
            with self._lock:
                if self._state.get('phase') == 'downloading':
                    self._state['progress'] = min(1.0, received[0] / total)

        urls = [spec['url']]
        if spec.get('mirrorUrl'):
            urls.append(spec['mirrorUrl'])
        failure = None
        for url in urls:
            if self._cancel.is_set():
                failure = None
                break
            received[0] = 0
            with self._lock:
                if self._state.get('phase') == 'downloading':
                    self._state['progress'] = 0.0
            try:
                self._fetch(url, partial_path, on_progress, self._cancel.is_set)
                failure = None
                break
            except UpdateCancelled:
                failure = 'cancelled'
                break
            except Exception as error:
                failure = 'download-failed'
                self._logger.warning('Update download failed (%s): %s', url, error)
                self._discard(partial_path)

        if failure == 'cancelled' or self._cancel.is_set():
            self._discard(partial_path)
            self._logger.info('Update download cancelled')
            with self._lock:
                if self._state.get('phase') == 'downloading':
                    self._state = {'phase': 'idle', 'progress': 0.0}
            return
        if failure is not None:
            self._discard(partial_path)
            self._logger.error('Update download failed for %s', version)
            self._fail(version, failure)
            return

        try:
            digest = file_sha256(partial_path)
        except OSError as error:
            self._discard(partial_path)
            self._logger.error('Cannot read downloaded update: %s', error)
            self._fail(version, 'download-failed')
            return
        if digest != spec['sha256']:
            self._discard(partial_path)
            self._logger.error('Update checksum mismatch for %s', version)
            self._fail(version, 'checksum-mismatch')
            return
        try:
            valid_package = has_mz_header(partial_path)
        except OSError:
            valid_package = False
        if not valid_package:
            self._discard(partial_path)
            self._logger.error('Update for %s is not a Windows executable', version)
            self._fail(version, 'invalid-package')
            return
        try:
            os.replace(partial_path, final_path)
        except OSError as error:
            self._discard(partial_path)
            self._logger.error('Cannot store update: %s', error)
            self._fail(version, 'download-failed')
            return
        with self._lock:
            self._state = {'phase': 'ready', 'progress': 1.0, 'version': version}
        self._logger.info('Update %s verified and ready at %s', version, final_path)


class Api:
    def __init__(self, data_dir=None):
        self._window = None
        # The HTTP port changes on every launch, so browser localStorage alone
        # cannot retain corrections. Store them outside the temporary EXE bundle.
        root = Path(data_dir) if data_dir else default_data_dir()
        self._logs_dir = root / 'logs'
        self._updates_dir = root / 'updates'
        self._downloader = UpdateDownloader(self._updates_dir)
        self._update_logger = logging.getLogger('uku.update')
        self._corrections_path = root / 'corrections.json'
        self._database_path = root / 'corrections-v2.json'
        self._library_path = root / 'library-v1.json'
        self._corrections_lock = threading.Lock()
        self._library_lock = threading.Lock()

    def load_corrections(self):
        with self._corrections_lock:
            if not self._corrections_path.exists():
                return {}
            with self._corrections_path.open(encoding='utf-8') as handle:
                data = json.load(handle)
            return data if isinstance(data, dict) else {}

    def save_corrections(self, data):
        try:
            if not isinstance(data, dict):
                return {'success': False, 'error': 'Invalid correction data'}
            with self._corrections_lock:
                self._corrections_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self._corrections_path.with_suffix('.tmp')
                with temporary.open('w', encoding='utf-8') as handle:
                    json.dump(data, handle, ensure_ascii=False)
                os.replace(temporary, self._corrections_path)
            return {'success': True}
        except Exception as error:
            return {'success': False, 'error': str(error)}

    def load_correction_database(self):
        with self._corrections_lock:
            path = self._database_path if self._database_path.exists() else self._corrections_path
            if not path.exists():
                return {'version': 2, 'glossary': {}, 'scripts': {}}
            with path.open(encoding='utf-8') as handle:
                data = json.load(handle)
            if not isinstance(data, dict):
                raise ValueError('Invalid correction database; original file retained')
            return data

    def save_correction_database(self, data):
        try:
            if not isinstance(data, dict) or data.get('version') != 2 or not isinstance(data.get('scripts'), dict) or not isinstance(data.get('glossary'), dict):
                return {'success': False, 'error': 'Invalid v2 correction database'}
            with self._corrections_lock:
                # Validate existing files before replacing: corrupt data must stay recoverable.
                for path in (self._database_path, self._corrections_path):
                    if path.exists():
                        with path.open(encoding='utf-8') as handle:
                            json.load(handle)
                self._database_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self._database_path.with_suffix('.tmp')
                with temporary.open('w', encoding='utf-8') as handle:
                    json.dump(data, handle, ensure_ascii=False)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self._database_path)
            return {'success': True}
        except Exception as error:
            return {'success': False, 'error': str(error)}

    def load_library_database(self):
        """Return the persisted library, or None so the frontend can seed starter books.

        Version 1 files are returned as stored; the frontend migrates them and saves version 2.
        """
        with self._library_lock:
            if not self._library_path.exists():
                return None
            with self._library_path.open(encoding='utf-8') as handle:
                data = json.load(handle)
            if not isinstance(data, dict) or data.get('version') not in LIBRARY_VERSIONS or not isinstance(data.get('books'), dict):
                raise ValueError('Invalid library database; original file retained')
            return data

    def save_library_database(self, data):
        try:
            if not isinstance(data, dict) or data.get('version') not in LIBRARY_VERSIONS or not isinstance(data.get('books'), dict):
                return {'success': False, 'error': 'Invalid library database'}
            with self._library_lock:
                # Validate the existing file before replacing: a corrupt library
                # must stay recoverable instead of being overwritten.
                if self._library_path.exists():
                    with self._library_path.open(encoding='utf-8') as handle:
                        json.load(handle)
                self._library_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self._library_path.with_suffix('.tmp')
                with temporary.open('w', encoding='utf-8') as handle:
                    json.dump(data, handle, ensure_ascii=False)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self._library_path)
            return {'success': True}
        except Exception as error:
            return {'success': False, 'error': str(error)}

    def set_window(self, window):
        self._window = window

    def get_log(self):
        """Tail of logs/uku.log so the feedback panel can show native errors."""
        return read_log_tail(self._logs_dir / LOG_FILENAME)

    def update_download(self, args):
        try:
            spec = validate_update_args(args)
        except ValueError as error:
            return {'success': False, 'error': str(error)}
        try:
            result = self._downloader.start(spec)
        except Exception as error:
            self._update_logger.exception('Cannot start update download')
            return {'success': False, 'error': str(error)}
        self._update_logger.info('update_download(%s) -> %s', spec['version'], result)
        return result

    def update_state(self):
        try:
            return self._downloader.state()
        except Exception as error:
            return {'phase': 'error', 'progress': 0.0, 'error': str(error)}

    def update_cancel(self):
        try:
            return self._downloader.cancel()
        except Exception:
            return {'success': False}

    def update_apply(self):
        try:
            if not getattr(sys, 'frozen', False):
                return {'success': False, 'error': 'not-frozen'}
            if self._downloader.state().get('phase') != 'ready':
                return {'success': False, 'error': 'no-update'}
            package = self._downloader.package_path()
            if package is None or not package.is_file():
                return {'success': False, 'error': 'no-update'}
            current_exe = Path(sys.executable)
            script = self._updates_dir / APPLY_SCRIPT_NAME
            self._updates_dir.mkdir(parents=True, exist_ok=True)
            # Write bytes so Windows does not translate the CRLF line ends again.
            script.write_bytes(build_apply_script(os.getpid(), current_exe, package).encode('utf-8'))
            flags = 0
            flags |= getattr(subprocess, 'DETACHED_PROCESS', 0x00000008)
            flags |= getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0x00000200)
            subprocess.Popen(
                ['cmd', '/c', str(script)],
                creationflags=flags,
                close_fds=True,
                cwd=str(current_exe.parent),
                env=relaunch_environment(),
            )
            self._update_logger.info('Update helper started for %s', package)
            self._schedule_quit()
            return {'success': True}
        except Exception as error:
            self._update_logger.exception('Cannot apply update')
            return {'success': False, 'error': str(error)}

    def _schedule_quit(self, delay=0.5):
        def quit_app():
            window = self._window
            try:
                if window is not None:
                    window.destroy()
                    return
            except Exception:
                pass
            os._exit(0)

        threading.Timer(delay, quit_app).start()

    def save_file(self, filename, base64_data):
        """Open native Windows Save File Dialog and write base64 file data."""
        try:
            if not self._window:
                return {'success': False, 'error': 'Window not ready'}

            ext = os.path.splitext(filename)[1].lower()
            if ext == '.docx':
                file_types = ('Word Document (*.docx)', 'All files (*.*)')
            elif ext == '.srt':
                file_types = ('SubRip Subtitle (*.srt)', 'All files (*.*)')
            else:
                file_types = ('Text Document (*.txt)', 'All files (*.*)')

            file_path = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=filename,
                file_types=file_types
            )

            if file_path:
                if isinstance(file_path, (list, tuple)):
                    if not file_path:
                        return {'success': False, 'error': 'Cancelled'}
                    file_path = file_path[0]

                raw_bytes = base64.b64decode(base64_data)
                with open(file_path, 'wb') as f:
                    f.write(raw_bytes)
                return {'success': True, 'path': file_path}
            else:
                return {'success': False, 'error': 'Cancelled'}
        except Exception as e:
            return {'success': False, 'error': str(e)}


def main():
    data_dir = default_data_dir()
    setup_logging(data_dir)
    install_exception_logging()
    logger = logging.getLogger('uku.app')
    logger.info('Starting Uku Furigana %s (data dir %s)', APP_VERSION, data_dir)
    if getattr(sys, 'frozen', False) and cleanup_stale_backup(sys.executable):
        logger.info('Removed leftover %s.old from a previous update', sys.executable)
    cleanup_update_dir(Path(data_dir) / 'updates')

    # Resolve static web assets directory
    web_dir = get_bundle_dir()

    if not os.path.exists(web_dir) or not os.path.isfile(os.path.join(web_dir, 'index.html')):
        logger.error('Static web build not found at: %s', web_dir)
        # Write error to a log file next to the EXE for debugging
        log_path = os.path.join(os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else __file__), 'error.log')
        with open(log_path, 'w', encoding='utf-8') as f:
            f.write(f"Error: Static web build not found at: {web_dir}\n")
        sys.exit(1)

    # Pick a free port and start the embedded server
    port = get_free_port()
    ready_event = threading.Event()

    server_thread = threading.Thread(target=start_http_server, args=(web_dir, port, ready_event), daemon=True)
    server_thread.start()

    # Wait for the server thread to bind the port
    ready_event.wait(timeout=5)

    # Wait for the server to actually respond to HTTP requests
    if not wait_for_server(port, timeout=10):
        logger.error('HTTP server failed to start on port %s', port)
        log_path = os.path.join(os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else __file__), 'error.log')
        with open(log_path, 'w', encoding='utf-8') as f:
            f.write(f"Error: HTTP server failed to start on port {port}\n")
        sys.exit(1)

    url = f"http://127.0.0.1:{port}/?desktop=1"

    # Use PyWebView for a stable, dedicated application window with Native Save Dialog API bridge
    api = Api(data_dir)
    logger.info('Serving %s on port %s', web_dir, port)
    window = webview.create_window('浮く Uku Furigana', url, width=1280, height=830, js_api=api)
    api.set_window(window)
    # Test setup only: UKU_DEBUG_PORT opens WebView2's DevTools port so the update test can drive the page.
    debug_port = os.environ.get('UKU_DEBUG_PORT', '').strip()
    if debug_port.isdigit():
        webview.settings['REMOTE_DEBUGGING_PORT'] = int(debug_port)
    try:
        webview.start(private_mode=False)
    finally:
        logger.info('Window closed, exiting')


if __name__ == '__main__':
    main()
