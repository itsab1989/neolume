"""plex.tv access for the one-time setup (PIN login, account, servers, Home profiles, per-profile server tokens).

Only fixed https URLs on plex.tv are ever requested (no caller-supplied URLs). The HTTP function is injectable
so that tests run fully offline with mocked responses.
"""
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from . import VERSION

PLEX_TV = 'https://plex.tv'
from . import brand


def product():
    return brand.name()
AUTH_APP = 'https://app.plex.tv/auth#?'
LINK_URL = 'https://plex.tv/link'
MAX_BODY = 4 << 20          # plex.tv answers are small; refuse anything absurd


class PlexError(Exception):
    """Error with a short machine-readable code for the UI (e.g. 'http401', 'network', 'parse')."""
    def __init__(self, code, detail=''):
        Exception.__init__(self, code)
        self.code, self.detail = code, detail


def urllib_fetch(method, url, headers, body=None, timeout=15):
    """Default HTTP function: returns (status, bytes). TLS certificate checks are on (default context)."""
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            return r.status, r.read(MAX_BODY + 1)
    except urllib.error.HTTPError as e:
        return e.code, b''
    except (urllib.error.URLError, OSError) as e:
        raise PlexError('network', str(getattr(e, 'reason', e)))


def _bool(v):
    if isinstance(v, bool): return v
    return str(v).strip().lower() in ('1', 'true', 'yes')


def _int(v):
    try: return int(v)
    except (TypeError, ValueError): return None


class PlexTV(object):
    def __init__(self, client_id, fetch=None, device_name=None):
        if not client_id or len(client_id) > 64: raise ValueError('client_id')
        self.client_id = client_id
        self.device_name = device_name or brand.name() + ' (TV)'
        self.fetch = fetch or urllib_fetch

    # ---------- low level ----------
    def headers(self, token=None, accept='application/json'):
        h = {'Accept': accept, 'X-Plex-Product': product(), 'X-Plex-Version': VERSION,
             'X-Plex-Client-Identifier': self.client_id, 'X-Plex-Device-Name': self.device_name,
             'X-Plex-Platform': 'Samsung', 'X-Plex-Device': 'Orsay TV (Setup)'}
        if token: h['X-Plex-Token'] = token
        return h

    def _call(self, method, path, query=None, token=None, accept='application/json'):
        if not path.startswith('/api/'): raise ValueError('path')      # fixed API paths only
        url = PLEX_TV + path + ('?' + urllib.parse.urlencode(query) if query else '')
        status, data = self.fetch(method, url, self.headers(token, accept), b'' if method == 'POST' else None)
        if len(data) > MAX_BODY: raise PlexError('parse', 'too large')
        if status < 200 or status >= 300: raise PlexError('http%d' % status)
        return data

    def _json(self, *a, **k):
        try: return json.loads(self._call(*a, **k).decode('utf-8'))
        except ValueError: raise PlexError('parse')

    def _xml(self, *a, **k):
        k['accept'] = 'application/xml'
        try: return ET.fromstring(self._call(*a, **k))
        except ET.ParseError: raise PlexError('parse')

    # ---------- PIN login ----------
    def create_pin(self, strong=True):
        """strong=True: long code for the app.plex.tv/auth link; False: 4-character code for plex.tv/link."""
        d = self._json('POST', '/api/v2/pins', {'strong': 'true' if strong else 'false'})
        return parse_pin(d)

    def check_pin(self, pin_id):
        if not isinstance(pin_id, int): raise ValueError('pin id')
        d = self._json('GET', '/api/v2/pins/%d' % pin_id)
        return parse_pin(d)['authToken']

    def auth_url(self, code):
        return auth_url(self.client_id, code)

    # ---------- account data ----------
    def user(self, token):
        return parse_user(self._json('GET', '/api/v2/user', token=token))

    def resources(self, token):
        d = self._json('GET', '/api/v2/resources', {'includeHttps': 1, 'includeRelay': 0, 'includeIPv6': 0}, token=token)
        return parse_resources(d)

    def home_users(self, token):
        return parse_home_users(self._json('GET', '/api/v2/home/users', token=token))

    def shared_servers(self, token, machine_id, user_ids):
        """Server tokens of the Plex Home users (user_ids) for this server. plex.tv answers with every account the server is
        shared with; entries of other accounts (friends outside Plex Home) are dropped right here, their tokens are never kept."""
        if not valid_machine_id(machine_id): raise ValueError('machine id')
        return parse_shared_servers(self._xml('GET', '/api/servers/%s/shared_servers' % machine_id, token=token), user_ids)

    def switch_home_user(self, token, user_id):
        """plex.tv token of a Plex Home profile WITHOUT a Plex PIN (POST /api/home/users/<id>/switch, as python-plexapi
        switchHomeUser). Used only for the optional helper (watchlist per profile). Profiles with a PIN are skipped:
        the setup never asks for or stores Plex PINs."""
        if not isinstance(user_id, int): raise ValueError('user id')
        root = self._xml('POST', '/api/home/users/%d/switch' % user_id, token=token)
        tok = root.get('authenticationToken') or root.get('authToken')
        if not valid_token(tok): raise PlexError('parse', 'switch')
        return tok


# ---------- parsing (pure functions, unit-tested) ----------
def valid_machine_id(m):
    return isinstance(m, str) and 8 <= len(m) <= 64 and all(c.isalnum() or c == '-' for c in m)


def valid_token(t):
    return isinstance(t, str) and 8 <= len(t) <= 256 and all(c.isalnum() or c in '-_.~' for c in t)


def parse_pin(d):
    if not isinstance(d, dict) or _int(d.get('id')) is None or not d.get('code'):
        raise PlexError('parse', 'pin')
    tok = d.get('authToken')
    return {'id': _int(d['id']), 'code': str(d['code']), 'expiresIn': _int(d.get('expiresIn')) or 900,
            'authToken': tok if valid_token(tok) else None}


def auth_url(client_id, code):
    q = urllib.parse.urlencode([('clientID', client_id), ('code', code), ('context[device][product]', product())])
    return AUTH_APP + q


def parse_user(d):
    if not isinstance(d, dict) or _int(d.get('id')) is None: raise PlexError('parse', 'user')
    # no e-mail address: not needed and personal data
    return {'id': _int(d['id']), 'uuid': str(d.get('uuid') or ''), 'title': str(d.get('title') or d.get('username') or ''),
            'thumb': str(d.get('thumb') or '')}


def parse_resources(d):
    """Servers from /api/v2/resources. Connections: only non-relay IPv4 with an address; local flag kept."""
    out = []
    for r in d if isinstance(d, list) else []:
        if not isinstance(r, dict) or 'server' not in str(r.get('provides') or ''): continue
        mid = r.get('clientIdentifier')
        if not valid_machine_id(mid): continue
        conns = []
        for c in r.get('connections') or []:
            if not isinstance(c, dict) or _bool(c.get('relay')) or _bool(c.get('IPv6')): continue
            addr, port = str(c.get('address') or ''), _int(c.get('port')) or 32400
            if not addr or not (0 < port < 65536): continue
            conns.append({'address': addr, 'port': port, 'local': _bool(c.get('local'))})
        tok = r.get('accessToken')
        # httpsRequired: owner set "Secure connections: Required" -> no plain http (the TV cannot do TLS 1.2), see wizard.others_scan
        out.append({'machineIdentifier': mid, 'name': str(r.get('name') or '')[:64], 'version': str(r.get('productVersion') or ''),
                    'owned': _bool(r.get('owned')), 'token': tok if valid_token(tok) else None, 'connections': conns,
                    'httpsRequired': _bool(r.get('httpsRequired'))})
    return out


def parse_home_users(d):
    lst = d.get('users') if isinstance(d, dict) else d
    out = []
    for u in lst if isinstance(lst, list) else []:
        if not isinstance(u, dict) or _int(u.get('id')) is None: continue
        out.append({'id': _int(u['id']), 'uuid': str(u.get('uuid') or ''),
                    'title': str(u.get('title') or u.get('friendlyName') or u.get('username') or '?'),
                    'thumb': str(u.get('thumb') or ''), 'admin': _bool(u.get('admin')), 'guest': _bool(u.get('guest')),
                    'restricted': _bool(u.get('restricted')), 'restrictionProfile': str(u.get('restrictionProfile') or ''),
                    'protected': _bool(u.get('protected'))})
    return out


def parse_shared_servers(root, user_ids):
    """XML <MediaContainer><SharedServer userID= username= accessToken= .../></MediaContainer> -> list, only entries whose
    userID is in user_ids (Plex Home users). Shared accounts outside Plex Home ("friends") are never returned."""
    allowed = set(user_ids or ())
    out = []
    for s in root.iter('SharedServer'):
        uid, tok = _int(s.get('userID')), s.get('accessToken')
        if uid is None or uid not in allowed or not valid_token(tok): continue
        out.append({'userID': uid, 'username': s.get('username') or '', 'token': tok,
                    'allLibraries': _bool(s.get('allLibraries')), 'accepted': bool(s.get('acceptedAt'))})
    return out


def build_profiles(account, home_users, shared, owner_token):
    """Profiles for the TV: owner (server token from resources) + every Home user with a shared-server token.
    Home users without a token are returned with token=None so the UI can explain why they are missing.
    Shared accounts outside Plex Home ("friends") never become profiles, even if `shared` contains them."""
    profiles, seen = [], set()
    by_uid = dict((s['userID'], s) for s in shared)
    admin = None
    for u in home_users:
        if u['admin'] or (account and u['id'] == account['id']): admin = u
    owner = admin or ({'id': account['id'], 'uuid': account['uuid'], 'title': account['title'], 'thumb': account['thumb'],
                       'restricted': False, 'restrictionProfile': ''} if account else None)
    if owner:
        profiles.append(_profile(owner, owner_token, 'owner', True))
        seen.add(owner['id'])
    for u in home_users:
        if u['id'] in seen or u['guest']: continue
        s = by_uid.get(u['id'])
        profiles.append(_profile(u, s['token'] if s else None, 'home', bool(s)))
        seen.add(u['id'])
    return profiles


def _profile(u, token, kind, include):
    return {'id': u['id'], 'uuid': u.get('uuid', ''), 'title': u.get('title', '?'), 'thumb': safe_thumb(u.get('thumb', '')),
            'kind': kind, 'restricted': bool(u.get('restricted')), 'restrictionProfile': u.get('restrictionProfile', ''),
            'token': token, 'include': bool(include and token)}


def safe_thumb(url):
    """Avatar URLs are later loaded by the TV via the PMS photo transcoder: allow only https on plex.tv hosts."""
    try: p = urllib.parse.urlsplit(url)
    except ValueError: return ''
    host = (p.hostname or '').lower()
    if p.scheme == 'https' and (host == 'plex.tv' or host.endswith('.plex.tv')): return url
    return ''
