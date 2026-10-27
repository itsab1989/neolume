"""LAN servers for the TV: User-App-Sync (port 80) and the optional update server.

Both serve a fixed in-memory allow-list of paths (no file system access, no proxying), only GET/HEAD
(PUT/DELETE only for the fixed helper routes when the optional helper is attached to the update port),
only to loopback/private clients (optionally a single TV address). The sync server additionally locks
itself to the first device that fetches widgetlist.xml, because the package contains the profile tokens.
"""
import http.server
import json
import os
import re
import socket
import socketserver
import threading
import time

from . import VERSION
from .netutil import lan_client_ok

SYNC_PORT = 80
UPDATE_PORT = 32499          # shared with the optional helper (neosetup/helper.py); helper routes take precedence
# DNS rebinding guard (pentest P1): a browser that rebinds its own domain to this computer sends that domain as Host.
# The TV (and every legitimate client) uses the IP address from widgetlist.xml/setup.json -> only IP literals/localhost.
_HOST_OK = re.compile(r'(\d{1,3}(?:\.\d{1,3}){3}|localhost|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?')


def host_ok(host):
    """Host header absent (HTTP/1.0) or an IP literal/localhost with optional port."""
    return host is None or bool(_HOST_OK.fullmatch(host.strip()))


class _Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'TVSetup/' + VERSION
    sys_version = ''
    timeout = 30                             # per socket operation: idle/slow clients cannot hold threads forever

    def parse_request(self):
        if not http.server.BaseHTTPRequestHandler.parse_request(self): return False
        path = self.path.split('?', 1)[0]
        if self.server.owner.client_allowed(self.client_address[0], path) and host_ok(self.headers.get('Host')): return True
        self.server.owner.event(self.client_address[0], self.path[:80], 403)
        self.send_error(403); return False

    def _api(self, method):
        """Helper routes (neosetup.helper.Helper.handle) take precedence over static files; None = not a helper path."""
        api = self.server.owner.api
        if not api: return False
        try: n = int(self.headers.get('Content-Length') or 0)
        except ValueError: n = -1
        if n < 0 or n > 1024:
            self.send_error(413); return True
        if n: self.rfile.read(n)                 # requests carry no body; drain a tiny one
        res = api.handle(method, self.path, self.headers, self.client_address[0])
        if res is None: return False
        status, obj = res
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)
        self.server.owner.event(self.client_address[0], self.path.split('?', 1)[0][:80], status)
        return True

    def _serve(self, head):
        owner = self.server.owner
        if not head and self._api('GET'): return
        path = self.path.split('?', 1)[0]
        item = owner.files.get(path)            # exact match against the allow-list, nothing else
        if item is None:
            owner.event(self.client_address[0], path[:80], 404)
            return self.send_error(404)
        data, ctype = item
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if not head: self.wfile.write(data)
        owner.fetched(self.client_address[0], path)

    def do_GET(self): self._serve(False)
    def do_HEAD(self): self._serve(True)
    def log_message(self, *a): pass


def _deny(self):
    self.send_error(405)
for _m in ('POST', 'PATCH', 'OPTIONS', 'CONNECT', 'TRACE'):
    setattr(_Handler, 'do_' + _m, _deny)


def _write(method):
    def do(self):                              # PUT/DELETE only for helper routes (watchlist add/remove)
        if not self._api(method): self.send_error(405)
    return do
_Handler.do_PUT = _write('PUT')
_Handler.do_DELETE = _write('DELETE')


class _HTTP(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != 'nt'   # Windows SO_REUSEADDR would let us bind a port another program uses
    def server_bind(self):                  # no getfqdn(): slow name resolution can block start-up
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


class LanServer(object):
    def __init__(self, name, port, allow=None, lock_path=None, bind='0.0.0.0'):
        self.name, self.port, self.bind = name, port, bind
        self.allow = set(allow or [])
        self.lock_path = lock_path          # first non-loopback client fetching this path becomes the only client
        self.locked_to = None
        self.files = {}
        self.api = None                     # optional helper (neosetup.helper.Helper) on the update port
        self.events = []                    # (time, client, path, status)
        self._lock = threading.Lock()
        self._httpd = None

    # --- content ---
    def set_files(self, files):
        """files: {'/path': (bytes, content_type)} - exact paths only."""
        for p in files:
            if not p.startswith('/') or '..' in p or '?' in p: raise ValueError(p)
        self.files = dict(files)

    # --- access control ---
    def client_allowed(self, addr, path=None):
        """LAN filter + TV lock. With a lock path (sync server) every other file - the packages with the profile tokens -
        is served only to the device that fetched the lock path first (pentest P2: before, any LAN device could download
        PlexNeo.zip directly while the server waited for the TV)."""
        if not lan_client_ok(addr, self.allow or None): return False
        loop = addr.startswith('127.') or addr == '::1'
        if self.locked_to and addr != self.locked_to and not loop: return False
        if self.lock_path and path is not None and path != self.lock_path and not loop and addr != self.locked_to: return False
        return True

    def unlock(self):
        self.locked_to = None

    def fetched(self, addr, path):
        with self._lock:
            if self.lock_path and path == self.lock_path and not self.locked_to and not (addr.startswith('127.') or addr == '::1'):
                self.locked_to = addr
        self.event(addr, path, 200)

    def event(self, addr, path, status):
        with self._lock:
            self.events.append((time.time(), addr, path, status))
            del self.events[:-200]

    # --- lifecycle ---
    @property
    def running(self):
        return self._httpd is not None

    def start(self):
        if self._httpd: return
        h = _HTTP((self.bind, self.port), _Handler)     # raises OSError (e.g. port 80 busy / not permitted)
        h.owner = self
        self.port = h.server_address[1]                 # actual port when started with 0 (tests)
        self._httpd = h
        threading.Thread(target=h.serve_forever, name=self.name, daemon=True).start()

    def stop(self):
        h, self._httpd = self._httpd, None
        if h:
            h.shutdown(); h.server_close()


def port_in_use(port, host='127.0.0.1'):
    """Something already listens on this port (tells 'busy' apart from 'not permitted'; Windows reports both as 10013)."""
    try:
        socket.create_connection((host, port), timeout=1).close()
        return True
    except OSError:
        return False


def sync_files(widgetlist_xml, packages):
    """packages: {'<widgetId>.zip': bytes, ...} -> allow-list for the sync server."""
    files = {'/widgetlist.xml': (widgetlist_xml, 'text/xml; charset=utf-8')}
    for name, data in packages.items():
        files['/' + name] = (data, 'application/zip')
    return files


def update_files(app_js, app_version):
    """Update server content: discovery JSON, manifest and app.js. Contains NO tokens."""
    import hashlib
    manifest = {'name': 'plex-neo-update', 'version': app_version, 'size': len(app_js),
                'sha256': hashlib.sha256(app_js).hexdigest(), 'app': '/update/app.js'}
    hello = {'name': 'plex-neo-setup', 'version': VERSION, 'features': ['update']}
    return {
        '/neo-helper': (json.dumps(hello).encode(), 'application/json'),
        '/update/manifest.json': (json.dumps(manifest).encode(), 'application/json'),
        '/update/app.js': (app_js, 'application/javascript'),
    }
