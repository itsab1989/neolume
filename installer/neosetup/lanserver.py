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


_LIVE_TOKEN = re.compile(r'/live/[A-Za-z0-9_-]{8,}')


class Raw(object):
    """Answer of a helper route that is not JSON (e.g. a small page of an edition extension): bytes, content type and extra
    headers (Content-Security-Policy etc.). Built-in routes always answer JSON."""
    def __init__(self, data, ctype, headers=None, stream=None, size=0, done=None):
        self.data, self.ctype, self.headers = data, ctype, list(headers or [])
        # large files (app update): stream = open binary file, size = its length; sent in chunks, never read into memory;
        # done() runs after sending (e.g. frees a transfer slot) – also when the client went away
        self.stream, self.size, self.done = stream, size, done


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

    def _api(self, method, head=False):
        """Helper routes (neosetup.helper.Helper.handle) take precedence over static files; None = not a helper path."""
        api = self.server.owner.api
        if not api: return False
        try: n = int(self.headers.get('Content-Length') or 0)
        except ValueError: n = -1
        limit = api.body_limit(method, self.path) if hasattr(api, 'body_limit') else 1024   # extension routes may take a JSON body
        if n < 0 or n > limit:
            self.send_error(413); return True
        body = self.rfile.read(n) if n else b''  # built-in routes carry no body (a tiny one is drained)
        res = api.handle(method, self.path, self.headers, self.client_address[0], body) if limit > 1024 else \
            api.handle(method, self.path, self.headers, self.client_address[0])
        if res is None: return False
        status, obj = res
        raw = obj if isinstance(obj, Raw) else None
        if raw and raw.stream is not None: return self._stream(status, raw, head)
        body = raw.data if raw else json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', raw.ctype if raw else 'application/json; charset=utf-8')
        for k, v in (raw.headers if raw else []): self.send_header(k, v)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if not head: self.wfile.write(body)
        self.server.owner.event(self.client_address[0], self.path.split('?', 1)[0][:80], status)
        return True

    def _stream(self, status, raw, head):
        try:
            self.send_response(status)
            self.send_header('Content-Type', raw.ctype)
            for k, v in raw.headers: self.send_header(k, v)
            self.send_header('Content-Length', str(raw.size))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            left = 0 if head else raw.size
            deadline = time.monotonic() + STREAM_DEADLINE
            while left > 0:
                if time.monotonic() > deadline:        # a reader that hardly takes anything never holds a thread for ever
                    self.close_connection = True
                    break
                chunk = raw.stream.read(min(65536, left))
                if not chunk: break
                self.wfile.write(chunk)
                left -= len(chunk)
            self.server.owner.event(self.client_address[0], self.path.split('?', 1)[0][:80], status)
            return True
        finally:
            try: raw.stream.close()
            except Exception: pass
            if raw.done:
                try: raw.done()
                except Exception: pass

    def _serve(self, head):
        owner = self.server.owner
        if not head and self._api('GET'): return
        if head and self.path.startswith('/live/') and self._api('GET', head=True): return   # some players probe live media with HEAD
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
for _m in ('PATCH', 'OPTIONS', 'CONNECT', 'TRACE'):
    setattr(_Handler, 'do_' + _m, _deny)


def _write(method):
    def do(self):                              # PUT/DELETE only for helper routes (watchlist add/remove)
        if not self._api(method): self.send_error(405)
    return do
_Handler.do_POST = _write('POST')               # only routes of optional extensions (helper ext_routes) accept POST
_Handler.do_PUT = _write('PUT')
_Handler.do_DELETE = _write('DELETE')


STREAM_DEADLINE = 600       # s: total time for one streamed answer (app package) – a stalled or trickling reader frees its thread
MAX_CONN = 64              # open connections in total (one thread each) …
MAX_CONN_CLIENT = 12       # … and per client address (the TV's player uses 2-4; review 05.11. Z1)


class _HTTP(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != 'nt'   # Windows SO_REUSEADDR would let us bind a port another program uses
    def server_bind(self):                  # no getfqdn(): slow name resolution can block start-up
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]
        self.conns, self.conn_lock = {}, threading.Lock()

    # Every connection gets its own thread, also one that never sends a request (idle up to _Handler.timeout). Without a cap
    # one home-network device could open thousands and use up threads/memory, and the rate limit (it counts requests) never
    # saw them. Above the caps a new connection is closed at once; the TV's connections are never refused while it stays
    # under MAX_CONN_CLIENT.
    def process_request(self, request, client_address):
        addr = client_address[0] if client_address else ''
        with self.conn_lock:
            total = sum(self.conns.values())
            ok = total < MAX_CONN and self.conns.get(addr, 0) < MAX_CONN_CLIENT
            if ok: self.conns[addr] = self.conns.get(addr, 0) + 1
        if not ok:
            self.shutdown_request(request); return
        try:
            http.server.ThreadingHTTPServer.process_request(self, request, client_address)
        except Exception:
            self._release(addr); raise

    def process_request_thread(self, request, client_address):
        try:
            http.server.ThreadingHTTPServer.process_request_thread(self, request, client_address)
        finally:
            self._release(client_address[0] if client_address else '')

    def _release(self, addr):
        with self.conn_lock:
            n = self.conns.get(addr, 0) - 1
            if n > 0: self.conns[addr] = n
            else: self.conns.pop(addr, None)


class LanServer(object):
    def __init__(self, name, port, allow=None, lock_path=None, bind='0.0.0.0'):
        self.name, self.port, self.bind = name, port, bind
        self.allow = set(allow or [])
        self.lock_path = lock_path          # first non-loopback client fetching this path becomes the only client
        self.locked_to = None
        self.on_fetch = None                # optional callable(addr, path) after a file was served (wizard: TV got the package)
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
        if not lan_client_ok(addr, self.allow or None):
            # a route of an optional extension may be open to every home-network client for a short time (e.g. a phone page
            # while a pairing code is shown on the TV); never public addresses
            opener = getattr(self.api, 'open_path', None) if self.api is not None else None
            if path and opener and opener(path) and lan_client_ok(addr, None): return True
            # Docker bridge (helper.is_nat): let the helper answer 403 {"error": "nat"}, so the TV can explain the fix
            nat = getattr(self.api, 'is_nat', None) if self.api is not None else None
            return bool(nat and nat(addr) and path is not None and (path.startswith('/neo-helper') or path.startswith('/watchlist') or
                        path.startswith('/discover/') or path.startswith('/live/') or path.startswith('/arr/') or path in ('/servers', '/details')))
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
        cb = self.on_fetch
        if cb:
            try: cb(addr, path)
            except Exception: pass             # never break serving because of the page state

    def event(self, addr, path, status):
        path = _LIVE_TOKEN.sub('/live/~', str(path))      # live TV session token (helper) never in the event list
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
