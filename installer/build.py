#!/usr/bin/env python3
"""Build the distributable setup program (see installer/BUILD.md). Used by .github/workflows/release-setup.yml and locally.

    python3 installer/build.py payload            app/ + loader/ -> installer/neosetup/payload/app.zip + brand.json (needs `npm run build`)
    python3 installer/build.py pyz                -> dist-setup/<slug>-setup.pyz (any OS with Python 3.8+)
    python3 installer/build.py exe                -> dist-setup/<slug>-setup-<os>-<cpu>[.exe|.zip] (PyInstaller, this OS/CPU only)
    python3 installer/build.py sums               -> dist-setup/SHA256SUMS
    python3 installer/build.py all                payload + pyz + exe + sums
    python3 installer/build.py stamp --version X  only stamp the version (Docker image build)
    python3 installer/build.py slug               print the artifact prefix (APP_SLUG) of the selected brand
    python3 installer/build.py brand              slug/appname/repo/brand as key=value lines (CI)
    options: --version 1.2.3 (stamps neosetup/__init__.py in the working tree; CI only), --out DIR, --brand ID

Artifact names come from the brand profile (brand/<id>.json "slug"; selection like tools/build.js: --brand / env BRAND ->
local.json "brand" -> private if brand/private.json exists -> public). Env APP_SLUG overrides the slug.
"""
import argparse
import hashlib
import io
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
import zipapp

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PKG = os.path.join(HERE, 'neosetup')
PAYLOAD_DIR = os.path.join(PKG, 'payload')
PAYLOAD = os.path.join(PAYLOAD_DIR, 'app.zip')              # TV app package (brand-specific name inside the TV sync)
PAYLOAD_BRAND = os.path.join(PAYLOAD_DIR, 'brand.json')     # brand the payload was built with
APP_SLUG = None                                             # set by select_brand()
SLUG_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,40}$')


def select_brand(bid=None):
    """Load the brand profile (same rule as tools/build.js) and set APP_SLUG (env APP_SLUG overrides)."""
    global APP_SLUG
    sys.path.insert(0, HERE)
    from neosetup import brand
    try:
        b = brand.load(ROOT, bid)
    except (OSError, ValueError) as e:
        sys.exit('brand: %s' % e)
    APP_SLUG = os.environ.get('APP_SLUG') or b['slug']
    return b


def name(suffix=''):
    if not SLUG_RE.match(APP_SLUG): sys.exit('APP_SLUG must be lower-case letters, digits and "-": %r' % APP_SLUG)
    return '%s-setup%s' % (APP_SLUG, suffix)


def target():
    """<os>-<cpu> of THIS machine/interpreter, e.g. windows-x64, macos-arm64, linux-arm64."""
    osname = {'win32': 'windows', 'darwin': 'macos'}.get(sys.platform, 'linux' if sys.platform.startswith('linux') else sys.platform)
    m = platform.machine().lower()
    cpu = {'amd64': 'x64', 'x86_64': 'x64', 'arm64': 'arm64', 'aarch64': 'arm64', 'armv7l': 'armv7'}.get(m, m)
    return '%s-%s' % (osname, cpu)


def stamp_version(v):
    v = v.lstrip('v')
    if not re.match(r'^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$', v): sys.exit('bad version: %r' % v)
    p = os.path.join(PKG, '__init__.py')
    with open(p, encoding='utf-8') as f: s = f.read()
    s2 = re.sub(r"VERSION = '[^']*'", "VERSION = '%s'" % v, s)
    with open(p, 'w', encoding='utf-8') as f: f.write(s2)
    print('version %s' % v)


BINARY_EXT = ('.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.zip')
_NOT_PRIVATE = ('localhost', '127.0.0.1', '0.0.0.0')


def _hosts(v):
    """Bare host/IP parts of a local.json value ("http://192.0.2.10:32400" -> "192.0.2.10", "192.0.2.11:8099" -> "192.0.2.11")."""
    out = set(re.findall(r'(?<![0-9.])(?:\d{1,3}\.){3}\d{1,3}(?![0-9])', v))
    m = re.match(r'^(?:[a-z][a-z0-9+.-]*://)?(?:[^@/]*@)?([A-Za-z0-9.-]+)(?::\d+)?(?:/|$)', v)
    if m and '.' in m.group(1): out.add(m.group(1))
    return set(h for h in out if h.lower() not in _NOT_PRIVATE and len(h) >= 7)


def local_values_in(blobs, root=None):
    """Keys of local.json whose values (home network addresses) occur in the given build outputs: the whole value and its
    bare host/IP part (an IP only as a whole number, so 192.0.2.1 does not match inside 192.0.2.10). tools/build.js bakes
    local.json into app.js; a release payload built on a developer machine would ship them (pentest: privacy). Example
    addresses in texts (e.g. 192.168.1.20) are fine as long as they are not in local.json."""
    try:
        with open(os.path.join(root or ROOT, 'local.json'), encoding='utf-8') as f: loc = json.load(f)
    except (OSError, ValueError):
        return []
    hits = set()
    for k, v in (loc.items() if isinstance(loc, dict) else []):
        for x in (v if isinstance(v, list) else [v]):
            if not isinstance(x, str): continue
            pats = [re.escape(x.encode('utf-8'))] if len(x) >= 7 and x not in _hosts(x) else []   # bare IP: boundaries below
            pats += [b'(?<![0-9A-Za-z.-])' + re.escape(h.encode('utf-8')) + b'(?![0-9A-Za-z-]|\\.[0-9A-Za-z])' for h in _hosts(x)]
            if any(re.search(pt, b) for pt in pats for b in blobs): hits.add(k)
    return sorted(hits)


def payload_texts(entries):
    """All text files of a payload (everything except known image/font/media files, e.g. also widget.info and config.xml) –
    every one of them is checked for local.json values."""
    return [d for n, d in entries if not n.lower().endswith(BINARY_EXT)]


def build_payload():
    """Release app package for the TV (no setup.json; the setup program adds it per user). Same rules as the
    setup's repo mode: DEV_HOST forced empty, dev prototypes dropped, app.min.js shipped as app.js."""
    import json
    sys.path.insert(0, HERE)
    from neosetup import brand, package
    if not os.path.isfile(os.path.join(ROOT, 'app', 'app.min.js')):
        sys.exit('app/app.min.js missing - run "npm ci && npm run build" first (the TV gets the minified release build)')
    entries = package.release_entries(package.base_from_repo(ROOT))
    os.makedirs(os.path.dirname(PAYLOAD), exist_ok=True)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, data in entries: z.writestr(zipfile.ZipInfo(n, (2026, 1, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)
    data = buf.getvalue()
    for n, d in entries:                     # never ship development hosts or local network values
        if n == 'boot.js' and b"DEV_HOST = ''" not in d: sys.exit('boot.js still has a DEV_HOST')
    leak = local_values_in(payload_texts(entries))
    if leak: sys.exit('the payload contains values from local.json (%s) - build without local.json for a release' % ', '.join(leak))
    for old in ('PlexNeo.zip',):                # older payload name: never ship two apps
        if os.path.exists(os.path.join(PAYLOAD_DIR, old)): os.remove(os.path.join(PAYLOAD_DIR, old))
    with open(PAYLOAD, 'wb') as f: f.write(data)
    with open(PAYLOAD_BRAND, 'w', encoding='utf-8') as f:
        json.dump({k: brand.CURRENT[k] for k in ('id',) + brand.KEYS}, f, indent=1)
    print('brand %s (%s, package %s)' % (brand.CURRENT['id'], brand.name(), brand.package_name()))
    print('payload %s (%d KB, app %s)' % (os.path.relpath(PAYLOAD, ROOT), len(data) // 1024, package.app_version(entries)))


def _need_payload():
    if not os.path.isfile(PAYLOAD) or not os.path.isfile(PAYLOAD_BRAND):
        sys.exit('payload missing: run "python3 installer/build.py payload" first')
    # stale payload (built for another brand profile or before a brand change, e.g. new "features") -> the setup program and
    # helper would run without the edition's extensions (seen 28.10.: helper without the routes of an optional extension)
    from neosetup import brand
    with open(PAYLOAD_BRAND, encoding='utf-8') as f: pb = json.load(f)
    want = {k: brand.CURRENT[k] for k in ('id',) + brand.KEYS}
    if pb != json.loads(json.dumps(want)):
        sys.exit('payload is stale (built for another brand profile): run "python3 installer/build.py payload" first')


def build_pyz(out):
    _need_payload()
    tmp = tempfile.mkdtemp()
    try:
        shutil.copytree(PKG, os.path.join(tmp, 'neosetup'), ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '__main__.py'))
        with open(os.path.join(tmp, '__main__.py'), 'w') as f:
            f.write('import sys\nfrom neosetup.app import main\nsys.exit(main())\n')
        os.makedirs(out, exist_ok=True)
        dst = os.path.join(out, name('.pyz'))
        zipapp.create_archive(tmp, dst, interpreter='/usr/bin/env python3', compressed=True)
    finally:
        shutil.rmtree(tmp)
    print('pyz %s (%d KB)' % (dst, os.path.getsize(dst) // 1024))
    return dst


def win_version_info(b, version):
    """PyInstaller --version-file. Checked on Windows 11 25H2 (German): Task Manager -> Startup apps and Settings -> Apps
    -> Startup list the helper's Startup shortcut by the FileDescription of the program it starts ("<Name> Setup & Helper",
    not the shortcut's name) with CompanyName as the publisher; the firewall prompt and the Processes tab show the
    FileDescription too. ProductName/InternalName/OriginalFilename only appear in the file's properties. One name for both
    roles, because the windowed helper copy (service.helper_program) is the same file with the same resource."""
    nums = [int(x) for x in re.findall(r'\d+', version)[:4]] + [0, 0, 0, 0]
    t = tuple(nums[:4])
    desc = '%s Setup & Helper' % b['name']
    sv = lambda k, v: 'StringStruct(%r, %r)' % (k, v)
    return ('VSVersionInfo(ffi=FixedFileInfo(filevers=%r, prodvers=%r, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, '
            'subtype=0x0, date=(0, 0)), kids=[StringFileInfo([StringTable(%r, [%s])]), VarFileInfo([VarStruct(%r, [1033, 1200])])])\n') % (
        t, t, '040904B0', ', '.join([sv('CompanyName', b['name']), sv('FileDescription', desc), sv('FileVersion', version),
                                     sv('InternalName', name()), sv('OriginalFilename', name('.exe')), sv('ProductName', b['name']),
                                     sv('ProductVersion', version)]), 'Translation')


def build_exe(out):
    _need_payload()
    tgt = target()
    exe_name = name('-' + tgt)
    work = tempfile.mkdtemp()
    sep = os.pathsep
    args = [sys.executable, '-m', 'PyInstaller', '--onefile', '--console', '--noconfirm', '--clean', '--name', exe_name,
            '--distpath', work, '--workpath', os.path.join(work, 'build'), '--specpath', work,
            '--add-data', '%s%sneosetup' % (os.path.join(PKG, 'ui.html'), sep),
            '--add-data', '%s%sneosetup/payload' % (PAYLOAD, sep),
            '--add-data', '%s%sneosetup/payload' % (PAYLOAD_BRAND, sep),
            '--hidden-import', 'neosetup.helper', '--hidden-import', 'neosetup.service', '--hidden-import', 'neosetup.background',
            '--hidden-import', 'neosetup.tray', '--hidden-import', 'ctypes.wintypes', '--paths', HERE,
            os.path.join(HERE, 'plexneo_setup.py')]
    ext_dir = os.path.join(PKG, 'private')
    if os.path.isdir(ext_dir):           # optional extensions of an edition (neosetup/ext.py); the public tree has none
        args[-1:-1] = ['--add-data', '%s%sneosetup/private' % (ext_dir, sep), '--collect-submodules', 'neosetup.private']
    if sys.platform == 'win32':
        from neosetup import brand
        with open(os.path.join(PKG, '__init__.py'), encoding='utf-8') as f:     # read again: stamp_version may have changed it
            version = re.search(r"VERSION = '([^']*)'", f.read()).group(1)
        vf = os.path.join(work, 'version.txt')
        with open(vf, 'w', encoding='utf-8') as f: f.write(win_version_info(brand.CURRENT, version))
        ico = os.path.join(work, 'app.ico')        # the helper's app icon: Startup apps, firewall prompt, Explorer
        from neosetup import tray
        rgb = tuple(int(brand.CURRENT['accent'][i:i + 2], 16) for i in (1, 3, 5))
        with open(ico, 'wb') as f: f.write(tray.ico(rgb, (16, 20, 24, 32, 40, 48, 64, 256), tray.app_icon_pixels))
        args[-1:-1] = ['--version-file', vf, '--icon', ico]
    print(' '.join(args)); sys.stdout.flush()
    subprocess.check_call(args)
    os.makedirs(out, exist_ok=True)
    built = os.path.join(work, exe_name + ('.exe' if sys.platform == 'win32' else ''))
    if sys.platform == 'darwin':
        # a bare download loses the executable bit -> zip with mode kept; inside: "<slug>-setup" (double-click opens Terminal)
        dst = os.path.join(out, exe_name + '.zip')
        info = zipfile.ZipInfo(name(), (2026, 1, 1, 0, 0, 0))
        info.external_attr = (0o100755 << 16)
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(built, 'rb') as f, zipfile.ZipFile(dst, 'w') as z: z.writestr(info, f.read())
    else:
        dst = os.path.join(out, os.path.basename(built))
        shutil.copy2(built, dst)
    shutil.rmtree(work, ignore_errors=True)
    print('exe %s (%d KB)' % (dst, os.path.getsize(dst) // 1024))
    return dst


def write_sums(out):
    lines = []
    for f in sorted(os.listdir(out)):
        p = os.path.join(out, f)
        if f == 'SHA256SUMS' or not os.path.isfile(p): continue
        h = hashlib.sha256()
        with open(p, 'rb') as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b''): h.update(chunk)
        lines.append('%s  %s\n' % (h.hexdigest(), f))
    with open(os.path.join(out, 'SHA256SUMS'), 'w', newline='\n') as f: f.writelines(lines)
    print(''.join(lines), end='')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('what', choices=('payload', 'pyz', 'exe', 'sums', 'all', 'target', 'name', 'slug', 'brand', 'stamp'))
    ap.add_argument('--brand', help='brand profile from brand/ (default: see brand/README.md)')
    ap.add_argument('--out', default=os.path.join(ROOT, 'dist-setup'))
    ap.add_argument('--version', help='stamp this version into neosetup/__init__.py first (e.g. from the git tag)')
    a = ap.parse_args(argv)
    if a.what == 'target': print(target()); return 0
    b = select_brand(a.brand)
    if a.what == 'brand':                     # for CI: key=value lines (GITHUB_OUTPUT)
        print('slug=%s\nappname=%s\nrepo=%s\nbrand=%s' % (APP_SLUG, b['name'], b['repo'], b['id'])); return 0
    if a.what == 'name': print(name()); return 0
    if a.what == 'slug': print(APP_SLUG); return 0
    if a.version: stamp_version(a.version)
    if a.what in ('payload', 'all'): build_payload()
    if a.what in ('pyz', 'all'): build_pyz(a.out)
    if a.what in ('exe', 'all'): build_exe(a.out)
    if a.what in ('sums', 'all'): write_sums(a.out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
