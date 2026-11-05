"""Live TV for the 2014 TV (SPEC LIVE-10): picture and sound in ONE stream.

ARD/ZDF send the sound of their live streams as a separate HLS rendition (EXT-X-MEDIA TYPE=AUDIO): the video segments carry
H.264 only, the sound comes as packed ADTS-AAC segments (.aac with an ID3 PRIV timestamp). The player of the 2014 TV cannot
combine the two (SEF event 6); measured 05.11.2026: the same picture + sound joined into one MPEG-TS plays at once with sound.

This module does exactly that join, in pure Python (no ffmpeg needed; used only as a fallback if it is installed):
- video TS packets are passed through unchanged; only the PMT gets one more entry (ADTS-AAC on a free PID, new CRC32),
- the ADTS frames of the matching audio segment (same media sequence number) go in as PES packets, PTS = ID3 PRIV
  `com.apple.streaming.transportStreamTimestamp` + 1024 samples per frame (1920 ticks at 48 kHz), interleaved by time,
- the helper serves a short live playlist (the newest WINDOW segments, EXT-X-DISCONTINUITY kept) per session.

It is NOT a proxy (same spirit as helper.py):
- the TV sends a channel id, never a URL; the helper knows the addresses from livedata.py (generated from src/live/channels.js),
- every upstream URL (the ARD page gateway answer, playlists, segments) must be https on a host of livedata.HOSTS, standard port,
  no credentials; redirects are never followed; size and time caps per fetch; certificate checks on,
- a session is a random token in the path (the TV's player cannot send headers), bound to the channel, the client address and
  the chosen height; it ends after IDLE seconds without a request, after LIFE seconds, on DELETE, or when the same client opens
  another one; at most MAX_SESSIONS at a time; at most KEEP joined segments per session in memory; nothing is written to disk
  (except the ffmpeg fallback's private temp files, removed at once),
- only segment numbers of the current window are served (review 05.11. M1), and a session may fetch at most BUDGET_SEGS
  times its video cap per minute from upstream (playlists and segments together).
"""
import http.client
import ipaddress
import os
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.parse
import zlib
from collections import OrderedDict

from . import livedata
from .netutil import json_loads

WINDOW = 6                    # segments in the playlist for the TV (about 12 s with 2-s segments)
KEEP = 3                      # joined segments per session kept in memory (the player may ask twice)
IDLE = 60                     # s without a request -> session ends (pause > 30 s reopens the stream in the app anyway)
LIFE = 12 * 3600              # s, absolute
MAX_SESSIONS = 4              # whole helper; one per client (a new one replaces the old)
TIMEOUT = 8                   # s per socket operation
DEADLINE = 15                 # s per fetch in total (a slow drip cannot hold a thread)
CAP_PLAYLIST = 2 << 20       # ARD media playlists list 2 h (~3600 segments, 460 KB; 29 KB with gzip)
CAP_API = 256 << 10
# Video segment cap by the height of the chosen variant (review 05.11. M2). Measured 05.11.2026, all 27 helper channels, the
# newest segments of every variant (4-s segments at ARD, 2-s at ZDF): largest segment 1080p 2.74 MB, 720p 1.33 MB, 540p
# 0.59 MB, 360p 0.33 MB; largest declared peak BANDWIDTH x 4 s: 1080p 4.05 MiB (8.5 Mbit/s), 720p 2.73 MiB, 540p 1.42 MiB,
# 360p 1.02 MiB. The caps are about 1.2-1.5 x that declared peak (an encoder may use it), 1.8-4.5 x the measured sizes.
CAP_VIDEO_BY_H = ((360, 3 << 19), (540, 2 << 20), (720, 7 << 19))   # height <= key -> cap (1.5 / 2 / 3.5 MiB)
CAP_VIDEO = 5 << 20           # 1080p (and unknown heights): 5 MiB
CAP_AUDIO = 1 << 20
HEIGHTS = (360, 540, 720, 1080)
DEFAULT_H = 720                 # same as the app's "Automatic" (TV test 05.11.: 720p and 1080p played on the 2014 TV)
TOKEN = re.compile(r'^[A-Za-z0-9_-]{32}$')
CHANNEL = re.compile(r'^[a-z]+-[a-z0-9-]{1,40}$')
SEG = re.compile(r'^s(\d{1,12})\.ts$')
ARD_API = 'https://api.ardmediathek.de/page-gateway/pages/%s/item/%s?devicetype=pc&embedded=true'
ARD_HOST = 'api.ardmediathek.de'
_PATH_OK = re.compile(r"^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$")
_QUERY_OK = re.compile(r"^[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$")
ID3_TS_OWNER = b'com.apple.streaming.transportStreamTimestamp'
SAMPLE_RATES = (96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350)
FRAMES_PER_PES = 4
JOINS_PER_SESSION = 2         # segments joined at the same time per session (the player fetches one after the other)
JOINS_ALL = 4                 # … and in the whole helper
AHEAD = 3                     # a segment number at most this far past the newest known forces a playlist refresh
TAIL = 30                     # newest segments read from an upstream media playlist
BUDGET_SEGS = 20              # upstream bytes per session and minute <= 20 x the video cap (1080p: 100 MiB/min = 14 Mbit/s,
                              # 2.5 x the measured 5.5 Mbit/s; 540p: 40 MiB/min, 3 x the measured 1.8 Mbit/s)
FFMPEG_RUN = 3                # ffmpeg fallbacks in a row per session, then picture only for the rest of it (review 05.11. L5)
FFMPEG_MAX = 10               # ... and in total per session
MASK33 = (1 << 33) - 1
DIGITS = re.compile(r'[0-9]{1,12}', re.ASCII)      # str.isdigit() also takes '²' etc. (int() then fails)


def cap_video(h):
    """Video segment cap for the chosen variant height (0 = unknown -> the 1080p cap)."""
    for lim, cap in CAP_VIDEO_BY_H:
        if 0 < (h or 0) <= lim: return cap
    return CAP_VIDEO


def _num(v):
    return int(v) if isinstance(v, str) and DIGITS.fullmatch(v) else None


class LiveError(Exception):
    def __init__(self, status, code):
        Exception.__init__(self, code)
        self.status, self.code = status, code


class MuxError(Exception):
    pass


# ---------------------------------------------------------------- upstream allow-list + fetch
_HOSTNAME = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?', re.ASCII)


def host_ok(host):
    """Only plain ASCII host names (letters, digits, '-', '.'; review 05.11. Z4: no Unicode, '%', '_' or ';' that the
    resolver's IDNA step would map to something else) that are exactly a host of the allow-list (review 05.11. L3: the
    generated list holds only the hosts of the joined channels, no sub-domains)."""
    h = (host or '').lower()
    if len(h) > 253 or not _HOSTNAME.fullmatch(h): return False
    return h.rstrip('.') in livedata.HOSTS


def url_ok(url, ard_api=False):
    """True only for https URLs on the channel hosts (or the fixed ARD page gateway path), standard port, no credentials."""
    if not isinstance(url, str) or len(url) > 1024 or not url.isascii() or any(c in url for c in ' \t\r\n\\"<>') \
            or any(ord(c) < 0x21 or ord(c) == 0x7F for c in url): return False
    try:
        p = urllib.parse.urlsplit(url)
        port = p.port
    except ValueError: return False
    if p.scheme != 'https' or p.username or p.password or port is not None or p.fragment or not _PATH_OK.match(p.path or '/'): return False
    if p.query and not _QUERY_OK.match(p.query): return False
    if '/../' in p.path + '/' or '/./' in p.path + '/': return False
    host = (p.hostname or '').lower()
    if ard_api: return host == ARD_HOST and re.fullmatch(r'/page-gateway/pages/[a-z0-9]{1,20}/item/[A-Za-z0-9_-]{8,200}', p.path) is not None
    return host_ok(host)


_CTX = ssl.create_default_context()     # certificate and host name checks on
_POOL = {}                              # host -> idle keep-alive connections (a TLS handshake per request cost CPU and ~50 ms)
_POOL_LOCK = threading.Lock()
POOL_PER_HOST = 3
POOL_HOSTS = 40                         # hosts with idle connections at most


def _v4_ok(ip):
    return ip.is_global and not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved
                                 or ip.is_unspecified or ip in _CGNAT)


def peer_ok(addr):
    """The address a broadcaster's host name resolved to must be a public one (review 05.11. Z3, DNS rebinding: a host of the
    allow-list that resolves to 127.0.0.1, 192.168.x.x, fe80:: … is never contacted, even if something there had a valid
    certificate for that name). IPv6 (review 05.11. L2: under Python 3.9 6to4 2002:c0a8:101::1 and site-local fec0::1
    passed): only global unicast 2000::/3 that the running Python calls global, not site-local; no 6to4 (2002::/16) and no
    Teredo at all (tunnels with an embedded IPv4 address, deprecated, never a CDN; Python 3.13+ calls 6to4 private, 3.9
    global - now the same on every version); an embedded IPv4 address (IPv4-mapped, NAT64 64:ff9b::/96) must be public."""
    try: ip = ipaddress.ip_address(str(addr).split('%')[0])
    except ValueError: return False
    if ip.version == 4: return _v4_ok(ip)
    if ip.ipv4_mapped: return _v4_ok(ip.ipv4_mapped)
    if ip in _NAT64: return _v4_ok(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF))
    if ip not in _GLOBAL6 or ip in _DOC6 or not ip.is_global or ip.is_site_local or ip.is_multicast or ip.teredo: return False
    if ip.sixtofour is not None: return False
    return True


_CGNAT = ipaddress.ip_network('100.64.0.0/10')
_NAT64 = ipaddress.ip_network('64:ff9b::/96')
_GLOBAL6 = ipaddress.ip_network('2000::/3')
_DOC6 = ipaddress.ip_network('3fff::/20')      # documentation (RFC 9637, 2024): older Pythons call it global


class _Conn(http.client.HTTPSConnection):
    """HTTPS connection that checks the peer address after the TCP connect and BEFORE the TLS handshake (nothing at all,
    not even the server name, goes to a private address)."""
    def connect(self):
        http.client.HTTPConnection.connect(self)
        try: peer = self.sock.getpeername()[0]
        except OSError: peer = ''
        if not peer_ok(peer):
            self.sock.close(); self.sock = None
            raise LiveError(502, 'not_public')
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def _conn(host):
    with _POOL_LOCK:
        idle = _POOL.get(host)
        if idle: return idle.pop(), True
    return _Conn(host, 443, timeout=TIMEOUT, context=_CTX), False


def _give_back(host, c):
    with _POOL_LOCK:                    # review 05.11. L4: check first, then add (no empty lists for ever more hosts)
        idle = _POOL.get(host)
        if idle is None and len(_POOL) < POOL_HOSTS: idle = _POOL[host] = []
        if idle is not None and len(idle) < POOL_PER_HOST: idle.append(c); return
    c.close()


def close_pool():
    """No session left: close every idle upstream connection (nothing stays open in the background)."""
    with _POOL_LOCK:
        conns = [c for idle in _POOL.values() for c in idle]
        _POOL.clear()
    for c in conns: c.close()


def _body(r, cap, t0, clock):
    n = r.getheader('Content-Length')
    if _num(n or '') is not None and _num(n) > cap: raise LiveError(502, 'too_large')
    enc = (r.getheader('Content-Encoding') or '').lower()
    if enc not in ('', 'identity', 'gzip'): raise LiveError(502, 'encoding')
    z = zlib.decompressobj(16 + zlib.MAX_WBITS) if enc == 'gzip' else None
    out = bytearray()
    try:
        while True:
            b = r.read1(65536) if hasattr(r, 'read1') else r.read(65536)      # read1: what is there, not "until 64 KB" 
            if not b: break
            if z:                                        # the unpacked size is capped too (no "zip bomb")
                b = z.decompress(b, cap + 1 - len(out))
                if z.unconsumed_tail: raise LiveError(502, 'too_large')
            out += b
            if len(out) > cap: raise LiveError(502, 'too_large')
            if clock() - t0 > DEADLINE: raise LiveError(504, 'slow')
        if z: out += z.flush()
        if hasattr(r, 'isclosed') and not r.isclosed(): r.read()     # read1 leaves the response "open": finish it for keep-alive
    except zlib.error:
        raise LiveError(502, 'encoding')
    if len(out) > cap: raise LiveError(502, 'too_large')
    return out                                           # bytearray: no second copy of a 12-MB segment


def https_fetch(url, cap, clock=time.monotonic):
    """-> bytes of a GET. https with certificate checks (http.client never follows redirects: any status but 200 is an error),
    at most `cap` bytes (also unpacked), DEADLINE seconds in total, keep-alive per host. Raises LiveError."""
    p = urllib.parse.urlsplit(url)
    host, path = p.hostname, (p.path or '/') + ('?' + p.query if p.query else '')
    t0 = clock()
    for attempt in (0, 1):
        c, reused = _conn(host)
        # watchdog: the socket timeout bounds each read only (a server sending one byte every 7 s would never time out) ->
        # after DEADLINE the socket is shut down, whatever http.client is waiting for (headers or body)
        late = []
        def kill(c=c):
            late.append(1)
            try:
                if c.sock: c.sock.shutdown(socket.SHUT_RDWR)
            except OSError: pass
        dog = threading.Timer(max(0.1, DEADLINE - (clock() - t0)), kill)
        dog.daemon = True
        dog.start()
        try:
            try:
                c.request('GET', path, headers={'User-Agent': 'Mozilla/5.0 (helper)', 'Accept': '*/*', 'Accept-Encoding': 'gzip'})
                r = c.getresponse()
            except (OSError, http.client.HTTPException, ValueError):
                c.close()
                if late: raise LiveError(504, 'slow')
                if reused and attempt == 0: continue      # the server closed an idle connection: once more on a fresh one
                raise LiveError(502, 'upstream')
            if r.status != 200:
                c.close(); raise LiveError(502, 'upstream_%d' % r.status)
            try: data = _body(r, cap, t0, clock)
            except (OSError, http.client.HTTPException, ValueError):
                c.close(); raise LiveError(504 if late else 502, 'slow' if late else 'upstream')
            except LiveError:
                c.close(); raise
        finally:
            dog.cancel()
        if late or r.will_close or (hasattr(r, 'isclosed') and not r.isclosed()): c.close()
        else: _give_back(host, c)
        return data
    raise LiveError(502, 'upstream')


# ---------------------------------------------------------------- playlists
_ATTR = re.compile(r'([A-Z0-9-]{1,64})=("[^"\n]*"|[^,"\n]*)')
MAX_TAG = 4096                # longest attribute list read (real ones: ~250 characters)


def _attrs(s):
    """KEY=VALUE,KEY="VALUE,…" -> dict. Linear (review 05.11. Z2: re.finditer over a long run of letters without '=' took
    quadratic time - a 2-MB line kept a thread busy for hours): match only at the current position, else skip to the next
    comma; at most MAX_TAG characters."""
    out, i, s = {}, 0, s[:MAX_TAG]
    n = len(s)
    while i < n:
        m = _ATTR.match(s, i)
        if m:
            v = m.group(2)
            out[m.group(1)] = v[1:-1] if v.startswith('"') else v
            i = m.end()
            if i < n and s[i] == ',': i += 1; continue
        j = s.find(',', i)
        if j < 0: break
        i = j + 1
    return out


def parse_master(text, base):
    """-> (variants [{h, bw, url, audio}], audio {group: [{url, default, name, lang}]}) with absolute URLs."""
    lines = text.splitlines()
    if not lines or not lines[0].startswith('#EXTM3U'): raise LiveError(502, 'playlist')
    vars_, aud = [], {}
    n = len(lines)
    for i, l in enumerate(lines):
        if l.startswith('#EXT-X-MEDIA:'):
            a = _attrs(l[13:])
            if a.get('TYPE') == 'AUDIO' and a.get('URI'):
                aud.setdefault(a.get('GROUP-ID', ''), []).append({'url': urllib.parse.urljoin(base, a['URI']), 'default': a.get('DEFAULT') == 'YES',
                                                                   'name': a.get('NAME', '')[:60], 'lang': a.get('LANGUAGE', '')[:10]})
        elif l.startswith('#EXT-X-STREAM-INF:'):
            a = _attrs(l[18:])
            j = i + 1
            while j < n and not lines[j].strip(): j += 1
            u = lines[j].strip() if j < n else ''
            if not u or u.startswith('#'): continue
            res = re.match(r'^(\d+)x(\d+)$', a.get('RESOLUTION', ''))
            bw = a.get('BANDWIDTH', '0')
            vars_.append({'h': int(res.group(2)) if res and len(res.group(2)) < 6 else 0, 'bw': _num(bw) or 0,
                          'url': urllib.parse.urljoin(base, u), 'audio': a.get('AUDIO', '')})
    return vars_, aud


def pick_variant(vars_, cap):
    """Highest height <= cap (first in the master at equal height: ZDF lists a backup copy of each); none -> smallest."""
    ok = [v for v in vars_ if v['h'] and v['h'] <= cap]
    if ok:
        best = max(v['h'] for v in ok)
        return next(v for v in ok if v['h'] == best)
    known = [v for v in vars_ if v['h']]
    return min(known, key=lambda v: v['h']) if known else (vars_[0] if vars_ else None)


def pick_audio(group):
    """Default rendition of the group (the programme sound), else the first."""
    if not group: return None
    return next((a for a in group if a['default']), group[0])


def parse_media(text, base, tail=TAIL):
    """-> {'target', 'seq', 'dseq', 'end', 'segs': [{n, dur, url, disc}]} (n = media sequence number). Only the newest `tail`
    segments are kept (ARD lists 2 h = ~3600; resolving all addresses cost 27 ms per list); dseq then counts the
    discontinuities of the dropped ones too, so it is the discontinuity sequence of the first kept segment."""
    lines = [l.strip() for l in text.splitlines()]
    if not lines or not lines[0].startswith('#EXTM3U'): raise LiveError(502, 'playlist')
    if '#EXT-X-KEY:' in text and any(l.startswith('#EXT-X-KEY:') and 'METHOD=NONE' not in l for l in lines): raise LiveError(502, 'encrypted')
    out = {'target': 2, 'seq': 0, 'dseq': 0, 'end': '#EXT-X-ENDLIST' in lines, 'segs': []}
    uris = [i for i, l in enumerate(lines) if l and l[0] != '#']
    first = uris[0] if uris else len(lines)
    skip = max(0, len(uris) - tail) if tail else 0          # segments before the tail: only their discontinuities count
    cut = uris[skip - 1] + 1 if skip else first
    body = lines[:first] + lines[cut:] if skip else lines
    raw, dur, disc = [], None, False
    for l in body:
        if not l: continue
        if l.startswith('#EXT-X-TARGETDURATION:'):
            v = l.split(':', 1)[1]
            out['target'] = _num(v) if _num(v) and _num(v) < 60 else 2
        elif l.startswith('#EXT-X-MEDIA-SEQUENCE:'):
            v = l.split(':', 1)[1]
            if _num(v) is not None: out['seq'] = _num(v)
        elif l.startswith('#EXT-X-DISCONTINUITY-SEQUENCE:'):
            v = l.split(':', 1)[1]
            if _num(v) is not None: out['dseq'] = _num(v)
        elif l == '#EXT-X-DISCONTINUITY': disc = True
        elif l == '#EXT-X-ENDLIST': out['end'] = True
        elif l.startswith('#EXTINF:'):
            try: dur = float(l[8:].split(',')[0])
            except ValueError: dur = None
        elif l[0] != '#':
            raw.append((dur, l, disc))
            dur = None; disc = False
    # discontinuity number of segment i = dseq + tags before segments 1..i (a tag before the very first one changes nothing);
    # the first kept segment's own tag is counted here too, so dseq is its number
    if skip: out['dseq'] += lines[first:uris[skip] + 1].count('#EXT-X-DISCONTINUITY') if uris[skip] > first else 0
    for i, (d, u, dc) in enumerate(raw):
        out['segs'].append({'n': out['seq'] + skip + i, 'dur': d if d and 0 < d < 60 else float(out['target']),
                            'url': urllib.parse.urljoin(base, u), 'disc': dc and i > 0})
    return out


# ---------------------------------------------------------------- MPEG-TS
def _crc_table():
    t = []
    for i in range(256):
        c = i << 24
        for _ in range(8): c = ((c << 1) ^ 0x04C11DB7) if c & 0x80000000 else (c << 1)
        t.append(c & 0xFFFFFFFF)
    return t


_CRC = _crc_table()


def crc32_mpeg(data):
    c = 0xFFFFFFFF
    for b in data: c = ((c << 8) & 0xFFFFFFFF) ^ _CRC[((c >> 24) ^ b) & 0xFF]
    return c


def _pid(p):
    return ((p[1] & 0x1F) << 8) | p[2]


def _payload(p):
    """offset of the payload in a 188-byte packet (None = no payload)."""
    afc = (p[3] >> 4) & 3
    if afc in (0, 2): return None
    off = 4 + (1 + p[4] if afc == 3 else 0)
    return off if off < 188 else None


def _pts(b, i):
    return (((b[i] >> 1) & 7) << 30) | (b[i + 1] << 22) | ((b[i + 2] >> 1) << 15) | (b[i + 3] << 7) | (b[i + 4] >> 1)


def _pts_bytes(v, prefix=0x2):
    v &= MASK33
    return bytes([(prefix << 4) | (((v >> 30) & 7) << 1) | 1, (v >> 22) & 0xFF, (((v >> 15) & 0x7F) << 1) | 1, (v >> 7) & 0xFF, ((v & 0x7F) << 1) | 1])


AUDIO_TYPES = (0x03, 0x04, 0x0F, 0x11, 0x81, 0x87)


def parse_pmt(pkt):
    """PMT in one packet -> dict(section bytes, pcr, streams [(type, pid)], header) or raise MuxError."""
    off = _payload(pkt)
    if off is None or not pkt[1] & 0x40: raise MuxError('pmt')
    off += 1 + pkt[off]                                  # pointer field
    if off + 3 > 188 or pkt[off] != 0x02: raise MuxError('pmt')
    slen = ((pkt[off + 1] & 0x0F) << 8) | pkt[off + 2]
    end = off + 3 + slen
    if end > 188 or slen < 13: raise MuxError('pmt_long')
    sec = bytes(pkt[off:end])
    if crc32_mpeg(sec) != 0: raise MuxError('pmt_crc')
    pcr = ((sec[8] & 0x1F) << 8) | sec[9]
    pil = ((sec[10] & 0x0F) << 8) | sec[11]
    i, streams = 12 + pil, []
    while i + 5 <= len(sec) - 4:
        st, pid, el = sec[i], ((sec[i + 1] & 0x1F) << 8) | sec[i + 2], ((sec[i + 3] & 0x0F) << 8) | sec[i + 4]
        streams.append((st, pid))
        i += 5 + el
    return {'sec': sec, 'pcr': pcr, 'streams': streams, 'head': bytes(pkt[:4])}


def pmt_with_audio(pmt, apid):
    """New PMT packet: same section + one ES entry (ADTS-AAC on apid), new length and CRC32."""
    body = pmt['sec'][:-4] + bytes([0x0F, 0xE0 | (apid >> 8), apid & 0xFF, 0xF0, 0x00])
    slen = len(body) - 3 + 4
    body = body[:1] + bytes([(body[1] & 0xF0) | (slen >> 8), slen & 0xFF]) + body[3:]
    sec = body + crc32_mpeg(body).to_bytes(4, 'big')
    head = bytes([pmt['head'][0], pmt['head'][1] | 0x40, pmt['head'][2], (pmt['head'][3] & 0x0F) | 0x10])   # payload only, keep CC
    pkt = head + b'\x00' + sec
    if len(pkt) > 188: raise MuxError('pmt_long')
    return pkt + b'\xff' * (188 - len(pkt))


def id3_timestamp(data, start=0):
    """-> (pts or None, offset after the ID3 tags that begin at `start`)."""
    i, ts = start, None
    while data[i:i + 3] == b'ID3' and i + 10 <= len(data):
        size = (data[i + 6] << 21) | (data[i + 7] << 14) | (data[i + 8] << 7) | data[i + 9]
        flags = data[i + 5]
        end = i + 10 + size + (10 if flags & 0x10 else 0)
        j = i + 10
        while j + 10 <= min(end, len(data)):
            fid, fs = data[j:j + 4], int.from_bytes(data[j + 4:j + 8], 'big')
            if not fid.strip(b'\x00'): break
            if data[i + 3] == 4: fs = (data[j + 4] << 21) | (data[j + 5] << 14) | (data[j + 6] << 7) | data[j + 7]
            fr = data[j + 10:j + 10 + fs]
            if fid == b'PRIV' and fr.startswith(ID3_TS_OWNER + b'\x00') and len(fr) >= len(ID3_TS_OWNER) + 9:
                ts = int.from_bytes(fr[len(ID3_TS_OWNER) + 1:len(ID3_TS_OWNER) + 9], 'big') & MASK33
            j += 10 + fs
        i = end
    return ts, i


def adts_frames(data, off):
    """-> list of (frame bytes, samples, sample rate). Skips junk up to the next sync word; raises MuxError if none."""
    out, n = [], len(data)
    while off + 7 <= n:
        if data[off] != 0xFF or (data[off + 1] & 0xF6) != 0xF0:
            if data[off:off + 3] == b'ID3':                    # a tag in the middle: skip it
                _, end = id3_timestamp(data, off)       # offset, no copy of the rest (hostile input: many tags)
                off = max(end, off + 3); continue
            off += 1; continue
        sfi = (data[off + 2] >> 2) & 0x0F
        flen = ((data[off + 3] & 0x03) << 11) | (data[off + 4] << 3) | (data[off + 5] >> 5)
        blocks = (data[off + 6] & 0x03) + 1
        if sfi >= len(SAMPLE_RATES) or flen < 7 or off + flen > n: break
        out.append((bytes(data[off:off + flen]), 1024 * blocks, SAMPLE_RATES[sfi]))
        off += flen
    if not out: raise MuxError('adts')
    return out


def audio_pes(frames, pts0):
    """ADTS frames -> [(pts, PES bytes)], FRAMES_PER_PES frames each; PTS = pts0 + samples * 90000 / rate."""
    out, samples = [], 0
    for k in range(0, len(frames), FRAMES_PER_PES):
        grp = frames[k:k + FRAMES_PER_PES]
        pts = (pts0 + samples * 90000 // grp[0][2]) & MASK33
        payload = b''.join(f[0] for f in grp)
        hdr = bytes([0x80, 0x80, 5]) + _pts_bytes(pts)
        ln = len(hdr) + len(payload)
        out.append((pts, b'\x00\x00\x01\xc0' + (ln if ln <= 0xFFFF else 0).to_bytes(2, 'big') + hdr + payload))
        samples += sum(f[1] for f in grp)
    return out


def packetize(pes, pid, cc):
    """PES -> TS packets (stuffing in the adaptation field of the last one) and the next continuity counter."""
    pkts, i, first = [], 0, True
    while i < len(pes):
        rest = len(pes) - i
        h = bytes([0x47, (0x40 if first else 0) | (pid >> 8), pid & 0xFF])
        if rest >= 184:
            pkts.append(h + bytes([0x10 | cc]) + pes[i:i + 184]); i += 184
        else:
            st = 184 - rest                                  # adaptation field: length byte (+ flags + 0xFF stuffing)
            af = bytes([st - 1]) + (b'\x00' + b'\xff' * (st - 2) if st >= 2 else b'')
            pkts.append(h + bytes([0x30 | cc]) + af + pes[i:]); i = len(pes)
        cc = (cc + 1) & 0x0F; first = False
    return pkts, cc


def _wrap_ge(a, b):
    """a >= b on the 33-bit clock (nearest distance)."""
    return ((a - b) & MASK33) < (1 << 32)


def mux(video, audio, cc=0, state=None):
    """Join one video TS segment and one packed-audio segment. -> (bytes, next audio cc, info dict).
    state (per session): {'apid'} keeps the audio PID stable. Raises MuxError if the input is not what we expect."""
    state = state if state is not None else {}
    if len(video) < 188 or len(video) % 188 or any(video[i] != 0x47 for i in range(0, len(video), 188)): raise MuxError('ts')
    pkts = [video[i:i + 188] for i in range(0, len(video), 188)]
    pmt_pid, pmt, vpid, vstarts = None, None, None, []
    for k, p in enumerate(pkts):
        pid = _pid(p)
        if pid == 0 and pmt_pid is None and p[1] & 0x40:
            off = _payload(p)
            if off is None: continue
            off += 1 + p[off]
            if off + 12 <= 188 and p[off] == 0x00: pmt_pid = ((p[off + 10] & 0x1F) << 8) | p[off + 11]
        elif pmt_pid is not None and pid == pmt_pid and pmt is None:
            pmt = parse_pmt(p)
            if any(st in AUDIO_TYPES for st, _ in pmt['streams']): return video, cc, {'passed': True}   # sound already inside
            vpid = next((pid_ for st, pid_ in pmt['streams'] if st in (0x1B, 0x24, 0x02)), None)
        elif vpid is not None and pid == vpid and p[1] & 0x40:
            off = _payload(p)
            if off is not None and p[off:off + 3] == b'\x00\x00\x01' and off + 14 <= 188 and p[off + 7] & 0x80:
                pts = _pts(p, off + 9)
                dts = _pts(p, off + 14) if p[off + 7] & 0x40 and off + 19 <= 188 else pts
                vstarts.append((k, dts, pts))
    if pmt is None or vpid is None or not vstarts: raise MuxError('no_pmt')
    used = {0, pmt_pid} | set(pid_ for _, pid_ in pmt['streams']) | {pmt['pcr']}
    apid = state.get('apid')
    if apid is None or apid in used:
        apid = next(x for x in range(0x101, 0x1FFF) if x not in used)
        state['apid'] = apid
    ts, off = id3_timestamp(audio)
    frames = adts_frames(audio, off)
    if ts is None: ts = vstarts[0][2]                      # no timestamp: start with the picture (should not happen)
    pes = audio_pes(frames, ts)
    newpmt = pmt_with_audio(pmt, apid)
    out, ai, n_audio = [], 0, 0
    starts = dict((k, dts) for k, dts, _ in vstarts)
    for k, p in enumerate(pkts):
        if k in starts:                                    # audio due before this picture (by decode time)
            while ai < len(pes) and not _wrap_ge(pes[ai][0], starts[k]):
                tp, cc = packetize(pes[ai][1], apid, cc); out += tp; n_audio += len(tp); ai += 1
        out.append(newpmt[:3] + bytes([(newpmt[3] & 0xF0) | (p[3] & 0x0F)]) + newpmt[4:] if _pid(p) == pmt_pid and p[1] & 0x40 else p)
    while ai < len(pes):
        tp, cc = packetize(pes[ai][1], apid, cc); out += tp; n_audio += len(tp); ai += 1
    info = {'apid': apid, 'frames': len(frames), 'rate': frames[0][2], 'a_pts': ts, 'v_pts': vstarts[0][2],
            'av_ms': round((((ts - vstarts[0][2] + (1 << 32)) & MASK33) - (1 << 32)) / 90.0, 1), 'audio_packets': n_audio}
    return b''.join(out), cc, info


def ffmpeg_mux(video, audio, a_pts, v_pts, exe=None, timeout=10):
    """Fallback (only if ffmpeg is installed and the pure join failed): same join by ffmpeg -c copy, timestamps kept."""
    exe = exe or shutil.which('ffmpeg')
    if not exe: raise MuxError('no_ffmpeg')
    d = tempfile.mkdtemp(prefix='neo-live-')
    try:
        vp, ap = os.path.join(d, 'v.ts'), os.path.join(d, 'a.aac')
        with open(vp, 'wb') as f: f.write(video)
        with open(ap, 'wb') as f: f.write(audio)
        off = '%.6f' % ((((a_pts - v_pts + (1 << 32)) & MASK33) - (1 << 32)) / 90000.0) if a_pts is not None and v_pts is not None else '0'
        cmd = [exe, '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-copyts', '-f', 'mpegts', '-i', vp,
               '-itsoffset', off, '-f', 'aac', '-i', ap, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', 'pipe:1']
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
        if r.returncode != 0 or not r.stdout: raise MuxError('ffmpeg')
        return r.stdout
    except (OSError, subprocess.SubprocessError):
        raise MuxError('ffmpeg')
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------- sessions
class Session(object):
    def __init__(self, token, ch, client, h, now):
        self.token, self.ch, self.client, self.h = token, ch, client, h
        self.created = self.last = now
        self.lock = threading.Lock()
        self.vurl = self.aurl = None
        self.vlist = self.alist = None
        self.list_at = 0
        self.segs = OrderedDict()          # n -> {vurl, aurl, dur, disc}
        self.cache = OrderedDict()         # n -> bytes
        self.cc = {}                       # n -> audio continuity counter after this segment
        self.state = {}
        self.busy = {}                     # n -> Event while the segment is being joined
        self.rlock = threading.Lock()      # one playlist refresh at a time (network I/O never under self.lock)
        self.joins = threading.BoundedSemaphore(JOINS_PER_SESSION)
        self.stats = {'segs': 0, 'bytes': 0, 'mux_ms': 0.0, 'fetch_ms': 0.0, 'av_ms': [], 'fallback': 0, 'video_only': 0}
        self.variant = None
        self.spent = []                    # [(time, upstream bytes)] of the last minute (byte budget, review 05.11. M1)
        self.fb_run = self.fb_total = 0    # ffmpeg fallbacks in a row / in total (review 05.11. L5)
        self.ffmpeg_off = False

    def cap(self):
        return cap_video(self.variant['h'] if self.variant else self.h)

    def newest(self):
        return next(reversed(self.segs)) if self.segs else None

    def in_window(self, n):
        """Only the segments of the current playlist (the newest WINDOW, one more for a playlist that moved on between the
        player's reads) and up to AHEAD past the newest (just announced upstream). Call under self.lock."""
        top = self.newest()
        return top is not None and top - WINDOW <= n <= top + AHEAD

    def charge(self, nbytes, now):
        """Count upstream bytes; call under self.lock."""
        self.spent = [x for x in self.spent if now - x[0] < 60] + [(now, nbytes)]

    def over_budget(self, now):
        return sum(b for t, b in self.spent if now - t < 60) >= BUDGET_SEGS * self.cap()


class Live(object):
    def __init__(self, fetch=None, clock=time.monotonic, ffmpeg=None, log=None, sleep=time.sleep, janitor=None):
        self.fetch = fetch or https_fetch
        self.clock, self.sleep = clock, sleep
        # background sweep: on by default with the real clock; tests with an injected clock turn it on with janitor=True
        self.use_janitor = (clock is time.monotonic) if janitor is None else bool(janitor)
        # ffmpeg (fallback only): resolved once here, never from the current directory; False = never
        self.ffmpeg = False if ffmpeg is False else (ffmpeg or _find_ffmpeg())
        self.joins = threading.BoundedSemaphore(JOINS_ALL)
        self.janitor = None
        self.sessions = {}
        self.lock = threading.Lock()
        self.api_cache = {}                # channel -> (time, master url)
        self.log = log or (lambda msg: None)

    # --- upstream with checks ---
    def get(self, url, cap, ard_api=False):
        if not url_ok(url, ard_api): raise LiveError(502, 'not_allowed')
        return self.fetch(url, cap)

    def master_url(self, ch):
        """ARD channels: the current address from the page gateway (fixed path, host checked; cached 6 h), else the fixed one."""
        d = livedata.CHANNELS[ch]
        if 'ard' in d:
            hit = self.api_cache.get(ch)
            if hit and self.clock() - hit[0] < 6 * 3600: return hit[1]
            try:
                j = json_loads(self.get(ARD_API % (urllib.parse.quote(d['ard'][0], safe=''), urllib.parse.quote(d['ard'][1], safe='')), CAP_API, True))
                u = j['widgets'][0]['mediaCollection']['embedded']['streams'][0]['media'][0]['url']
                if isinstance(u, str) and re.match(r'^https://[^\s"\'<>]+\.m3u8(\?[^\s"\'<>]*)?$', u) and url_ok(u):
                    self.api_cache[ch] = (self.clock(), u)
                    return u
            except (LiveError, ValueError, KeyError, IndexError, TypeError, UnicodeDecodeError, RecursionError):
                pass
        return d['url']

    # --- session lifecycle ---
    def _expire(self):
        """Drop idle and too old sessions; call under self.lock. -> True if none is left."""
        now = self.clock()
        for t in [t for t, s in self.sessions.items() if now - s.last > IDLE or now - s.created > LIFE]:
            self.sessions.pop(t).cache.clear()
        return not self.sessions

    def sweep(self):
        with self.lock: empty = self._expire()
        if empty and self.fetch is https_fetch: close_pool()
        return empty

    def _watch(self):
        """Small background sweep while sessions exist (memory and upstream connections are freed even if the TV just stops
        asking); ends by itself when the last session is gone."""
        with self.lock:
            if self.janitor is not None: return
            self.janitor = th = threading.Thread(target=self._janitor, name='live-sweep', daemon=True)
        th.start()

    def _janitor(self):
        """Review 05.11. L1: "no session left" and "no janitor any more" are decided under the same lock - an open() in
        between either still finds sessions here or finds janitor None and starts a new one."""
        try:
            while True:
                self.sleep(IDLE / 4.0)
                with self.lock:
                    if self._expire():
                        self.janitor = None
                        break
            if self.fetch is https_fetch: close_pool()
        except BaseException:
            with self.lock:
                if self.janitor is threading.current_thread(): self.janitor = None
            raise

    def open(self, ch, client, h):
        if not isinstance(ch, str) or not CHANNEL.match(ch) or ch not in livedata.CHANNELS: raise LiveError(404, 'channel')
        if h not in HEIGHTS: raise LiveError(400, 'h')
        self.sweep()
        with self.lock:
            for t in [t for t, s in self.sessions.items() if s.client == client]: del self.sessions[t]     # one per client
            if len(self.sessions) >= MAX_SESSIONS: raise LiveError(503, 'busy')
            tok = secrets.token_urlsafe(24)                # 32 characters, 192 bits
            s = Session(tok, ch, client, h, self.clock())
            self.sessions[tok] = s
        try:
            self._resolve(s)
        except Exception:                                  # a failed open leaves no session behind
            self.close(tok, client); raise
        if self.use_janitor: self._watch()
        return {'path': '/live/%s/index.m3u8' % tok, 'idle': IDLE, 'h': s.variant['h'] if s.variant else h}

    def close(self, tok, client):
        with self.lock:
            s = self.sessions.get(tok)
            if s and s.client == client: del self.sessions[tok]; s.cache.clear(); return True
        return False

    def session(self, tok, client):
        if not TOKEN.match(tok or ''): raise LiveError(404, 'session')
        self.sweep()
        with self.lock:
            s = self.sessions.get(tok)
            if not s or s.client != client: raise LiveError(404, 'session')      # unknown, ended, or another device
            s.last = self.clock()
            return s

    # --- playlists ---
    def _resolve(self, s):
        mu = self.master_url(s.ch)
        try: text = self.get(mu, CAP_PLAYLIST).decode('utf-8', 'replace')
        except LiveError:
            if mu == livedata.CHANNELS[s.ch]['url']: raise
            self.api_cache.pop(s.ch, None); mu = livedata.CHANNELS[s.ch]['url']
            text = self.get(mu, CAP_PLAYLIST).decode('utf-8', 'replace')
        vars_, aud = parse_master(text, mu)
        v = pick_variant(vars_, s.h)
        if not v: raise LiveError(502, 'playlist')
        a = pick_audio(aud.get(v['audio'])) if v['audio'] else None
        if not url_ok(v['url']) or (a and not url_ok(a['url'])): raise LiveError(502, 'not_allowed')
        with s.lock: s.variant, s.vurl, s.aurl = v, v['url'], a['url'] if a else None
        self._refresh(s, force=True)

    def _refresh(self, s, force=False):
        """Re-read the picture and sound playlists if older than ~one target duration (force: now). Network I/O runs outside
        s.lock (other requests of the session go on); only one refresh at a time, a second caller waits for it."""
        def fresh():
            return s.vlist and self.clock() - s.list_at < max(1.0, s.vlist['target'] * 0.9)
        with s.lock:
            if not force and fresh(): return
            t0 = s.list_at
        if not s.rlock.acquire(timeout=DEADLINE * 2 + 2): raise LiveError(503, 'busy')
        try:
            with s.lock:
                if s.list_at != t0 and s.vlist: return            # someone else refreshed meanwhile
                vurl, aurl = s.vurl, s.aurl
            vb = self.get(vurl, CAP_PLAYLIST)
            ab = self.get(aurl, CAP_PLAYLIST) if aurl else b''
            with s.lock: s.charge(len(vb) + len(ab), self.clock())
            vl = parse_media(vb.decode('utf-8', 'replace'), vurl)
            al = parse_media(ab.decode('utf-8', 'replace'), aurl) if aurl else None
            del vb, ab
            am = dict((x['n'], x['url']) for x in al['segs']) if al else {}
            with s.lock:
                s.vlist, s.alist, s.list_at = vl, al, self.clock()
                for x in vl['segs'][-(WINDOW + 6):]:              # only the live end (ARD lists 2 h, ~3600 segments)
                    if x['n'] in s.segs: continue
                    if aurl and x['n'] not in am: continue
                    if not url_ok(x['url']) or (aurl and not url_ok(am[x['n']])): continue
                    s.segs[x['n']] = {'vurl': x['url'], 'aurl': am.get(x['n']), 'dur': x['dur'], 'disc': x['disc']}
                while len(s.segs) > 60: s.segs.popitem(last=False)
        finally:
            s.rlock.release()

    def playlist(self, tok, client):
        s = self.session(tok, client)
        self._refresh(s)
        with s.lock:
            vl = s.vlist
            have = [x for x in vl['segs'][-(WINDOW + 6):] if x['n'] in s.segs]
            win = have[-WINDOW:]
            if not win: raise LiveError(503, 'starting')
            # ZDF (and ad breaks/encoder restarts) mark EXT-X-DISCONTINUITY: kept for the TV, the sequence counts the ones before
            dseq = vl['dseq'] + sum(1 for x in vl['segs'] if x['n'] <= win[0]['n'] and x['disc'])
            target = max(int(x['dur'] + 0.999) for x in win)
            o = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:%d' % target, '#EXT-X-MEDIA-SEQUENCE:%d' % win[0]['n'],
                 '#EXT-X-DISCONTINUITY-SEQUENCE:%d' % dseq]
            for i, x in enumerate(win):
                if x['disc'] and i: o.append('#EXT-X-DISCONTINUITY')
                o += ['#EXTINF:%.3f,' % x['dur'], 's%d.ts' % x['n']]
            if vl['end']: o.append('#EXT-X-ENDLIST')
            return ('\n'.join(o) + '\n').encode('ascii')

    def segment(self, tok, name, client):
        m = SEG.match(name or '')
        if not m: raise LiveError(404, 'route')
        n = int(m.group(1))
        s = self.session(tok, client)
        with s.lock:
            # review 05.11. M1: numbers outside the window -> 404 at once (before, any of the 60 known ones was fetched
            # and joined again on every cache miss)
            if not s.in_window(n): raise LiveError(404, 'segment')
            if n in s.cache: s.cache.move_to_end(n); return s.cache[n]
            soon = n not in s.segs and n > s.newest()
        if soon: self._refresh(s, force=True)              # just announced upstream; anything else unknown -> 404 at once
        with s.lock:
            seg = s.segs.get(n) if s.in_window(n) else None
            if not seg: raise LiveError(404, 'segment')
            if n not in s.cache and n not in s.busy and s.over_budget(self.clock()): raise LiveError(503, 'budget')
            busy = s.busy.get(n)
            if busy is None: s.busy[n] = busy = threading.Event(); mine = True
            else: mine = False
        if not mine:                                       # the same segment is being joined right now: wait for it
            busy.wait(DEADLINE * 2 + 2)
            with s.lock:
                if n in s.cache: return s.cache[n]
            raise LiveError(502, 'segment')
        try:
            if not s.joins.acquire(timeout=DEADLINE * 2 + 2): raise LiveError(503, 'busy')
            try:
                if not self.joins.acquire(timeout=DEADLINE * 2 + 2): raise LiveError(503, 'busy')
                try: data = self._join(s, n, seg)
                finally: self.joins.release()
            finally:
                s.joins.release()
            with s.lock:
                for k in [k for k in s.cache if not s.in_window(k)]: del s.cache[k]     # cache only window numbers
                if s.in_window(n): s.cache[n] = data
                while len(s.cache) > KEEP: s.cache.popitem(last=False)
            return data
        finally:
            with s.lock: s.busy.pop(n, None)
            busy.set()

    def _join(self, s, n, seg):
        """Fetch picture and sound of segment n (sound in parallel) and join them; nothing of the session is locked meanwhile."""
        t0 = time.monotonic()
        res, th = {}, None
        if seg['aurl']:
            def ga():
                try: res['a'] = self.get(seg['aurl'], CAP_AUDIO)
                except LiveError as e: res['ae'] = e
            th = threading.Thread(target=ga, daemon=True); th.start()
        try: video = self.get(seg['vurl'], s.cap())
        finally:
            if th: th.join(DEADLINE + 1)
        t1 = time.monotonic()
        with s.lock:
            s.charge(len(video) + len(res.get('a') or b''), self.clock())
            prev = 0 if seg['disc'] else s.cc.get(n - 1, 0)
        if not seg['aurl']: data, info = video, {'passed': True}
        elif 'a' not in res:
            data, info = video, {'video_only': True}
            self.log('live %s s%d: Ton fehlt (%s)' % (s.ch, n, getattr(res.get('ae'), 'code', 'timeout')))
        else:
            try:
                data, cc, info = mux(video, res['a'], prev, s.state)
                with s.lock: s.cc[n] = cc; s.fb_run = 0
            except (MuxError, IndexError, ValueError) as e:     # unexpected or hostile media: never a 500, picture at least
                data, info = self._fallback(s, n, video, res['a'], e)
        t2 = time.monotonic()
        with s.lock:
            st = s.stats
            st['segs'] += 1; st['bytes'] += len(data); st['fetch_ms'] += (t1 - t0) * 1000; st['mux_ms'] += (t2 - t1) * 1000
            if info.get('video_only'): st['video_only'] += 1
            if info.get('ffmpeg'): st['fallback'] += 1
            if 'av_ms' in info: st['av_ms'] = (st['av_ms'] + [info['av_ms']])[-20:]
            while len(s.cc) > 20: s.cc.pop(next(iter(s.cc)))
        return data

    def _fallback(self, s, n, video, audio, err):
        """Review 05.11. L5: a broken (or hostile) stream could force ffmpeg - a process, temp files and its parsers - for
        every segment. After FFMPEG_RUN fallbacks in a row or FFMPEG_MAX in total the session gets the picture alone (the
        pure join is still tried for every segment, so the sound comes back as soon as the stream is fine again; ending the
        session would make a channel unwatchable whose picture works). A new session (zapping) starts counting again."""
        with s.lock:
            exe = self.ffmpeg if not s.ffmpeg_off else None
            if exe:
                s.fb_run += 1; s.fb_total += 1
                if s.fb_run >= FFMPEG_RUN or s.fb_total >= FFMPEG_MAX: s.ffmpeg_off = True
        if exe:
            try:
                ts, _ = id3_timestamp(audio)
                vp = None
                try: vp = first_video_pts(video)
                except (MuxError, IndexError): pass
                out = ffmpeg_mux(video, audio, ts, vp, exe)
                self.log('live %s s%d: ffmpeg (%s)' % (s.ch, n, err))
                return out, {'ffmpeg': True}
            except (MuxError, IndexError, ValueError):
                pass
        self.log('live %s s%d: nur Bild (%s)' % (s.ch, n, err))
        return video, {'video_only': True}

    def status(self):
        """For the tray/diagnostics: sessions without tokens or addresses."""
        with self.lock:
            return [{'ch': s.ch, 'h': s.variant['h'] if s.variant else s.h, 'segs': s.stats['segs'],
                     'av_ms': s.stats['av_ms'][-1] if s.stats['av_ms'] else None} for s in self.sessions.values()]


def _find_ffmpeg():
    """ffmpeg on PATH, as an absolute path outside the current directory (Windows looks there first), else None."""
    exe = shutil.which('ffmpeg')
    if not exe: return None
    exe = os.path.abspath(exe)
    return None if os.path.dirname(exe) == os.path.abspath(os.getcwd()) else exe


def first_video_pts(video):
    for i in range(0, len(video) - 187, 188):
        p = video[i:i + 188]
        off = _payload(p)
        if p[1] & 0x40 and off is not None and off + 14 <= 188 and p[off:off + 3] == b'\x00\x00\x01' and (p[off + 3] & 0xF0) == 0xE0 and p[off + 7] & 0x80:
            return _pts(p, off + 9)
    raise MuxError('no_video')
