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


# Characters our texts use that old console code pages (Windows cp1252/cp850 over SSH, a C locale) cannot show.
ASCII_FALLBACK = {'→': '->', '←': '<-', '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'", '‚': "'", '–': '-', '—': '-',
                  '…': '...', '✓': 'OK', '✔': 'OK', '✗': 'x', '•': '*', '\u00a0': ' ', '›': '>', '‹': '<', '·': '-'}


def _ascii_fallback(err):
    if not isinstance(err, UnicodeEncodeError): raise err
    bad = err.object[err.start:err.end]
    out = ''.join(ASCII_FALLBACK.get(ch, '?') for ch in bad)
    try:
        out.encode(err.encoding)
    except (UnicodeEncodeError, LookupError):
        out = out.encode('ascii', 'replace').decode('ascii')
    return out, err.end


def safe_console(streams=None):
    """Never crash on output: characters the console's code page cannot show become ASCII ("→" -> "->", "„“" -> '"',
    others "?"). The encoding itself stays, so umlauts still show where the code page has them."""
    import codecs
    try: codecs.lookup_error('neo-ascii')
    except LookupError: codecs.register_error('neo-ascii', _ascii_fallback)
    for name in streams or ('stdout', 'stderr'):
        st = getattr(sys, name, None)
        if st is None or not hasattr(st, 'reconfigure'): continue
        try:
            # Windows, output into a pipe (ssh without a terminal, the helper's autostart): the old code page would turn
            # umlauts into "?" on the other side; UTF-8 is what ssh clients and log viewers expect. A real console window
            # writes Unicode directly and is left alone.
            if os.name == 'nt' and not st.isatty() and (st.encoding or '').lower().replace('-', '') != 'utf8':
                st.reconfigure(encoding='utf-8')
            st.reconfigure(errors='neo-ascii')
        except (ValueError, OSError, AttributeError): pass


def main(argv=None):
    safe_console()
    try:
        return _main(argv)
    except SystemExit:
        raise
    except Exception as e:                                   # last resort: readable message instead of a traceback
        try:
            print('\nFehler / error: %s: %s' % (type(e).__name__, e))
            print('Bitte melden / please report: https://github.com/%s/issues' % brand.CURRENT.get('repo', 'itsab1989/neolume'))
        except (OSError, ValueError):                         # no usable console (autostart): the log below still gets it
            pass
        if '--background' in (argv if argv is not None else sys.argv[1:]):
            from . import background, service
            background.log_crash(service.Ctx())
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
    ap.add_argument('--install-helper', action='store_true',
                    help='install the helper permanently: program copy + autostart (macOS LaunchAgent, Windows autostart, '
                         'Linux systemd --user) and start it; run the setup with "Set up the helper" first')
    ap.add_argument('--uninstall-helper', action='store_true',
                    help='remove the helper completely: autostart, program copy, its settings, access file, plex.tv device entry')
    ap.add_argument('--keep-access', action='store_true', help='with --uninstall-helper: only turn autostart off, keep the access file')
    ap.add_argument('--helper-status', action='store_true', help='show whether the helper is installed and running')
    ap.add_argument('--no-tray', dest='tray', action='store_false', default=None,
                    help='with --install-helper: no icon in the menu bar / notification area')
    ap.add_argument('--tray', dest='tray', action='store_true', help='with --install-helper: show the icon (default)')
    ap.add_argument('--at-boot', action='store_true',
                    help='macOS, with sudo and --install-helper: start at boot without a login (LaunchDaemon, no icon)')
    ap.add_argument('--version', action='version', version='%(prog)s ' + VERSION)
    ap.add_argument('--bind', default='0.0.0.0', help=argparse.SUPPRESS)
    ap.add_argument('--background', action='store_true', help=argparse.SUPPRESS)    # started by the autostart entry
    ap.add_argument('--detached', action='store_true', help=argparse.SUPPRESS)      # Windows: second start without window
    ap.add_argument('--setup-dir', help=argparse.SUPPRESS)                          # = PLEXNEO_SETUP_DIR (portable use)
    ap.add_argument('--section', choices=('helper',), help=argparse.SUPPRESS)        # open the page at this card
    a = ap.parse_args(argv)
    if a.setup_dir: os.environ['PLEXNEO_SETUP_DIR'] = os.path.abspath(a.setup_dir)
    if a.install_helper or a.uninstall_helper or a.helper_status:
        return helper_cli(a)
    if a.helper and a.background:
        from . import background
        return background.run(a.helper_file, a.update_port, a.bind, tray_on=a.tray is not False, detached=a.detached,
                              argv=[x for x in (argv if argv is not None else sys.argv[1:]) if x != '--detached'])
    if a.helper:
        from .helper import run_headless
        return run_headless(a.helper_file, a.update_port, a.bind, wait=a.wait)

    frag = '#' + a.section if a.section else ''
    other = running_instance(a.port)
    if other:                                    # already running (second double-click): just show its page again
        print('%s Setup laeuft schon / is already running: %s' % (brand.name(), other))
        if not a.no_browser: webbrowser.open(other + frag)
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
        threading.Timer(0.5, lambda: webbrowser.open(ui.url + frag)).start()
    try:
        ui.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        w.shutdown()
        ui.server_close()
        print('\nBeendet / stopped.')
    return 0


def helper_cli(a, ctx=None, out=None):
    """--install-helper / --uninstall-helper / --helper-status (also over SSH on an always-on Mac: no browser needed)."""
    from . import service
    out = out or sys.stdout
    ctx = ctx or service.Ctx.for_sudo_user()
    lang = ctx.ui_lang()
    if a.helper_status:
        st = service.status(ctx, a.helper_file)
        de = lang == 'de'
        yes, no = ('ja', 'nein') if de else ('yes', 'no')
        rows = [('Eingerichtet (Zugangsdatei)' if de else 'Set up (access file)', yes if st['configured'] else no),
                ('Dauerhaft installiert' if de else 'Installed permanently', yes if st['installed'] else no),
                ('Autostart', yes if st['autostart'] else no),
                ('Läuft' if de else 'Running', (yes + ' (Port %d)' % st['port']) if st['running'] else no),
                ('Symbol' if de else 'Icon', _icon_state(st, de)),
                ('Protokoll' if de else 'Log', st['log'])]
        if st['installed'] and st['os'] in ('mac', 'win'):
            if st['os'] == 'mac':
                where = ('Systemeinstellungen → Allgemein → Anmeldeobjekte & Erweiterungen' if de else
                         'System Settings → General → Login Items & Extensions')
            else:   # Task Manager shows the program's description, not the shortcut's name (build.py win_version_info)
                desc = brand.name() + ' Setup & Helper' if service.this_program()['kind'] == 'exe' else 'Python'
                where = ('Task-Manager → Autostart-Apps, dort als „%s“' if de else 'Task Manager → Startup apps, listed as “%s”') % desc
            rows.insert(2, ('Name im System' if de else 'Name in the system', '%s (%s)' % (st['name'], where)))
        for k, v in rows: out.write('  %-22s %s\n' % (k + ':', v))
        return 0
    if a.install_helper:
        port = a.update_port if a.update_port else service.DEFAULT_PORT
        r = service.install(ctx, a.helper_file, port, a.tray, a.at_boot)
    else:
        r = service.uninstall(ctx, keep_access=a.keep_access, helper_file=a.helper_file)
    out.write(r.text(lang) + '\n')
    return 0 if r.ok else 1


def _icon_state(st, de):
    if not st['trayPossible']: return '-'
    if not st['tray']: return 'aus' if de else 'off'
    if not st['running']: return 'an (erscheint, sobald der Helfer läuft)' if de else 'on (appears when the helper runs)'
    if st.get('trayShown') is False:
        return ('an, aber gerade nicht sichtbar: der Helfer wurde ohne Desktop gestartet (z. B. per SSH). Bei der nächsten '
                'Anmeldung löst der Autostart ihn ab, dann mit Symbol.' if de else
                'on, but not visible right now: the helper was started without a desktop (e.g. over SSH). At the next '
                'login the autostart takes over, then with its icon.')
    return 'an, sichtbar' if de else 'on, visible'


if __name__ == '__main__':
    sys.exit(main())
