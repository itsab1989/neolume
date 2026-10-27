"""Weitere Server: servers OTHER people shared with the chosen profiles (plex.tv mocked, PMS probes mocked).
Example addresses only (RFC 5737 documentation ranges), never real servers."""
import io
import json
import os
import shutil
import tempfile
import unittest
import zipfile

import helpers as H
from neosetup import helper as HP
from neosetup import netutil, package
from neosetup.plextv import PlexTV, parse_resources
from neosetup.wizard import Wizard, StepError

OTHER = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555'      # friend's server: http works ("Secure connections: Preferred")
SECURE = 'bbbb1111bbbb2222cccc3333dddd4444eeee5555'     # requires https -> not usable on the TV
DOWN = 'cccc1111bbbb2222cccc3333dddd4444eeee5555'       # no answer right now
OWNER_OTHER_TOK = 'ownerOtherTok-12345'
TEEN_OTHER_TOK = 'teenOtherTok-123456'
OWNER_SECURE_TOK = 'ownerSecureTok-1234'
OWNER_DOWN_TOK = 'ownerDownTok-123456'
TEEN_PLEX_TOK = 'teenPlexTok-1234567'


def res(mid, name, tok, conns, owned=False, https=False):
    return {'name': name, 'provides': 'server', 'clientIdentifier': mid, 'owned': owned, 'accessToken': tok,
            'httpsRequired': https, 'connections': conns}


OWNER_RES = [
    H.RESOURCES_JSON[0],                                              # own server
    res(OTHER, 'Freund', OWNER_OTHER_TOK, [
        {'protocol': 'https', 'address': '198.51.100.9', 'port': 32400, 'local': True, 'relay': False, 'IPv6': False},
        {'protocol': 'https', 'address': '203.0.113.7', 'port': 32400, 'local': False, 'relay': False, 'IPv6': False},
        {'protocol': 'https', 'address': '203.0.113.99', 'port': 8443, 'local': False, 'relay': True, 'IPv6': False},
        {'protocol': 'https', 'address': '2001:db8::1', 'port': 32400, 'local': False, 'relay': False, 'IPv6': True}]),
    res(SECURE, 'Sicher', OWNER_SECURE_TOK, [{'address': '203.0.113.20', 'port': 32400, 'local': False}], https=True),
    res(DOWN, 'Aus', OWNER_DOWN_TOK, [{'address': '203.0.113.30', 'port': 32400, 'local': False}]),
]
TEEN_RES = [
    dict(H.RESOURCES_JSON[0], owned=False, accessToken=H.TEEN_TOK),   # own server seen by a Home profile: never "other"
    res(OTHER, 'Freund', TEEN_OTHER_TOK, [{'address': '203.0.113.7', 'port': 32400, 'local': False}]),
]


class Fetch(object):
    def __init__(self):
        self.calls = []
        self.base = H.FakeFetch(after=1)

    def __call__(self, method, url, headers, body=None, timeout=15):
        self.calls.append((method, url, headers.get('X-Plex-Token')))
        path = url.split('https://plex.tv', 1)[1].split('?')[0]
        if method == 'POST' and path == '/api/home/users/3/switch':
            return 201, ('<user id="3" authenticationToken="%s"/>' % TEEN_PLEX_TOK).encode()
        if path == '/api/v2/resources':
            tok = headers.get('X-Plex-Token')
            if tok == H.ACCOUNT_TOK: return 200, json.dumps(OWNER_RES).encode()
            if tok == TEEN_PLEX_TOK: return 200, json.dumps(TEEN_RES).encode()
            return 401, b''
        return self.base(method, url, headers, body, timeout)


class PMS(H.FakePMS):
    """Own PMS like H.FakePMS; the friend's server answers /identity over plain http on its public address only."""
    def __call__(self, url, headers=None, timeout=3):
        if url == 'http://203.0.113.7:32400/identity':
            self.calls.append((url, dict(headers or {})))
            return 200, json.dumps({'MediaContainer': {'machineIdentifier': OTHER}}).encode()
        return H.FakePMS.__call__(self, url, headers, timeout)


class Parse(unittest.TestCase):
    def test_https_required_and_candidates(self):
        r = parse_resources(OWNER_RES)
        by = dict((x['machineIdentifier'], x) for x in r)
        self.assertTrue(by[SECURE]['httpsRequired'])
        self.assertFalse(by[OTHER]['httpsRequired'])
        # relay and IPv6 dropped already by parse_resources; local first, then remote
        self.assertEqual(netutil.other_candidate_uris(by[OTHER]), ['http://198.51.100.9:32400', 'http://203.0.113.7:32400'])

    def test_net_ipv4(self):
        for ok in ('203.0.113.7', '192.168.1.2', '10.0.0.1'): self.assertTrue(netutil.is_net_ipv4(ok), ok)
        for bad in ('example.com', '0.0.0.0', '127.0.0.1', '224.0.0.1', '240.0.0.1', '2001:db8::1', '203.0.113', '010.0.0.1', ''):
            self.assertFalse(netutil.is_net_ipv4(bad), bad)
        self.assertIsNone(netutil.probe_identity_net('http://example.com:32400', lambda *a: (200, b'{}')))
        self.assertIsNone(netutil.probe_identity_net('https://203.0.113.7:32400', lambda *a: (200, b'{}')))


class Flow(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.fetch = Fetch()
        self.pms = PMS()
        gdm = [{'machineIdentifier': H.MID, 'address': '192.0.2.20', 'port': 32400, 'name': 'Home Server'}]
        self.w = Wizard(H.base_entries, prefs={}, plextv_factory=lambda cid: PlexTV(cid, fetch=self.fetch), http_get=self.pms,
                        gdm=lambda: gdm, lan_ip=lambda towards: '192.0.2.10', sync_port=0, update_port=0,
                        settings_file=os.path.join(self.dir, 's.json'), helper_file=os.path.join(self.dir, 'h.json'))
        self.w.login_start('auth'); self.w.login_poll()
        self.w.choose_server(H.MID)
        self.w.set_profiles([1, 2, 3])                       # Owner, Kid (Plex PIN), Teen (no PIN)

    def tearDown(self):
        self.w.sync.stop(); self.w.update.stop()
        shutil.rmtree(self.dir)

    def cfg(self):
        with zipfile.ZipFile(io.BytesIO(self.w.package)) as z: return json.loads(z.read('setup.json'))

    def test_default_off_and_old_format(self):
        self.w.build()
        cfg = self.cfg()
        self.assertNotIn('serversSchema', cfg)               # nothing chosen -> file exactly as before
        self.assertTrue(all('servers' not in p for p in cfg['profiles']))

    def test_scan_choose_build(self):
        self.w.others_scan()
        st = self.w.public_state()['others']
        self.assertTrue(st['scanned'])
        by = dict((o['id'], o) for o in st['list'])
        self.assertEqual(sorted(by), sorted([OTHER, SECURE, DOWN]))   # own server never listed, also not via the Home profile
        self.assertEqual((by[OTHER]['status'], by[SECURE]['status'], by[DOWN]['status']), ('ok', 'https', 'unreachable'))
        self.assertEqual(by[OTHER]['profiles'], ['Owner', 'Teen'])
        self.assertEqual(st['skipped'], ['Kid'])             # Plex PIN: never asked, not checked
        self.assertFalse(any(o['include'] for o in st['list']))   # default: off
        s = json.dumps(self.w.public_state()['others'])        # names/status only: no tokens, no addresses
        for secret in (OWNER_OTHER_TOK, TEEN_OTHER_TOK, OWNER_SECURE_TOK, TEEN_PLEX_TOK, '203.0.113.7', '198.51.100.9'):
            self.assertNotIn(secret, s)
        # http probes: /identity only, never with a token
        foreign = [c for c in self.pms.calls if '203.0.113.' in c[0] or '198.51.100.' in c[0]]
        self.assertTrue(foreign)
        self.assertTrue(all(c[0].endswith('/identity') and 'X-Plex-Token' not in c[1] for c in foreign))

        self.w.set_others([OTHER, SECURE, DOWN])
        st = dict((o['id'], o['include']) for o in self.w.public_state()['others']['list'])
        self.assertEqual(st, {OTHER: True, SECURE: False, DOWN: True})   # https-only cannot be chosen
        self.w.set_others([OTHER])
        info = self.w.build()
        self.assertEqual(info['others'], ['Freund'])
        cfg = self.cfg()
        self.assertEqual(cfg['serversSchema'], 1)
        prof = dict((p['title'], p) for p in cfg['profiles'])
        self.assertEqual(prof['Owner']['servers'], [{'machineIdentifier': OTHER, 'name': 'Freund',
                                                      'uris': ['http://203.0.113.7:32400', 'http://198.51.100.9:32400'], 'token': OWNER_OTHER_TOK}])
        self.assertEqual([(x['machineIdentifier'], x['token']) for x in prof['Teen']['servers']], [(OTHER, TEEN_OTHER_TOK)])
        self.assertNotIn('servers', prof['Kid'])
        self.assertNotIn(TEEN_PLEX_TOK, json.dumps(cfg))     # the plex.tv token of the profile never goes to the TV

    def test_bad_input_and_profile_change(self):
        with self.assertRaises(StepError): self.w.set_others('x')
        with self.assertRaises(StepError): self.w.set_others([1])
        self.w.others_scan()
        self.w.set_others([OTHER])
        self.w.set_profiles([1])                             # profiles changed -> search again
        self.assertFalse(self.w.public_state()['others']['scanned'])
        self.w.build()
        self.assertNotIn('serversSchema', self.cfg())

    def test_rescan_keeps_choice(self):
        self.w.others_scan()
        self.w.set_others([OTHER])
        self.w.others_scan()
        self.assertEqual([o['id'] for o in self.w.public_state()['others']['list'] if o['include']], [OTHER])


class Config(unittest.TestCase):
    def test_make_config_only_profiles_with_access(self):
        profiles = [{'id': 1, 'uuid': 'u1', 'title': 'A', 'kind': 'owner', 'token': 'tokA-12345678', 'include': True},
                    {'id': 2, 'uuid': 'u2', 'title': 'B', 'kind': 'home', 'token': 'tokB-12345678', 'include': False},
                    {'id': 3, 'uuid': 'u3', 'title': 'C', 'kind': 'home', 'token': 'tokC-12345678', 'include': True}]
        others = [{'machineIdentifier': OTHER, 'name': 'F', 'uris': ['http://203.0.113.7:32400'], 'status': 'ok', 'include': True,
                   'tokens': {2: 'x-tokB-123456', 3: 'x-tokC-123456'}},
                  {'machineIdentifier': SECURE, 'name': 'S', 'uris': ['http://203.0.113.20:32400'], 'status': 'https', 'include': True,
                   'tokens': {1: 'x-tokA-123456'}}]
        cfg = package.make_config('cid', {'machineIdentifier': H.MID}, ['http://192.0.2.20:32400'], profiles, others=others)
        self.assertEqual([p['title'] for p in cfg['profiles']], ['A', 'C'])
        self.assertNotIn('servers', cfg['profiles'][0])      # A has no access to F; S requires https
        self.assertEqual(cfg['profiles'][1]['servers'][0]['token'], 'x-tokC-123456')


class HelperServers(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def fetch(method, url, headers, timeout=10):
            assert HP.upstream_allowed(method, url), url
            self.calls.append((method, url, headers.get('X-Plex-Token')))
            return 200, json.dumps(OWNER_RES).encode()
        s = HP.Store('k' * 24)
        s.add('u-owner', 'plexTok-123456789', 'Owner', 'owner')
        self.h = HP.Helper(s, 'plexneo-helper-test', fetch=fetch, clock=lambda: 1000.0, rate=HP.RateLimit(1000, 1))

    def test_route(self):
        hd = {'X-Neo-Key': 'k' * 24, 'X-Neo-Profile': 'u-owner', 'Host': '10.0.0.10:32499'}
        st, body = self.h.handle('GET', '/servers', hd, '10.0.0.50')
        self.assertEqual(st, 200)
        by = dict((x['id'], x['uris']) for x in body['servers'])
        self.assertEqual(sorted(by), sorted([OTHER, DOWN]))  # own server and https-only servers are left out
        self.assertEqual(by[OTHER], ['http://198.51.100.9:32400', 'http://203.0.113.7:32400'])
        self.assertNotIn('plexTok', json.dumps(body))
        self.assertNotIn(OWNER_OTHER_TOK, json.dumps(body))  # never a server token to the TV
        self.assertEqual(self.calls[0][0:1], ('GET',))
        self.assertTrue(self.calls[0][1].startswith('https://plex.tv/api/v2/resources?'))
        self.h.handle('GET', '/servers', hd, '10.0.0.50')
        self.assertEqual(len(self.calls), 1)                 # cached
        self.assertEqual(self.h.handle('GET', '/servers', dict(hd, **{'X-Neo-Key': 'x' * 24}), '10.0.0.50')[0], 401)
        self.assertEqual(self.h.handle('GET', '/servers', dict(hd, **{'X-Neo-Profile': 'u-nobody'}), '10.0.0.50')[0], 404)
        self.assertEqual(self.h.handle('GET', '/servers?x=1', hd, '10.0.0.50')[0], 400)
        self.assertEqual(self.h.handle('PUT', '/servers', hd, '10.0.0.50')[0], 405)
        self.assertEqual(self.h.handle('GET', '/servers', hd, '8.8.8.8')[0], 403)   # only home-network clients
        self.assertIn('servers', self.h.hello()['features'])


if __name__ == '__main__':
    unittest.main()
