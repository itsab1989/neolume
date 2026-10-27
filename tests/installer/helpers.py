"""Shared fakes for the installer tests (no network: plex.tv and the PMS are mocked)."""
import json
import os
import sys
import tempfile

# Never touch the real per-user settings/helper files from tests (Wizard(helper_file=None) loads the default path).
os.environ['PLEXNEO_SETUP_DIR'] = tempfile.mkdtemp(prefix='plexneo-test-')

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'installer'))

MID = 'abcdef0123456789abcdef0123456789abcdef01'
OWNER_TOK = 'ownerTok-1234567890'
KID_TOK = 'kidTok-1234567890ab'
TEEN_TOK = 'teenTok-1234567890a'
FRIEND_TOK = 'friendTok-123456789'
ACCOUNT_TOK = 'accountTok-12345678'

PIN_JSON = {'id': 4711, 'code': 'abcdefghijklmnopqrstuvwxy', 'expiresIn': 900, 'authToken': None}
USER_JSON = {'id': 1, 'uuid': 'u-owner', 'username': 'owner', 'title': 'Owner', 'email': 'owner@example.com',
             'thumb': 'https://plex.tv/users/u-owner/avatar'}
RESOURCES_JSON = [
    {'name': 'Home Server', 'product': 'Plex Media Server', 'productVersion': '1.43.5', 'provides': 'server',
     'clientIdentifier': MID, 'owned': True, 'accessToken': OWNER_TOK,
     'connections': [
         {'protocol': 'https', 'address': '1.2.3.4', 'port': 32400, 'local': False, 'relay': False, 'IPv6': False},
         {'protocol': 'https', 'address': '192.0.2.20', 'port': 32400, 'local': True, 'relay': False, 'IPv6': False},
         {'protocol': 'https', 'address': '10.0.0.5', 'port': 32400, 'local': False, 'relay': True, 'IPv6': False}]},
    {'name': 'Friend Server', 'provides': 'server', 'clientIdentifier': 'ffff0000ffff0000', 'owned': False,
     'accessToken': 'otherTok-123456789', 'connections': [
         {'address': '5.6.7.8', 'port': 32400, 'local': False}]},
    {'name': 'Phone', 'provides': 'client,player', 'clientIdentifier': 'phone0000phone', 'connections': []},
]
HOME_JSON = {'users': [
    {'id': 1, 'uuid': 'u-owner', 'title': 'Owner', 'admin': True, 'thumb': 'https://plex.tv/users/u-owner/avatar'},
    {'id': 2, 'uuid': 'u-kid', 'title': 'Kid', 'restricted': True, 'restrictionProfile': 'little_kid',
     'thumb': 'https://plex.tv/users/u-kid/avatar', 'protected': True},
    {'id': 3, 'uuid': 'u-teen', 'title': 'Teen', 'restricted': True, 'thumb': 'http://evil.example/x.png'},
    {'id': 4, 'uuid': 'u-new', 'title': 'NoShare'},
    {'id': 9, 'uuid': 'u-guest', 'title': 'Guest', 'guest': True},
]}
SHARED_XML = ('<?xml version="1.0" encoding="UTF-8"?>\n<MediaContainer friendlyName="myPlex" size="5">'
              '<SharedServer id="11" username="Kid" userID="2" accessToken="%s" owned="1" allLibraries="0" acceptedAt="1"/>'
              '<SharedServer id="12" username="Teen" userID="3" accessToken="%s" owned="1" allLibraries="0" acceptedAt="1"/>'
              '<SharedServer id="13" username="buddy" userID="77" accessToken="%s" owned="1" allLibraries="1" acceptedAt="1"/>'
              '<SharedServer id="14" username="bad" userID="78" accessToken="x y"/>'
              '<SharedServer id="15" username="nouid" accessToken="abcdefghijkl"/>'
              '</MediaContainer>') % (KID_TOK, TEEN_TOK, FRIEND_TOK)


class FakeFetch(object):
    """Mock for the plex.tv HTTP function; records calls; pin becomes authorized after `after` checks."""
    def __init__(self, after=1):
        self.calls = []
        self.after = after
        self.checks = 0

    def __call__(self, method, url, headers, body=None, timeout=15):
        self.calls.append((method, url, dict(headers)))
        path = url.split('https://plex.tv', 1)[1].split('?')[0]
        if method == 'POST' and path == '/api/v2/pins':
            return 201, json.dumps(PIN_JSON).encode()
        if path == '/api/v2/pins/4711':
            self.checks += 1
            d = dict(PIN_JSON, authToken=ACCOUNT_TOK if self.checks >= self.after else None)
            return 200, json.dumps(d).encode()
        if headers.get('X-Plex-Token') != ACCOUNT_TOK: return 401, b''
        if path == '/api/v2/user': return 200, json.dumps(USER_JSON).encode()
        if path == '/api/v2/resources': return 200, json.dumps(RESOURCES_JSON).encode()
        if path == '/api/v2/home/users': return 200, json.dumps(HOME_JSON).encode()
        if path == '/api/servers/%s/shared_servers' % MID: return 200, SHARED_XML.encode()
        return 404, b''


class FakePMS(object):
    """Mock for netutil.http_get: PMS at 192.0.2.20:32400; tokens see different numbers of libraries."""
    LIBS = {OWNER_TOK: 4, KID_TOK: 2, TEEN_TOK: 3, FRIEND_TOK: 4}

    def __init__(self):
        self.calls = []

    def __call__(self, url, headers=None, timeout=3):
        self.calls.append((url, dict(headers or {})))
        if url == 'http://192.0.2.20:32400/identity':
            return 200, json.dumps({'MediaContainer': {'machineIdentifier': MID, 'version': '1.43'}}).encode()
        if url == 'http://192.0.2.20:32400/library/sections':
            n = self.LIBS.get((headers or {}).get('X-Plex-Token'))
            if n is None: return 401, b''
            return 200, json.dumps({'MediaContainer': {'size': n}}).encode()
        raise OSError('unreachable')


def base_entries():
    return [
        ('widget.info', b'Screen Resolution = 1280x720\n'),
        ('boot.js', b"var Boot = (function () {\n  var DEV_HOST = '192.0.2.10';\n})();\n"),
        ('index.html', b'<html></html>'),
        ('config.xml', b'<widget><ver itemtype="string">0.0.2</ver><widgetname itemtype="string">Test App</widgetname></widget>'),
        ('icon/w4_00000000_106x87.png', b'PNG'),
        ('app.js', b'var App = {};'),
        ('icons.png', b'PNG'),
        ('bench.js', b'old prototype'),
        ('setup.json', b'{"old": true}'),
    ]
