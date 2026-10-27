import unittest

import helpers as H
from neosetup import netutil, plextv


class Gdm(unittest.TestCase):
    REPLY = (b'HTTP/1.0 200 OK\r\nContent-Type: plex/media-server\r\nResource-Identifier: ' + H.MID.encode() +
             b'\r\nName: Home Server\r\nPort: 32400\r\nVersion: 1.43\r\n\r\n')

    def test_parse(self):
        r = netutil.parse_gdm(self.REPLY, '192.0.2.20')
        self.assertEqual(r, {'machineIdentifier': H.MID, 'name': 'Home Server', 'port': 32400, 'address': '192.0.2.20'})

    def test_reject(self):
        self.assertIsNone(netutil.parse_gdm(self.REPLY, '1.2.3.4'))       # public sender
        self.assertIsNone(netutil.parse_gdm(b'garbage', '192.0.2.20'))
        self.assertIsNone(netutil.parse_gdm(self.REPLY.replace(b'32400\r\nV', b'99999\r\nV'), '192.0.2.20'))
        self.assertIsNone(netutil.parse_gdm(self.REPLY.replace(b'plex/media-server', b'plex/media-player'), '192.0.2.20'))


class Addresses(unittest.TestCase):
    def setUp(self):
        self.srv = plextv.parse_resources(H.RESOURCES_JSON)[0]

    def test_private_only_local_first(self):
        self.assertEqual(netutil.candidate_uris(self.srv, []), ['http://192.0.2.20:32400'])   # public 1.2.3.4 never

    def test_gdm_first_and_dedupe(self):
        g = [{'machineIdentifier': H.MID, 'address': '192.168.1.5', 'port': 32400, 'name': ''},
             {'machineIdentifier': 'other', 'address': '192.168.1.6', 'port': 32400, 'name': ''},
             {'machineIdentifier': H.MID, 'address': '192.0.2.20', 'port': 32400, 'name': ''}]
        self.assertEqual(netutil.candidate_uris(self.srv, g), ['http://192.168.1.5:32400', 'http://192.0.2.20:32400'])

    def test_merge(self):
        res = plextv.parse_resources(H.RESOURCES_JSON)
        g = [{'machineIdentifier': 'gdmonly0000', 'address': '192.168.1.9', 'port': 32400, 'name': 'Neighbour'}]
        m = netutil.merge_servers(res, g)
        self.assertEqual([s['name'] for s in m], ['Home Server', 'Friend Server', 'Neighbour'])
        self.assertEqual(m[1]['uris'], [])                 # friend server only public -> unusable
        self.assertTrue(m[2]['foreign'])

    def test_private_checks(self):
        for a in ('192.168.0.1', '10.1.2.3', '172.16.0.1', '169.254.1.1'): self.assertTrue(netutil.is_private_ipv4(a), a)
        for a in ('8.8.8.8', '127.0.0.1', '0.0.0.0', '224.0.0.1', 'fe80::1', 'example.com', ''): self.assertFalse(netutil.is_private_ipv4(a), a)

    def test_lan_client_ok(self):
        self.assertTrue(netutil.lan_client_ok('192.168.0.50'))
        self.assertTrue(netutil.lan_client_ok('127.0.0.1'))
        self.assertTrue(netutil.lan_client_ok('::ffff:192.168.0.50'))
        self.assertFalse(netutil.lan_client_ok('8.8.8.8'))
        self.assertFalse(netutil.lan_client_ok('nonsense'))
        self.assertTrue(netutil.lan_client_ok('192.168.0.50', {'192.168.0.50'}))
        self.assertFalse(netutil.lan_client_ok('192.168.0.51', {'192.168.0.50'}))


class Probes(unittest.TestCase):
    def test_identity(self):
        pms = H.FakePMS()
        self.assertEqual(netutil.probe_identity('http://192.0.2.20:32400', pms), H.MID)
        self.assertNotIn('X-Plex-Token', pms.calls[0][1])                 # no token for /identity
        self.assertIsNone(netutil.probe_identity('http://192.0.2.99:32400', pms))
        self.assertIsNone(netutil.probe_identity('http://1.2.3.4:32400', pms))     # public: not even asked
        self.assertEqual(len(pms.calls), 2)

    def test_identity_xml(self):
        self.assertEqual(netutil.parse_identity(b'<MediaContainer machineIdentifier="m1"/>'), 'm1')
        self.assertIsNone(netutil.parse_identity(b'<<<'))

    def test_pick_reachable(self):
        pms = H.FakePMS()
        self.assertEqual(netutil.pick_reachable(['http://192.0.2.99:32400', 'http://192.0.2.20:32400'], H.MID, pms), 'http://192.0.2.20:32400')
        self.assertIsNone(netutil.pick_reachable(['http://192.0.2.20:32400'], 'othermachine', pms))

    def test_count_sections_uses_header(self):
        pms = H.FakePMS()
        self.assertEqual(netutil.count_sections('http://192.0.2.20:32400', H.KID_TOK, pms), 2)
        self.assertIsNone(netutil.count_sections('http://192.0.2.20:32400', 'wrongtoken12345', pms))
        self.assertNotIn(H.KID_TOK, pms.calls[0][0])                       # token in header, not in URL


if __name__ == '__main__':
    unittest.main()
