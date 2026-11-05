"""Live TV in the helper (installer/neosetup/live.py, SPEC LIVE-10): picture + separate sound joined for the 2014 TV.
No network: the broadcasters are faked with synthetic HLS playlists and synthetic MPEG-TS / ADTS segments (no real media).
Covers the join (PMT + CRC32, PES/PTS from ID3 PRIV, interleaving, continuity counters, discontinuities), the playlist, and
every security rule: channel id instead of URL, host allow-list, no redirects, size caps, token bound to channel + client,
idle/lifetime end, session limit, LAN/Host/key/rate checks of the helper."""
import gzip
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.request

import helpers as H  # noqa: F401  (import path for neosetup)
from neosetup import helper as HP, live as LV, livedata
from neosetup.lanserver import LanServer, Raw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KEY = 'k' * 32
TV = '10.0.0.40'
HDR = {'Host': '10.0.0.10:32499', 'X-Neo-Key': KEY}
VPID, PMTPID = 0x1E1, 0x1E0
ERSTE = 'https://daserste-live.ard-mcdn.de/daserste/live/hls/de/'
ZDF = 'https://zdf-hls-15.akamaized.net/hls/live/2016498/de/high/master.m3u8'


# ---------------------------------------------------------------- synthetic media
def _section(table_id, ext, body):
    """PSI section with section_length and CRC32."""
    head = bytes([table_id, 0xB0 | ((len(body) + 9) >> 8), (len(body) + 9) & 0xFF, ext >> 8, ext & 0xFF, 0xC1, 0, 0])
    sec = head + body
    return sec + LV.crc32_mpeg(sec).to_bytes(4, 'big')


def _psi_packet(pid, sec, cc=0):
    p = bytes([0x47, 0x40 | (pid >> 8), pid & 0xFF, 0x10 | cc, 0]) + sec
    return p + b'\xff' * (188 - len(p))


def pat():
    return _psi_packet(0, _section(0x00, 1, bytes([0, 1, 0xE0 | (PMTPID >> 8), PMTPID & 0xFF])))


def pmt(streams=((0x1B, VPID),)):
    body = bytes([0xE0 | (VPID >> 8), VPID & 0xFF, 0xF0, 0])
    for st, pid in streams: body += bytes([st, 0xE0 | (pid >> 8), pid & 0xFF, 0xF0, 0])
    return _psi_packet(PMTPID, _section(0x02, 1, body))


def video_ts(pts0, frames=10, step=3600, pkts_per_frame=3, streams=((0x1B, VPID),)):
    """PAT, PMT, then `frames` video PES (PTS + DTS), each spread over a few packets; continuity counters per PID."""
    out, cc = [pat(), pmt(streams)], 0
    for f in range(frames):
        pts, dts = pts0 + f * step + 7200, pts0 + f * step
        pes = b'\x00\x00\x01\xe0\x00\x00' + bytes([0x80, 0xC0, 10]) + LV._pts_bytes(pts, 3) + LV._pts_bytes(dts, 1) + bytes([f]) * 400
        for k in range(pkts_per_frame):
            chunk = pes[k * 184:(k + 1) * 184]
            if len(chunk) < 184: chunk = chunk + b'\xff' * (184 - len(chunk))
            out.append(bytes([0x47, (0x40 if k == 0 else 0) | (VPID >> 8), VPID & 0xFF, 0x10 | cc]) + chunk)
            cc = (cc + 1) & 15
    return b''.join(out)


def id3_priv(ts, extra=True):
    """ID3v2.4 with PRIV com.apple.streaming.transportStreamTimestamp (+ a second tag like ARD's elemental UTC stamp)."""
    def tag(owner, data):
        fr = owner + b'\x00' + data
        frame = b'PRIV' + bytes([(len(fr) >> 21) & 0x7F, (len(fr) >> 14) & 0x7F, (len(fr) >> 7) & 0x7F, len(fr) & 0x7F]) + b'\x00\x00' + fr
        return b'ID3\x04\x00\x00' + bytes([(len(frame) >> 21) & 0x7F, (len(frame) >> 14) & 0x7F, (len(frame) >> 7) & 0x7F, len(frame) & 0x7F]) + frame
    out = tag(LV.ID3_TS_OWNER, ts.to_bytes(8, 'big'))
    if extra: out += tag(b'com.elementaltechnologies.timestamp.utc', b'2026-11-05T13:59:00Z')
    return out


def adts(n, rate=48000, size=300):
    sfi = LV.SAMPLE_RATES.index(rate)
    out = b''
    for i in range(n):
        ln = size
        hdr = bytes([0xFF, 0xF1, 0x40 | (sfi << 2) | 0, 0x80 | ((ln >> 11) & 3), (ln >> 3) & 0xFF, ((ln & 7) << 5) | 0x1F, 0xFC])
        out += hdr + bytes([i & 0xFF]) * (ln - 7)
    return out


def audio_seg(ts, frames=94, rate=48000, extra=True):
    return (id3_priv(ts, extra) if ts is not None else b'') + adts(frames, rate)


def packets(ts):
    return [ts[i:i + 188] for i in range(0, len(ts), 188)]


def pes_list(ts, pid):
    """Reassemble the PES of one PID -> [(pts, payload)] and the continuity counters seen."""
    out, cur, ccs = [], None, []
    for p in packets(ts):
        if LV._pid(p) != pid: continue
        ccs.append(p[3] & 15)
        off = LV._payload(p)
        if p[1] & 0x40:
            if cur: out.append(cur)
            cur = bytearray(p[off:])
        elif cur is not None: cur += p[off:]
    if cur: out.append(cur)
    res = []
    for b in out:
        hl = b[8]
        ln = int.from_bytes(b[4:6], 'big')
        res.append((LV._pts(b, 9), bytes(b[9 + hl:6 + ln] if ln else b[9 + hl:])))
    return res, ccs


# ---------------------------------------------------------------- fake broadcaster
MASTER_ARD = '''#EXTM3U
#EXT-X-VERSION:4
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=2147200,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=640x360,AUDIO="program_audio",SUBTITLES="subs"
master360p1200.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1003200,RESOLUTION=640x360,URI="master360p1200_I-Frame.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=8500800,CODECS="avc1.64002a,mp4a.40.2",RESOLUTION=1920x1080,AUDIO="program_audio"
master1080p5000.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2816000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=960x540,AUDIO="program_audio"
master540p1600.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5491200,CODECS="avc1.640020,mp4a.40.2",RESOLUTION=1280x720,AUDIO="program_audio"
master720p3200.m3u8
#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="de",NAME="Deutsch",AUTOSELECT=YES,DEFAULT=YES,CHANNELS="2",GROUP-ID="program_audio",URI="masteraudio1.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="de",NAME="Klare Sprache",AUTOSELECT=YES,DEFAULT=NO,GROUP-ID="program_audio",URI="masteraudio2.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Deutsch",DEFAULT=YES,LANGUAGE="de",GROUP-ID="subs",URI="mastersubs.m3u8"
'''

MASTER_ZDF = '''#EXTM3U

#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="A-1",NAME="TV Ton",LANGUAGE="deu",DEFAULT=YES,URI="/hls/live/2016498/de/x/4/4.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="A-1",NAME="Audio-Deskription",LANGUAGE="deu",URI="/hls/live/2016498/de/x/6/6.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="A-2",NAME="TV Ton",LANGUAGE="deu",DEFAULT=YES,URI="/hls/live/2016498-b/de/x/4/4.m3u8"

#EXT-X-STREAM-INF:BANDWIDTH=2257198,RESOLUTION=960x540,AUDIO="A-1"
/hls/live/2016498/de/x/2/2.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2257198,RESOLUTION=960x540,AUDIO="A-2"
/hls/live/2016498-b/de/x/2/2.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4504154,RESOLUTION=1280x720,AUDIO="A-1"
/hls/live/2016498/de/x/3/3.m3u8
'''


def media(seq, n, ext, disc=(), dseq=0, prefix=''):
    o = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:%d' % seq, '#EXT-X-DISCONTINUITY-SEQUENCE:%d' % dseq]
    for i in range(seq, seq + n):
        if i in disc: o.append('#EXT-X-DISCONTINUITY')
        o += ['#EXTINF:2.000,', '%s%d.%s' % (prefix, i, ext)]
    return '\n'.join(o) + '\n'


class Fake(object):
    """Broadcaster: URL -> bytes; records every fetch; seq moves on with .tick()."""
    def __init__(self):
        self.seq, self.calls, self.extra, self.disc, self.audio_lag = 1000, [], {}, (), 0

    def tick(self, n=1): self.seq += n

    def __call__(self, url, cap):
        self.calls.append(url)
        if url in self.extra:
            v = self.extra[url]
            if isinstance(v, Exception): raise v
            return v
        if url.startswith('https://api.ardmediathek.de/'):
            return json.dumps({'widgets': [{'mediaCollection': {'embedded': {'streams': [{'media': [{'url': ERSTE + 'master.m3u8'}]}]}}}]}).encode()
        if url == ERSTE + 'master.m3u8': return MASTER_ARD.encode()
        if url == ERSTE + 'master540p1600.m3u8': return media(self.seq, 8, 'ts', self.disc, 5, 'v/').encode()
        if url == ERSTE + 'masteraudio1.m3u8': return media(self.seq, 8 - self.audio_lag, 'aac', self.disc, 5, 'a/').encode()
        if url.startswith(ERSTE + 'v/'):
            n = int(url.rsplit('/', 1)[1].split('.')[0])
            return video_ts(90000 * 2 * n)
        if url.startswith(ERSTE + 'a/'):
            n = int(url.rsplit('/', 1)[1].split('.')[0])
            return audio_seg(90000 * 2 * n + 360)
        raise LV.LiveError(502, 'upstream_404')


# ---------------------------------------------------------------- tests
class Join(unittest.TestCase):
    def test_crc32_mpeg(self):
        self.assertEqual(LV.crc32_mpeg(b'123456789'), 0x0376E6E7)        # CRC-32/MPEG-2 check value
        self.assertEqual(LV.crc32_mpeg(_section(0x02, 1, b'\xe1\xe1\xf0\x00')), 0)   # whole section incl. CRC -> 0

    def test_id3_and_adts(self):
        ts, off = LV.id3_timestamp(audio_seg(2009418400))
        self.assertEqual(ts, 2009418400)
        fr = LV.adts_frames(audio_seg(5), off)
        self.assertEqual((len(fr), fr[0][1], fr[0][2]), (94, 1024, 48000))
        self.assertEqual(LV.id3_timestamp(adts(3))[0], None)
        with self.assertRaises(LV.MuxError): LV.adts_frames(b'\x00' * 500, 0)

    def test_mux_video_unchanged_pmt_new_audio_pts(self):
        v, a = video_ts(1000000), audio_seg(1000360)
        out, cc, info = LV.mux(v, a, 0, {})
        vin, vout = packets(v), packets(out)
        # every packet of the picture is still there, unchanged and in order; only the PMT is new
        self.assertEqual([p for p in vout if LV._pid(p) not in (0x101, PMTPID)], [p for p in vin if LV._pid(p) != PMTPID])
        m = LV.parse_pmt(next(p for p in vout if LV._pid(p) == PMTPID))
        self.assertEqual(m['streams'], [(0x1B, VPID), (0x0F, 0x101)])     # ADTS-AAC on a free PID, CRC checked in parse_pmt
        self.assertEqual(m['pcr'], VPID)
        pes, ccs = pes_list(out, 0x101)
        self.assertEqual([p[0] for p in pes], [1000360 + k * 4 * 1920 for k in range(len(pes))])   # +1920 per frame at 48 kHz
        self.assertEqual(b''.join(p[1] for p in pes), adts(94))                                  # every frame, unchanged
        self.assertEqual(ccs, [i & 15 for i in range(len(ccs))])
        self.assertEqual(cc, len(ccs) & 15)
        self.assertEqual((info['frames'], info['rate'], info['av_ms']), (94, 48000, -76.0))   # sound 360, first picture PTS 7200

    def test_mux_interleaves_by_time(self):
        out, _, _ = LV.mux(video_ts(0, frames=50), audio_seg(0), 0, {})
        last_v = None
        for p in packets(out):
            pid = LV._pid(p)
            if pid == VPID and p[1] & 0x40:
                off = LV._payload(p); last_v = LV._pts(p, off + 14)
            elif pid == 0x101 and p[1] & 0x40:
                off = LV._payload(p); a = LV._pts(p, off + 9)
                if last_v is not None: self.assertGreaterEqual(a, last_v - 3600)   # sound sits next to the picture of its time
        pids = [LV._pid(p) for p in packets(out)]
        self.assertLess(pids.index(0x101), 2 + 3 * 2)                         # the first sound (time 0) next to the first picture

    def test_mux_other_rates_continuity_and_pid(self):
        out, cc, info = LV.mux(video_ts(0), audio_seg(0, 10, 44100), 7, {})
        pes, ccs = pes_list(out, 0x101)
        self.assertEqual([p[0] for p in pes], [0, 4 * 1024 * 90000 // 44100, 8 * 1024 * 90000 // 44100])
        self.assertEqual(ccs[0], 7)                                           # continues from the last segment
        st = {}
        LV.mux(video_ts(0, streams=((0x1B, VPID), (0x15, 0x101))), audio_seg(0), 0, st)
        self.assertEqual(st['apid'], 0x102)                                   # 0x101 taken (ID3 metadata stream) -> next free

    def test_mux_without_timestamp_or_with_sound_inside(self):
        out, _, info = LV.mux(video_ts(5000), audio_seg(None), 0, {})
        self.assertEqual(info['a_pts'], 5000 + 7200)                          # no PRIV: starts with the first picture
        v = video_ts(0, streams=((0x1B, VPID), (0x0F, 0x1E2)))
        self.assertEqual(LV.mux(v, audio_seg(0), 3, {}), (v, 3, {'passed': True}))   # sound already in the stream: untouched

    def test_mux_rejects_garbage(self):
        for bad in (b'', b'\x47' * 100, b'x' * 188, pat() * 3):
            with self.assertRaises(LV.MuxError): LV.mux(bad, audio_seg(0), 0, {})
        with self.assertRaises(LV.MuxError): LV.mux(video_ts(0), b'\x00' * 50, 0, {})

    def test_pts_wrap(self):
        top = (1 << 33) - 2000
        out, _, info = LV.mux(video_ts(top), audio_seg(top + 100), 0, {})
        pes, _ = pes_list(out, 0x101)
        self.assertEqual(pes[1][0], (top + 100 + 4 * 1920) & LV.MASK33)
        self.assertEqual(info['av_ms'], round((100 - 7200) / 90.0, 1))


class Playlists(unittest.TestCase):
    def test_master_pick(self):
        v, a = LV.parse_master(MASTER_ARD, ERSTE + 'master.m3u8')
        self.assertEqual([x['h'] for x in v], [360, 1080, 540, 720])          # I-frame lists and subtitles do not count
        self.assertEqual(LV.pick_variant(v, 540)['url'], ERSTE + 'master540p1600.m3u8')
        self.assertEqual(LV.pick_variant(v, 1080)['h'], 1080)
        self.assertEqual(LV.pick_variant(v, 300)['h'], 360)                   # nothing that small -> the smallest
        self.assertEqual(LV.pick_audio(a['program_audio'])['url'], ERSTE + 'masteraudio1.m3u8')
        v, a = LV.parse_master(MASTER_ZDF, ZDF)
        p = LV.pick_variant(v, 540)
        self.assertEqual(p['url'], 'https://zdf-hls-15.akamaized.net/hls/live/2016498/de/x/2/2.m3u8')   # first copy, not the backup
        self.assertEqual(LV.pick_audio(a[p['audio']])['url'], 'https://zdf-hls-15.akamaized.net/hls/live/2016498/de/x/4/4.m3u8')
        with self.assertRaises(LV.LiveError): LV.parse_master('<html>', ZDF)

    def test_media_tail_discontinuity(self):
        t = media(100, 10, 'ts', disc=(103, 105, 108), dseq=7)
        full = LV.parse_media(t, ZDF, 0)
        self.assertEqual([(x['n'], x['disc']) for x in full['segs']][3:6], [(103, True), (104, False), (105, True)])
        for tail, dseq, first in ((7, 8, 103), (5, 9, 105), (2, 10, 108)):
            m = LV.parse_media(t, ZDF, tail)
            self.assertEqual((m['dseq'], m['segs'][0]['n'], m['segs'][0]['disc']), (dseq, first, False), tail)
        self.assertEqual(LV.parse_media(t, ZDF)['segs'][0]['url'], 'https://zdf-hls-15.akamaized.net/hls/live/2016498/de/high/100.ts')
        with self.assertRaises(LV.LiveError):
            LV.parse_media('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:2,\n1.ts\n', ZDF)

    def test_livedata_matches_channels_js(self):
        """The helper's channel table is generated from src/live/channels.js (tools/live_data.js); every address allowed."""
        self.assertTrue(len(livedata.CHANNELS) >= 25)
        for ch, d in livedata.CHANNELS.items():
            self.assertTrue(LV.CHANNEL.match(ch), ch)
            self.assertTrue(LV.url_ok(d['url']), ch)
        self.assertNotIn('de-arte', livedata.CHANNELS)                       # sound inside the picture: the TV plays it directly
        self.assertNotIn('int-dw-en', livedata.CHANNELS)
        if shutil.which('node') and os.path.isfile(os.path.join(ROOT, 'tools', 'live_data.js')):
            r = subprocess.run(['node', os.path.join(ROOT, 'tools', 'live_data.js'), '--check'], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


class Allow(unittest.TestCase):
    def test_url_ok(self):
        ok = ['https://daserste-live.ard-mcdn.de/daserste/live/hls/de/master.m3u8', 'https://mcdn.br.de/br/fs/a/b.ts',
              'https://zdf-hls-15.akamaized.net/hls/live/2016498/de/x/2/432639.ts?x=1']
        bad = ['http://daserste-live.ard-mcdn.de/a.m3u8', 'https://evil.example/a.m3u8', 'https://ard-mcdn.de.evil.example/a.m3u8',
               'https://evilard-mcdn.de/a.m3u8', 'https://user:' + 'pw' + '@mcdn.br.de/a.m3u8', 'https://mcdn.br.de:8443/a.m3u8',
               'https://mcdn.br.de/a.m3u8#x', 'https://mcdn.br.de/a/../b.m3u8', 'https://mcdn.br.de/a b.m3u8', 'https://mcdn.br.de\\@evil/x',
               'https://zdf-hls-99.akamaized.net/a.m3u8', 'https://akamaized.net/a.m3u8', 'file:///etc/passwd', 'https://127.0.0.1/a.m3u8',
               'https://169.254.169.254/latest', 'https://mcdn.br.de/' + 'a' * 1100, None, 42]
        for u in ok: self.assertTrue(LV.url_ok(u), u)
        for u in bad: self.assertFalse(LV.url_ok(u), u)
        self.assertTrue(LV.url_ok('https://api.ardmediathek.de/page-gateway/pages/daserste/item/Y3JpZDovL2Rhc2Vyc3Rl?devicetype=pc&embedded=true', True))
        self.assertFalse(LV.url_ok('https://api.ardmediathek.de/page-gateway/pages/daserste/item/x', False))   # API host only for the API
        self.assertFalse(LV.url_ok('https://api.ardmediathek.de/other/path', True))

    def test_body_caps_and_gzip_bomb(self):
        class R(object):
            def __init__(self, data, enc=''):
                self.d, self.h = [data[i:i + 65536] for i in range(0, len(data), 65536)] + [b''], {'Content-Encoding': enc}
            def getheader(self, k): return self.h.get(k)
            def read(self, n): return self.d.pop(0)
        self.assertEqual(LV._body(R(b'x' * 100), 100, 0, lambda: 0), b'x' * 100)
        with self.assertRaises(LV.LiveError): LV._body(R(b'x' * 101), 100, 0, lambda: 0)
        bomb = gzip.compress(b'\x00' * (50 << 20))                         # 50 MB unpacked from ~50 KB
        with self.assertRaises(LV.LiveError) as e: LV._body(R(bomb, 'gzip'), 1 << 20, 0, lambda: 0)
        self.assertEqual(e.exception.code, 'too_large')
        self.assertEqual(LV._body(R(gzip.compress(b'#EXTM3U\n'), 'gzip'), 100, 0, lambda: 0), b'#EXTM3U\n')
        with self.assertRaises(LV.LiveError): LV._body(R(b'x', 'br'), 100, 0, lambda: 0)
        t = [0]
        def slow(): t[0] += 10; return t[0]
        with self.assertRaises(LV.LiveError) as e: LV._body(R(b'x' * 200000), 1 << 20, 0, slow)
        self.assertEqual(e.exception.code, 'slow')

    def test_fetch_refuses_redirects_and_errors(self):
        """http.client never follows a redirect: any status but 200 is an error (checked against a local TLS-less fake)."""
        import http.client
        class Resp(object):
            def __init__(self, status): self.status, self.will_close = status, True
            def getheader(self, k): return None
            def read(self, n): return b''
        class Conn(object):
            st = 302
            def __init__(self, *a, **k): pass
            def request(self, *a, **k): pass
            def getresponse(self): return Resp(Conn.st)
            def close(self): pass
        orig = LV._Conn
        LV._Conn = Conn
        try:
            LV.close_pool()
            for st in (301, 302, 307, 404, 500):
                Conn.st = st
                with self.assertRaises(LV.LiveError) as e: LV.https_fetch('https://mcdn.br.de/a.m3u8', 1000)
                self.assertEqual(e.exception.code, 'upstream_%d' % st)
        finally:
            LV._Conn = orig


class Sessions(unittest.TestCase):
    def setUp(self):
        self.f = Fake()
        self.now = [1000.0]
        self.L = LV.Live(fetch=self.f, clock=lambda: self.now[0], ffmpeg=False)

    def open(self, ch='de-daserste', client=TV, h=540):
        d = self.L.open(ch, client, h)
        return d['path'].split('/')[2], d

    def test_flow(self):
        tok, d = self.open()
        self.assertRegex(d['path'], r'^/live/[A-Za-z0-9_-]{32}/index\.m3u8$')
        self.assertEqual(d['h'], 540)
        pl = self.L.playlist(tok, TV).decode()
        self.assertIn('#EXT-X-MEDIA-SEQUENCE:1002\n', pl)                   # the newest WINDOW (6) of 8
        self.assertEqual(pl.count('.ts'), 6)
        self.assertNotIn('http', pl)                                         # only relative names: the TV never sees a broadcaster URL
        seg = self.L.segment(tok, 's1005.ts', TV)
        pes, _ = pes_list(seg, 0x101)
        self.assertEqual(pes[0][0], 90000 * 2 * 1005 + 360)
        self.assertTrue(all(LV.url_ok(u) or LV.url_ok(u, True) for u in self.f.calls))
        self.assertIn(ERSTE + 'master540p1600.m3u8', self.f.calls)
        self.assertIs(self.L.segment(tok, 's1005.ts', TV), seg)             # asked twice: from memory, no new fetch
        with self.assertRaises(LV.LiveError) as e: self.L.segment(tok, 's1.ts', TV)
        self.assertEqual(e.exception.status, 404)
        for name in ('../../etc/passwd', 's1005.ts/../x', 'index.m3u8', 's-1.ts', 's1005.aac', 's' + '9' * 13 + '.ts'):
            with self.assertRaises(LV.LiveError): self.L.segment(tok, name, TV)
        n0 = len(self.f.calls)
        self.L.playlist(tok, TV)                                             # within one target duration: no new upstream request
        self.assertEqual(len(self.f.calls), n0)
        self.f.tick(); self.now[0] += 2
        self.assertIn('#EXT-X-MEDIA-SEQUENCE:1003\n', self.L.playlist(tok, TV).decode())

    def test_only_channel_ids_never_urls(self):
        for ch in ('https://evil.example/x.m3u8', 'de-arte', 'int-dw-en', '../de-zdf', 'DE-ZDF', '', None, 'de-zdf\n'):
            with self.assertRaises(LV.LiveError) as e: self.L.open(ch, TV, 540)
            self.assertEqual(e.exception.status, 404, ch)
        for h in (0, 100, 2160, 541):
            with self.assertRaises(LV.LiveError): self.L.open('de-zdf', TV, h)
        self.assertEqual(self.f.calls, [])                                   # nothing fetched for a refused request

    def test_foreign_hosts_in_answers_are_refused(self):
        self.f.extra[ERSTE + 'master.m3u8'] = MASTER_ARD.replace('master540p1600.m3u8', 'https://evil.example/v.m3u8').encode()
        with self.assertRaises(LV.LiveError) as e: self.open()
        self.assertEqual(e.exception.code, 'not_allowed')
        self.assertFalse(any('evil' in u for u in self.f.calls))
        self.assertEqual(self.L.sessions, {})                                # a failed open leaves no session behind
        # the ARD service names a foreign host -> ignored, the fixed address from the data is used
        self.f.extra = {}
        api = json.dumps({'widgets': [{'mediaCollection': {'embedded': {'streams': [{'media': [{'url': 'https://evil.example/m.m3u8'}]}]}}}]}).encode()
        self.f.extra['https://api.ardmediathek.de/page-gateway/pages/daserste/item/' + livedata.CHANNELS['de-daserste']['ard'][1] + '?devicetype=pc&embedded=true'] = api
        self.open()
        self.assertFalse(any('evil' in u for u in self.f.calls))
        # a segment on a foreign host in the media playlist is left out
        self.f.extra[ERSTE + 'master540p1600.m3u8'] = media(1000, 8, 'ts', prefix='https://evil.example/').encode()
        tok, _ = self.open(client='10.0.0.41')
        with self.assertRaises(LV.LiveError) as e: self.L.playlist(tok, '10.0.0.41')
        self.assertEqual(e.exception.status, 503)
        self.assertFalse(any('evil' in u for u in self.f.calls))

    def test_token_bound_to_client_and_ends(self):
        tok, _ = self.open()
        with self.assertRaises(LV.LiveError): self.L.playlist(tok, '10.0.0.99')     # another device with the same address
        with self.assertRaises(LV.LiveError): self.L.playlist(tok[:-1] + ('A' if tok[-1] != 'A' else 'B'), TV)
        with self.assertRaises(LV.LiveError): self.L.playlist('short', TV)
        self.assertFalse(self.L.close(tok, '10.0.0.99'))                  # only its own client may end it
        self.now[0] += LV.IDLE - 1; self.L.playlist(tok, TV)                 # a request keeps it alive
        self.now[0] += LV.IDLE + 1
        with self.assertRaises(LV.LiveError) as e: self.L.playlist(tok, TV)   # idle -> gone
        self.assertEqual(e.exception.code, 'session')
        tok, _ = self.open()
        for _ in range(int(LV.LIFE / 50) + 1):
            self.now[0] += 50
            try: self.L.playlist(tok, TV)
            except LV.LiveError: break
        self.assertNotIn(tok, self.L.sessions)                               # never longer than LIFE
        tok, _ = self.open()
        self.assertTrue(self.L.close(tok, TV))
        self.assertEqual(self.L.sessions, {})

    def test_one_per_client_and_limit(self):
        a, _ = self.open()
        b, _ = self.open('de-zdf'.replace('de-zdf', 'de-daserste'))         # zapping: the new session replaces the old one
        self.assertEqual(list(self.L.sessions), [b])
        for i in range(LV.MAX_SESSIONS - 1): self.open(client='10.0.0.%d' % (50 + i))
        with self.assertRaises(LV.LiveError) as e: self.open(client='10.0.0.90')
        self.assertEqual((e.exception.status, e.exception.code), (503, 'busy'))
        self.now[0] += LV.IDLE + 1
        self.open(client='10.0.0.90')                                     # idle ones are swept first
        self.assertEqual(len(self.L.sessions), 1)

    def test_tokens_random(self):
        toks = set()
        for i in range(50): toks.add(self.open(client='10.0.0.%d' % i)[0]); self.L.sessions.clear()
        self.assertEqual(len(toks), 50)

    def test_discontinuity_kept(self):
        self.f.disc = (1004,)
        tok, _ = self.open()
        pl = self.L.playlist(tok, TV).decode().split('\n')
        self.assertIn('#EXT-X-DISCONTINUITY-SEQUENCE:5', pl)
        self.assertEqual(pl[pl.index('#EXT-X-DISCONTINUITY') + 2], 's1004.ts')
        self.L.segment(tok, 's1002.ts', TV)
        s3 = self.L.segment(tok, 's1003.ts', TV)
        s4 = self.L.segment(tok, 's1004.ts', TV)
        self.assertNotEqual(pes_list(s3, 0x101)[1][0], 0)
        self.assertEqual(pes_list(s4, 0x101)[1][0], 0)                      # new timeline: counters start again
        self.f.tick(3); self.now[0] += 6                                     # the tag slid out of the window -> sequence + 1
        pl = self.L.playlist(tok, TV).decode()
        self.assertIn('#EXT-X-DISCONTINUITY-SEQUENCE:6', pl)
        self.assertNotIn('#EXT-X-DISCONTINUITY\n', pl)

    def test_audio_lag_and_missing_sound(self):
        self.f.audio_lag = 1                                                 # the sound list is one segment behind
        tok, _ = self.open()
        pl = self.L.playlist(tok, TV).decode()
        self.assertNotIn('s1007.ts', pl)                                     # only segments with both
        self.f.extra[ERSTE + 'a/1005.aac'] = LV.LiveError(502, 'upstream_404')
        self.assertEqual(self.L.segment(tok, 's1005.ts', TV), video_ts(90000 * 2 * 1005))   # sound failed: picture alone, no error
        self.f.extra[ERSTE + 'a/1004.aac'] = b'not audio at all' * 10
        self.assertEqual(self.L.segment(tok, 's1004.ts', TV), video_ts(90000 * 2 * 1004))   # no ffmpeg: picture alone
        self.assertEqual(self.L.sessions[tok].stats['video_only'], 2)

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg not installed')
    def test_ffmpeg_fallback(self):
        L = LV.Live(fetch=self.f, clock=lambda: self.now[0], ffmpeg=shutil.which('ffmpeg'))
        d = L.open('de-daserste', TV, 540)
        tok = d['path'].split('/')[2]
        out, info = L._fallback(L.sessions[tok], 1, video_ts(0), audio_seg(360), LV.MuxError('test'))
        self.assertTrue(info.get('ffmpeg') or info.get('video_only'))
        self.assertTrue(len(out) % 188 == 0 and out[:1] == b'\x47')

    def test_memory_bounded(self):
        tok, _ = self.open()
        s = self.L.sessions[tok]
        for i in range(30):
            self.f.tick(); self.now[0] += 2
            self.L.playlist(tok, TV)
            self.L.segment(tok, 's%d.ts' % (self.f.seq + 5), TV)
        self.assertLessEqual(len(s.cache), LV.KEEP)
        self.assertLessEqual(len(s.segs), 60)
        self.assertLessEqual(len(s.cc), 21)


class Routes(unittest.TestCase):
    def setUp(self):
        self.store = HP.Store(KEY, {})
        self.h = HP.Helper(self.store, 'plexneo-helper-test')
        self.f = Fake()
        self.h.live = LV.Live(fetch=self.f, ffmpeg=False)

    def get(self, path, headers=None, client=TV, method='GET'):
        return self.h.handle(method, path, dict(HDR, **(headers or {})), client)

    def test_hello_announces_live(self):
        self.assertIn('live', self.h.hello()['features'])

    def test_open_and_play(self):
        st, d = self.get('/live/open?ch=de-daserste&h=540')
        self.assertEqual(st, 200, d)
        st, pl = self.get(d['path'], {'X-Neo-Key': ''})                    # the player sends no key: the token is enough
        self.assertEqual((st, type(pl), pl.ctype), (200, Raw, 'application/vnd.apple.mpegurl'))
        name = [l for l in pl.data.decode().split('\n') if l.endswith('.ts')][-1]
        st, seg = self.get(d['path'].rsplit('/', 1)[0] + '/' + name, {'X-Neo-Key': ''})
        self.assertEqual((st, seg.ctype), (200, 'video/mp2t'))
        st, r = self.get(d['path'].rsplit('/', 1)[0], method='DELETE')
        self.assertEqual((st, r), (200, {'ok': True}))
        st, r = self.get(d['path'])
        self.assertEqual((st, r), (404, {'error': 'session'}))

    def test_refusals(self):
        cases = [
            (('/live/open?ch=de-daserste', {'X-Neo-Key': 'wrong'}), 401, 'key'),
            (('/live/open?ch=de-daserste', {'X-Neo-Key': ''}), 401, 'key'),
            (('/live/open?ch=de-daserste', {'Host': 'evil.example'}), 403, 'host'),
            (('/live/open?ch=de-daserste&url=https://evil.example/x.m3u8',), 400, 'query'),
            (('/live/open?url=https://evil.example/x.m3u8',), 400, 'query'),
            (('/live/open?ch=de-daserste&ch=de-zdf',), 400, 'query'),
            (('/live/open?ch=https%3A%2F%2Fevil.example%2Fx.m3u8',), 404, 'channel'),
            (('/live/open?ch=de-daserste&h=99999',), 400, 'h'),
            (('/live/open?ch=de-daserste&h=abc',), 400, 'h'),
            (('/live/../neo-helper',), 404, 'route'),
            (('/live/' + 'a' * 32 + '/../../etc/passwd',), 404, 'route'),
            (('/live/' + 'a' * 32 + '/index.m3u8?u=https://evil.example',), 404, 'route'),
            (('/live/' + 'a' * 32 + '/index.m3u8',), 404, 'session'),
            (('/live/%2e%2e/index.m3u8',), 404, 'route'),
        ]
        for args, st, code in cases:
            r = self.get(*args)
            self.assertEqual(r, (st, {'error': code}), args)
        self.assertEqual(self.get('/live/open?ch=de-daserste', client='8.8.8.8'), (403, {'error': 'lan_only'}))
        self.assertEqual(self.get('/live/open?ch=de-daserste', method='POST'), (405, {'error': 'method'}))
        self.assertEqual(self.f.calls, [])                                   # none of these reached a broadcaster

    def test_tv_address_lock_and_rate(self):
        self.store.allow = TV
        self.assertEqual(self.get('/live/open?ch=de-daserste', client='10.0.0.41'), (403, {'error': 'lan_only'}))
        self.h.rate = HP.RateLimit(rate=3, per=60)
        codes = [self.get('/live/' + 'a' * 32 + '/index.m3u8')[0] for _ in range(5)]
        self.assertEqual(codes[-1], 429)

    def test_upstream_error_is_json(self):
        self.f.extra[ERSTE + 'master.m3u8'] = LV.LiveError(502, 'upstream')
        self.f.extra['https://daserste-live.ard-mcdn.de/daserste/live/hls/de/master.m3u8'] = LV.LiveError(502, 'upstream')
        self.assertEqual(self.get('/live/open?ch=de-daserste'), (502, {'error': 'upstream'}))

    def test_over_lanserver(self):
        srv = LanServer('helper', 0, bind='127.0.0.1')
        srv.api = self.h
        srv.start()
        try:
            base = 'http://127.0.0.1:%d' % srv.port
            req = urllib.request.Request(base + '/live/open?ch=de-daserste&h=540', headers={'X-Neo-Key': KEY})
            with urllib.request.urlopen(req, timeout=5) as r: d = json.loads(r.read())
            with urllib.request.urlopen(base + d['path'], timeout=5) as r:
                self.assertEqual(r.headers['Content-Type'], 'application/vnd.apple.mpegurl')
                self.assertEqual(r.headers['Cache-Control'], 'no-store')
                self.assertTrue(r.read().startswith(b'#EXTM3U'))
            self.assertFalse(any(d['path'].split('/')[2] in e[2] for e in srv.events))   # the token is not kept in the event list
            with self.assertRaises(urllib.error.HTTPError) as e: urllib.request.urlopen(base + '/live/open?ch=de-daserste', timeout=5)
            self.assertEqual(e.exception.code, 401)
        finally:
            srv.stop()


class Review(unittest.TestCase):
    """Findings of the security review 05.11. (each one reproduced first, then fixed)."""
    def setUp(self):
        self.f = Fake()
        self.now = [1000.0]
        self.L = LV.Live(fetch=self.f, clock=lambda: self.now[0], ffmpeg=False)

    def test_deadline_kills_slow_drip(self):
        """A server sending one byte every few seconds never trips the socket timeout: the watchdog ends the fetch."""
        import http.client, threading, time as T
        class Sock(object):
            def __init__(self): self.dead = threading.Event()
            def shutdown(self, how): self.dead.set()
        class Resp(object):
            status, will_close = 200, False
            def __init__(self, sock): self.sock = sock
            def getheader(self, k): return None
            def read1(self, n):
                if self.sock.dead.wait(0.05): raise OSError('shut down')
                return b'x'
        class Conn(object):
            def __init__(self, *a, **k): self.sock = Sock()
            def request(self, *a, **k): pass
            def getresponse(self): return Resp(self.sock)
            def close(self): pass
        orig, dl = LV._Conn, LV.DEADLINE
        LV._Conn, LV.DEADLINE = Conn, 0.3
        try:
            LV.close_pool()
            t0 = T.monotonic()
            with self.assertRaises(LV.LiveError) as e: LV.https_fetch('https://mcdn.br.de/a.ts', 1 << 20)
            self.assertIn(e.exception.code, ('slow', 'upstream'))
            self.assertLess(T.monotonic() - t0, 2.0)
        finally:
            LV._Conn, LV.DEADLINE = orig, dl

    def test_unknown_segment_numbers_cost_nothing(self):
        tok, _ = Sessions.open(self)
        n0 = len(self.f.calls)
        for n in (1, 999, 10 ** 11):
            with self.assertRaises(LV.LiveError): self.L.segment(tok, 's%d.ts' % n, TV)
        self.assertEqual(len(self.f.calls), n0)                              # far outside the window: no upstream request

    def test_joins_limited_per_session(self):
        import threading
        tok, _ = Sessions.open(self)
        gate, active, peak = threading.Event(), [0], [0]
        lock = threading.Lock()
        orig = self.f.__call__
        def slow(url, cap):
            if '/v/' in url:
                with lock: active[0] += 1; peak[0] = max(peak[0], active[0])
                gate.wait(2)
                with lock: active[0] -= 1
            return orig(url, cap)
        self.L.fetch = slow
        ths = [threading.Thread(target=lambda n=n: self.L.segment(tok, 's%d.ts' % n, TV)) for n in range(1002, 1008)]
        for t in ths: t.start()
        import time as T; T.sleep(0.3)
        self.assertLessEqual(peak[0], LV.JOINS_PER_SESSION)
        gate.set()
        for t in ths: t.join(5)

    def test_malformed_ts_gives_picture_not_500(self):
        bad = bytearray(video_ts(0))
        bad[188 + 4] = 200                                                    # PMT pointer field far beyond the packet
        tok, _ = Sessions.open(self)
        self.f.extra[ERSTE + 'v/1005.ts'] = bytes(bad)
        self.assertEqual(self.L.segment(tok, 's1005.ts', TV), bytes(bad))   # picture alone, no exception
        trunc = video_ts(0)[:188 * 2] + bytes([0x47, 0x41, 0xE1, 0x30, 183]) + b'\x00' * 183
        with self.assertRaises(LV.MuxError): LV.first_video_pts(trunc)

    def test_odd_digits_and_huge_numbers(self):
        m = LV.parse_media('#EXTM3U\n#EXT-X-TARGETDURATION:²\n#EXT-X-MEDIA-SEQUENCE:' + '9' * 5000 + '\n#EXTINF:2,\n1.ts\n', ZDF)
        self.assertEqual((m['target'], m['seq']), (2, 0))
        v, _ = LV.parse_master('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=²,RESOLUTION=1x99999999\nv.m3u8\n', ZDF)
        self.assertEqual((v[0]['bw'], v[0]['h']), (0, 0))

    def test_big_master_linear(self):
        import time as T
        txt = '#EXTM3U\n' + '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1x1\n\n' * 40000
        t0 = T.process_time(); LV.parse_master(txt, ZDF)
        self.assertLess(T.process_time() - t0, 1.0)
        many = b''.join(id3_priv(i, False) for i in range(20000)) + adts(2)
        t0 = T.process_time(); LV.adts_frames(many, 0)
        self.assertLess(T.process_time() - t0, 1.0)

    def test_closed_sessions_free_memory(self):
        tok, _ = Sessions.open(self)
        self.L.segment(tok, 's1005.ts', TV)
        s = self.L.sessions[tok]
        self.now[0] += LV.IDLE + 1
        self.assertTrue(self.L.sweep())
        self.assertEqual(len(s.cache), 0)

    def test_event_list_never_holds_token(self):
        srv = LanServer('helper', 0, bind='127.0.0.1')
        srv.event('10.0.0.40', 'http://10.0.0.10/live/' + 'a' * 32 + '/index.m3u8', 403)
        srv.event('10.0.0.40', '/live/' + 'b' * 32 + '/s1.ts', 404)
        self.assertFalse(any('a' * 32 in e[2] or 'b' * 32 in e[2] for e in srv.events))

    def test_ffmpeg_formats_fixed(self):
        import inspect
        src = inspect.getsource(LV.ffmpeg_mux)
        self.assertIn("'-f', 'mpegts', '-i', vp", src)
        self.assertIn("'-f', 'aac', '-i', ap", src)


if __name__ == '__main__':
    unittest.main()
