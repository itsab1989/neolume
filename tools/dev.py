#!/usr/bin/env python3
"""Neolume – Entwicklungswerkzeug.

  python3 tools/dev.py build [--mac-ip <MAC-IP>]   # Lader + lokale App-Kopie -> dist/<widgetId>.zip + widgetlist.xml
  python3 tools/dev.py serve [--min]                # Sync-Server :80, App-Server :8090, Log-Empfaenger :8099
                                                    #   App-Server liefert app/app.js lesbar (Debugging); --min = app.min.js
  python3 tools/dev.py serve --bench all            # P7: Messlauf startet nach jedem App-Start automatisch (docs/P7-TV-TEST.md)
  python3 tools/dev.py serve --no-app               # P7: kein app.js -> TV startet die lokale Kopie (app.min.js), Logs laufen weiter
  python3 tools/dev.py build --readable             # Paket mit lesbarem app.js statt minifiziertem (Standard: app.min.js, P7)
  python3 tools/dev.py build --setup PFAD/setup.json  # P2-Test: setup.json (vom Einrichtungsprogramm) ins Paket -> App nur mit PMS

setup.json enthaelt die Profil-Tokens: nie einchecken, nur lokal (z. B. .secrets/setup.json); mit --setup "allowClients" in local.json
auf die TV-IP setzen, sonst kann jedes Geraet im Heimnetz das Paket vom Sync-Server laden.

Lokale Netzwerk-Werte stehen in local.json (git-ignoriert, Vorlage local.example.json): "macIp" ist der Standard fuer
--mac-ip; "allowClients" (Liste von IPs, z. B. die TV-IP) beschraenkt alle drei Server zusaetzlich auf diese Geraete.
Ohne Liste werden nur Anfragen aus privaten Netzen/Loopback beantwortet.
"brand" waehlt das Marken-Profil (brand/<id>.json), "icon" das Symbol-Set, "extraApps" ersetzt die weiteren eigenen
Apps des Marken-Profils in der Sync-Liste.

Der Sync-Server liefert nur widgetlist.xml und die App-Pakete. Der App-Server liefert nur app.js und Bilder aus app/
(ohne Cache), damit der TV bei jedem App-Start den neuesten Code laedt. Logs landen in logs/app.log
(je Anfrage max. 1 MB, Datei rotiert bei 5 MB, Token/PINs/Codes geschwaerzt – auch URL-kodiert).
"""
import hashlib, argparse, datetime, http.server, ipaddress, json, os, re, sys, threading, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST, LOADER, APP, LOGS = (os.path.join(ROOT, d) for d in ('dist', 'loader', 'app', 'logs'))
APP_FILES = re.compile(r'^(app\.js|[A-Za-z0-9_-]+\.(png|gif))$')       # nur das, was der TV braucht
LOG_MAX_REQ, LOG_MAX_FILE = 1 << 20, 5 << 20


def local_config():
    p = os.path.join(ROOT, 'local.json')
    if not os.path.exists(p): return {}
    try:
        with open(p) as f: return json.load(f)
    except ValueError as e:
        sys.exit('local.json ist kein gueltiges JSON: %s' % e)


LOCAL = local_config()
ALLOW = set(str(ipaddress.ip_address(a)) for a in (LOCAL.get('allowClients') or []))   # beim Merge 27.10. verloren gegangen


def load_brand(name=None):
    """Marken-Profil brand/<id>.json (siehe brand/README.md). Auswahl: --brand / env BRAND -> local.json "brand"
    -> "private", falls brand/private.json existiert -> "public" (gleiche Regel wie tools/build.js)."""
    bid = name or os.environ.get('BRAND') or LOCAL.get('brand') or ('private' if os.path.exists(os.path.join(ROOT, 'brand', 'private.json')) else 'public')
    if not re.match(r'^[a-z0-9-]+$', bid): sys.exit('Marke ungueltig: %s' % bid)
    try:
        with open(os.path.join(ROOT, 'brand', bid + '.json'), encoding='utf-8') as f: b = json.load(f)
    except (OSError, ValueError) as e:
        sys.exit('Marken-Profil brand/%s.json fehlt oder ist kaputt: %s' % (bid, e))
    b['id'] = bid
    if not re.match(r'^[A-Za-z0-9_]{1,64}$', b.get('widgetId') or ''): sys.exit('brand/%s.json: widgetId fehlt/ungueltig' % bid)
    return b


def extra_apps(brand):
    """Weitere eigene Apps fuer die Sync-Liste: local.json "extraApps", sonst die des Marken-Profils.
    Der User-App-Sync des TVs ENTFERNT alle eigenen Apps, die nicht in der Liste stehen."""
    out = []
    for e in (LOCAL['extraApps'] if 'extraApps' in LOCAL else brand.get('extraApps')) or []:
        if not isinstance(e, dict) or not e.get('id') or not e.get('zip'): sys.exit('extraApps-Eintrag braucht "id" und "zip": %r' % (e,))
        z = os.path.expanduser(e['zip'])
        if not re.match(r'^[A-Za-z0-9_.-]+$', e['id']) or not re.match(r'^[A-Za-z0-9_.-]+\.zip$', os.path.basename(z)):
            sys.exit('extraApps-Eintrag ungueltig: %r' % (e,))
        out.append({'id': e['id'], 'title': e.get('title') or e['id'], 'zip': z, 'name': os.path.basename(z)})
    return out


EXTRA = []   # von build()/serve() gesetzt


def xml_text(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def client_ok(addr):
    """Nur LAN: private/Loopback/Link-Local-Adressen; mit allowClients zusaetzlich nur diese Geraete (+ Loopback)."""
    try: ip = ipaddress.ip_address(addr)
    except ValueError: return False
    if getattr(ip, 'ipv4_mapped', None): ip = ip.ipv4_mapped
    if ip.is_loopback: return True
    if ALLOW: return str(ip) in ALLOW or str(ip) == LOCAL.get('macIp')
    return ip.is_private or ip.is_link_local


_SEP = r'((?:%22)?(?:%3D|%3A)(?:%22)?|["\']?\s*[:=]\s*["\']?)'
_PRE = r'(^|%3F|%26|%22|%2C|[^A-Za-z0-9_])'
_REDACT = [
    (re.compile(r'(X-Plex-Token|accessToken|authToken|authenticationToken|token)' + _SEP + r'[^&"\'\s,;}%]+', re.I), r'\1\2***'),
    (re.compile(_PRE + r'(pin)' + _SEP + r'[^&"\'\s,;}%]+', re.I), r'\1\2\3***'),
    (re.compile(_PRE + r'(code)' + _SEP + r'[A-Za-z0-9]{4,8}(?![A-Za-z0-9])', re.I), r'\1\2\3***'),
]


def redact(s):
    """Wie N.diag.redact (src/core/log.js): Token, PINs, plex.tv-Codes – auch URL-kodiert und in JSON."""
    for rx, sub in _REDACT: s = rx.sub(sub, s)
    return s


_HOST_OK = re.compile(r'(\d{1,3}(?:\.\d{1,3}){3}|localhost|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?')


def host_ok(host):
    """DNS-Rebinding-Schutz (Pentest P1): Host fehlt (HTTP/1.0) oder ist eine IP-Adresse/localhost. Eine Webseite, die ihren
    Namen auf diesen Mac umbiegt, schickt ihren Namen als Host -> 403 (sonst liest sie PlexNeo.zip mit setup.json)."""
    return host is None or bool(_HOST_OK.fullmatch(host.strip()))


class Guard(http.server.BaseHTTPRequestHandler):
    def parse_request(self):
        if not http.server.BaseHTTPRequestHandler.parse_request(self): return False
        if client_ok(self.client_address[0]) and host_ok(self.headers.get('Host')): return True
        print('[%s] abgewiesen: %s' % (type(self).__name__, self.client_address[0]), flush=True)
        self.send_error(403); return False
    def log_message(self, *a): pass


def build(mac_ip, dev=True, icon=None, setup=None, readable=False, brand=None, allow_missing=False):
    mac_ip = mac_ip or LOCAL.get('macIp')
    if not mac_ip or not re.match(r'^[A-Za-z0-9.-]+$', mac_ip): sys.exit('Mac-Adresse fehlt: --mac-ip <MAC-IP> oder "macIp" in local.json')
    brand = load_brand(brand)
    if brand['id'] != 'private' and os.path.exists(os.path.join(ROOT, 'brand', 'private.json')) and 'extraApps' not in LOCAL and not allow_missing:
        sys.exit('Marke %s ohne "extraApps" in local.json: ein Sync wuerde die private App und ihre Zusatz-Apps vom TV entfernen.\n'
                 'Alle Apps in local.json "extraApps" eintragen (README, Abschnitt Sync-Liste) oder --allow-missing-extra.' % brand['id'])
    EXTRA[:] = extra_apps(brand)
    icon = icon or LOCAL.get('icon') or brand.get('defaultIcon') or 'original'
    idir = os.path.join(ROOT, 'loader-icons', icon)
    if not os.path.isdir(idir): sys.exit('Unbekanntes Symbol-Set: %s (vorhanden: %s)' % (icon, ', '.join(sorted(os.listdir(os.path.join(ROOT, 'loader-icons'))))))
    if icon not in (brand.get('icons') or []): print('HINWEIS: Symbol-Set %s gehoert nicht zur Marke %s (%s)' % (icon, brand['id'], ', '.join(brand.get('icons') or [])))
    print('Marke: %s (%s)' % (brand['id'], brand['name']))
    print('Symbol-Set: %s (%s)' % (icon, idir))
    # Der TV merkt sich Symbole am Dateinamen -> Name enthaelt Set + Inhalts-Pruefsumme, damit ein neues Symbol sicher erscheint
    h = hashlib.sha1()
    for f in sorted(os.listdir(idir)):
        if f.endswith('.png'): h.update(open(os.path.join(idir, f), 'rb').read())
    tag = '%s_%s' % (icon, h.hexdigest()[:8])
    os.makedirs(DIST, exist_ok=True)
    pkg = brand['widgetId'] + '.zip'           # App-ID = Paketname (Marken-Profil, nie aendern)
    for old in os.listdir(DIST):
        if old.endswith('.zip'): os.remove(os.path.join(DIST, old))
    out = os.path.join(DIST, pkg)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(LOADER):
            for f in files:
                p = os.path.join(base, f)
                rel = os.path.relpath(p, LOADER)
                data = open(p, 'rb').read()
                if rel == 'boot.js':
                    host = mac_ip if dev else ''   # normale Version: kein Mac, kein Warten beim Start
                    data = re.sub(rb"var DEV_HOST = '[^']*'", b"var DEV_HOST = '" + host.encode() + b"'", data)
                if rel == 'config.xml':
                    data = data.replace(b'>icon/icon_', b'>icon/' + tag.encode() + b'_')
                    name = xml_text(brand['name']).encode('utf-8')
                    data = re.sub(rb'(<(widgetname|runTitle|cpname|name) itemtype="string">)[^<]*(<)', lambda m: m.group(1) + name + m.group(3), data)
                    data = re.sub(rb'(<description itemtype="string">)[^<]*(<)', lambda m: m.group(1) + xml_text(brand.get('description') or brand['name']).encode('utf-8') + m.group(2), data)
                if rel == 'index.html':
                    data = re.sub(rb'<title>[^<]*</title>', b'<title>' + xml_text(brand['name']).encode('utf-8') + b'</title>', data)
                if rel.startswith('icon' + os.sep):          # Symbol aus gewaehltem Set
                    data = open(os.path.join(idir, os.path.basename(rel)), 'rb').read()
                    rel = os.path.join('icon', os.path.basename(rel).replace('icon_', tag + '_', 1))
                z.writestr(rel, data)
        if setup:                                   # P2: Einrichtung (PMS-only) – Inhalt nie ausgeben (Tokens)
            try:
                data = open(setup, 'rb').read(); j = json.loads(data.decode('utf-8'))
            except (OSError, ValueError) as e: sys.exit('setup.json nicht lesbar: %s' % e)
            if not isinstance(j, dict) or j.get('kind') != 'plexneo-setup': sys.exit('setup.json: kind ist nicht "plexneo-setup"')
            z.writestr('setup.json', data)
            print('setup.json im Paket (%d Profile) – App arbeitet nur mit dem PMS.%s' % (len(j.get('profiles') or []),
                  '' if ALLOW else ' WARNUNG: ohne allowClients kann jedes LAN-Geraet das Paket mit den Tokens laden.'))
        src = 'app.js' if readable else 'app.min.js'   # P7: Paket = minifizierter Release-Build (ohne dev/-Module)
        if not os.path.isfile(os.path.join(APP, src)): sys.exit('app/%s fehlt – zuerst "npm run build"' % src)
        if json.dumps(brand['name']).encode() not in open(os.path.join(APP, src), 'rb').read():
            sys.exit('app/%s wurde nicht mit der Marke %s gebaut – "BRAND=%s npm run build" ausfuehren' % (src, brand['id'], brand['id']))
        z.write(os.path.join(APP, src), 'app.js')
        print('Paket: app.js = app/%s (%d KB)' % (src, os.path.getsize(os.path.join(APP, src)) // 1024))
        for f in sorted(os.listdir(APP)):          # Bilder der lokalen Rueckfall-Kopie
            if APP_FILES.match(f) and f != 'app.js': z.write(os.path.join(APP, f), f)
    # ACHTUNG: Der User-App-Sync des TVs ENTFERNT alle eigenen Apps, die nicht in dieser Liste stehen.
    # Deshalb stehen alle Apps aus local.json "extraApps" mit in der Liste.
    entries = [(brand['widgetId'], xml_text(brand['name']), pkg, os.path.getsize(out))]
    for e in EXTRA:
        if os.path.exists(e['zip']): entries.append((e['id'], xml_text(e['title']), e['name'], os.path.getsize(e['zip'])))
        elif allow_missing: print('WARNUNG: %s fehlt - ein Sync wuerde "%s" vom TV entfernen!' % (e['zip'], e['title']))
        else: sys.exit('FEHLER: %s fehlt - ein Sync wuerde "%s" vom TV entfernen. Erst bauen oder --allow-missing-extra.' % (e['zip'], e['title']))
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rsp stat="ok">\n\t<list>\n'
    for wid, title, fname, size in entries:
        xml += ('\t\t<widget id="%s">\n\t\t\t<title>%s</title>\n\t\t\t<compression size="%d" type="zip"/>\n'
                '\t\t\t<description/>\n\t\t\t<download>http://%s/%s</download>\n\t\t</widget>\n') % (wid, title, size, mac_ip, fname)
    open(os.path.join(DIST, 'widgetlist.xml'), 'w').write(xml + '\t</list>\n</rsp>\n')
    for e in entries: print('Sync-Liste: %s (%s, %d Bytes)' % (e[1], e[2], e[3]))


class Sync(Guard):
    FILES = {}                                   # von serve() gesetzt (Marken-Profil)
    EXTRA_PATHS = dict(('/' + e['name'], e['zip']) for e in EXTRA)
    def do_GET(self):
        p = self.path.split('?')[0]
        if p not in self.FILES: return self.send_error(404)
        data = open(self.EXTRA_PATHS.get(p) or os.path.join(DIST, p[1:]), 'rb').read()
        self.send_response(200); self.send_header('Content-Type', self.FILES[p])
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        print('[sync] TV hat %s abgeholt' % p[1:], flush=True)


class AppSrv(Guard):
    js = 'app.js'                                # serve --min: app.min.js unter /app.js
    bench = ''                                   # serve --bench: Messlauf-Szenarien (haengt window.PN_BENCH an app.js an)
    def do_GET(self):
        rel = self.path.split('?')[0].lstrip('/')
        if rel == 'app.js' and self.js is None: return self.send_error(404)   # serve --no-app: TV startet die lokale Kopie
        p = os.path.join(APP, self.js if rel == 'app.js' else rel)
        if not APP_FILES.match(rel) or not os.path.isfile(p): return self.send_error(404)   # Liste statt Pfad -> kein ../
        data = open(p, 'rb').read()
        if rel == 'app.js' and self.bench: data += ("\nwindow.PN_BENCH = '%s';\n" % self.bench).encode()
        ctype = 'application/javascript' if p.endswith('.js') else 'image/png' if p.endswith('.png') else 'image/gif'
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        print('[app] %s geladen' % rel, flush=True)


class LogSrv(Guard):
    lock = threading.Lock()
    def _ok(self, code=200):
        self.send_response(code); self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Content-Length', '0'); self.end_headers()
    def do_OPTIONS(self): self._ok()
    def do_POST(self):
        if self.path.split('?')[0] != '/log': return self._ok(404)
        try: n = int(self.headers.get('Content-Length') or 0)
        except ValueError: n = -1
        if n < 0 or n > LOG_MAX_REQ: self.close_connection = True; return self._ok(413)
        body = redact(self.rfile.read(n).decode('utf-8', 'replace'))   # Geheimnisse schwaerzen (auch URL-kodiert)
        path = os.path.join(LOGS, 'app.log')
        with self.lock:
            if os.path.exists(path) and os.path.getsize(path) > LOG_MAX_FILE: os.replace(path, path + '.1')
            with open(path, 'a') as f: f.write(body.rstrip('\n') + '\n')
        self._ok()


class Server(http.server.ThreadingHTTPServer):
    def server_bind(self):                       # ohne getfqdn(): Namensaufloesung kann beim Start minutenlang haengen
        import socketserver
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def serve(minified=False, bench='', no_app=False, brand=None):
    os.makedirs(LOGS, exist_ok=True)
    b = load_brand(brand)
    EXTRA[:] = extra_apps(b)
    Sync.FILES = dict([('/widgetlist.xml', 'text/xml'), ('/' + b['widgetId'] + '.zip', 'application/zip')] + [('/' + e['name'], 'application/zip') for e in EXTRA])
    Sync.EXTRA_PATHS = dict(('/' + e['name'], e['zip']) for e in EXTRA)
    AppSrv.js = None if no_app else 'app.min.js' if minified else 'app.js'
    if bench and not re.match(r'^[a-z0-9,:-]{1,80}$', bench, re.I): sys.exit('--bench: nur Szenario-Namen, z. B. all oder home,lib,leak:20')
    if bench and minified: sys.exit('--bench braucht den lesbaren Build (app.min.js hat keine dev/-Module)')
    AppSrv.bench = bench or ''
    print('App-Server liefert %s%s' % ('KEIN app.js (TV nimmt die lokale Kopie)' if no_app else 'app/' + AppSrv.js, ' + Messlauf "%s"' % bench if bench else ''))
    servers = [(80, Sync), (8090, AppSrv), (8099, LogSrv)]
    for port, h in servers:
        s = Server(('0.0.0.0', port), h)
        threading.Thread(target=s.serve_forever, daemon=True).start()
        print('laeuft: Port %d (%s)' % (port, h.__name__))
    print('Ctrl+C beendet alle Server.')
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('build'); b.add_argument('--mac-ip', default=None, help='Standard: "macIp" aus local.json')
    b.add_argument('--release', action='store_true', help='normale Version ohne Entwicklungs-Verbindung zum Mac')
    b.add_argument('--icon', default=None, help='Symbol-Set aus loader-icons/ (Standard: local.json "icon", sonst defaultIcon der Marke)')
    b.add_argument('--brand', default=None, help='Marken-Profil aus brand/ (Standard: local.json "brand", sonst private falls vorhanden, sonst public)')
    b.add_argument('--setup', default=None, help='setup.json vom Einrichtungsprogramm ins Paket legen (PMS-only-Test)')
    b.add_argument('--allow-missing-extra', action='store_true', help='fehlende weitere Apps nur melden (Sync entfernt sie dann vom TV!)')
    b.add_argument('--readable', action='store_true', help='lesbares app.js ins Paket statt app.min.js')
    sv = sub.add_parser('serve'); sv.add_argument('--min', action='store_true', help='app.min.js statt lesbarem app.js ausliefern')
    sv.add_argument('--no-app', action='store_true', help='kein app.js ausliefern (Startzeit der lokalen Kopie messen, Logs laufen weiter)')
    sv.add_argument('--brand', default=None, help='Marken-Profil (bestimmt die weiteren Apps der Sync-Liste)')
    sv.add_argument('--bench', default='', help='Messlauf nach dem App-Start (all | home,lib,details,search,player-osd,leak[:n])')
    a = ap.parse_args()
    build(a.mac_ip, dev=not a.release, icon=a.icon, setup=a.setup, readable=a.readable, brand=a.brand, allow_missing=a.allow_missing_extra) if a.cmd == 'build' else serve(a.min, a.bench, a.no_app, a.brand)
