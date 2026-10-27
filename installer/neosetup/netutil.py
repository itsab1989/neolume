"""LAN helpers: client filter, own LAN address, GDM discovery, choice of the PMS address, read-only PMS probes."""
import ipaddress
import json
import socket
import urllib.request
import xml.etree.ElementTree as ET

GDM_PORT = 32414
GDM_GROUP = '239.0.0.250'
GDM_QUERY = b'M-SEARCH * HTTP/1.1\r\n\r\n'


def _ip(addr):
    try: ip = ipaddress.ip_address(str(addr).split('%')[0])
    except ValueError: return None
    if getattr(ip, 'ipv4_mapped', None): ip = ip.ipv4_mapped
    return ip


def is_private_ip(addr):
    """RFC 1918 / link-local / loopback (IPv4 and IPv6 ULA). Public addresses -> False."""
    ip = _ip(addr)
    return bool(ip) and (ip.is_private or ip.is_link_local or ip.is_loopback) and not ip.is_unspecified


def is_private_ipv4(addr):
    ip = _ip(addr)
    return bool(ip) and ip.version == 4 and (ip.is_private or ip.is_link_local) and not ip.is_loopback \
        and not ip.is_unspecified and not ip.is_multicast


def lan_client_ok(addr, allow=None):
    """Sync/update servers: only loopback or private/link-local clients; with an allow-list only those (+ loopback)."""
    ip = _ip(addr)
    if not ip: return False
    if ip.is_loopback: return True
    if allow: return str(ip) in allow
    return (ip.is_private or ip.is_link_local) and not ip.is_unspecified and not ip.is_multicast


def own_lan_ip(towards=None):
    """Address of this computer on the LAN (route towards the PMS if known). UDP connect sends no packet."""
    for target in ([towards] if towards else []) + ['192.168.0.1', '10.0.0.1']:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((target, 9))
            ip = s.getsockname()[0]
            if is_private_ipv4(ip): return ip
        except OSError:
            pass
        finally:
            s.close()
    return None


# ---------- GDM (Plex "G'Day Mate" LAN discovery) ----------
def parse_gdm(data, sender_ip):
    """Reply to M-SEARCH -> {machineIdentifier, name, port, address} or None."""
    try: text = data.decode('utf-8', 'replace')
    except AttributeError: return None
    lines = text.replace('\r', '').split('\n')
    if not lines or ' 200 ' not in lines[0] + ' ': return None
    h = {}
    for ln in lines[1:]:
        if ':' in ln:
            k, v = ln.split(':', 1)
            h[k.strip().lower()] = v.strip()
    mid = h.get('resource-identifier', '')
    try: port = int(h.get('port', '32400'))
    except ValueError: return None
    if not mid or 'server' not in h.get('content-type', 'plex/media-server') or not (0 < port < 65536): return None
    if not is_private_ipv4(sender_ip): return None
    return {'machineIdentifier': mid, 'name': h.get('name', ''), 'port': port, 'address': sender_ip}


def gdm_discover(timeout=1.5):
    hits = {}
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
        s.settimeout(timeout)
        for target in (GDM_GROUP, '255.255.255.255'):
            try: s.sendto(GDM_QUERY, (target, GDM_PORT))
            except OSError: pass
        while True:
            try: data, (addr, _) = s.recvfrom(4096)
            except (socket.timeout, OSError): break
            r = parse_gdm(data, addr)
            if r: hits.setdefault((r['machineIdentifier'], r['address']), r)
    finally:
        s.close()
    return list(hits.values())


# ---------- address choice ----------
def candidate_uris(server, gdm_hits):
    """Plain-http LAN URIs for a server, best first: GDM answers (seen on this LAN), then plex.tv 'local'
    connections, then other private addresses. Public addresses are never used (token would cross the internet
    in clear text, security review S5)."""
    out = []
    def add(addr, port):
        if is_private_ipv4(addr):
            u = 'http://%s:%d' % (addr, port)
            if u not in out: out.append(u)
    for g in gdm_hits:
        if g['machineIdentifier'] == server['machineIdentifier']: add(g['address'], g['port'])
    for c in server.get('connections', []):
        if c['local']: add(c['address'], c['port'])
    for c in server.get('connections', []):
        add(c['address'], c['port'])
    return out


def merge_servers(resources, gdm_hits):
    """Servers for the UI: plex.tv resources (owned first) annotated with LAN URIs; GDM-only servers are listed
    as 'not on your account' so the user understands why they cannot be chosen."""
    known = set(r['machineIdentifier'] for r in resources)
    out = []
    for r in sorted(resources, key=lambda r: (not r['owned'], r['name'].lower())):
        out.append(dict(r, uris=candidate_uris(r, gdm_hits), lan=any(g['machineIdentifier'] == r['machineIdentifier'] for g in gdm_hits)))
    for g in gdm_hits:
        if g['machineIdentifier'] not in known:
            known.add(g['machineIdentifier'])
            out.append({'machineIdentifier': g['machineIdentifier'], 'name': g['name'], 'version': '', 'owned': False,
                        'token': None, 'connections': [], 'uris': candidate_uris({'machineIdentifier': g['machineIdentifier']}, [g]),
                        'lan': True, 'foreign': True})
    return out


# ---------- read-only PMS probes ----------
def http_get(url, headers=None, timeout=3):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read(1 << 20)


def parse_identity(data):
    """PMS /identity (JSON or XML) -> machineIdentifier or None."""
    try:
        d = json.loads(data.decode('utf-8'))
        return (d.get('MediaContainer') or {}).get('machineIdentifier')
    except (ValueError, AttributeError, UnicodeDecodeError):
        pass
    try: return ET.fromstring(data).get('machineIdentifier')
    except ET.ParseError: return None


def probe_identity(uri, get=http_get):
    """GET {uri}/identity without token (only private addresses). Returns machineIdentifier or None."""
    host = uri.split('//', 1)[-1].rsplit(':', 1)[0]
    if not uri.startswith('http://') or not is_private_ipv4(host): return None
    try:
        status, data = get(uri + '/identity', {'Accept': 'application/json'})
    except Exception:
        return None
    return parse_identity(data) if status == 200 else None


def pick_reachable(uris, machine_id, get=http_get):
    """First URI whose /identity answers with the expected machineIdentifier, else None."""
    for u in uris:
        if probe_identity(u, get) == machine_id: return u
    return None


def count_sections(uri, token, get=http_get):
    """Number of libraries visible with this token (read-only check for the summary), None on error."""
    try:
        status, data = get(uri + '/library/sections', {'Accept': 'application/json', 'X-Plex-Token': token})
        if status != 200: return None
        return int((json.loads(data.decode('utf-8')).get('MediaContainer') or {}).get('size', 0))
    except Exception:
        return None
