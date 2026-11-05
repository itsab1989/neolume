"""Third security review of the live TV join (installer/neosetup/live.py, SPEC LIVE-10), 05.11.2026, findings M1, M2, L1-L5
and Info (design/reviews/helper-security.md, section "Dritter Review"). Each test reproduces the finding first; no network:
synthetic media and a fake broadcaster (test_live_mux.Fake). Addresses are RFC 1918 / RFC 5737 / documentation examples."""
import threading
import time
import unittest

import helpers as H  # noqa: F401  (import path for neosetup)
from neosetup import live as LV, netutil

import test_live_mux as T


class Base(unittest.TestCase):
    def setUp(self):
        self.f = T.Fake()
        self.now = [1000.0]
        self.L = LV.Live(fetch=self.f, clock=lambda: self.now[0], ffmpeg=False)

    def open(self, h=540, client=T.TV, L=None):
        return (L or self.L).open('de-daserste', client, h)['path'].split('/')[2]

    def seg_fetches(self):
        return [u for u in self.f.calls if '/v/' in u]


class Window(Base):
    """M1: a number still known in s.segs (up to 60) but long out of the playlist was fetched and joined again on every cache
    miss (KEEP 3) - with the token up to ~10 MB/s of internet traffic, bounded only by the rate limit."""
    def test_old_numbers_404_without_fetch(self):
        tok = self.open()
        for _ in range(12):                                          # the live end moves on: 1000..1019 known, newest 1019
            self.f.tick(); self.now[0] += 2
            self.L.playlist(tok, T.TV)
        s = self.L.sessions[tok]
        newest = max(s.segs)
        self.assertIn(newest - 15, s.segs)                           # still known ...
        n0 = len(self.f.calls)
        for n in (newest - 15, newest - LV.WINDOW - 1):
            with self.assertRaises(LV.LiveError) as e: self.L.segment(tok, 's%d.ts' % n, T.TV)
            self.assertEqual((e.exception.status, e.exception.code), (404, 'segment'))
        self.assertEqual(len(self.f.calls), n0)                      # ... but outside the window: no upstream request
        for n in (newest - LV.WINDOW, newest - 2, newest):            # the window (+1 for a playlist that moved on) plays
            self.assertEqual(self.L.segment(tok, 's%d.ts' % n, T.TV)[:1], b'\x47')

    def test_byte_budget_per_minute(self):
        tok = self.open()
        s = self.L.sessions[tok]
        orig = getattr(LV, 'BUDGET_SEGS', None)
        one = len(T.video_ts(0)) + len(T.audio_seg(0))
        LV.BUDGET_SEGS = 4.5 * one / LV.cap_video(540) if hasattr(LV, 'cap_video') else 0   # budget: about 4 segments a minute
        try:
            got, n = [], 1002
            for i in range(12):                                      # cycling through the window: the cache (3) always misses
                try: self.L.segment(tok, 's%d.ts' % (1002 + i % 6), T.TV); got.append(200)
                except LV.LiveError as e: got.append((e.status, e.code))
            self.assertIn((503, 'budget'), got)
            self.assertLessEqual(len(self.seg_fetches()), 6)
            for _ in range(3):                                       # a minute later (the session kept alive) it plays again
                self.now[0] += 25; self.L.playlist(tok, T.TV)
            self.assertEqual(self.L.segment(tok, 's%d.ts' % max(s.segs), T.TV)[:1], b'\x47')
        finally:
            if orig is None: del LV.BUDGET_SEGS
            else: LV.BUDGET_SEGS = orig

    def test_cache_only_window_numbers(self):
        tok = self.open()
        s = self.L.sessions[tok]
        for k in (2, 1, 0): self.L.segment(tok, 's%d.ts' % (max(s.segs) - k), T.TV)
        for _ in range(10):                                          # the player stalls, the live end moves on
            self.f.tick(); self.now[0] += 2
            self.L.playlist(tok, T.TV)
        self.L.segment(tok, 's%d.ts' % max(s.segs), T.TV)          # old segments do not stay in memory
        top = max(s.segs)
        self.assertTrue(all(top - LV.WINDOW <= n <= top for n in s.cache), (list(s.cache), top))
        self.assertLessEqual(len(s.cache), LV.KEEP)


class Caps(Base):
    """M2: 12 MB per video segment for every height -> worst case ~340 MB with a hostile CDN. Now by the chosen height,
    sized from measured segments (live.py, CAP_VIDEO_BY_H)."""
    def test_cap_by_height(self):
        self.assertEqual([LV.cap_video(h) for h in (270, 360, 540, 720, 1080, 0, 2160)],
                         [3 << 19, 3 << 19, 2 << 20, 7 << 19, 5 << 20, 5 << 20, 5 << 20])
        self.assertLessEqual(LV.CAP_VIDEO, 5 << 20)
        # worst case: every session caches KEEP of the largest segments, every join holds one in flight (+ sound)
        self.assertLessEqual(LV.MAX_SESSIONS * LV.KEEP * LV.CAP_VIDEO + LV.JOINS_ALL * (LV.CAP_VIDEO + LV.CAP_AUDIO), 90 << 20)

    def test_fetch_uses_cap_of_chosen_variant(self):
        caps = {}
        orig = self.f.__call__
        def rec(url, cap):
            if '/v/' in url: caps[url] = cap
            return orig(url, cap)
        self.L.fetch = rec
        tok = self.open(540)
        self.L.segment(tok, 's1005.ts', T.TV)
        self.assertEqual(set(caps.values()), {2 << 20})


class Janitor(Base):
    """L1: _janitor saw the list empty and released the lock; an open() in between found the old janitor still set and
    started none; then the old one set janitor = None -> the new session had no sweeper. The clock and the sleep are
    injectable now, so the janitor runs in tests (before: only with clock is time.monotonic)."""
    def test_no_session_without_janitor(self):
        first, hold, opened = threading.Event(), threading.Event(), {}
        def sleep(sec):
            if not first.is_set():                                   # first round: the session has expired
                first.set(); self.now[0] += LV.IDLE + 1; return
            hold.wait(5)                                             # later rounds: wait (a janitor that is alive)
        L = LV.Live(fetch=self.f, clock=lambda: self.now[0], ffmpeg=False, sleep=sleep, janitor=True)
        real = L.lock
        class Probe(object):
            """The janitor's lock: right after it releases it with no session left, an open() runs (the race)."""
            def __enter__(s): return real.__enter__()
            def __exit__(s, *a):
                r = real.__exit__(*a)
                if threading.current_thread().name == 'live-sweep' and not L.sessions and not opened:
                    opened['tok'] = None
                    th = threading.Thread(target=lambda: opened.update(tok=self.open(client='10.0.0.41', L=L)))
                    th.start(); th.join(5)
                return r
        L.lock = Probe()
        self.open(L=L)
        deadline = time.time() + 5
        while time.time() < deadline and not opened.get('tok'): time.sleep(0.01)
        time.sleep(0.2)
        try:
            self.assertTrue(opened.get('tok') in L.sessions)
            j = L.janitor
            self.assertTrue(j is not None and j.is_alive(), 'session without janitor')
        finally:
            L.sessions.clear(); hold.set()

    def test_janitor_frees_and_ends(self):
        calls = []
        def sleep(sec):
            calls.append(sec); self.now[0] += LV.IDLE + 1
        L = LV.Live(fetch=self.f, clock=lambda: self.now[0], ffmpeg=False, sleep=sleep, janitor=True)
        self.open(L=L)
        deadline = time.time() + 5
        while time.time() < deadline and L.janitor is not None: time.sleep(0.01)
        self.assertEqual((L.sessions, L.janitor), ({}, None))
        self.assertEqual(calls[0], LV.IDLE / 4.0)
        self.assertIsNone(LV.Live(fetch=self.f, clock=lambda: 0).janitor)   # injected clock: off unless asked for
        self.assertFalse(LV.Live(fetch=self.f, clock=lambda: 0).use_janitor)


class Peer(unittest.TestCase):
    """L2: under Python 3.9 6to4 (2002:c0a8:101::1 = 192.168.1.1) and site-local fec0::1 were "public"."""
    def test_ipv6_only_global_and_embedded_ipv4_checked(self):
        for a in ('2002:c0a8:101::1', '2002:0a00:0001::1', '2002:7f00:1::1', 'fec0::1', 'fec0:1::2', '2001:db8::1', '64:ff9b::c0a8:101',
                  '64:ff9b::a00:1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '::ffff:10.0.0.1', '::ffff:100.64.0.1', '::192.168.1.1',
                  '::', '::1', 'fe80::1', 'fd12:abcd::1', 'ff02::1', '100::1', '3fff::1', '2002:808:808::1'):
            self.assertFalse(LV.peer_ok(a), a)
        for a in ('2a00:1450:4001::1', '2600:1406:3a00::1', '64:ff9b::808:808', '::ffff:8.8.8.8', '8.8.8.8',
                  '23.40.10.1'):
            self.assertTrue(LV.peer_ok(a), a)


class Pool(unittest.TestCase):
    """L4: _give_back called setdefault before the size check -> the dict grew by an empty list for every new host."""
    def test_pool_does_not_grow_past_limit(self):
        class C(object):
            closed = 0
            def close(self): C.closed += 1
        saved = dict(LV._POOL)
        LV._POOL.clear()
        try:
            limit = getattr(LV, 'POOL_HOSTS', 40)
            for i in range(limit): LV._give_back('h%d.example' % i, C())
            for i in range(50): LV._give_back('more%d.example' % i, C())
            self.assertEqual(len(LV._POOL), limit)
            self.assertTrue(all(LV._POOL.values()))                      # no empty lists
            self.assertEqual(C.closed, 50)
            for _ in range(LV.POOL_PER_HOST + 2): LV._give_back('h0.example', C())
            self.assertEqual(len(LV._POOL['h0.example']), LV.POOL_PER_HOST)
        finally:
            LV._POOL.clear(); LV._POOL.update(saved)


class FfmpegRun(Base):
    """L5: a stream with a broken PMT in every segment forced the ffmpeg fallback (a process + temp files) for every one."""
    def test_fallback_stops_after_a_run(self):
        calls, orig = [], LV.ffmpeg_mux
        def fake(video, audio, a, v, exe=None, timeout=10):
            calls.append(exe); return video
        LV.ffmpeg_mux = fake
        try:
            L = LV.Live(fetch=self.f, clock=lambda: self.now[0], ffmpeg='/opt/example/ffmpeg')
            tok = self.open(L=L)
            bad = bytearray(T.video_ts(0)); bad[188 + 4] = 200          # PMT pointer far beyond the packet: pure join fails
            for i in range(10):
                n = 1000 + 7 + i
                self.f.extra[T.ERSTE + 'v/%d.ts' % n] = bytes(bad)
                self.assertEqual(L.segment(tok, 's%d.ts' % n, T.TV), bytes(bad))   # the picture always
                self.f.tick(); self.now[0] += 2; L.playlist(tok, T.TV)
            run = getattr(LV, 'FFMPEG_RUN', 3)
            self.assertEqual(len(calls), run)
            s = L.sessions[tok]
            self.assertTrue(s.ffmpeg_off)
            n = max(s.segs)                                          # the stream heals: the pure join brings the sound back
            seg = L.segment(tok, 's%d.ts' % n, T.TV)
            self.assertTrue(T.pes_list(seg, 0x101)[0])
            self.assertEqual(len(calls), run)
            tok = self.open(L=L, client='10.0.0.41')                 # a new session tries ffmpeg again
            self.assertFalse(L.sessions[tok].ffmpeg_off)
        finally:
            LV.ffmpeg_mux = orig


class Info(unittest.TestCase):
    def test_port_zero_refused(self):
        """url_ok had `or port`: ':0' is falsy and passed."""
        for u in ('https://mcdn.br.de:0/a.m3u8', 'https://mcdn.br.de:443/a.m3u8', 'https://mcdn.br.de:00/a.m3u8'):
            self.assertFalse(LV.url_ok(u), u)
        self.assertTrue(LV.url_ok('https://mcdn.br.de/a.m3u8'))

    def test_exact_hosts_only_joined_channels(self):
        """L3: the helper's allow-list holds exactly the hosts of the joined channels (no sub-domains, no RTVE/NHK/arte)."""
        from neosetup import livedata
        self.assertEqual(set(livedata.HOSTS), set(LV.urllib.parse.urlsplit(d['url']).hostname for d in livedata.CHANNELS.values()))
        for u in ('https://other.ard-mcdn.de/a.m3u8', 'https://x.mcdn.br.de/a.ts', 'https://rtvelivestream.rtve.es/a.m3u8',
                  'https://masterpl.hls.nhkworld.jp/a.m3u8', 'https://artesimulcast.akamaized.net/a.m3u8', 'https://ard-mcdn.de/a'):
            self.assertFalse(LV.url_ok(u), u)


class JsonDepth(unittest.TestCase):
    """Python 3.14+ parses 30 000 nested arrays without RecursionError: the depth limit is our own, the same everywhere."""
    def test_depth_limit_every_version(self):
        for deep in ('[' * 30000 + ']' * 30000, '{"a":' * 5000 + '1' + '}' * 5000, '[' * (netutil.JSON_DEPTH + 1) + ']' * (netutil.JSON_DEPTH + 1)):
            with self.assertRaises(ValueError): netutil.json_loads(deep)
            with self.assertRaises(ValueError): netutil.json_loads(deep.encode())
        ok = '[' * netutil.JSON_DEPTH + ']' * netutil.JSON_DEPTH
        self.assertIsInstance(netutil.json_loads(ok), list)                    # exactly at the limit: fine
        brackets = '{"t": "' + '[' * 1000 + '\\"[[[' + '{' * 500 + '", "n": [1, [2]]}'
        self.assertEqual(netutil.json_loads(brackets)['n'], [1, [2]])            # brackets inside strings do not count
        with self.assertRaises(ValueError): netutil.json_loads(b'\xff')
        with self.assertRaises(ValueError): netutil.json_loads('{"a": [1,')
        t0 = time.process_time()
        with self.assertRaises(ValueError): netutil.json_loads('[' * 100 + '"' + '\\"' * 200000)     # unterminated string: linear
        self.assertLess(time.process_time() - t0, 2.0)

    def test_helper_parsers_answer_parse_error(self):
        from neosetup import helper as HP
        with self.assertRaises(HP.HelperError) as e: HP.metadata_list(b'{"MediaContainer":' + b'[' * 30000 + b']' * 30000 + b'}')
        self.assertEqual(e.exception.code, 'parse')


if __name__ == '__main__':
    unittest.main()
