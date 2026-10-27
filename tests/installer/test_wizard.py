"""Whole setup flow with mocked plex.tv / PMS / GDM: login -> server -> profiles -> package -> sync -> finish."""
import io
import json
import os
import shutil
import tempfile
import unittest
import urllib.request
import zipfile

import helpers as H
from neosetup.plextv import PlexTV
from neosetup.wizard import Wizard, StepError

GDM = [{'machineIdentifier': H.MID, 'address': '192.0.2.20', 'port': 32400, 'name': 'Home Server'}]


class Flow(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.fetch = H.FakeFetch(after=2)
        self.pms = H.FakePMS()
        self.w = Wizard(H.base_entries, prefs={}, plextv_factory=lambda cid: PlexTV(cid, fetch=self.fetch),
                        http_get=self.pms, gdm=lambda: GDM, lan_ip=lambda towards: '127.0.0.1' if towards else None,
                        sync_port=0, update_port=0, settings_file=os.path.join(self.dir, 's.json'))
        self.w.lan_ip = lambda towards: '192.0.2.10'

    def tearDown(self):
        self.w.sync.stop(); self.w.update.stop()
        shutil.rmtree(self.dir)

    def login(self):
        r = self.w.login_start('auth')
        self.assertTrue(r['url'].startswith('https://app.plex.tv/auth#?'))
        self.assertEqual(self.w.login_poll(), {'done': False})
        self.assertEqual(self.w.login_poll(), {'done': True})

    def assert_no_secrets(self, obj):
        s = json.dumps(obj)
        for tok in (H.ACCOUNT_TOK, H.OWNER_TOK, H.KID_TOK, H.TEEN_TOK, H.FRIEND_TOK):
            self.assertNotIn(tok, s)

    def test_full_flow(self):
        self.assertRaises(StepError, self.w.login_poll)
        self.login()
        st = self.w.public_state()
        self.assertTrue(st['loggedIn'])
        self.assertEqual([s['name'] for s in st['servers']], ['Home Server', 'Friend Server'])
        self.assertTrue(st['servers'][0]['lan'])
        with self.assertRaises(StepError) as c: self.w.choose_server('ffff0000ffff0000')
        self.assertEqual(c.exception.code, 'not_owner')

        profiles = self.w.choose_server(H.MID)
        self.assertEqual(self.w.uris[0], 'http://192.0.2.20:32400')
        libs = dict((p['title'], p['libraries']) for p in profiles)
        self.assertEqual(libs, {'Owner': 4, 'Kid': 2, 'Teen': 3, 'NoShare': None, 'buddy': 4})
        self.assert_no_secrets(self.w.public_state())

        self.w.set_profiles([1, 2, 77, 4])            # NoShare has no token -> stays out
        self.assertEqual([p['title'] for p in self.w.profiles if p['include']], ['Owner', 'Kid', 'buddy'])
        with self.assertRaises(StepError): self.w.set_profiles([])
        with self.assertRaises(StepError): self.w.set_profiles(['1'])

        info = self.w.build(reset_pins=True)                       # checkbox "App-PINs zuruecksetzen"
        self.assertTrue(info['resetPins'])
        with zipfile.ZipFile(io.BytesIO(self.w.package)) as z: self.assertIs(json.loads(z.read('setup.json'))['resetAppPins'], True)
        info = self.w.build()
        self.assertEqual(info['profiles'], 3)
        with zipfile.ZipFile(io.BytesIO(self.w.package)) as z: cfg = json.loads(z.read('setup.json'))
        self.assertNotIn('resetAppPins', cfg)                         # default keeps the PINs
        self.assertEqual(cfg['server']['uris'], ['http://192.0.2.20:32400'])
        self.assertEqual(dict((p['title'], p['token']) for p in cfg['profiles']),
                         {'Owner': H.OWNER_TOK, 'Kid': H.KID_TOK, 'buddy': H.FRIEND_TOK})
        self.assertEqual(cfg['computer']['address'], '192.0.2.10')
        self.assertNotIn(H.ACCOUNT_TOK, json.dumps(cfg))              # only server-bound tokens on the TV
        self.assertIn(b'http://192.0.2.10/Neolume.zip', self.w.widgetlist)

        self.w.sync_start()
        port = self.w.sync.port
        with urllib.request.urlopen('http://127.0.0.1:%d/widgetlist.xml' % port) as r: self.assertIn(b'Neolume', r.read())
        with urllib.request.urlopen('http://127.0.0.1:%d/Neolume.zip' % port) as r: self.assertEqual(r.read(), self.w.package)
        st = self.w.public_state()
        self.assertEqual([e['path'] for e in st['sync']['events']], ['/widgetlist.xml', '/Neolume.zip'])
        self.assert_no_secrets(st)

        self.w.update_start()
        with urllib.request.urlopen('http://127.0.0.1:%d/update/manifest.json' % self.w.update.port) as r:
            self.assertEqual(json.loads(r.read())['version'], '0.0.2')

        self.w.finish()
        self.assertFalse(self.w.sync.running)
        self.assertIsNone(self.w.token)
        self.assertIsNone(self.w.package)
        self.assertEqual(self.w.profiles, [])
        self.assertTrue(self.w.update.running)                        # update server is independent of the tokens

    def test_link_pin(self):
        r = self.w.login_start('link')
        self.assertEqual(r['url'], 'https://plex.tv/link')
        self.assertTrue(r['code'])

    def test_pin_expiry(self):
        self.w.login_start('auth')
        self.w.pins['auth']['created'] -= 10000
        with self.assertRaises(StepError) as c: self.w.login_poll()
        self.assertEqual(c.exception.code, 'pin_expired')

    def test_unreachable_server(self):
        self.login()
        self.w.http_get = lambda *a, **k: (_ for _ in ()).throw(OSError('down'))
        with self.assertRaises(StepError) as c: self.w.choose_server(H.MID)
        self.assertEqual(c.exception.code, 'unreachable')

    def test_tv_address_validation(self):
        self.w.set_tv_address('192.168.1.50')
        self.assertEqual(self.w.sync.allow, {'192.168.1.50'})
        with self.assertRaises(StepError): self.w.set_tv_address('8.8.8.8')
        with self.assertRaises(StepError): self.w.set_tv_address('tv.local')
        self.w.set_tv_address('')
        self.assertEqual(self.w.sync.allow, set())

    def test_settings_never_hold_tokens(self):
        self.login()
        self.w.choose_server(H.MID)
        self.w.set_prefs(lang='en', remember=True)
        with open(os.path.join(self.dir, 's.json')) as f: saved = json.load(f)
        self.assertEqual(sorted(saved), ['clientIdentifier', 'extras', 'lang', 'tvAddress'])
        self.assert_no_secrets(saved)
        self.w.set_prefs(remember=False)
        self.assertFalse(os.path.exists(os.path.join(self.dir, 's.json')))
        with self.assertRaises(StepError): self.w.set_prefs(lang='fr')


if __name__ == '__main__':
    unittest.main()
