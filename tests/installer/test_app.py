"""Program start (CLI), second start, headless helper (--helper/--wait), app source order, settings file,
extra helper checks (rate limit per device, key auth)."""
import io
import json
import os
import shutil
import tempfile
import threading
import unittest
import zipfile

import helpers as H
from neosetup import app, brand, settings
from neosetup import helper as HP
from neosetup.webui import UIServer
from neosetup.wizard import Wizard


class Cli(unittest.TestCase):
    def tearDown(self):
        brand.load(None, 'public')             # app.main() selects the repo's brand; keep other tests on the default

    def test_version_and_help(self):
        out = io.StringIO()
        import contextlib
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as c: app.main(['--version'])
        self.assertEqual(c.exception.code, 0)
        self.assertIn(brand.CURRENT['slug'] + '-setup', out.getvalue())

    def test_helper_without_file_exits_2(self):
        d = tempfile.mkdtemp()
        try:
            out = io.StringIO()
            import contextlib
            with contextlib.redirect_stdout(out):
                self.assertEqual(app.main(['--helper', '--helper-file', os.path.join(d, 'none.json'), '--update-port', '0']), 2)
            self.assertIn('no helper set up', out.getvalue())
        finally:
            shutil.rmtree(d)

    def test_second_start_reuses_running_instance(self):
        w = Wizard(H.base_entries, prefs={}, sync_port=0, update_port=0)
        ui = UIServer(w, 0)
        threading.Thread(target=ui.serve_forever, daemon=True).start()
        try:
            port = ui.server_address[1]
            self.assertEqual(app.running_instance(port), 'http://127.0.0.1:%d/' % port)
            out = io.StringIO()
            import contextlib
            with contextlib.redirect_stdout(out):
                self.assertEqual(app.main(['--port', str(port), '--no-browser']), 0)
            self.assertIn('already running', out.getvalue())
        finally:
            ui.shutdown(); ui.server_close()
        self.assertIsNone(app.running_instance(port))
        self.assertIsNone(app.running_instance(0))

    def test_other_program_on_port_is_not_us(self):
        import http.server
        srv = http.server.HTTPServer(('127.0.0.1', 0), http.server.BaseHTTPRequestHandler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try: self.assertIsNone(app.running_instance(srv.server_address[1]))
        finally: srv.shutdown(); srv.server_close()


class AppSource(unittest.TestCase):
    def test_base_zip_first(self):
        d = tempfile.mkdtemp()
        try:
            p = os.path.join(d, 'PlexNeo.zip')
            with zipfile.ZipFile(p, 'w') as z:
                for n, data in H.base_entries(): z.writestr(n, data)
            entries = dict(app.make_base_loader(base_zip=p)())
            self.assertIn('app.js', entries)
        finally:
            shutil.rmtree(d)

    def test_repo_fallback_reports_missing_app(self):
        from neosetup.package import PackageError
        d = tempfile.mkdtemp()
        try:
            with self.assertRaises(PackageError) as c: app.make_base_loader(repo=d)()
            self.assertEqual(c.exception.code, 'no_app')
        finally:
            shutil.rmtree(d)


class Headless(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, 'helper.json')

    def tearDown(self):
        shutil.rmtree(self.dir)

    def test_wait_for_file_then_run(self):
        out, sleeps = io.StringIO(), []
        def sleep(n):
            sleeps.append(n)
            if len(sleeps) == 1:                      # user copies helper.json while the container waits
                with open(self.path, 'w') as f: f.write('{broken')
            elif len(sleeps) == 2:
                s = HP.Store('k' * 32); s.add('u-owner', 'plexTvTok-1234567890', 'Owner', 'owner'); s.save(self.path)
            else:
                raise KeyboardInterrupt                # the helper's main loop sleeps too -> stop it here
        rc = HP.run_headless(self.path, 0, '127.0.0.1', out, wait=True, poll=30, sleep=sleep)
        self.assertEqual(rc, 0)
        self.assertEqual(sleeps[:2], [30, 30])
        self.assertEqual(out.getvalue().count('no helper set up'), 1)   # said once, not every 30 s
        self.assertIn('laeuft auf Port', out.getvalue())

    def test_invalid_file_without_wait(self):
        with open(self.path, 'w') as f: json.dump({'kind': 'plexneo-helper', 'schema': 1, 'key': 'k' * 32, 'profiles': {}}, f)
        out = io.StringIO()
        self.assertEqual(HP.run_headless(self.path, 0, '127.0.0.1', out), 2)
        self.assertIn('invalid', out.getvalue())


class Settings(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.p = os.path.join(self.dir, 'sub', 'settings.json')

    def tearDown(self):
        shutil.rmtree(self.dir)

    def test_roundtrip_and_clean(self):
        settings.save({'clientIdentifier': 'plexneo-abc123', 'lang': 'de', 'extras': ['/a/B.zip', '', 5], 'tvAddress': '192.168.1.5',
                       'token': H.ACCOUNT_TOK, 'X-Plex-Token': 'x'}, self.p)
        with open(self.p) as f: raw = f.read()
        self.assertNotIn(H.ACCOUNT_TOK, raw)
        self.assertEqual(settings.load(self.p), {'clientIdentifier': 'plexneo-abc123', 'lang': 'de', 'extras': ['/a/B.zip'],
                                                 'tvAddress': '192.168.1.5'})

    def test_bad_files(self):
        self.assertEqual(settings.load(self.p), {})
        os.makedirs(os.path.dirname(self.p))
        for content in ('{', '[]', '{"lang": "fr", "clientIdentifier": "a b"}', '\xff'):
            with open(self.p, 'w', encoding='latin-1') as f: f.write(content)
            self.assertEqual(settings.load(self.p), {}, content)

    def test_wizard_uses_saved_prefs(self):
        settings.save({'clientIdentifier': 'plexneo-keepme123', 'lang': 'en', 'extras': ['/x/OtherApp.zip'], 'tvAddress': '192.168.1.5'}, self.p)
        w = Wizard(H.base_entries, prefs=settings.load(self.p), sync_port=0, update_port=0, settings_file=self.p)
        st = w.public_state()
        self.assertEqual((st['lang'], st['remember'], st['tvAddress'], st['extraSpecs']), ('en', True, '192.168.1.5', ['/x/OtherApp.zip']))
        self.assertEqual(w.client_id, 'plexneo-keepme123')          # same client id -> plex.tv sees the same device
        w.set_prefs(lang='de')
        self.assertEqual(settings.load(self.p)['lang'], 'de')

    def test_env_override(self):
        self.assertTrue(settings.settings_dir().startswith(os.environ['PLEXNEO_SETUP_DIR']))
        self.assertEqual(os.path.dirname(HP.store_path()), settings.settings_dir())


class HelperAuth(unittest.TestCase):
    def setUp(self):
        s = HP.Store('k' * 32)
        s.add('u-owner', 'plexTvTok-1234567890', 'Owner', 'owner')
        self.clock = [0.0]
        self.h = HP.Helper(s, 'cid', fetch=lambda m, u, h, timeout=10: (200, b'{"MediaContainer":{"Metadata":[]}}'),
                           rate=HP.RateLimit(30, 10, clock=lambda: self.clock[0]))

    def call(self, client='192.168.1.50', **hdr):
        h = {'Host': '192.168.1.2:32499', 'X-Neo-Key': 'k' * 32, 'X-Neo-Profile': 'u-owner'}
        h.update(hdr)
        return self.h.handle('GET', '/watchlist', h, client)

    def test_key(self):
        self.assertEqual(self.call()[0], 200)
        for k in ('', 'k' * 31, 'k' * 33, 'K' * 32, None):
            self.assertEqual(self.call(client='192.168.1.%d' % (60 + len(k or '')), **{'X-Neo-Key': k})[0], 401, k)

    def test_rate_limit_per_device_and_refill(self):
        codes = [self.call()[0] for _ in range(31)]
        self.assertEqual(codes[:30], [200] * 30)
        self.assertEqual(codes[30], 429)
        self.assertEqual(self.call(client='192.168.1.51')[0], 200)       # other device unaffected
        self.clock[0] += 1.0                                                # 3 requests per second refill
        self.assertEqual([self.call()[0] for _ in range(4)], [200, 200, 200, 429])

    def test_rate_limit_before_key_check(self):
        for _ in range(30): self.call(**{'X-Neo-Key': 'wrong-key-wrong-key'})
        self.assertEqual(self.call()[0], 429)                               # key guessing is throttled too

    def test_ipv6_and_public_refused(self):
        for c in ('2001:db8::5', 'fd00::5', '8.8.8.8', '100.64.1.1'):
            self.assertEqual(self.call(client=c), (403, {'error': 'lan_only'}), c)


if __name__ == '__main__':
    unittest.main()
