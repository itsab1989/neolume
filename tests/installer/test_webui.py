"""Local web UI over real HTTP: whole wizard flow through /api/*, request checks (Host/Origin/CSRF/body), quit,
error paths when plex.tv or the PMS are unreachable, and that no token ever reaches the page."""
import http.client
import io
import json
import os
import re
import shutil
import tempfile
import threading
import unittest
import zipfile

import helpers as H
from neosetup import plextv
from neosetup.plextv import PlexTV, PlexError
from neosetup.webui import UIServer
from neosetup.wizard import Wizard

GDM = [{'machineIdentifier': H.MID, 'address': '192.0.2.20', 'port': 32400, 'name': 'Home Server'}]
SECRETS = (H.ACCOUNT_TOK, H.OWNER_TOK, H.KID_TOK, H.TEEN_TOK, H.FRIEND_TOK)


def raw(port, method, path, headers=None, body=None):
    c = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    hdrs = dict((k.lower(), v) for k, v in r.getheaders())
    c.close()
    return r.status, data, hdrs


class Base(unittest.TestCase):
    fetch_after = 2

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.fetch = H.FakeFetch(after=self.fetch_after)
        self.pms = H.FakePMS()
        self.w = Wizard(H.base_entries, prefs={}, plextv_factory=lambda cid: PlexTV(cid, fetch=lambda *a, **k: self.fetch_fn(*a, **k)),
                        http_get=self.pms, gdm=lambda: GDM, lan_ip=lambda towards: '192.0.2.10', sync_port=0, update_port=0,
                        settings_file=os.path.join(self.dir, 's.json'), helper_file=os.path.join(self.dir, 'h.json'))
        self.ui = UIServer(self.w, 0)
        self.port = self.ui.server_address[1]
        self.thread = threading.Thread(target=self.ui.serve_forever, daemon=True)
        self.thread.start()
        self.host = '127.0.0.1:%d' % self.port
        self.seen = []                          # every body the page received (checked for tokens)

    def fetch_fn(self, *a, **k):
        return self.fetch(*a, **k)

    def tearDown(self):
        self.ui.shutdown(); self.ui.server_close()
        self.w.shutdown()
        shutil.rmtree(self.dir)

    def call(self, action, args=None, **hdr):
        h = {'Host': self.host, 'Content-Type': 'application/json', 'X-Neo-Csrf': self.ui.csrf}
        h.update(hdr)
        st, body, _ = raw(self.port, 'POST', '/api/' + action, h, json.dumps(args or {}).encode())
        self.seen.append(body)
        return st, json.loads(body)

    def ok(self, action, args=None):
        st, d = self.call(action, args)
        self.assertEqual(st, 200, d)
        self.assertTrue(d['ok'], d)
        return d

    def login(self):
        d = self.ok('login_start', {'kind': 'link'})
        self.assertEqual(d['state']['pending'], ['link'])
        while not self.ok('login_poll')['result']['done']: pass
        return d


class Flow(Base):
    def test_full_flow_over_http(self):
        self.login()
        st = self.ok('state')['state']
        self.assertTrue(st['loggedIn'])
        self.assertEqual(st['servers'][0]['name'], 'Home Server')
        d = self.ok('choose_server', {'id': H.MID})
        self.assertEqual(d['state']['server']['uri'], 'http://192.0.2.20:32400')
        self.ok('profiles', {'ids': [1, 2]})
        self.assertEqual(self.ok('extras', {'specs': []})['result'], [])
        self.ok('tv', {'address': ''})
        self.ok('helper', {'on': False, 'remember': False, 'address': ''})

        # "Reset app PINs" ticked -> setup.json carries resetAppPins; unticked -> the PINs are kept (no field)
        info = self.ok('build', {'resetPins': True})['result']
        self.assertTrue(info['resetPins'])
        self.assertIs(self._setup_json()['resetAppPins'], True)
        info = self.ok('build', {'resetPins': False})['result']
        self.assertFalse(info['resetPins'])
        self.assertNotIn('resetAppPins', self._setup_json())
        self.ok('build', {})                                      # default = keep PINs
        self.assertNotIn('resetAppPins', self._setup_json())

        d = self.ok('sync_start')
        sp = d['state']['sync']['port']
        self.assertTrue(d['state']['sync']['running'])
        st, body, _ = raw(sp, 'GET', '/widgetlist.xml')
        self.assertEqual(st, 200)
        self.assertIn(b'http://192.0.2.10/Neolume.zip', body)
        self.assertEqual(raw(sp, 'GET', '/Neolume.zip')[1], self.w.package)
        ev = self.ok('state')['state']['sync']['events']
        self.assertEqual([e['path'] for e in ev], ['/widgetlist.xml', '/Neolume.zip'])

        self.ok('update_start')
        self.assertTrue(self.ok('state')['state']['update']['running'])
        self.ok('update_stop')
        d = self.ok('finish')
        self.assertFalse(d['state']['loggedIn'])
        self.assertFalse(d['state']['sync']['running'])
        self.assertEqual(d['state']['profiles'], [])
        for body in self.seen:
            for tok in SECRETS: self.assertNotIn(tok.encode(), body)

    def _setup_json(self):
        with zipfile.ZipFile(io.BytesIO(self.w.package)) as z: return json.loads(z.read('setup.json'))

    def test_prefs_persist_and_validate(self):
        self.ok('prefs', {'lang': 'en', 'remember': True})
        with open(os.path.join(self.dir, 's.json')) as f: saved = json.load(f)
        self.assertEqual(saved['lang'], 'en')
        self.assertEqual(saved['clientIdentifier'], self.w.client_id)
        st, d = self.call('prefs', {'remember': 'false'})            # strings are not booleans
        self.assertEqual(d['error'], 'bad_input')
        self.assertTrue(os.path.exists(os.path.join(self.dir, 's.json')))
        st, d = self.call('prefs', {'lang': ['de']})
        self.assertEqual(d['error'], 'bad_input')
        self.ok('prefs', {'remember': False})
        self.assertFalse(os.path.exists(os.path.join(self.dir, 's.json')))

    def test_steps_out_of_order(self):
        for action, code in (('choose_server', 'not_logged_in'), ('servers', 'not_logged_in'), ('profiles', 'no_server'),
                             ('build', 'no_server'), ('sync_start', 'no_package'), ('login_poll', 'no_pin'),
                             ('helper_start', 'no_helper')):
            st, d = self.call(action, {'id': H.MID} if action == 'choose_server' else {})
            self.assertEqual((st, d['ok'], d['error']), (200, False, code), action)

    def test_quit_stops_everything(self):
        self.login()
        self.ok('choose_server', {'id': H.MID})
        self.ok('build', {})
        self.ok('sync_start')
        self.ok('update_start')
        st, d = self.call('quit')
        self.assertTrue(d['ok'])
        self.thread.join(5)
        self.assertFalse(self.thread.is_alive())                # serve_forever() returned
        self.assertTrue(self.ui.quitting)
        self.assertFalse(self.w.sync.running)
        self.assertFalse(self.w.update.running)
        self.assertIsNone(self.w.token)
        self.assertIsNone(self.w.package)


class Errors(Base):
    def test_plextv_unreachable(self):
        def down(*a, **k): raise PlexError('network', 'getaddrinfo failed')
        self.fetch_fn = down
        st, d = self.call('login_start', {'kind': 'auth'})
        self.assertEqual((st, d['ok'], d['error']), (200, False, 'network'))
        self.assertFalse(d['state']['loggedIn'])

    def test_plextv_down_during_poll_and_5xx(self):
        self.ok('login_start', {'kind': 'link'})
        self.fetch_fn = lambda *a, **k: (503, b'')
        st, d = self.call('login_poll')
        self.assertEqual(d['error'], 'http503')
        self.assertEqual(d['state']['pending'], ['link'])        # pin kept: polling can continue

    def test_plextv_garbage(self):
        self.fetch_fn = lambda *a, **k: (200, b'<html>captive portal</html>')
        st, d = self.call('login_start', {'kind': 'auth'})
        self.assertEqual(d['error'], 'parse')

    def test_token_revoked(self):
        self.login()
        self.fetch_fn = lambda *a, **k: (401, b'')
        st, d = self.call('servers')
        self.assertEqual(d['error'], 'http401')

    def test_pms_unreachable(self):
        self.login()
        self.w.http_get = lambda *a, **k: (_ for _ in ()).throw(OSError('timed out'))
        st, d = self.call('choose_server', {'id': H.MID})
        self.assertEqual(d['error'], 'unreachable')
        self.assertIsNone(d['state']['server'])

    def test_gdm_failure_is_not_fatal(self):
        def gdm(): raise OSError('no multicast route')
        self.w.gdm = gdm
        self.login()
        st = self.ok('state')['state']
        self.assertEqual(st['servers'][0]['name'], 'Home Server')
        self.assertFalse(st['servers'][0]['lan'])

    def test_no_lan_ip(self):
        self.login()
        self.ok('choose_server', {'id': H.MID})
        self.w.lan_ip = lambda towards: None
        st, d = self.call('build', {})
        self.assertEqual(d['error'], 'no_lan_ip')

    def test_port_busy(self):
        import socket
        s = socket.socket(); s.bind(('127.0.0.1', 0)); s.listen(1)
        try:
            self.login(); self.ok('choose_server', {'id': H.MID}); self.ok('build', {})
            self.w.sync.port, self.w.sync.bind = s.getsockname()[1], '127.0.0.1'
            st, d = self.call('sync_start')
            self.assertEqual(d['error'], 'port_busy')
        finally:
            s.close()

    def test_extra_app_missing(self):
        st, d = self.call('extras', {'specs': [os.path.join(self.dir, 'Nope.zip')]})
        self.assertEqual((d['error'], d['detail']), ('extra_missing', 'Nope.zip'))
        st, d = self.call('extras', {'specs': ['x'] * 11})
        self.assertEqual(d['error'], 'bad_input')

    def test_internal_error_hides_details(self):
        def boom(kind): raise RuntimeError('secret ' + H.ACCOUNT_TOK)
        self.w.login_start = boom
        st, d = self.call('login_start', {'kind': 'auth'})
        self.assertEqual((st, d['error'], d['detail']), (500, 'internal', 'RuntimeError'))
        self.assertNotIn(H.ACCOUNT_TOK, json.dumps(d))


class RequestChecks(Base):
    def test_host_header(self):
        for host in ('localhost:%d' % self.port, '[::1]:%d' % self.port, self.host):
            self.assertEqual(self.call('state', Host=host)[0], 200, host)
        for host in ('evil.example:%d' % self.port, '127.0.0.1', '127.0.0.1:1', 'localhost', '127.0.0.1.nip.io:%d' % self.port,
                     '0.0.0.0:%d' % self.port, ''):
            self.assertEqual(self.call('state', Host=host)[0], 403, host)
            self.assertEqual(raw(self.port, 'GET', '/', {'Host': host})[0], 403, host)

    def test_origin(self):
        for o in ('http://evil.example', 'null', 'https://' + self.host, 'http://' + self.host + '.evil.example',
                  'http://127.0.0.1:1'):
            self.assertEqual(self.call('state', Origin=o)[0], 403, o)
        for o in ('http://' + self.host, 'http://localhost:%d' % self.port, 'http://' + self.host + '/'):
            self.assertEqual(self.call('state', Origin=o)[0], 200, o)

    def test_csrf(self):
        h = {'Host': self.host, 'Content-Type': 'application/json'}
        self.assertEqual(raw(self.port, 'POST', '/api/state', h, b'{}')[0], 403)          # header missing
        self.assertEqual(self.call('state', **{'X-Neo-Csrf': self.ui.csrf[:-1]})[0], 403)
        self.assertEqual(self.call('state', **{'X-Neo-Csrf': ''})[0], 403)
        other = UIServer(self.w, 0)                                                         # token is per process
        try: self.assertNotEqual(other.csrf, self.ui.csrf)
        finally: other.server_close()

    def test_simple_form_post_is_refused(self):
        # what a foreign web page can send without a CORS preflight: form/text content types, no custom header
        h = {'Host': self.host, 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'http://evil.example'}
        self.assertEqual(raw(self.port, 'POST', '/api/logout', h, b'a=1')[0], 403)
        h = {'Host': self.host, 'Content-Type': 'text/plain', 'X-Neo-Csrf': self.ui.csrf}
        self.assertEqual(raw(self.port, 'POST', '/api/state', h, b'{}')[0], 415)

    def test_body_limits(self):
        h = {'Host': self.host, 'Content-Type': 'application/json', 'X-Neo-Csrf': self.ui.csrf}
        self.assertEqual(raw(self.port, 'POST', '/api/state', dict(h, **{'Content-Length': '999999999'}))[0], 413)
        self.assertEqual(raw(self.port, 'POST', '/api/state', h, b'{bad json')[0], 400)
        self.assertEqual(raw(self.port, 'POST', '/api/state', h, b'\xff\xfe')[0], 400)
        self.assertEqual(raw(self.port, 'POST', '/api/state', h, b'"str"')[0], 400)
        self.assertEqual(raw(self.port, 'POST', '/api/state', h, b'')[0], 200)          # empty body = {}
        self.assertEqual(raw(self.port, 'POST', '/state', h, b'{}')[0], 404)
        self.assertEqual(raw(self.port, 'POST', '/api/../api/state', h, b'{}')[0], 404)
        self.assertEqual(raw(self.port, 'POST', '/api/__init__', h, b'{}')[0], 404)

    def test_types_validated(self):
        for action, args in (('choose_server', {'id': 1}), ('choose_server', {'id': 'x' * 300}), ('tv', {'address': 5}),
                             ('build', {'resetPins': 1}), ('build', {'resetPins': 'true'}), ('helper', {'on': 'yes'}),
                             ('helper', {'on': True, 'remember': True, 'address': '8.8.8.8'}), ('tv', {'address': '10.0.0.1; rm'}),
                             ('extras', {'specs': 'a.zip'}), ('login_start', {'kind': None})):
            st, d = self.call(action, args)
            self.assertEqual(d.get('error'), 'bad_input', (action, args, d))

    def test_page(self):
        st, body, hdr = raw(self.port, 'GET', '/', {'Host': self.host})
        self.assertEqual(st, 200)
        csp = hdr['content-security-policy']
        self.assertIn("script-src 'nonce-%s'" % self.ui.nonce, csp)
        self.assertNotIn('unsafe-inline', csp)
        self.assertIn("frame-ancestors 'none'", csp)
        self.assertEqual(hdr['x-frame-options'], 'DENY')
        self.assertEqual(hdr['cache-control'], 'no-store')
        self.assertEqual(len(re.findall(rb'<script nonce="([^"]+)"', body)), 1)
        self.assertIn(b'<script nonce="%s">' % self.ui.nonce.encode(), body)
        self.assertNotIn(b'__NONCE__', body)
        self.assertNotIn(b'innerHTML', body)
        for path in ('/index.html', '/api/state', '/../neosetup/webui.py', '/ui.html'):
            self.assertEqual(raw(self.port, 'GET', path, {'Host': self.host})[0], 404, path)
        self.assertEqual(raw(self.port, 'GET', '/?x=1', {'Host': self.host})[0], 200)

    def test_no_tokens_in_any_state(self):
        self.login()
        self.ok('choose_server', {'id': H.MID})
        self.ok('profiles', {'ids': [1, 2, 3, 77]})
        self.ok('build', {})
        for body in self.seen:
            for tok in SECRETS: self.assertNotIn(tok.encode(), body)


class Translations(unittest.TestCase):
    """Every error code the program can send to the page has a German and an English text (non-technical users)."""
    def test_error_codes_translated(self):
        src = os.path.join(os.path.dirname(H.__file__), '..', '..', 'installer', 'neosetup')
        codes = set()
        for name in os.listdir(src):
            if name.endswith('.py'):
                with open(os.path.join(src, name), encoding='utf-8') as f: text = f.read()
                codes.update(re.findall(r"(?:StepError|PlexError|PackageError)\('([a-z_0-9]+)'", text))
        codes.update(['csrf', 'internal', 'network', 'offline', 'httpOther'])
        codes -= {'http'}
        with open(os.path.join(src, 'ui.html'), encoding='utf-8') as f: ui = f.read()
        blocks = re.findall(r'errors: \{(.*?)other:', ui, re.S)
        self.assertEqual(len(blocks), 2)
        for lang, block in zip(('de', 'en'), blocks):
            keys = set(re.findall(r'([a-zA-Z_0-9]+):', block))
            self.assertEqual(sorted(codes - keys), [], lang)


if __name__ == '__main__':
    unittest.main()
