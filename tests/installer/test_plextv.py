import unittest
import xml.etree.ElementTree as ET

import helpers as H
from neosetup import plextv
from neosetup.plextv import PlexTV, PlexError


class PinFlow(unittest.TestCase):
    def test_create_and_check_pin(self):
        f = H.FakeFetch(after=2)
        p = PlexTV('plexneo-test0001', fetch=f)
        pin = p.create_pin(strong=True)
        self.assertEqual(pin['id'], 4711)
        method, url, hdr = f.calls[0]
        self.assertEqual(method, 'POST')
        self.assertTrue(url.startswith('https://plex.tv/api/v2/pins?'))
        self.assertIn('strong=true', url)
        self.assertEqual(hdr['X-Plex-Client-Identifier'], 'plexneo-test0001')
        self.assertEqual(hdr['X-Plex-Product'], 'Neolume')
        self.assertNotIn('X-Plex-Token', hdr)
        self.assertIsNone(p.check_pin(4711))
        self.assertEqual(p.check_pin(4711), H.ACCOUNT_TOK)

    def test_link_pin_is_not_strong(self):
        f = H.FakeFetch()
        PlexTV('plexneo-test0001', fetch=f).create_pin(strong=False)
        self.assertIn('strong=false', f.calls[0][1])

    def test_check_pin_rejects_non_int(self):
        with self.assertRaises(ValueError): PlexTV('plexneo-test0001', fetch=H.FakeFetch()).check_pin('1/../x')

    def test_auth_url(self):
        u = plextv.auth_url('plexneo-abc', 'CODE123')
        self.assertTrue(u.startswith('https://app.plex.tv/auth#?'))
        self.assertIn('clientID=plexneo-abc', u)
        self.assertIn('code=CODE123', u)
        self.assertIn('context%5Bdevice%5D%5Bproduct%5D=Neolume', u)

    def test_parse_pin_errors(self):
        for bad in (None, [], {}, {'id': 'x', 'code': 'a'}, {'id': 1}):
            with self.assertRaises(PlexError): plextv.parse_pin(bad)
        self.assertIsNone(plextv.parse_pin({'id': 1, 'code': 'A', 'authToken': 'bad token!'})['authToken'])

    def test_http_errors_become_codes(self):
        p = PlexTV('plexneo-test0001', fetch=lambda *a, **k: (401, b''))
        with self.assertRaises(PlexError) as c: p.user('whatever-token')
        self.assertEqual(c.exception.code, 'http401')
        p = PlexTV('plexneo-test0001', fetch=lambda *a, **k: (200, b'not json'))
        with self.assertRaises(PlexError) as c: p.user('whatever-token')
        self.assertEqual(c.exception.code, 'parse')

    def test_only_fixed_api_paths(self):
        p = PlexTV('plexneo-test0001', fetch=H.FakeFetch())
        with self.assertRaises(ValueError): p._call('GET', 'https://evil.example/')
        with self.assertRaises(ValueError): p.shared_servers(H.ACCOUNT_TOK, '../../api/v2/user', [2])


class Parsing(unittest.TestCase):
    def test_user_drops_email(self):
        u = plextv.parse_user(H.USER_JSON)
        self.assertEqual(u['title'], 'Owner')
        self.assertNotIn('email', u)

    def test_resources(self):
        r = plextv.parse_resources(H.RESOURCES_JSON)
        self.assertEqual([s['name'] for s in r], ['Home Server', 'Friend Server'])   # non-server resource dropped
        home = r[0]
        self.assertTrue(home['owned'])
        self.assertEqual(home['token'], H.OWNER_TOK)
        self.assertEqual([c['address'] for c in home['connections']], ['1.2.3.4', '192.0.2.20'])  # relay dropped
        self.assertEqual(plextv.parse_resources({'not': 'a list'}), [])

    def test_home_users(self):
        u = plextv.parse_home_users(H.HOME_JSON)
        self.assertEqual(len(u), 5)
        self.assertTrue(u[0]['admin'])
        self.assertTrue(u[1]['restricted'] and u[1]['protected'])
        self.assertTrue(u[4]['guest'])

    def test_shared_servers(self):
        s = plextv.parse_shared_servers(ET.fromstring(H.SHARED_XML.encode()), [2, 3, 4, 78])
        self.assertEqual([(x['userID'], x['token']) for x in s],
                         [(2, H.KID_TOK), (3, H.TEEN_TOK)])   # invalid token / missing userID dropped

    def test_shared_servers_never_friends(self):
        # shared accounts outside Plex Home ("friends", userID 77) are dropped while parsing: their token is never kept
        s = plextv.parse_shared_servers(ET.fromstring(H.SHARED_XML.encode()), [2, 3])
        self.assertNotIn(77, [x['userID'] for x in s])
        self.assertNotIn(H.FRIEND_TOK, repr(s))
        self.assertEqual(plextv.parse_shared_servers(ET.fromstring(H.SHARED_XML.encode()), []), [])
        self.assertEqual(plextv.parse_shared_servers(ET.fromstring(H.SHARED_XML.encode()), None), [])

    def test_shared_servers_request(self):
        f = H.FakeFetch()
        s = PlexTV('plexneo-test0001', fetch=f).shared_servers(H.ACCOUNT_TOK, H.MID, [2, 3])
        self.assertEqual(len(s), 2)
        self.assertEqual(f.calls[0][1], 'https://plex.tv/api/servers/%s/shared_servers' % H.MID)
        self.assertEqual(f.calls[0][2]['Accept'], 'application/xml')

    def test_build_profiles(self):
        acc = plextv.parse_user(H.USER_JSON)
        home = plextv.parse_home_users(H.HOME_JSON)
        shared = plextv.parse_shared_servers(ET.fromstring(H.SHARED_XML.encode()), [u['id'] for u in home])
        p = plextv.build_profiles(acc, home, shared, H.OWNER_TOK)
        by = dict((x['title'], x) for x in p)
        self.assertEqual([x['title'] for x in p], ['Owner', 'Kid', 'Teen', 'NoShare'])
        self.assertEqual(by['Owner']['kind'], 'owner'); self.assertEqual(by['Owner']['token'], H.OWNER_TOK)
        self.assertTrue(by['Kid']['include']); self.assertEqual(by['Kid']['token'], H.KID_TOK)
        self.assertEqual(by['Kid']['restrictionProfile'], 'little_kid')
        self.assertIsNone(by['NoShare']['token']); self.assertFalse(by['NoShare']['include'])
        self.assertNotIn('Guest', by)
        self.assertEqual(by['Teen']['thumb'], '')            # non-plex.tv / http avatar dropped

    def test_build_profiles_never_friends(self):
        # even if a friend's entry reaches build_profiles (unfiltered list), it never becomes a profile
        acc = plextv.parse_user(H.USER_JSON)
        home = plextv.parse_home_users(H.HOME_JSON)
        shared = [{'userID': 77, 'username': 'buddy', 'token': H.FRIEND_TOK, 'allLibraries': True, 'accepted': True}]
        p = plextv.build_profiles(acc, home, shared, H.OWNER_TOK)
        self.assertNotIn('buddy', [x['title'] for x in p])
        self.assertNotIn('friend', [x['kind'] for x in p])
        self.assertNotIn(H.FRIEND_TOK, repr(p))

    def test_build_profiles_without_home(self):
        acc = plextv.parse_user(H.USER_JSON)
        p = plextv.build_profiles(acc, [], [], H.OWNER_TOK)
        self.assertEqual(len(p), 1)
        self.assertEqual(p[0]['kind'], 'owner')

    def test_safe_thumb(self):
        self.assertEqual(plextv.safe_thumb('https://plex.tv/users/x/avatar?c=1'), 'https://plex.tv/users/x/avatar?c=1')
        for bad in ('http://plex.tv/a', 'https://plex.tv.evil.com/a', 'javascript:alert(1)', 'https://evilplex.tv/a', ''):
            self.assertEqual(plextv.safe_thumb(bad), '', bad)

    def test_validators(self):
        self.assertTrue(plextv.valid_machine_id(H.MID))
        self.assertFalse(plextv.valid_machine_id('a/b/c/d/e/f'))
        self.assertFalse(plextv.valid_token('short'))
        self.assertFalse(plextv.valid_token('has space in it'))


if __name__ == '__main__':
    unittest.main()
