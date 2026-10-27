"""Local web UI (127.0.0.1 only). CSRF: random token embedded in the page, required as header on every API call;
Host header must be our loopback address (DNS-rebinding guard); cross-origin requests are rejected."""
import http.server
import json
import pkgutil
import secrets
import socketserver
import threading

from . import brand
from .package import PackageError
from .plextv import PlexError
from .wizard import StepError

MAX_BODY = 64 << 10


class UIServer(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, wizard, port=0, host='127.0.0.1'):
        if host not in ('127.0.0.1', '::1'): raise ValueError('UI must bind to loopback')
        http.server.ThreadingHTTPServer.__init__(self, (host, port), Handler)
        self.wizard = wizard
        self.csrf = secrets.token_urlsafe(24)
        self.nonce = secrets.token_urlsafe(16)
        self.lock = threading.Lock()
        p = self.server_address[1]
        self.hosts = {'127.0.0.1:%d' % p, 'localhost:%d' % p, '[::1]:%d' % p}
        self.url = 'http://127.0.0.1:%d/' % p
        self.quitting = False

    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def actions(w):
    return {
        'state': lambda a: None,
        'login_start': lambda a: w.login_start(a.get('kind')),
        'login_poll': lambda a: w.login_poll(),
        'servers': lambda a: (w.refresh_servers(), None)[1],
        'choose_server': lambda a: (w.choose_server(_str(a.get('id'))), None)[1],
        'profiles': lambda a: w.set_profiles(a.get('ids')),
        'extras': lambda a: w.set_extras(a.get('specs')),
        'tv': lambda a: w.set_tv_address(_str(a.get('address'))),
        'build': lambda a: w.build(_bool(a.get('resetPins', False))),
        'sync_start': lambda a: w.sync_start(),
        'sync_stop': lambda a: w.sync_stop(),
        'sync_unlock': lambda a: w.sync.unlock(),
        'update_start': lambda a: w.update_start(),
        'update_stop': lambda a: w.update_stop(),
        'others_scan': lambda a: w.others_scan(),
        'others': lambda a: w.set_others(a.get('ids')),
        'helper': lambda a: w.set_helper(_bool(a.get('on', False)), _bool(a.get('remember', True)), _str(a.get('address', ''))),
        'helper_start': lambda a: w.helper_start(),
        'helper_stop': lambda a: w.helper_stop(),
        'finish': lambda a: w.finish(),
        'logout': lambda a: w.reset(),
        'prefs': lambda a: w.set_prefs(_opt_str(a.get('lang')), None if a.get('remember') is None else _bool(a.get('remember'))),
    }


def _bool(v):
    if not isinstance(v, bool): raise StepError('bad_input')
    return v


def _opt_str(v):
    return None if v is None else _str(v)


def _str(v):
    if not isinstance(v, str) or len(v) > 256: raise StepError('bad_input')
    return v


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'TVSetup'
    sys_version = ''

    def log_message(self, *a): pass

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy',
                         "default-src 'none'; script-src 'nonce-%s'; style-src 'nonce-%s'; img-src 'self' https://*.plex.tv https://plex.tv data:; "
                         "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" % (self.server.nonce, self.server.nonce))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode('utf-8'), 'application/json; charset=utf-8')

    def _host_ok(self):
        return self.headers.get('Host', '') in self.server.hosts

    def do_GET(self):
        if not self._host_ok(): return self._send(403, b'forbidden', 'text/plain')
        if self.path.split('?')[0] != '/': return self._send(404, b'not found', 'text/plain')
        html = pkgutil.get_data('neosetup', 'ui.html').decode('utf-8')
        html = html.replace('__CSRF__', self.server.csrf).replace('__NONCE__', self.server.nonce).replace('__APP__', brand.name()).replace('__PKG__', brand.package_name())
        html = html.replace('__ACCENT__', brand.CURRENT['accent'].lower()).replace('__SOFT_LIGHT__', brand.CURRENT['softLight']).replace('__SOFT_DARK__', brand.CURRENT['softDark'])
        self._send(200, html.encode('utf-8'), 'text/html; charset=utf-8')

    def do_POST(self):
        if not self._host_ok(): return self._json(403, {'ok': False, 'error': 'forbidden'})
        origin = self.headers.get('Origin')
        if origin and origin.rstrip('/') not in ('http://' + h for h in self.server.hosts):
            return self._json(403, {'ok': False, 'error': 'forbidden'})
        if not secrets.compare_digest(self.headers.get('X-Neo-Csrf', ''), self.server.csrf):
            return self._json(403, {'ok': False, 'error': 'csrf'})
        if not self.path.startswith('/api/'): return self._json(404, {'ok': False, 'error': 'not_found'})
        try: n = int(self.headers.get('Content-Length') or 0)
        except ValueError: n = -1
        if n < 0 or n > MAX_BODY: return self._json(413, {'ok': False, 'error': 'too_large'})
        if (self.headers.get('Content-Type') or '').split(';')[0].strip() != 'application/json':
            return self._json(415, {'ok': False, 'error': 'content_type'})
        try:
            args = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
            if not isinstance(args, dict): raise ValueError
        except (ValueError, RecursionError):        # deeply nested JSON must not kill the handler with a traceback
            return self._json(400, {'ok': False, 'error': 'bad_input'})
        w = self.server.wizard
        if self.path == '/api/quit':                 # "Quit program" button: stop everything, then end serve_forever()
            with self.server.lock:
                w.shutdown()
                self.server.quitting = True
            self._json(200, {'ok': True, 'result': None, 'state': None})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        fn = actions(w).get(self.path[5:])
        if not fn: return self._json(404, {'ok': False, 'error': 'not_found'})
        try:
            with self.server.lock:
                res = fn(args)
                st = w.public_state()
            return self._json(200, {'ok': True, 'result': res, 'state': st})
        except (StepError, PlexError, PackageError) as e:
            return self._json(200, {'ok': False, 'error': e.code, 'detail': str(e.detail)[:200], 'state': w.public_state()})
        except Exception as e:                     # never leak tracebacks/tokens into the page
            return self._json(500, {'ok': False, 'error': 'internal', 'detail': type(e).__name__})
