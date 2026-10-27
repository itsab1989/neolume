"""TV package: release app package (loader + app) + embedded setup.json, plus widgetlist.xml for the User-App-Sync.

Layout is the same as `tools/dev.py build --release` (loader files at the root, icon/<set>_<hash>_WxH.png,
app.js + images at the root). The package is built in memory only; it is never written to disk unless the
user explicitly asks for it (CLI --save-package).
"""
import datetime
import hashlib
import io
import json
import os
import re
import zipfile
from xml.sax.saxutils import escape

from . import VERSION, brand

CONFIG_NAME = 'setup.json'
SCHEMA = 1
SAFE_ENTRY = re.compile(r'^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$')
DEV_ONLY = {'bench.js', 'proto.js'}                     # old prototypes that must not ship
APP_FILES = re.compile(r'^(app\.js|[A-Za-z0-9_-]+\.(png|gif))$')   # same rule as tools/dev.py
WIDGET_ID_RE = re.compile(r'^[A-Za-z0-9_]{1,64}$')
MAX_ZIP = 64 << 20


class PackageError(Exception):
    def __init__(self, code, detail=''):
        Exception.__init__(self, code)
        self.code, self.detail = code, detail


def _safe_name(n):
    return bool(SAFE_ENTRY.match(n)) and '..' not in n.split('/')


def read_zip_entries(data):
    """zip bytes -> ordered list of (name, bytes); rejects unsafe names (traversal, absolute, backslashes)."""
    if len(data) > MAX_ZIP: raise PackageError('too_large')
    try: z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile: raise PackageError('bad_zip')
    out = []
    with z:
        for info in z.infolist():
            if info.is_dir(): continue
            if not _safe_name(info.filename): raise PackageError('unsafe_entry', info.filename)
            if info.file_size > MAX_ZIP: raise PackageError('too_large', info.filename)
            out.append((info.filename, z.read(info)))
    return out


def _local_json(root):
    try:
        with open(os.path.join(root, 'local.json')) as f: j = json.load(f)
        return j if isinstance(j, dict) else {}
    except (OSError, ValueError):
        return {}


def find_icon_dir(root, icon=None):
    """Icon set from loader-icons/. Default (icon=None): local.json "icon" > defaultIcon of the brand > "original"."""
    if not icon: icon = _local_json(root).get('icon') or brand.CURRENT.get('defaultIcon') or 'original'
    p = os.path.join(root, 'loader-icons', icon)
    return icon, (p if re.match(r'^[A-Za-z0-9_-]+$', icon) and os.path.isdir(p) else None)


def _xml(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def brand_loader_file(rel, data):
    """Write the brand's app name into config.xml / index.html of the loader."""
    nm = _xml(brand.name()).encode('utf-8')
    if rel == 'config.xml':
        data = re.sub(rb'(<(widgetname|runTitle|cpname|name) itemtype="string">)[^<]*(<)', lambda m: m.group(1) + nm + m.group(3), data)
        desc = _xml(brand.CURRENT.get('description') or brand.name()).encode('utf-8')
        data = re.sub(rb'(<description itemtype="string">)[^<]*(<)', lambda m: m.group(1) + desc + m.group(2), data)
    elif rel == 'index.html':
        data = re.sub(rb'<title>[^<]*</title>', b'<title>' + nm + b'</title>', data)
    return data


def base_from_repo(root, icon=None):
    """Assemble the release package entries from the repo (loader/ + app/), like tools/dev.py build --release."""
    loader, app = os.path.join(root, 'loader'), os.path.join(root, 'app')
    icon, icon_dir = find_icon_dir(root, icon)
    icon_dir = icon_dir or ''
    # like tools/dev.py build --release: the minified release build (without dev/ modules) goes to the TV as app.js
    app_js = next((os.path.join(app, n) for n in ('app.min.js', 'app.js') if os.path.isfile(os.path.join(app, n))), None)
    if not app_js: raise PackageError('no_app', 'app/app.min.js (npm run build)')
    if not os.path.isdir(loader): raise PackageError('no_loader')
    tag = None
    if os.path.isdir(icon_dir):
        h = hashlib.sha1()
        for f in sorted(os.listdir(icon_dir)):
            if f.endswith('.png'):
                with open(os.path.join(icon_dir, f), 'rb') as fh: h.update(fh.read())
        tag = '%s_%s' % (icon, h.hexdigest()[:8])
    out = []
    for base, dirs, files in os.walk(loader):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(base, f)
            rel = os.path.relpath(p, loader).replace(os.sep, '/')
            with open(p, 'rb') as fh: data = fh.read()
            data = brand_loader_file(rel, data)
            if tag and rel == 'config.xml':
                data = data.replace(b'>icon/icon_', b'>icon/' + tag.encode() + b'_')
            if tag and rel.startswith('icon/'):
                name = rel.split('/', 1)[1]
                src = os.path.join(icon_dir, name)
                if os.path.isfile(src):
                    with open(src, 'rb') as fh: data = fh.read()
                rel = 'icon/' + name.replace('icon_', tag + '_', 1)
            out.append((rel, data))
    with open(app_js, 'rb') as fh: js = fh.read()
    if b'N.brand' in js and json.dumps(brand.name()).encode() not in js:      # built for another brand profile
        raise PackageError('no_app', 'app/%s was built for another brand - run "BRAND=%s npm run build"' % (os.path.basename(app_js), brand.CURRENT['id']))
    out.append(('app.js', js))
    for f in sorted(os.listdir(app)):
        if APP_FILES.match(f) and f != 'app.js':
            with open(os.path.join(app, f), 'rb') as fh: out.append((f, fh.read()))
    return out


def release_entries(entries):
    """Normalize a base package: drop dev prototypes and any old setup.json, force the release loader
    (DEV_HOST empty: no development host, no network logs). Raises if loader/app are missing."""
    out, names = [], set()
    for name, data in entries:
        if not _safe_name(name): raise PackageError('unsafe_entry', name)
        if name in DEV_ONLY or name == CONFIG_NAME: continue
        if name == 'boot.js':
            data = re.sub(rb"var DEV_HOST = '[^']*'", b"var DEV_HOST = ''", data)
        out.append((name, data)); names.add(name)
    for need in ('config.xml', 'index.html', 'boot.js', 'app.js'):
        if need not in names: raise PackageError('incomplete', need)
    return out


def app_version(entries):
    for name, data in entries:
        if name == 'config.xml':
            m = re.search(rb'<ver[^>]*>([^<]+)</ver>', data)
            if m: return m.group(1).decode('ascii', 'replace').strip()
    return ''


def make_config(client_id, server, uri_list, profiles, computer_ip=None, update_port=None, now=None, reset_pins=False, helper=None):
    """setup.json content (schema 1, see installer/README.md). Only profiles with include=True and a token,
    and only the owner and Plex Home users (shared accounts outside Plex Home are never written).
    reset_pins: checkbox "Reset app PINs" -> the app deletes all app PINs once for this setup (otherwise they are kept)."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    cfg = {
        'schema': SCHEMA,
        'kind': 'plexneo-setup',
        'createdAt': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'setupVersion': VERSION,
        'clientIdentifier': client_id,
        'server': {'machineIdentifier': server['machineIdentifier'], 'name': server.get('name', ''), 'uris': list(uri_list)},
        'profiles': [{'id': p['id'], 'uuid': p.get('uuid', ''), 'title': p['title'], 'thumb': p.get('thumb', ''),
                      'kind': p['kind'], 'restricted': bool(p.get('restricted')),
                      'restrictionProfile': p.get('restrictionProfile', ''), 'token': p['token']}
                     for p in profiles if p.get('include') and p.get('token') and p.get('kind') in ('owner', 'home')],   # never friends
        'computer': {'address': computer_ip, 'updatePort': update_port} if computer_ip else None,
    }
    if reset_pins: cfg['resetAppPins'] = True
    if helper: cfg['helper'] = {'url': helper['url'], 'key': helper['key']}     # optional helper (no plex.tv tokens here)
    return cfg


def build_package(base_entries, config):
    """-> zip bytes with the release app and setup.json."""
    if not config.get('profiles'): raise PackageError('no_profiles')
    buf = io.BytesIO()
    fixed = (2026, 1, 1, 0, 0, 0)            # stable timestamps: same input -> same bytes
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in release_entries(base_entries):
            z.writestr(zipfile.ZipInfo(name, fixed), data, zipfile.ZIP_DEFLATED)
        z.writestr(zipfile.ZipInfo(CONFIG_NAME, fixed), json.dumps(config, indent=1, ensure_ascii=False).encode('utf-8'),
                   zipfile.ZIP_DEFLATED)
    return buf.getvalue()


def known_ids(root=None):
    """Apps whose widget id differs from the zip name: optional local.json "extraApps" ([{"id", "zip"}]) of a repo checkout.
    Otherwise the id comes from 'WIDGETID=path.zip' or the zip name."""
    root = root or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out = {}
    for e in _local_json(root).get('extraApps') or []:
        if isinstance(e, dict) and isinstance(e.get('id'), str) and isinstance(e.get('zip'), str):
            out[os.path.basename(os.path.expanduser(e['zip']))] = e['id']
    return out


def read_extra_app(path, widget_id=None):
    """Another user app that must stay on the TV (the sync REMOVES every user app not listed in widgetlist.xml).
    Spec on the command line/UI: 'path.zip' or 'WIDGETID=path.zip'. -> {'id','title','file','data','path'}"""
    path = os.path.abspath(os.path.expanduser(path))
    base = os.path.basename(path)
    if not base.lower().endswith('.zip') or not os.path.isfile(path): raise PackageError('extra_missing', base)
    if os.path.getsize(path) > MAX_ZIP: raise PackageError('too_large', base)
    if not re.match(r'^[A-Za-z0-9_]+\.zip$', base) or base == brand.package_name(): raise PackageError('extra_bad_name', base)
    with open(path, 'rb') as f: data = f.read()
    entries = dict(read_zip_entries(data))
    if 'config.xml' not in entries: raise PackageError('extra_not_app', base)
    wid = widget_id or known_ids().get(base) or base[:-4]
    if not WIDGET_ID_RE.match(wid) or wid == brand.widget_id(): raise PackageError('extra_bad_name', wid)
    m = re.search(rb'<widgetname[^>]*>([^<]+)</widgetname>', entries['config.xml'])
    title = m.group(1).decode('utf-8', 'replace').strip() if m else wid
    return {'id': wid, 'title': title[:64], 'file': base, 'data': data, 'path': path}


def parse_extra_spec(spec):
    """'path.zip' or 'WIDGETID=path.zip' -> (path, widget_id or None)"""
    spec = (spec or '').strip()
    m = re.match(r'^([A-Za-z0-9_]{1,64})=(.+)$', spec)
    return (m.group(2), m.group(1)) if m else (spec, None)


def widgetlist(host, apps):
    """apps: list of {'id','title','file','size'}; host = this computer's LAN IP (the TV downloads from port 80)."""
    if not re.match(r'^[0-9.]+$', host or ''): raise PackageError('bad_host')
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rsp stat="ok">\n\t<list>\n'
    for a in apps:
        if not WIDGET_ID_RE.match(a['id']) or not re.match(r'^[A-Za-z0-9_]+\.zip$', a['file']): raise PackageError('bad_app')
        xml += ('\t\t<widget id="%s">\n\t\t\t<title>%s</title>\n\t\t\t<compression size="%d" type="zip"/>\n'
                '\t\t\t<description/>\n\t\t\t<download>http://%s/%s</download>\n\t\t</widget>\n') % (
            a['id'], escape(a['title']), int(a['size']), host, a['file'])
    return (xml + '\t</list>\n</rsp>\n').encode('utf-8')
