"""Optional helper (installer/neosetup/helper.py): allow-list, LAN check, parameters, mapping, store, wizard + HTTP.
plex.tv is mocked; response shapes follow the read-only live check of 27.10.2026 (docs/research/discover.md),
with anonymised content (made-up ids/titles)."""
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
import urllib.error
import urllib.request

import helpers as H
from neosetup import helper as HP
from neosetup.lanserver import LanServer
from neosetup.plextv import PlexTV
from neosetup.wizard import Wizard, StepError

KEY = 'k' * 32
OWNER = 'u-owner'
PLEX_TOK = 'plexTvTok-1234567890'
HOME_TOK = 'homeTvTok-1234567890'
A = 'a' * 24
B = 'b' * 24
C = 'c' * 24
D = 'd' * 24
NOW = 1793059200          # 2026-10-26 00:00 UTC (fixed clock)


def md(hexid, typ, title, date='', year=2020, **extra):
    m = {'guid': 'plex://%s/%s' % (typ, hexid), 'ratingKey': hexid, 'key': '/library/metadata/' + hexid, 'type': typ,
         'title': title, 'year': year, 'thumb': 'https://image.tmdb.org/t/p/original/x%s.jpg' % hexid[:4],
         'originallyAvailableAt': date, 'Image': [{'type': 'background', 'url': 'https://metadata-static.plex.tv/a/x.jpg'}],
         'Media': [{'url': 'https://vod.example/streams/main.m3u8'}], 'userState': False, 'publicPagesURL': 'https://watch.plex.tv/x'}
    m.update(extra)
    return m


def mc(items, **k):
    d = {'identifier': 'tv.plex.provider.discover', 'offset': 0, 'size': len(items), 'totalSize': len(items), 'Metadata': items}
    d.update(k)
    return json.dumps({'MediaContainer': d}).encode()


HUBS = {
    'top_watchlisted': mc([md(A, 'movie', 'Film A', '2026-09-01'), md(B, 'show', 'Serie B', '2021-01-08'),
                           md(C, 'movie', 'Film C', '2026-11-20'),
                           {'guid': 'plex://season/' + D, 'type': 'season', 'title': 'Staffel'},
                           md(D, 'movie', 'Bad', thumb='http://evil.example/p.jpg')]),
    'recently-released-family': mc([md(B, 'show', 'Serie B', '2026-10-01'), md(D, 'show', 'Serie D', '2026-08-15')]),
    'coming-soon': mc([md(C, 'movie', 'Film C', '2026-11-20'), md(A, 'movie', 'Film A', '2026-09-01'),
                       md(D, 'movie', 'Film D', '')]),
}


class FakeTV(object):
    """plex.tv discover/metadata mock; records calls; rejects anything not on the allow-list like the real helper would."""
    def __init__(self):
        self.calls = []
        self.watch = set([A])
        self.fail = None

    def __call__(self, method, url, headers, timeout=10):
        assert HP.upstream_allowed(method, url), url
        self.calls.append((method, url, headers.get('X-Plex-Token')))
        if self.fail: return self.fail, b''
        path, _, q = url.split('https://', 1)[1].partition('/')[2].partition('?')
        path = '/' + path
        if path == '/library/sections/watchlist/all':
            items = [md(A, 'movie', 'Film A', '2026-09-01')] if A in self.watch else []
            if 'type=2' in q: items = []
            return 200, mc(items, librarySectionID='watchlist')
        if path.startswith('/hubs/sections/home/'):
            return 200, HUBS[path.rsplit('/', 1)[1]]
        if path.endswith('/userState'):
            ids = path.split('/')[3].split(',')
            us = [dict({'ratingKey': i, 'type': 'movie', 'viewCount': 0}, **({'watchlistedAt': 1} if i in self.watch else {})) for i in ids]
            return 200, json.dumps({'MediaContainer': {'size': len(us), 'UserState': us}}).encode()
        if path == '/actions/addToWatchlist': self.watch.add(q.split('=')[1]); return 200, b''
        if path == '/actions/removeFromWatchlist': self.watch.discard(q.split('=')[1]); return 200, b''
        return 404, b''


def make(fetch=None, allow=''):
    s = HP.Store(KEY, allow=allow)
    s.add(OWNER, PLEX_TOK, 'Owner', 'owner')
    s.add('u-teen', HOME_TOK, 'Teen', 'home')
    return HP.Helper(s, 'plexneo-helper-test', fetch=fetch or FakeTV(), clock=lambda: NOW, rate=HP.RateLimit(1000, 1))


def hdr(profile=OWNER, key=KEY):
    return {'X-Neo-Key': key, 'X-Neo-Profile': profile, 'Host': '10.0.0.10:32499'}


HOST = {'Host': '10.0.0.10:32499'}


class AllowList(unittest.TestCase):
    def test_allowed(self):
        ok = [('GET', 'https://discover.provider.plex.tv/library/sections/watchlist/all?type=1&X-Plex-Container-Start=0&X-Plex-Container-Size=50'),
              ('PUT', 'https://discover.provider.plex.tv/actions/addToWatchlist?ratingKey=' + A),
              ('PUT', 'https://discover.provider.plex.tv/actions/removeFromWatchlist?ratingKey=' + A),
              ('GET', 'https://discover.provider.plex.tv/library/metadata/%s,%s/userState' % (A, B)),
              ('GET', 'https://discover.provider.plex.tv/hubs/sections/home/coming-soon?X-Plex-Container-Size=60'),
              ('GET', 'https://metadata.provider.plex.tv/library/metadata/' + A)]
        for m, u in ok: self.assertTrue(HP.upstream_allowed(m, u), u)

    def test_refused(self):
        bad = [('GET', 'http://discover.provider.plex.tv/library/sections/watchlist/all'),          # no TLS
               ('GET', 'https://evil.example/library/sections/watchlist/all'),
               ('GET', 'https://discover.provider.plex.tv.evil.example/library/sections/watchlist/all'),
               ('GET', 'https://user@discover.provider.plex.tv/library/sections/watchlist/all'),
               ('GET', 'https://discover.provider.plex.tv:8443/library/sections/watchlist/all'),
               ('DELETE', 'https://discover.provider.plex.tv/library/sections/watchlist/all'),
               ('GET', 'https://discover.provider.plex.tv/actions/addToWatchlist?ratingKey=' + A),        # wrong method
               ('PUT', 'https://discover.provider.plex.tv/actions/rate?ratingKey=' + A),
               ('GET', 'https://discover.provider.plex.tv/hubs/sections/home/trending-plex'),             # not in the table
               ('GET', 'https://discover.provider.plex.tv/hubs/sections/home/../../library/search'),
               ('GET', 'https://discover.provider.plex.tv/library/sections/watchlist/all?url=https://x'),  # unknown query key
               ('GET', 'https://discover.provider.plex.tv/library/metadata/%s/userState' % ('a' * 23)),
               ('GET', 'https://plex.tv/api/v2/user'),
               ('GET', 'https://metadata.provider.plex.tv/library/metadata/%s#x' % A)]
        for m, u in bad: self.assertFalse(HP.upstream_allowed(m, u), u)

    def test_every_route_mapping_is_allowed(self):
        f = FakeTV()                                             # asserts the allow-list on every call
        h = make(f)
        for path, m in (('/watchlist?type=all', 'GET'), ('/watchlist?type=movie&start=0&size=10', 'GET'),
                        ('/watchlist/state?ids=%s,%s' % (A, B), 'GET'), ('/watchlist/' + B, 'PUT'), ('/watchlist/' + B, 'DELETE'),
                        ('/discover/trending?type=movie', 'GET'), ('/discover/new?type=show', 'GET'), ('/discover/soon?type=movie', 'GET')):
            st, body = h.handle(m, path, hdr(), '10.0.0.50')
            self.assertEqual(st, 200, (path, body))
        self.assertTrue(f.calls)
        self.assertTrue(all(c[1].startswith('https://discover.provider.plex.tv/') for c in f.calls))


class Lan(unittest.TestCase):
    def test_private_only(self):
        h = make()
        for ip in ('10.0.0.5', '10.1.2.3', '172.16.0.9', '169.254.1.1', '127.0.0.1'):
            self.assertEqual(h.handle('GET', '/neo-helper', HOST, ip)[0], 200, ip)
        for ip in ('8.8.8.8', '100.64.0.1', '224.0.0.1', '0.0.0.0', 'nonsense', '2001:db8::1'):
            self.assertEqual(h.handle('GET', '/neo-helper', HOST, ip), (403, {'error': 'lan_only'}), ip)

    def test_tv_allow_list(self):
        h = make(allow='10.0.0.34')
        self.assertEqual(h.handle('GET', '/neo-helper', HOST, '10.0.0.34')[0], 200)
        self.assertEqual(h.handle('GET', '/neo-helper', HOST, '10.0.0.35')[0], 403)


class Params(unittest.TestCase):
    def setUp(self):
        self.f = FakeTV(); self.h = make(self.f)

    def r(self, m, p, headers=None):
        return self.h.handle(m, p, hdr() if headers is None else headers, '10.0.0.50')

    def test_hello_without_key(self):
        st, b = self.h.handle('GET', '/neo-helper', HOST, '10.0.0.50')
        self.assertEqual(b['name'], 'plex-neo-helper'); self.assertTrue(b['watchlist'] and b['discover'])
        self.assertNotIn(KEY, json.dumps(b))

    def test_key_and_profile(self):
        self.assertEqual(self.r('GET', '/watchlist', HOST), (401, {'error': 'key'}))
        self.assertEqual(self.r('GET', '/watchlist', hdr(key='x' * 32)), (401, {'error': 'key'}))
        self.assertEqual(self.r('GET', '/watchlist', hdr(profile='')), (400, {'error': 'profile'}))
        self.assertEqual(self.r('GET', '/watchlist', hdr(profile='../x')), (400, {'error': 'profile'}))
        self.assertEqual(self.r('GET', '/watchlist', hdr(profile='u-kid-with-pin')), (404, {'error': 'profile'}))
        self.assertFalse(self.f.calls)

    def test_bad_params(self):
        for p in ('/watchlist?type=episode', '/watchlist?size=0', '/watchlist?size=51', '/watchlist?start=-1', '/watchlist?type=all&type=movie',
                  '/watchlist?start=1e3', '/watchlist/state', '/watchlist/state?ids=' + ','.join([A] * 31), '/watchlist/state?ids=xyz',
                  '/discover/trending', '/discover/trending?type=all', '/discover/trending?type=movie&size=31', '/watchlist?type=movie&x=%zz', '/watchlist?type=movie&url=https://evil.example', '/discover/new?type=movie&hub=trending-plex'):
            self.assertEqual(self.r('GET', p)[0], 400, p)
        self.assertEqual(self.r('GET', '/discover/popular?type=movie')[0], 404)
        self.assertEqual(self.r('PUT', '/watchlist/' + A.upper())[0], 400)
        self.assertEqual(self.r('PUT', '/watchlist/https:%2F%2Fevil.example')[0], 400)
        self.assertEqual(self.r('GET', '/watchlist/' + A)[0], 405)
        self.assertEqual(self.r('PUT', '/watchlist')[0], 405)
        self.assertEqual(self.r('DELETE', '/discover/new?type=movie')[0], 405)
        self.assertIsNone(self.r('GET', '/update/app.js'))         # not a helper route -> static files
        self.assertIsNone(self.r('GET', '/https://plex.tv/api/v2/user'))
        self.assertFalse(self.f.calls)

    def test_host_header(self):
        for host in ('10.0.0.10:32499', '10.0.0.10', 'localhost:32499', '[::1]:32499'):
            self.assertEqual(self.h.handle('GET', '/neo-helper', {'Host': host}, '10.0.0.50')[0], 200, host)
        for host in (None, '', 'evil.example', 'evil.example:32499', '10.0.0.10.evil.example', '10.0.0.10:32499 x'):
            self.assertEqual(self.h.handle('GET', '/neo-helper', {'Host': host} if host is not None else {}, '10.0.0.50'), (403, {'error': 'host'}), host)

    def test_internal_error_hidden(self):
        def boom(*a, **k): raise RuntimeError('secret ' + PLEX_TOK)
        st, b = make(boom).handle('GET', '/watchlist', hdr(), '10.0.0.50')
        self.assertEqual((st, b), (500, {'error': 'internal'}))

    def test_rate_limit(self):
        t = [0.0]
        h = make(); h.rate = HP.RateLimit(5, 10, clock=lambda: t[0])
        codes = [h.handle('GET', '/neo-helper', HOST, '10.0.0.9')[0] for _ in range(7)]
        self.assertEqual(codes, [200] * 5 + [429] * 2)
        self.assertEqual(h.handle('GET', '/neo-helper', HOST, '10.0.0.10')[0], 200)   # per client
        t[0] = 4.0
        self.assertEqual(h.handle('GET', '/neo-helper', HOST, '10.0.0.9')[0], 200)


class Mapping(unittest.TestCase):
    def setUp(self):
        self.f = FakeTV(); self.h = make(self.f)

    def r(self, m, p, prof=OWNER):
        return self.h.handle(m, p, hdr(prof), '10.0.0.50')

    def test_watchlist_slim_and_token(self):
        st, b = self.r('GET', '/watchlist?type=all&start=0&size=50')
        self.assertEqual(st, 200)
        self.assertEqual(b['total'], 1)
        self.assertEqual(b['items'], [{'id': A, 'type': 'movie', 'guid': 'plex://movie/' + A, 'title': 'Film A', 'year': 2020,
                                       'summary': '', 'thumb': 'https://image.tmdb.org/t/p/original/xaaaa.jpg'}])
        m, url, tok = self.f.calls[0]
        self.assertIn('/library/sections/watchlist/all?', url)
        self.assertEqual(tok, PLEX_TOK)
        self.assertNotIn(PLEX_TOK, json.dumps(b))
        self.r('GET', '/watchlist?type=show', 'u-teen')
        self.assertIn('type=2', self.f.calls[-1][1]); self.assertEqual(self.f.calls[-1][2], HOME_TOK)

    def test_state_add_remove(self):
        self.assertEqual(self.r('GET', '/watchlist/state?ids=%s,%s' % (A, B))[1], {'ids': {A: True, B: False}})
        self.assertEqual(len(self.f.calls), 1)                     # one upstream call for all ids
        self.r('GET', '/watchlist')
        self.assertEqual(self.r('PUT', '/watchlist/' + B)[1], {'ok': True, 'id': B, 'on': True})
        self.assertEqual(self.f.calls[-1][:2], ('PUT', 'https://discover.provider.plex.tv/actions/addToWatchlist?ratingKey=' + B))
        n = len(self.f.calls); self.r('GET', '/watchlist')
        self.assertEqual(len(self.f.calls), n + 1)                 # cache dropped after a change
        self.r('DELETE', '/watchlist/' + B)
        self.assertEqual(self.f.calls[-1][:2], ('PUT', 'https://discover.provider.plex.tv/actions/removeFromWatchlist?ratingKey=' + B))
        self.assertEqual(self.f.watch, set([A]))

    def test_discover_rows(self):
        t = self.r('GET', '/discover/trending?type=movie&size=20')[1]['items']
        self.assertEqual([i['id'] for i in t], [A, C, D])         # season dropped; D kept with its http thumb blanked
        self.assertEqual(t[0]['guid'], 'plex://movie/' + A)
        self.assertNotIn('Media', json.dumps(t)); self.assertNotIn('vod', json.dumps(t)); self.assertNotIn('publicPagesURL', json.dumps(t))
        n = self.r('GET', '/discover/new?type=show')[1]['items']
        self.assertEqual([i['id'] for i in n], [B, D])            # released in the last 180 days, newest first, deduped
        s = self.r('GET', '/discover/soon?type=movie')[1]['items']
        self.assertEqual([i['id'] for i in s], [C, D])            # future first, unknown date last, released dropped
        calls = len(self.f.calls)
        self.r('GET', '/discover/trending?type=show')
        self.assertEqual(len(self.f.calls), calls)                # hub cached 15 min (shared by profiles)
        nm = self.r('GET', '/discover/new?type=movie')[1]['items']
        self.assertEqual([i['id'] for i in nm], [A])

    def test_bad_thumb_dropped(self):
        t = make(self.f).discover(OWNER, 'trending', 'movie', 30)['items']
        d = [x for x in (HP.slim(m) for m in json.loads(HUBS['top_watchlisted'])['MediaContainer']['Metadata']) if x]
        self.assertTrue(all(x['thumb'] == '' or x['thumb'].startswith('https://image.tmdb.org/') for x in t))
        self.assertEqual([x for x in d if x['id'] == D][0]['thumb'], '')

    def test_upstream_errors(self):
        for code, err in ((401, 'plex_auth'), (404, 'plex_404'), (500, 'plex_500'), (302, 'plex_302')):
            self.f.fail = code
            h = make(self.f)
            self.assertEqual(h.handle('GET', '/watchlist', hdr(), '10.0.0.50'), (502, {'error': err}))
        def big(*a, **k): return 200, b'x' * (HP.MAX_UPSTREAM + 1)
        self.assertEqual(make(big).handle('GET', '/watchlist', hdr(), '10.0.0.50'), (502, {'error': 'too_large'}))
        def garbage(*a, **k): return 200, b'<html>'
        self.assertEqual(make(garbage).handle('GET', '/watchlist', hdr(), '10.0.0.50'), (502, {'error': 'parse'}))

    def test_slim(self):
        self.assertIsNone(HP.slim({'guid': 'plex://movie/' + A, 'type': 'show', 'title': 'x'}))     # type mismatch
        self.assertIsNone(HP.slim({'guid': 'imdb://tt1', 'type': 'movie', 'title': 'x'}))
        self.assertIsNone(HP.slim({'guid': 'plex://movie/' + A, 'type': 'movie'}))
        self.assertEqual(HP.safe_img('https://images.plex.tv/photo?url=x&X-Plex-Token=abc'), '')
        self.assertEqual(HP.safe_img('https://image.tmdb.org.evil.example/x.jpg'), '')
        self.assertEqual(HP.safe_img('https://metadata-static.plex.tv/a/b.jpg'), 'https://metadata-static.plex.tv/a/b.jpg')


class StoreFile(unittest.TestCase):
    def setUp(self): self.dir = tempfile.mkdtemp()
    def tearDown(self): shutil.rmtree(self.dir)

    def test_roundtrip_0600(self):
        p = os.path.join(self.dir, 'sub', 'helper.json')
        s = HP.Store(KEY, allow='10.0.0.34'); s.add(OWNER, PLEX_TOK, 'Owner', 'owner')
        s.save(p)
        if os.name == 'posix': self.assertEqual(stat.S_IMODE(os.stat(p).st_mode), 0o600)
        l = HP.Store.load(p)
        self.assertEqual((l.key, l.owner, l.allow, l.token(OWNER)), (KEY, OWNER, '10.0.0.34', PLEX_TOK))
        self.assertNotIn(PLEX_TOK, json.dumps(l.summary()))
        HP.Store.forget(p); self.assertFalse(os.path.exists(p))

    def test_bad_files(self):
        for d in ({}, {'kind': 'plexneo-helper', 'schema': 2}, {'kind': 'plexneo-helper', 'schema': 1, 'profiles': {}},
                  {'kind': 'plexneo-helper', 'schema': 1, 'profiles': {'../x': {'token': PLEX_TOK}}}):
            self.assertRaises(ValueError, HP.Store.from_json, d)
        s = HP.Store.from_json({'kind': 'plexneo-helper', 'schema': 1, 'key': 'short', 'allow': '8.8.8.8', 'profiles': {OWNER: {'token': PLEX_TOK, 'kind': 'owner'}}})
        self.assertNotEqual(s.key, 'short'); self.assertEqual(s.allow, '')


class HttpEndToEnd(unittest.TestCase):
    """Through the real LanServer (update port) on loopback: helper routes, PUT/DELETE, static files still served."""
    def setUp(self):
        self.f = FakeTV()
        self.srv = LanServer('update', 0, bind='127.0.0.1')
        self.srv.set_files({'/update/app.js': (b'//app', 'application/javascript')})
        self.srv.api = make(self.f)
        self.srv.start()
        self.base = 'http://127.0.0.1:%d' % self.srv.port

    def tearDown(self): self.srv.stop()

    def req(self, method, path, headers=None):
        r = urllib.request.Request(self.base + path, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(r, timeout=5) as resp: return resp.status, resp.read()
        except urllib.error.HTTPError as e: return e.code, e.read()

    def test_routes(self):
        st, b = self.req('GET', '/neo-helper'); self.assertEqual(json.loads(b)['name'], 'plex-neo-helper')
        st, b = self.req('GET', '/watchlist?type=all', hdr()); self.assertEqual(st, 200); self.assertEqual(json.loads(b)['total'], 1)
        self.assertEqual(self.req('PUT', '/watchlist/' + B, hdr())[0], 200)
        self.assertEqual(self.req('DELETE', '/watchlist/' + B, hdr())[0], 200)
        self.assertEqual(self.req('GET', '/update/app.js'), (200, b'//app'))
        self.assertEqual(self.req('PUT', '/update/app.js')[0], 405)
        self.assertEqual(self.req('POST', '/watchlist/' + B, hdr())[0], 405)
        self.assertEqual(self.req('GET', '/watchlist', {})[0], 401)
        self.assertEqual(self.req('GET', '/etc/passwd')[0], 404)
        self.srv.api = None
        self.assertEqual(self.req('PUT', '/watchlist/' + B, hdr())[0], 405)


class WizardHelper(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.hfile = os.path.join(self.dir, 'helper.json')
        self.fetch = H.FakeFetch(after=1)
        orig = self.fetch.__call__
        def fetch(method, url, headers, body=None, timeout=15):
            if method == 'POST' and '/api/home/users/' in url and url.endswith('/switch'):
                self.fetch.calls.append((method, url, dict(headers)))
                return 201, b'<user id="3" authenticationToken="%s"/>' % HOME_TOK.encode()
            return orig(method, url, headers, body, timeout)
        self.pms = H.FakePMS()
        gdm = [{'machineIdentifier': H.MID, 'address': '192.0.2.20', 'port': 32400, 'name': 'Home Server'}]
        self.w = Wizard(H.base_entries, prefs={}, plextv_factory=lambda cid: PlexTV(cid, fetch=fetch), http_get=self.pms,
                        gdm=lambda: gdm, lan_ip=lambda towards: '192.0.2.10', sync_port=0, update_port=0,
                        settings_file=os.path.join(self.dir, 's.json'), helper_file=self.hfile, helper_fetch=FakeTV())

    def tearDown(self):
        self.w.sync.stop(); self.w.update.stop()
        shutil.rmtree(self.dir)

    def setup_flow(self, **helper):
        self.w.login_start('auth'); self.w.login_poll()
        self.w.choose_server(H.MID)
        ids = [p['id'] for p in self.w.profiles if p['kind'] in ('owner', 'home') and p['token']]
        self.w.set_profiles(ids)
        self.w.set_helper(True, **helper)
        self.w.build()

    def setup_json(self):
        import io, zipfile
        return json.loads(zipfile.ZipFile(io.BytesIO(self.w.package)).read('setup.json'))

    def test_build_writes_helper_and_file(self):
        self.setup_flow()
        cfg = self.setup_json()
        self.assertTrue(cfg['helper']['url'].startswith('http://192.0.2.10:'))
        self.assertTrue(HP.KEY.match(cfg['helper']['key']))
        self.assertNotIn(H.ACCOUNT_TOK, json.dumps(cfg['helper']))
        st = HP.Store.load(self.hfile)
        self.assertEqual(st.key, cfg['helper']['key'])
        self.assertEqual(st.token('u-owner'), H.ACCOUNT_TOK)       # plex.tv token of this sign-in
        self.assertEqual(st.token('u-teen'), HOME_TOK)             # home profile without Plex PIN via switch
        self.assertIsNone(st.token('u-kid'))                       # protected (Plex PIN) -> skipped, PIN never asked
        pub = json.dumps(self.w.public_state())
        for tok in (H.ACCOUNT_TOK, HOME_TOK, st.key): self.assertNotIn(tok, pub)
        self.assertIn('Kid', self.w.public_state()['helper']['skipped'])
        switches = [c for c in self.fetch.calls if c[1].endswith('/switch')]
        self.assertEqual(len(switches), 1)

    def test_key_kept_on_resetup_and_nas_address(self):
        self.setup_flow()
        key = self.setup_json()['helper']['key']
        self.w.set_helper(True, True, '192.0.2.77'); self.w.build()
        cfg = self.setup_json()
        self.assertEqual(cfg['helper'], {'url': 'http://192.0.2.77:%d' % (self.w.update.port or HP.HELPER_PORT), 'key': key})
        self.assertRaises(StepError, self.w.set_helper, True, True, '8.8.8.8')

    def test_not_remembered_and_off(self):
        self.setup_flow(remember=False)
        self.assertFalse(os.path.exists(self.hfile))
        self.assertIn('helper', self.setup_json())
        self.w.set_helper(False); self.w.build()
        self.assertNotIn('helper', self.setup_json())

    def test_start_stop_shares_update_port(self):
        self.assertRaises(StepError, self.w.helper_start)
        self.setup_flow()
        self.w.finish()                                           # setup tokens gone, helper keeps its copies
        self.assertIsNone(self.w.token)
        self.w.helper_start()
        self.assertTrue(self.w.public_state()['helper']['running'])
        base = 'http://127.0.0.1:%d' % self.w.update.port
        with urllib.request.urlopen(base + '/neo-helper', timeout=5) as r: self.assertEqual(json.loads(r.read())['features'], ['watchlist', 'discover', 'servers'])
        self.w.update_start()
        with urllib.request.urlopen(base + '/neo-helper', timeout=5) as r: self.assertIn('update', json.loads(r.read())['features'])
        self.w.update_stop()
        self.assertTrue(self.w.update.running)                    # helper still on
        self.w.helper_stop()
        self.assertFalse(self.w.update.running)

    def test_loads_saved_helper_on_start(self):
        s = HP.Store(KEY); s.add(OWNER, PLEX_TOK, 'Owner', 'owner'); s.save(self.hfile)
        w = Wizard(H.base_entries, prefs={}, sync_port=0, update_port=0, helper_file=self.hfile, helper_fetch=FakeTV(),
                   settings_file=os.path.join(self.dir, 's2.json'))
        try:
            self.assertTrue(w.public_state()['helper']['configured'])
            w.helper_start(); self.assertTrue(w.public_state()['helper']['running'])
        finally:
            w.update.stop()


class Headless(unittest.TestCase):
    def test_no_file(self):
        import io
        out = io.StringIO()
        self.assertEqual(HP.run_headless(os.path.join(tempfile.gettempdir(), 'nope-plexneo-helper.json'), 0, '127.0.0.1', out), 2)
        self.assertIn('Kein Helfer', out.getvalue())


if __name__ == '__main__':
    unittest.main()
