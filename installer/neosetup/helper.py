"""Optional helper ("Helfer"): plex.tv-only features for the TV (watchlist, Discover rows).

The 2014 TV cannot speak TLS 1.2, so this small service on a computer/NAS in the home network talks HTTPS to plex.tv
and offers a few FIXED plain-HTTP JSON routes to the TV. It is NOT a proxy:

- every TV route maps to one hard-coded plex.tv URL pattern (ROUTES/UPSTREAM below); the TV never sends a URL or host,
- every upstream URL is checked against UPSTREAM (host + method + path regex + allowed query keys) before it is fetched,
- https only, certificate checks on, redirects are never followed, 10 s timeout, 256 KB response cap,
- only clients on private networks (optionally only the TV's address), shared key from setup.json, per-client rate limit,
- plex.tv tokens of the chosen profiles stay in this process (and, if "remember" is ticked, in a 0600 file); they are
  never sent to the TV, never logged; answers to the TV are slim JSON (no tokens, no streaming/provider fields).

Live check of the upstream endpoints: docs/research/discover.md "Helfer: live geprueft" (read-only GETs, 27.10.2026).
Python 3 standard library only.
"""
import hmac
import json
import os
import re
import secrets
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import VERSION, brand
from .netutil import is_private_ipv4
import ipaddress

HELPER_PORT = 32499                      # shared with the update server (same LanServer)
MAX_UPSTREAM = 256 << 10                 # plex.tv answer cap
MAX_ITEMS = 50
TIMEOUT = 10
CACHE_DISCOVER = 15 * 60
CACHE_WATCHLIST = 60
HEX = re.compile(r'^[0-9a-f]{24}$')
UUID = re.compile(r'^[A-Za-z0-9-]{4,64}$')
KEY = re.compile(r'^[A-Za-z0-9_-]{16,128}$')
GUID = re.compile(r'^plex://(movie|show)/([0-9a-f]{24})$')
IMG_HOSTS = ('images.plex.tv', 'metadata-static.plex.tv', 'image.tmdb.org', 'artworks.thetvdb.com')

DISCOVER = 'discover.provider.plex.tv'
METADATA = 'metadata.provider.plex.tv'

# Complete upstream allow-list: (method, host, path regex, allowed query keys). Anything else -> refused, no request.
_PAGING = ('X-Plex-Container-Start', 'X-Plex-Container-Size')
UPSTREAM = (
    ('GET', DISCOVER, r'/library/sections/watchlist/all', ('type', 'includeCollections', 'includeExternalMedia') + _PAGING),
    ('PUT', DISCOVER, r'/actions/(addToWatchlist|removeFromWatchlist)', ('ratingKey',)),
    ('GET', DISCOVER, r'/library/metadata/[0-9a-f]{24}(,[0-9a-f]{24}){0,29}/userState', ()),
    ('GET', DISCOVER, r'/hubs/sections/home/(top_watchlisted|recently-released-family|coming-soon)', _PAGING),
    ('GET', METADATA, r'/library/metadata/[0-9a-f]{24}', ()),     # reserved: cast/summary of foreign titles (not routed yet)
)

# Discover rows: fixed hub table (checked live 27.10.2026, docs/research/discover.md). No hub is chosen by the TV.
#   trending = "Diese Woche am haeufigsten vorgemerkt" (service-neutral; "Populaer auf Plex" = Plex's own free VOD -> not used)
#   new      = released in the last NEW_DAYS days, from the two hubs below, newest first
#   soon     = "Demnaechst", not yet released, soonest first
DISCOVER_LISTS = {
    'trending': {'hubs': ('top_watchlisted',), 'when': None},
    'new': {'hubs': ('top_watchlisted', 'recently-released-family'), 'when': 'past'},
    'soon': {'hubs': ('coming-soon',), 'when': 'future'},
}
NEW_DAYS = 180
HUB_SIZE = 60

# Hub/field names that are advertising/streaming related are never passed on (we copy only whitelisted fields anyway).
WL_TYPE = {'all': None, 'movie': 1, 'show': 2}


class HelperError(Exception):
    def __init__(self, status, code):
        Exception.__init__(self, code)
        self.status, self.code = status, code


# ---------------------------------------------------------------- upstream allow-list
def upstream_allowed(method, url):
    """True only for https URLs on the allow-list (host, method, full path match, known query keys, no userinfo/port)."""
    try: p = urllib.parse.urlsplit(url)
    except ValueError: return False
    if p.scheme != 'https' or p.username or p.password or p.port or p.fragment: return False
    host = (p.hostname or '').lower()
    try: q = urllib.parse.parse_qsl(p.query, keep_blank_values=True, strict_parsing=bool(p.query))
    except ValueError: return False
    for m, h, rx, keys in UPSTREAM:
        if m == method and h == host and re.fullmatch(rx, p.path):
            return all(k in keys for k, _ in q)
    return False


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None                      # never follow: a 3xx comes back as HTTPError -> refused


_OPENER = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context()))


def urllib_fetch(method, url, headers, timeout=TIMEOUT):
    """-> (status, bytes). TLS checks on, no redirects, capped body."""
    req = urllib.request.Request(url, data=b'' if method == 'PUT' else None, method=method, headers=headers)
    try:
        with _OPENER.open(req, timeout=timeout) as r:
            return r.status, r.read(MAX_UPSTREAM + 1)
    except urllib.error.HTTPError as e:
        return e.code, b''
    except (urllib.error.URLError, OSError, ValueError):
        raise HelperError(502, 'upstream')


# ---------------------------------------------------------------- slim answers for the TV
def _str(v, n):
    return v[:n] if isinstance(v, str) else ''


def safe_img(url):
    """Image URLs for the TV (loaded via the PMS photo transcoder): https on known image hosts, no credentials in the query."""
    if not isinstance(url, str) or len(url) > 600: return ''
    try: p = urllib.parse.urlsplit(url)
    except ValueError: return ''
    if p.scheme != 'https' or (p.hostname or '').lower() not in IMG_HOSTS or p.username or p.port: return ''
    if 'token' in p.query.lower(): return ''
    return url


def slim(md):
    """plex.tv Metadata entry -> {id, type, guid, title, year, summary, thumb, date} or None (only movie/show with plex GUID)."""
    if not isinstance(md, dict): return None
    m = GUID.match(md.get('guid') or '')
    if not m or md.get('type') != m.group(1): return None
    title = _str(md.get('title'), 200)
    if not title: return None
    year = md.get('year')
    return {'id': m.group(2), 'type': m.group(1), 'guid': m.group(0), 'title': title,
            'year': year if isinstance(year, int) and 1800 < year < 2200 else 0,
            'summary': _str(md.get('summary'), 600), 'thumb': safe_img(md.get('thumb')),
            'date': _str(md.get('originallyAvailableAt'), 10) if re.match(r'^\d{4}-\d{2}-\d{2}$', str(md.get('originallyAvailableAt') or '')) else ''}


def metadata_list(data):
    try: d = json.loads(data.decode('utf-8'))
    except (ValueError, UnicodeDecodeError): raise HelperError(502, 'parse')
    mc = d.get('MediaContainer') if isinstance(d, dict) else None
    if not isinstance(mc, dict): raise HelperError(502, 'parse')
    md = mc.get('Metadata') or []
    total = mc.get('totalSize', mc.get('size', 0))
    return (md if isinstance(md, list) else []), (total if isinstance(total, int) else 0)


def pick(items, type_, when, today, size):
    """Filter/sort Discover entries: type, release window, dedupe by id."""
    out, seen = [], set()
    lo = time.strftime('%Y-%m-%d', time.gmtime(time.mktime(time.strptime(today, '%Y-%m-%d')) - NEW_DAYS * 86400))
    for it in items:
        if not it or it['id'] in seen or (type_ and it['type'] != type_): continue
        d = it['date']
        if when == 'past' and not (d and lo <= d <= today): continue
        if when == 'future' and d and d < today: continue
        seen.add(it['id']); out.append(it)
    if when == 'past': out.sort(key=lambda x: x['date'], reverse=True)
    if when == 'future': out.sort(key=lambda x: x['date'] or '9999')
    return out[:size]


def public(it):
    return dict((k, it[k]) for k in ('id', 'type', 'guid', 'title', 'year', 'summary', 'thumb'))


# ---------------------------------------------------------------- token store
def store_path():
    from .settings import settings_path
    return os.path.join(os.path.dirname(settings_path()), 'helper.json')


PLEX_PAGE_MAX = 100        # discover.provider.plex.tv lehnt X-Plex-Container-Size > 100 mit 400 ab (live geprueft 27.10.)


class Store(object):
    """Helper configuration: shared key, port, allowed TV address, plex.tv token per profile uuid.
    Kept in memory; saved only on request to a file readable by the current user only (0600)."""
    def __init__(self, key=None, profiles=None, allow='', owner=''):
        self.key = key if isinstance(key, str) and KEY.match(key) else secrets.token_urlsafe(24)
        self.profiles = {}                # uuid -> {'token', 'title', 'kind'}
        self.owner = owner
        self.allow = allow
        for u, p in (profiles or {}).items(): self.add(u, p.get('token'), p.get('title', ''), p.get('kind', 'home'))

    def add(self, uuid, token, title='', kind='home'):
        from .plextv import valid_token
        if not (isinstance(uuid, str) and UUID.match(uuid)) or not valid_token(token): return False
        self.profiles[uuid] = {'token': token, 'title': _str(title, 64), 'kind': kind if kind in ('owner', 'home') else 'home'}
        if kind == 'owner': self.owner = uuid
        return True

    def token(self, uuid):
        p = self.profiles.get(uuid)
        return p and p['token']

    def summary(self):
        """For the UI: names only, never tokens or the key."""
        return [{'title': p['title'], 'kind': p['kind']} for p in self.profiles.values()]

    def to_json(self):
        return {'kind': 'plexneo-helper', 'schema': 1, 'key': self.key, 'owner': self.owner, 'allow': self.allow,
                'profiles': self.profiles}

    @classmethod
    def from_json(cls, d):
        if not isinstance(d, dict) or d.get('kind') != 'plexneo-helper' or d.get('schema') != 1: raise ValueError('helper file')
        from .netutil import is_private_ipv4
        allow = d.get('allow') if isinstance(d.get('allow'), str) and is_private_ipv4(d.get('allow')) else ''
        s = cls(d.get('key'), {}, allow)
        for u, p in (d.get('profiles') or {}).items():
            if isinstance(p, dict): s.add(u, p.get('token'), p.get('title', ''), p.get('kind', 'home'))
        if not s.profiles: raise ValueError('no profiles')
        return s

    def save(self, path=None):
        path = path or store_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + '.tmp'
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)   # Windows: per-user %APPDATA% ACL
        with os.fdopen(fd, 'w', encoding='utf-8') as f: json.dump(self.to_json(), f)
        try: os.chmod(tmp, 0o600)
        except OSError: pass
        os.replace(tmp, path)
        return path

    @classmethod
    def load(cls, path=None):
        path = path or store_path()
        with open(path, encoding='utf-8') as f: return cls.from_json(json.load(f))

    @staticmethod
    def forget(path=None):
        try: os.remove(path or store_path())
        except OSError: pass


# ---------------------------------------------------------------- rate limit
class RateLimit(object):
    """Token bucket per client address: `rate` requests per `per` seconds (burst = rate)."""
    def __init__(self, rate=30, per=10.0, clock=time.monotonic):
        self.rate, self.per, self.clock = float(rate), float(per), clock
        self.b = {}
        self.lock = threading.Lock()

    def ok(self, client):
        now = self.clock()
        with self.lock:
            tokens, last = self.b.get(client, (self.rate, now))
            tokens = min(self.rate, tokens + (now - last) * self.rate / self.per)
            if tokens < 1:
                self.b[client] = (tokens, now); return False
            self.b[client] = (tokens - 1, now)
            if len(self.b) > 256: self.b = dict(list(self.b.items())[-128:])
            return True


# ---------------------------------------------------------------- the helper
class Helper(object):
    def __init__(self, store, client_id, fetch=None, clock=time.time, rate=None):
        self.store = store
        self.client_id = client_id
        self.fetch = fetch or urllib_fetch
        self.clock = clock
        self.rate = rate or RateLimit()
        self.cache = {}
        self.lock = threading.Lock()
        self.upstream = threading.BoundedSemaphore(4)
        self.update_on = False            # the update server shares the port: /neo-helper then also announces 'update'

    # --- plex.tv ---
    def _headers(self, token):
        return {'Accept': 'application/json', 'X-Plex-Product': brand.name() + ' Helper', 'X-Plex-Version': VERSION,
                'X-Plex-Client-Identifier': self.client_id, 'X-Plex-Language': 'de', 'X-Plex-Token': token}

    def call(self, method, host, path, query, token):
        url = 'https://%s%s%s' % (host, path, '?' + urllib.parse.urlencode(query) if query else '')
        if not upstream_allowed(method, url): raise HelperError(403, 'not_allowed')     # defence in depth
        with self.upstream:
            status, data = self.fetch(method, url, self._headers(token))
        if len(data) > MAX_UPSTREAM: raise HelperError(502, 'too_large')
        if status in (401, 403): raise HelperError(502, 'plex_auth')
        if status == 404: raise HelperError(502, 'plex_404')
        if status < 200 or status >= 300: raise HelperError(502, 'plex_%d' % status)
        return data

    def _cached(self, key, ttl, fn):
        now = self.clock()
        with self.lock:
            hit = self.cache.get(key)
            if hit and now - hit[0] < ttl: return hit[1]
        val = fn()
        with self.lock:
            self.cache[key] = (now, val)
            if len(self.cache) > 200: self.cache = dict(sorted(self.cache.items(), key=lambda kv: kv[1][0])[-100:])
        return val

    def _drop(self, prefix):
        with self.lock:
            for k in [k for k in self.cache if k[0] == prefix]: del self.cache[k]

    # --- mapped routes ---
    def watchlist(self, uuid, type_, start, size):
        tok = self.store.token(uuid)
        q = [('includeCollections', 0), ('includeExternalMedia', 0)]
        if WL_TYPE[type_]: q.append(('type', WL_TYPE[type_]))
        q += [('X-Plex-Container-Start', start), ('X-Plex-Container-Size', min(size, PLEX_PAGE_MAX))]
        def get():
            md, total = metadata_list(self.call('GET', DISCOVER, '/library/sections/watchlist/all', q, tok))
            items = [public(i) for i in (slim(m) for m in md) if i][:MAX_ITEMS]
            return {'items': items, 'total': total}
        return self._cached(('wl', uuid, type_, start, size), CACHE_WATCHLIST, get)

    def state(self, uuid, ids):
        tok = self.store.token(uuid)
        data = self.call('GET', DISCOVER, '/library/metadata/%s/userState' % ','.join(ids), None, tok)
        try: us = (json.loads(data.decode('utf-8')).get('MediaContainer') or {}).get('UserState') or []
        except (ValueError, UnicodeDecodeError, AttributeError): raise HelperError(502, 'parse')
        if isinstance(us, dict): us = [us]
        on = dict((i, False) for i in ids)
        for u in us if isinstance(us, list) else []:
            if isinstance(u, dict) and u.get('ratingKey') in on: on[u['ratingKey']] = bool(u.get('watchlistedAt'))
        return {'ids': on}

    def set(self, uuid, hexid, on):
        tok = self.store.token(uuid)
        self.call('PUT', DISCOVER, '/actions/%s' % ('addToWatchlist' if on else 'removeFromWatchlist'), [('ratingKey', hexid)], tok)
        self._drop('wl')
        return {'ok': True, 'id': hexid, 'on': on}

    def discover(self, uuid, lst, type_, size):
        tok = self.store.token(uuid) or self.store.token(self.store.owner)     # lists are not personal
        spec = DISCOVER_LISTS[lst]
        today = time.strftime('%Y-%m-%d', time.gmtime(self.clock()))
        def hub(name):
            def get():
                md, _ = metadata_list(self.call('GET', DISCOVER, '/hubs/sections/home/' + name,
                                                [('X-Plex-Container-Start', 0), ('X-Plex-Container-Size', HUB_SIZE)], tok))
                return [i for i in (slim(m) for m in md) if i]
            return self._cached(('hub', name), CACHE_DISCOVER, get)
        items = []
        for name in spec['hubs']:
            try: items += hub(name)
            except HelperError:
                if len(spec['hubs']) == 1: raise
        return {'items': [public(i) for i in pick(items, type_, spec['when'], today, size)]}

    # --- TV-facing request handling (pure; LanServer passes method/path/headers/client) ---
    def hello(self):
        return {'name': 'plex-neo-helper', 'version': VERSION, 'watchlist': True, 'discover': True,
                'features': ['watchlist', 'discover'] + (['update'] if self.update_on else [])}

    def handle(self, method, raw_path, headers, client):
        """-> (status, dict) or None when the path is not a helper route (LanServer then tries its static files)."""
        path, _, qs = raw_path.partition('?')
        if not (path == '/neo-helper' or path == '/watchlist' or path.startswith('/watchlist/') or path.startswith('/discover/')):
            return None
        try:
            if not host_ok(headers.get('Host')): raise HelperError(403, 'host')     # DNS rebinding: only IP literals
            return 200, self._route(method, path, qs, headers, client)
        except HelperError as e:
            return e.status, {'error': e.code}
        except Exception:                                  # never a traceback (could carry request data) to stderr/TV
            return 500, {'error': 'internal'}

    def _route(self, method, path, qs, headers, client):
        if not client_ok(client, self.store.allow): raise HelperError(403, 'lan_only')
        if not self.rate.ok(client): raise HelperError(429, 'rate')
        if path == '/neo-helper':
            if method != 'GET': raise HelperError(405, 'method')
            return self.hello()
        if not hmac.compare_digest(str(headers.get('X-Neo-Key') or ''), self.store.key): raise HelperError(401, 'key')
        uuid = str(headers.get('X-Neo-Profile') or '')
        if not UUID.match(uuid): raise HelperError(400, 'profile')
        q = parse_qs(qs)
        route = path if path in ('/watchlist', '/watchlist/state') else 'item' if path.startswith('/watchlist/') else 'discover'
        check_keys(q, route)
        if path == '/watchlist':
            if method != 'GET': raise HelperError(405, 'method')
            self._need_profile(uuid)
            return self.watchlist(uuid, q_choice(q, 'type', WL_TYPE, 'all'), q_int(q, 'start', 0, 0, 10000), q_int(q, 'size', 50, 1, MAX_ITEMS))
        if path == '/watchlist/state':
            if method != 'GET': raise HelperError(405, 'method')
            self._need_profile(uuid)
            ids = q_ids(q)
            return self.state(uuid, ids)
        if path.startswith('/watchlist/'):
            hexid = path[len('/watchlist/'):]
            if not HEX.match(hexid): raise HelperError(400, 'id')
            if method not in ('PUT', 'DELETE'): raise HelperError(405, 'method')
            self._need_profile(uuid)
            return self.set(uuid, hexid, method == 'PUT')
        lst = path[len('/discover/'):]
        if lst not in DISCOVER_LISTS: raise HelperError(404, 'route')
        if method != 'GET': raise HelperError(405, 'method')
        if not self.store.token(uuid) and not self.store.token(self.store.owner): raise HelperError(404, 'profile')
        return self.discover(uuid, lst, q_choice(q, 'type', {'movie': 1, 'show': 2}, None, required=True), q_int(q, 'size', 20, 1, 30))

    def _need_profile(self, uuid):
        if not self.store.token(uuid): raise HelperError(404, 'profile')     # e.g. profile with a Plex PIN


# ---------------------------------------------------------------- LAN check + parameter validation
def client_ok(addr, allow=''):
    """Only loopback or private/link-local IPv4 clients (RFC 1918, 169.254/16); with a TV address only that one (+ loopback).
    IPv6 is refused except ::1 (the server binds IPv4 only; avoids treating documentation/ULA ranges as 'home')."""
    try: ip = ipaddress.ip_address(str(addr).split('%')[0])
    except ValueError: return False
    if getattr(ip, 'ipv4_mapped', None): ip = ip.ipv4_mapped
    if ip.is_loopback: return True
    if allow: return str(ip) == allow
    return ip.version == 4 and is_private_ipv4(str(ip))


def host_ok(host):
    """Host header must be an IPv4 literal (the TV uses the address from setup.json) or loopback, optional port.
    A browser page that rebinds its own domain to the helper's address therefore gets 403."""
    m = re.fullmatch(r'(\d{1,3}(?:\.\d{1,3}){3}|localhost|\[::1\])(?::\d{1,5})?', str(host or ''))
    return bool(m)


ROUTE_KEYS = {'/watchlist': ('type', 'start', 'size'), '/watchlist/state': ('ids',), 'item': (), 'discover': ('type', 'size')}


def check_keys(q, route):
    if any(k not in ROUTE_KEYS[route] for k in q): raise HelperError(400, 'query')

def parse_qs(qs):
    if len(qs) > 1024: raise HelperError(400, 'query')
    try: pairs = urllib.parse.parse_qsl(qs, keep_blank_values=True, strict_parsing=bool(qs))
    except ValueError: raise HelperError(400, 'query')
    out = {}
    for k, v in pairs:
        if k in out: raise HelperError(400, 'query')       # no duplicate parameters
        out[k] = v
    return out


def q_int(q, name, default, lo, hi):
    v = q.get(name)
    if v is None: return default
    if not re.fullmatch(r'\d{1,6}', v) or not lo <= int(v) <= hi: raise HelperError(400, name)
    return int(v)


def q_choice(q, name, choices, default, required=False):
    v = q.get(name)
    if v is None:
        if required: raise HelperError(400, name)
        return default
    if v not in choices: raise HelperError(400, name)
    return v


def q_ids(q):
    ids = (q.get('ids') or '').split(',')
    if not ids or len(ids) > 30 or not all(HEX.match(i) for i in ids): raise HelperError(400, 'ids')
    return list(dict.fromkeys(ids))


# ---------------------------------------------------------------- headless mode (autostart / Docker)
def run_headless(path=None, port=HELPER_PORT, bind='0.0.0.0', out=None, wait=False, poll=30, sleep=time.sleep):
    """`plexneo_setup.py --helper`: only the helper, from the saved helper file (made in the setup UI).
    wait=True (Docker/NAS): keep checking for the file instead of exiting, so the container does not restart in a loop."""
    from .lanserver import LanServer
    out = out or sys.stdout
    told = False
    while True:
        try:
            store = Store.load(path)
            break
        except (OSError, ValueError) as e:
            if not told:
                out.write('Kein Helfer eingerichtet / no helper set up: %s (%s)\n'
                          'Bitte zuerst im Einrichtungsprogramm "Helfer einrichten" mit "Zugang merken" waehlen.\n'
                          'Please tick "Set up the helper" and "Remember access" in the setup program first.\n'
                          % (path or store_path(), 'missing' if isinstance(e, OSError) else 'invalid'))
                out.flush()
                told = True
            if not wait: return 2
            sleep(poll)
    cid = 'plexneo-helper-' + store.key[:8].encode().hex()[:12]
    srv = LanServer('helper', port, allow=[store.allow] if store.allow else None, bind=bind)
    srv.api = Helper(store, cid)
    srv.start()
    try:                                                   # Docker/systemd stop with SIGTERM -> clean shutdown
        import signal
        def _term(*a): raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, _term)
    except (ImportError, ValueError, AttributeError):
        pass
    out.write(brand.name() + ' Helfer %s laeuft auf Port %d (nur Heimnetz). Beenden: Ctrl+C\n' % (VERSION, srv.port)); out.flush()
    try:
        while True: sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        srv.stop()
    return 0
