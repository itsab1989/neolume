"""Helper protocol 2 for every TV route (05.11.2026): signed with the signing key from the app package (setup.json helper.sign),
no key in plain text; honest answers in both directions of an update; Docker bridge mode is recognised (403 nat).
Signature text: helper.sig_message = the same as src/plex/discover.js (tests/helper-sig.test.js checks the JS side)."""
import hashlib
import hmac
import json
import os
import shutil
import tempfile
import unittest
import urllib.error
import urllib.request

import helpers  # noqa: F401  (Pfad zu installer/, Test-Einstellungsordner)
from neosetup import helper as HP
from neosetup import netutil
from neosetup.lanserver import LanServer
from test_helper import B, KEY, NOW, OWNER, FakeTV, make

SIGN = '7' * 64
TV = '10.0.0.50'


def signed(method, path, profile=OWNER, key=SIGN, ts=NOW, nonce=None, body=b''):
    nonce = nonce or os.urandom(12).hex()
    msg = '\n'.join(['neo-2', method, path, str(ts), nonce, profile, hashlib.sha256(body).hexdigest()])
    return {'Host': '10.0.0.10:32499', 'X-Neo-Sv': '2', 'X-Neo-Profile': profile, 'X-Neo-Time': str(ts), 'X-Neo-Nonce': nonce,
            'X-Neo-Sig': hmac.new(key.encode(), msg.encode(), hashlib.sha256).hexdigest()}


def plain(profile=OWNER):
    return {'Host': '10.0.0.10:32499', 'X-Neo-Key': KEY, 'X-Neo-Profile': profile}


class Protocol2(unittest.TestCase):
    def setUp(self):
        self.h = make()
        self.h.store.sign = SIGN

    def get(self, path, hd, client=TV, method='GET'):
        return self.h.handle(method, path, hd, client)

    def test_signed_read_routes_without_key(self):
        p = '/watchlist?type=all&start=0&size=50'
        st, d = self.get(p, signed('GET', p))
        self.assertEqual((st, d.get('total')), (200, 1), d)
        p = '/watchlist/' + B
        self.assertEqual(self.get(p, signed('PUT', p), method='PUT')[0], 200)
        p = '/discover/trending?type=movie&size=10'
        self.assertEqual(self.get(p, signed('GET', p))[0], 200)
        self.assertIn('sig2', self.h.hello()['features'])

    def test_plain_key_refused_once_a_signing_key_exists(self):
        """Wer X-Neo-Key im Heimnetz mitgelesen hat, kommt damit nicht mehr an Merkliste, Entdecken oder Fernsehen."""
        st, d = self.get('/watchlist?type=all', plain())
        self.assertEqual((st, d['error']), (401, 'sig_required'))
        st, d = self.get('/live/open?ch=ard', {'Host': '10.0.0.10:32499', 'X-Neo-Key': KEY})
        self.assertEqual((st, d['error']), (401, 'sig_required'))

    def test_tampering_replay_time(self):
        p = '/watchlist?type=all'
        self.assertEqual(self.get('/watchlist?type=movie', signed('GET', p))[1]['error'], 'sig')     # query changed
        self.assertEqual(self.get(p, signed('GET', p, profile='u-teen'))[0], 200)
        hd = signed('GET', p, profile='u-teen'); hd['X-Neo-Profile'] = OWNER                         # profile swapped
        self.assertEqual(self.get(p, hd)[1]['error'], 'sig')
        hd = signed('GET', p, nonce='ab' * 12)
        self.assertEqual(self.get(p, hd)[0], 200)
        self.assertEqual(self.get(p, hd)[1]['error'], 'replay')
        self.assertEqual(self.get(p, signed('GET', p, ts=NOW - 300))[1]['error'], 'time')
        self.assertEqual(self.get(p, signed('GET', p, key='8' * 64))[1]['error'], 'sig')
        self.assertEqual(self.get('/watchlist/' + B, signed('PUT', '/watchlist/' + B), method='DELETE')[1]['error'], 'sig')   # method signed

    def test_live_open_signed_and_session_token_unchanged(self):
        calls = []
        self.h.live.open = lambda ch, client, h: calls.append((ch, client, h)) or {'path': '/live/' + 'x' * 32 + '/index.m3u8', 'h': h}
        p = '/live/open?ch=ard&h=540'
        st, d = self.get(p, signed('GET', p, profile=''))
        self.assertEqual(st, 200, d)
        self.assertEqual(calls, [('ard', TV, 540)])                    # bound to this client as before (live.py)

    def test_old_setup_without_signing_key(self):
        """helper.json von vor 1.0.17 (ohne Signaturschluessel): das App-Paket derselben Einrichtung hat auch keinen – der alte
        Schluessel gilt dort weiter. Eine neue App, die signiert, bekommt eine ehrliche Antwort (no_sig = App-Paket neu erstellen)."""
        self.h.store.sign = ''
        self.assertEqual(self.get('/watchlist?type=all', plain())[0], 200)
        st, d = self.get('/watchlist?type=all', signed('GET', '/watchlist?type=all'))
        self.assertEqual((st, d['error']), (401, 'no_sig'))

    def test_store_keeps_and_migrates_the_signing_key(self):
        d = dict(self.h.store.to_json())
        self.assertEqual(d['sign'], SIGN)
        self.assertEqual(HP.Store.from_json(d).sign, SIGN)
        d.pop('sign'); d['arrSig'] = '9' * 64                            # first private version (arrSig): same key, same TVs
        self.assertEqual(HP.Store.from_json(d).sign, '9' * 64)
        d.pop('arrSig')
        s = HP.Store.from_json(d)
        self.assertEqual(s.sign, '')
        k = s.new_sign()
        self.assertRegex(k, r'^[0-9a-f]{64}$')
        self.assertEqual(s.new_sign(), k)
        self.assertNotIn(SIGN, json.dumps(self.h.hello()))


class DockerBridge(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def files(self, gw_hex='010011AC', container=True):
        mark = os.path.join(self.dir, '.dockerenv')
        if container: open(mark, 'w').close()
        route = os.path.join(self.dir, 'route')
        with open(route, 'w') as f:
            f.write('Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\n'
                    'eth0\t00000000\t%s\t0003\t0\t0\t0\t00000000\n'
                    'eth0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\n' % gw_hex)
        return (mark,), route

    def test_gateway_detection(self):
        marks, route = self.files()
        self.assertEqual(netutil.container_gateway(marks, route), '172.17.0.1')
        marks, route = self.files('0100000A')                          # host networking: the home router
        self.assertEqual(netutil.container_gateway(marks, route), '10.0.0.1')
        shutil.rmtree(self.dir); os.mkdir(self.dir)
        marks, route = self.files(container=False)
        self.assertEqual(netutil.container_gateway(marks, route), '')    # not in a container
        self.assertEqual(netutil.container_gateway(marks, os.path.join(self.dir, 'missing')), '')

    def test_bridge_mode_is_explained(self):
        """Bridge-Modus: alle Geraete erscheinen als 172.17.0.1. Mit eingetragener Fernseher-Adresse antwortet der Helfer 403 nat
        (statt eines stummen 403), die Hallo-Antwort meldet nat – die App erklaert "Host-Netzwerk"; gelogged wird es einmal."""
        logs = []
        h = make(allow=TV)
        h.store.sign = SIGN
        h.nat_gw, h.log = '172.17.0.1', logs.append
        st, d = h.handle('GET', '/watchlist?type=all', signed('GET', '/watchlist?type=all'), '172.17.0.1')
        self.assertEqual((st, d['error']), (403, 'nat'))
        self.assertEqual(h.handle('GET', '/watchlist?type=all', signed('GET', '/watchlist?type=all'), '10.0.0.77')[1]['error'], 'lan_only')
        self.assertTrue(h.hello().get('nat'))
        h.handle('GET', '/neo-helper', {'Host': '10.0.0.10'}, '172.17.0.1')
        self.assertEqual(len(logs), 1)
        self.assertIn('--net=host', logs[0])
        h2 = make()                                                       # without a TV address: read routes still work (signed)
        h2.store.sign = SIGN
        h2.nat_gw = '172.17.0.1'
        self.assertEqual(h2.handle('GET', '/watchlist?type=all', signed('GET', '/watchlist?type=all'), '172.17.0.1')[0], 200)
        self.assertTrue(h2.hello().get('nat'))

    def test_lanserver_lets_the_helper_answer_nat(self):
        srv = LanServer('helper', 0, allow=['10.0.0.50'], bind='127.0.0.1')
        srv.api = make(allow='10.0.0.50')
        srv.api.nat_gw = '172.17.0.1'
        self.assertTrue(srv.client_allowed('172.17.0.1', '/watchlist'))
        self.assertFalse(srv.client_allowed('172.17.0.1', '/update/app.js'))
        self.assertFalse(srv.client_allowed('10.0.0.77', '/watchlist'))


class ReplayAfterRefusal(unittest.TestCase):
    """Abschluss-Review 05.11. L1: eine signierte Anfrage, die der Helfer VOR der Signaturpruefung abweist (Rate-Limit,
    Adressfilter), verbraucht trotzdem ihre Nonce - sonst koennte ein Mitleser sie binnen 120 s von der eigenen Adresse
    einreichen und die Antwort bekommen."""
    def setUp(self):
        self.h = make()
        self.h.store.sign = SIGN

    def test_rate_limited_request_cannot_be_replayed_from_another_address(self):
        self.h.rate = HP.RateLimit(1, 1000)
        self.h.rate.ok(TV)                                                      # the TV used up its budget
        p = '/servers'
        hd = signed('GET', p)
        st, d = self.h.handle('GET', p, hd, TV)
        self.assertEqual((st, d['error']), (429, 'rate'))                       # the TV's request was refused ...
        self.h.rate = HP.RateLimit(1000, 1)
        st, d = self.h.handle('GET', p, hd, '10.0.0.66')                        # ... and is replayed by someone reading along
        self.assertEqual((st, d['error']), (401, 'replay'))

    def test_live_open_refused_by_rate_limit_uses_up_its_nonce(self):
        self.h.live.open = lambda ch, client, h: {'path': '/live/' + 'x' * 32 + '/index.m3u8', 'h': h}
        self.h.rate = HP.RateLimit(1, 1000)
        self.h.rate.ok(TV)
        p = '/live/open?ch=ard'
        hd = signed('GET', p, profile='')
        self.assertEqual(self.h.handle('GET', p, hd, TV)[0], 429)
        self.h.rate = HP.RateLimit(1000, 1)
        self.assertEqual(self.h.handle('GET', p, hd, '10.0.0.66')[1]['error'], 'replay')

    def test_bad_signature_refused_by_rate_limit_stores_nothing(self):
        self.h.rate = HP.RateLimit(1, 1000)
        self.h.rate.ok(TV)
        p = '/servers'
        self.assertEqual(self.h.handle('GET', p, signed('GET', p, key='8' * 64), TV)[0], 429)
        self.assertEqual(self.h.nonces.d, {})                                   # only a valid signature is remembered


class NewSigningKey(unittest.TestCase):
    """Abschluss-Review 05.11. L2: "Neuen Signaturschluessel erzeugen" im Einrichtungsprogramm. Alte App-Pakete bekommen
    401 no_sig (die App: "App-Paket bitte neu erstellen"), die Bindung und alles andere in helper.json bleiben."""
    def test_old_package_gets_the_honest_answer(self):
        h = make()
        h.store.sign = SIGN
        h.store.extra['arrTv'] = {'ip': TV, 'src': 'package', 't': 1}
        new = h.store.rotate_sign()
        self.assertNotEqual(new, SIGN)
        p = '/watchlist?type=all'
        st, d = h.handle('GET', p, signed('GET', p), TV)
        self.assertEqual((st, d['error']), (401, 'no_sig'))
        st, d = h.handle('GET', p, signed('GET', p, key='8' * 64), TV)
        self.assertEqual((st, d['error']), (401, 'sig'))                       # never signed by us: no hint
        self.assertEqual(h.handle('GET', p, signed('GET', p, key=new), TV)[0], 200)
        d = h.store.to_json()
        self.assertEqual((d['sign'], d['signOld'], d['arrTv']['ip']), (new, [SIGN], TV))
        s2 = HP.Store.from_json(d)
        self.assertEqual((s2.sign, s2.sign_old), (new, [SIGN]))
        for _ in range(6): s2.rotate_sign()
        self.assertEqual(len(s2.sign_old), HP.SIGN_OLD)
        self.assertNotIn(s2.sign, s2.sign_old)

    def test_legacy_arrsig_is_retired_too(self):
        s = HP.Store(KEY)
        s.extra['arrSig'] = SIGN
        self.assertEqual(s.sign, SIGN)
        s.rotate_sign()
        self.assertNotIn('arrSig', s.extra)
        self.assertEqual(s.sign_old, [SIGN])

    def test_wizard_button(self):
        from neosetup.wizard import Wizard, StepError
        from neosetup import webui
        d = tempfile.mkdtemp()
        try:
            hf = os.path.join(d, 'helper.json')
            s = HP.Store(KEY, sign=SIGN)
            s.add(OWNER, 'plexTvTok-1234567890', 'Owner', 'owner')
            s.save(hf)
            w = Wizard(lambda: [], prefs={}, sync_port=0, update_port=0, settings_file=os.path.join(d, 's.json'), helper_file=hf)
            w.package = b'old'
            self.assertIn('helper_new_sign', webui.actions(w))
            w.helper_new_sign()
            with open(hf) as f: j = json.load(f)
            self.assertEqual(j['signOld'], [SIGN])
            self.assertNotEqual(j['sign'], SIGN)
            self.assertEqual(j['key'], KEY)                                    # the shared key and profiles stay
            self.assertIsNone(w.package)
            self.assertTrue(w.sign_new)
            w.helper_store = None
            with self.assertRaises(StepError): w.helper_new_sign()
        finally:
            shutil.rmtree(d)


class WizardKeepsTvAddress(unittest.TestCase):
    def test_address_from_helper_json_is_kept(self):
        """Neue Einrichtung auf einem Computer ohne gemerkte Einstellungen: die Fernseher-Adresse aus helper.json bleibt."""
        from neosetup.wizard import Wizard
        d = tempfile.mkdtemp()
        try:
            hf = os.path.join(d, 'helper.json')
            s = HP.Store(KEY, allow=TV)
            s.add(OWNER, 'plexTvTok-1234567890', 'Owner', 'owner')
            s.save(hf)
            w = Wizard(lambda: [], prefs={}, sync_port=0, update_port=0, settings_file=os.path.join(d, 's.json'), helper_file=hf)
            self.assertEqual(w.tv_address, TV)
            self.assertEqual(w.helper_store.allow, TV)
        finally:
            shutil.rmtree(d)


class StoreSaveConcurrency(unittest.TestCase):
    """helper.json: one lock around snapshot + write, a unique temporary file per save, a dict changed by another thread
    while it is copied does not lose the save (security review 06.11.2026, L2)."""
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, 'helper.json')

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_parallel_saves_and_changes(self):
        import threading
        st = make().store
        stop = threading.Event()

        def change():
            i = 0
            while not stop.is_set():
                st.extra['x%d' % (i % 50)] = {'n': i}
                st.extra.pop('x%d' % ((i + 25) % 50), None)
                i += 1
        errors = []

        def save():
            try:
                for _ in range(40): st.save(self.path)
            except Exception as e:  # noqa: BLE001
                errors.append(e)
        writer = threading.Thread(target=change)
        writer.start()
        savers = [threading.Thread(target=save) for _ in range(4)]
        for t in savers: t.start()
        for t in savers: t.join()
        stop.set()
        writer.join()
        self.assertEqual(errors, [])
        with open(self.path) as f: self.assertEqual(json.load(f)['kind'], 'plexneo-helper')
        self.assertEqual(sorted(os.listdir(self.dir)), ['helper.json'])        # no temporary file left

    def test_retry_after_dict_changed(self):
        st = make().store
        real, calls = st.to_json, []

        def flaky():
            calls.append(1)
            if len(calls) == 1: raise RuntimeError('dictionary changed size during iteration')
            return real()
        st.to_json = flaky
        st.save(self.path)
        self.assertEqual(len(calls), 2)
        with open(self.path) as f: self.assertEqual(json.load(f)['key'], KEY)


if __name__ == '__main__':
    unittest.main()
