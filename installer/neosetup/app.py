"""Entry point: python3 installer/plexneo_setup.py  (or python3 plexneo-setup.pyz)."""
import argparse
import json
import os
import pkgutil
import sys
import threading
import webbrowser

from . import VERSION, brand, package, settings
from .wizard import Wizard
from .webui import UIServer

HERE = os.path.dirname(os.path.abspath(__file__))


def payload(name):
    try: return pkgutil.get_data('neosetup', 'payload/' + name)
    except OSError: return None


def make_base_loader(base_zip=None, repo=None, icon=None):
    """Where the app comes from, in this order: --base ZIP, --repo DIR, payload embedded in the installer
    (neosetup/payload/app.zip – older builds: payload/PlexNeo.zip – for distributed builds; payload/brand.json = the brand
    the payload was built with), the repo checkout this file lives in (loader/ + app/)."""
    def load():
        if base_zip:
            with open(base_zip, 'rb') as f: return package.read_zip_entries(f.read())
        if repo: return package.base_from_repo(repo, icon)          # explicit --repo wins over the embedded payload
        data = payload('app.zip') or payload('PlexNeo.zip')
        if data: return package.read_zip_entries(data)
        root = os.path.dirname(os.path.dirname(HERE))
        return package.base_from_repo(root, icon)
    return load


def running_instance(port):
    """URL of a setup program that already runs on this computer (second double-click), else None."""
    if not port: return None
    import http.client
    try:
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=1)
        c.request('HEAD', '/', headers={'Host': '127.0.0.1:%d' % port})
        r = c.getresponse()
        server = r.getheader('Server') or ''
        c.close()
    except (OSError, http.client.HTTPException):
        return None
    return 'http://127.0.0.1:%d/' % port if server.startswith('TVSetup') else None


def _pause_if_double_clicked():
    """A double-clicked .exe closes its console window immediately; keep error messages readable."""
    if getattr(sys, 'frozen', False) and os.name == 'nt':
        try: input('\nEnter = schliessen / close')
        except (EOFError, KeyboardInterrupt): pass


def main(argv=None):
    try:
        return _main(argv)
    except SystemExit:
        raise
    except Exception as e:                                   # last resort: readable message instead of a traceback
        print('\nFehler / error: %s: %s' % (type(e).__name__, e))
        print('Bitte melden / please report: https://github.com/%s/issues' % brand.CURRENT.get('repo', 'itsab1989/neolume'))
        _pause_if_double_clicked()
        return 1


def select_brand(argv):
    """Brand before the real argument parsing (program name, --version): embedded payload/brand.json for distributed
    builds, otherwise brand/ of the repo (--brand / --repo / env BRAND / local.json, see brand/README.md)."""
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument('--brand'); pre.add_argument('--repo')
    p, _ = pre.parse_known_args(argv)
    try:
        pb = payload('brand.json')
        if pb and not p.brand and not p.repo:
            brand.load_dict(json.loads(pb.decode('utf-8')))
        else:
            brand.load(p.repo or os.path.dirname(os.path.dirname(HERE)), p.brand)
    except (OSError, ValueError) as e:
        sys.exit('brand: %s' % e)


def _main(argv=None):
    select_brand(argv)
    ap = argparse.ArgumentParser(prog=brand.CURRENT['slug'] + '-setup', description='%s Setup %s - Einrichtung / setup' % (brand.name(), VERSION))
    ap.add_argument('--port', type=int, default=32480, help='port of the local web UI (127.0.0.1 only), 0 = any free port')
    ap.add_argument('--base', help='release app package (zip) to use instead of the built-in one')
    ap.add_argument('--repo', help='checkout to build the app from (loader/ + app/app.js)')
    ap.add_argument('--brand', default=None, help='brand profile from brand/ (repo builds; default: see brand/README.md)')
    ap.add_argument('--icon', default=None, help='icon set from loader-icons/ (repo builds only; default: local.json "icon", else the brand\'s defaultIcon)')
    ap.add_argument('--extra', action='append', default=[], metavar='[ID=]PATH.zip',
                    help='other user app that must stay on the TV (the TV sync removes unlisted apps); repeatable')
    ap.add_argument('--no-browser', action='store_true', help='do not open the browser automatically')
    ap.add_argument('--sync-port', type=int, default=80, help=argparse.SUPPRESS)   # the TV always uses 80; for tests only
    ap.add_argument('--update-port', type=int, default=32499, help='port of the optional update server')
    ap.add_argument('--helper', action='store_true',
                    help='run only the optional helper (watchlist/Discover for the TV) from the saved helper file; for autostart/Docker')
    ap.add_argument('--helper-file', help='helper file (default: per-user settings folder, see installer/README.md)')
    ap.add_argument('--wait', action='store_true',
                    help='with --helper: wait until the helper file exists instead of exiting (Docker/NAS)')
    ap.add_argument('--version', action='version', version='%(prog)s ' + VERSION)
    ap.add_argument('--bind', default='0.0.0.0', help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if a.helper:
        from .helper import run_headless
        return run_headless(a.helper_file, a.update_port, a.bind, wait=a.wait)

    other = running_instance(a.port)
    if other:                                    # already running (second double-click): just show its page again
        print('%s Setup laeuft schon / is already running: %s' % (brand.name(), other))
        if not a.no_browser: webbrowser.open(other)
        return 0

    prefs = settings.load()
    w = Wizard(make_base_loader(a.base, a.repo, a.icon), extras=a.extra or None, prefs=prefs,
               sync_port=a.sync_port, update_port=a.update_port, helper_file=a.helper_file)
    try:
        ui = UIServer(w, a.port)
    except OSError:
        ui = UIServer(w, 0)                          # preferred port busy -> any free port
    print('%s Setup %s' % (brand.name(), VERSION))
    print('  Bitte im Browser öffnen / open in your browser:  %s' % ui.url)
    print('  Beenden / quit: Knopf "Programm beenden" auf der Seite oder Ctrl+C / "Quit" button on the page or Ctrl+C')
    sys.stdout.flush()
    as_sudo = os.name == 'posix' and hasattr(os, 'geteuid') and os.geteuid() == 0 and os.environ.get('SUDO_USER')
    if as_sudo:                                  # Linux needs sudo for port 80; do not start a browser as root
        print('  (sudo: bitte die Adresse selbst im Browser oeffnen / please open the address in your browser)')
    if not a.no_browser and not as_sudo:
        threading.Timer(0.5, lambda: webbrowser.open(ui.url)).start()
    try:
        ui.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        w.shutdown()
        ui.server_close()
        print('\nBeendet / stopped.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
