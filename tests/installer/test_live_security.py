"""Independent security review of the live TV join (installer/neosetup/live.py, SPEC LIVE-10), 05.11.2026, findings Z1-Z5
(design/reviews/helper-security.md). Each test reproduces the attack first; no network: local sockets and synthetic media only.
Addresses are loopback or RFC 5737 / RFC 1918 examples."""
import random
import socket
import threading
import time
import unittest

import helpers as H  # noqa: F401  (import path for neosetup)
from neosetup import live as LV, lanserver as LS
from neosetup.lanserver import LanServer

import test_live_mux as T


class HostileUpstream(unittest.TestCase):
    """Z2: a playlist line with a long run of attribute letters and no '=' took quadratic time (2 MB -> hours of CPU)."""
    def test_attribute_list_linear(self):
        for line in ('A' * (2 << 20), 'A=' + '"' + 'x,' * 200000, ('AB-' * 1000 + ',') * 300, 'A="' * 300000):
            txt = '#EXTM3U\n#EXT-X-STREAM-INF:' + line + '\nv.m3u8\n#EXT-X-MEDIA:' + line + '\n'
            t0 = time.process_time()
            LV.parse_master(txt, T.ZDF)
            self.assertLess(time.process_time() - t0, 1.0)

    def test_attributes_still_read(self):
        a = LV._attrs('BANDWIDTH=2147200,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=640x360,AUDIO="program_audio",SUBTITLES="subs"')
        self.assertEqual((a['BANDWIDTH'], a['CODECS'], a['RESOLUTION'], a['AUDIO']), ('2147200', 'avc1.4d401f,mp4a.40.2', '640x360', 'program_audio'))
        a = LV._attrs('TYPE=AUDIO,junk,GROUP-ID="A-1",URI="/hls/4.m3u8"')     # a broken item is skipped, the rest is read
        self.assertEqual((a['TYPE'], a['GROUP-ID'], a['URI']), ('AUDIO', 'A-1', '/hls/4.m3u8'))


class HostNames(unittest.TestCase):
    """Z4: only plain ASCII host names. Before, Unicode, '%', '_', ';' or a zero-width space passed the suffix check and were
    left to the resolver's IDNA mapping."""
    def test_odd_host_names_refused(self):
        for u in ('https://evil.com．com.mcdn.br.de/a', 'https://evil.com​.mcdn.br.de/a', 'https://evİl.mcdn.br.de/a',
                  'https://evil.com%2f.mcdn.br.de/a', 'https://ev%00il.mcdn.br.de/a', 'https://a_b.mcdn.br.de/a',
                  'https://evil.com;.mcdn.br.de/a', 'https://mcdn.br.de/a\x7f', 'https://mcdn.br.de/\x01a', 'https://-x.mcdn.br.de/a',
                  'https://x..mcdn.br.de/a', 'https://' + 'a' * 64 + '.mcdn.br.de/a', 'https://mcdn.br.de．/a'):
            self.assertFalse(LV.url_ok(u), repr(u))
        for u in ('https://mcdn.br.de/x/a.ts', 'https://MCDN.BR.DE/x/a.ts', 'https://mcdn.br.de./x/a.ts', 'https://daserste-live.ard-mcdn.de/a.m3u8',
                  'https://zdf-hls-15.akamaized.net/hls/live/2016498/de/high/master.m3u8'):
            self.assertTrue(LV.url_ok(u), u)
        self.assertFalse(LV.host_ok('xn--mcdn-br-de'))
        self.assertFalse(LV.host_ok('xn--e1a.mcdn.br.de'))                   # since review 3 (L3): exact hosts, no sub-domains


class PrivatePeer(unittest.TestCase):
    """Z3 (DNS rebinding): a host of the allow-list that resolves to a home-network or loopback address is never contacted -
    the check runs after the TCP connect, before TLS (not even the server name is sent)."""
    def test_peer_ok(self):
        for a in ('127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
                  '::1', 'fe80::1%en0', 'fd00::1', '::ffff:192.168.1.1', '::', '', 'garbage'):
            self.assertFalse(LV.peer_ok(a), a)
        for a in ('8.8.8.8', '2a00:1450:4001::1', '::ffff:8.8.8.8'):
            self.assertTrue(LV.peer_ok(a), a)

    def test_rebound_host_not_contacted(self):
        lsock = socket.socket(); lsock.bind(('127.0.0.1', 0)); lsock.listen(4)
        port, got = lsock.getsockname()[1], []
        def serve():
            lsock.settimeout(3)
            try:
                c, _ = lsock.accept()
                c.settimeout(1)
                try: got.append(c.recv(4096))
                except OSError: got.append(b'')
                c.close()
            except OSError: pass
        th = threading.Thread(target=serve, daemon=True); th.start()
        real_gai, real_conn = socket.getaddrinfo, LV._Conn
        def gai(host, *a, **k):                                         # the "rebinding" resolver
            if host == 'mcdn.br.de': return real_gai('127.0.0.1', *a, **k)
            return real_gai(host, *a, **k)
        class C(real_conn):
            def __init__(self, host, _port, **k): real_conn.__init__(self, host, port, **k)
        socket.getaddrinfo, LV._Conn = gai, C
        try:
            LV.close_pool()
            with self.assertRaises(LV.LiveError) as e: LV.https_fetch('https://mcdn.br.de/x/a.m3u8', 1000)
            self.assertEqual((e.exception.status, e.exception.code), (502, 'not_public'))
        finally:
            socket.getaddrinfo, LV._Conn = real_gai, real_conn
            th.join(3); lsock.close()
        self.assertEqual(got, [b''])                                    # connected, but no TLS ClientHello / request sent


class Connections(unittest.TestCase):
    """Z1: every connection had its own thread without any limit; idle connections (no request) never reached the rate
    limit. Measured before the fix: 300 idle connections from one address -> 300 threads."""
    def setUp(self):
        self.orig = LS.MAX_CONN, LS.MAX_CONN_CLIENT
        LS.MAX_CONN, LS.MAX_CONN_CLIENT = 6, 3
        self.srv = LanServer('helper', 0, bind='127.0.0.1')
        self.srv.set_files({'/x': (b'ok', 'text/plain')})
        self.srv.start()

    def tearDown(self):
        self.srv.stop()
        LS.MAX_CONN, LS.MAX_CONN_CLIENT = self.orig

    def _open(self):
        return socket.create_connection(('127.0.0.1', self.srv.port), timeout=3)

    def _get(self, s):
        s.sendall(b'GET /x HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
        out = b''
        try:
            while True:
                b = s.recv(4096)
                if not b: break
                out += b
        except socket.timeout: pass
        return out

    def test_idle_connections_capped(self):
        before = threading.active_count()
        idle = [self._open() for _ in range(3)]
        time.sleep(0.3)
        extra = [self._open() for _ in range(20)]                     # accepted by the kernel, closed at once by the server
        time.sleep(0.3)
        self.assertLessEqual(threading.active_count() - before, 3 + 1)
        self.assertEqual(self._get(extra[0]), b'')
        for s in extra + idle: s.close()
        deadline = time.time() + 3                                    # slots come back when connections end
        while time.time() < deadline and self.srv._httpd.conns: time.sleep(0.05)
        self.assertEqual(self.srv._httpd.conns, {})
        s = self._open()
        self.assertIn(b'200', self._get(s).split(b'\r\n', 1)[0])
        s.close()


class Fuzz(unittest.TestCase):
    """Parser robustness: a few thousand broken TS / ADTS / ID3 / playlist inputs. Only the expected exceptions (the join
    then serves the picture alone), no hang (review 05.11.: 2 x 5000 cases clean)."""
    OK = (LV.MuxError, IndexError, ValueError)

    def test_media(self):
        rnd = random.Random(20261105)
        V, A = T.video_ts(90000, frames=20), T.audio_seg(90360, frames=40)
        t0 = time.process_time()
        for _ in range(1500):
            v, a = bytearray(V), bytearray(A)
            for _ in range(rnd.randint(1, 30)):
                i = rnd.randrange(len(v))
                if i % 188: v[i] = rnd.randrange(256)                  # keep sync bytes: reaches PAT/PMT/PES code
                a[rnd.randrange(len(a))] = rnd.randrange(256)
            if rnd.random() < 0.3: v = v[:rnd.randrange(len(v))]
            if rnd.random() < 0.3: a = a[:rnd.randrange(len(a))]
            v, a = bytes(v), bytes(a)
            for fn, args in ((LV.mux, (v, a, rnd.randrange(16), {})), (LV.first_video_pts, (v,)), (LV.id3_timestamp, (a,)), (LV.adts_frames, (a, 0))):
                try: fn(*args)
                except self.OK: pass
        self.assertLess(time.process_time() - t0, 20)

    def test_playlists(self):
        rnd = random.Random(5)
        base = [T.MASTER_ARD, T.MASTER_ZDF, T.media(1000, 30, 'ts', (1005,), 3)]
        for k in range(1500):
            s = bytearray(base[k % 3].encode())
            for _ in range(rnd.randint(1, 20)):
                s[rnd.randrange(len(s))] = rnd.choice(b'#:,="\n\r\t0123456789-AZaz/.?@%\\\x00\xff')
            txt = bytes(s).decode('utf-8', 'replace')
            for fn in (LV.parse_master, LV.parse_media):
                try:
                    r = fn(txt, T.ZDF)
                    if fn is LV.parse_master:
                        LV.pick_variant(r[0], 540)
                        for v in r[0]: LV.url_ok(v['url'])
                except LV.LiveError: pass


if __name__ == '__main__':
    unittest.main()
