"""The installed helper in the background (`--helper --background`, started by the autostart entry from service.py).

Compared to the plain `--helper` (Docker/NAS) it adds: a log file instead of a console, a pid file (so "remove" can stop
it), one instance only, waiting for a busy port instead of failing, re-reading helper.json after a new setup, a small
plex.tv reachability check (TLS handshake only, nothing is sent) and the optional icon with its menu (tray.py).
"""
import os
import signal
import socket
import ssl
import subprocess
import sys
import threading
import time
import webbrowser

from . import VERSION, brand, service
from . import helper as helpermod

LOG_MAX = 512 << 10
PLEX_CHECK = 10 * 60


# Same words as the setup page and the docs (one name per thing). {app} = brand name.
TEXTS = {
    'de': {
        'tip': '{app} Helfer – Merkliste & Trends für den Fernseher',
        'tip_paused': '{app} Helfer – pausiert',
        'running': 'Helfer läuft (Port %s, nur Heimnetz)',
        'paused': 'Helfer pausiert – der Fernseher zeigt Merkliste und Trends gerade nicht',
        'plex_ok': 'plex.tv: erreichbar',
        'plex_bad': 'plex.tv: nicht erreichbar – Internet prüfen',
        'plex_unknown': 'plex.tv: wird geprüft …',
        'tv_seen': 'Fernseher zuletzt gesehen: %s',
        'tv_never': 'Fernseher: noch nicht gesehen (bis die App Merkliste oder Trends öffnet)',
        'pause': 'Pausieren', 'resume': 'Fortsetzen',
        'open': 'Einrichtungsprogramm öffnen …',
        'about': 'Was macht der Helfer?',
        'quit': 'Helfer beenden',
        'remove': 'Helfer entfernen …',
        'today': 'heute %s',
        'about_title': '{app} Helfer',
        'about_text': (
            'Der Helfer holt für deinen Samsung-Fernseher (2014) die Plex-Merkliste, die Entdecken-Reihen „Gerade beliebt“, '
            '„Neu erschienen“ und „Bald verfügbar“ und – wenn du in Entdecken einen Titel öffnest, der nicht auf deinem Server '
            'ist – dessen Inhalt, Genres, Laufzeit und Besetzung von plex.tv. Merkst du am Fernseher einen Titel vor oder '
            'entfernst ihn, gibt der Helfer das an plex.tv weiter. Nutzt du freigegebene Server anderer Leute, fragt er auch '
            'deren aktuelle Adresse ab. Mehr holt er nicht aus dem Internet.\n\n'
            'Warum? Der Fernseher kann plex.tv nicht selbst erreichen: plex.tv verlangt eine neuere Verschlüsselung (TLS 1.2), '
            'der Fernseher kann nur ältere (bis TLS 1.1).\n\n'
            'Was er nicht tut: Er leitet keine Videos weiter (die kommen immer direkt von deinem Plex-Server), ist aus dem Internet '
            'nicht erreichbar und reicht keine Anfragen für andere weiter. Er antwortet nur Geräten in deinem Heimnetz und ruft im '
            'Internet nur feste plex.tv-Adressen ab. Daten gehen ins Internet nur an plex.tv.\n\n'
            'Gespeichert: die Zugangsdatei helper.json (nur für dich lesbar) in\n%s\n\n'
            'Ist der Helfer aus, läuft die App ganz normal weiter – nur Merkliste, diese Reihen und die Infos zu Titeln '
            'außerhalb deines Servers fehlen.\n'
            'Komplett entfernen: hier im Menü „Helfer entfernen …“.'),
        'remove_title': 'Helfer entfernen?',
        'remove_text': (
            'Entfernt den Autostart, die Programmkopie, die Einstellungen und die Zugangsdatei des Helfers und beendet ihn. '
            'Bei plex.tv wird – wenn möglich – sein Geräteeintrag gelöscht.\n\n'
            'Danach zeigt der Fernseher Merkliste, Trends und Infos zu Titeln außerhalb deines Servers nicht mehr; alles '
            'andere läuft weiter. Bis du das App-Paket ohne „Helfer einrichten“ neu erstellt und auf den Fernseher gebracht '
            'hast, meldet die App kurz „Helfer von {app} nicht erreichbar“, wenn sie ihn sucht.\n\n'
            'Wieder einrichten: Einrichtungsprogramm starten, „Helfer einrichten“ ankreuzen und das App-Paket erstellen.'),
        'remove_ok': 'Entfernen', 'cancel': 'Abbrechen',
        'removed_title': 'Helfer entfernt',
        'open_failed': 'Das Einrichtungsprogramm konnte nicht gestartet werden. Bitte starte es von Hand (die heruntergeladene Datei).',
    },
    'en': {
        'tip': '{app} Helper – watchlist & trends for the TV',
        'tip_paused': '{app} Helper – paused',
        'running': 'Helper running (port %s, home network only)',
        'paused': 'Helper paused – the TV does not show the watchlist and trends right now',
        'plex_ok': 'plex.tv: reachable',
        'plex_bad': 'plex.tv: not reachable – check the internet connection',
        'plex_unknown': 'plex.tv: checking …',
        'tv_seen': 'TV last seen: %s',
        'tv_never': 'TV: not seen yet (until the app opens the watchlist or trends)',
        'pause': 'Pause', 'resume': 'Resume',
        'open': 'Open setup program …',
        'about': 'What does the helper do?',
        'quit': 'Quit helper',
        'remove': 'Remove helper …',
        'today': 'today %s',
        'about_title': '{app} Helper',
        'about_text': (
            'The helper fetches your Plex watchlist, the Discover rows “Trending now”, “Just released” and “Coming soon” and – '
            'when you open a title in Discover that is not on your server – its story, genres, runtime and cast from plex.tv '
            'for your 2014 Samsung TV. When you add or remove a title on the TV, the helper passes that on to plex.tv. If you '
            'use servers other people shared with you, it also looks up their current address. It fetches nothing else from '
            'the internet.\n\n'
            'Why? The TV cannot reach plex.tv by itself: plex.tv requires newer encryption (TLS 1.2), the TV only knows older '
            'versions (up to TLS 1.1).\n\n'
            'What it does not do: it never passes on video (videos always come straight from your Plex server), it cannot be '
            'reached from the internet, and it does not pass on requests for anyone else. It only answers devices in your home '
            'network and only calls fixed plex.tv addresses on the internet. Data goes to the internet only to plex.tv.\n\n'
            'Stored: the access file helper.json (readable only by you) in\n%s\n\n'
            'When the helper is off, the app keeps working – only the watchlist, these rows and the details of titles outside '
            'your server are missing.\n'
            'Remove it completely: “Remove helper …” in this menu.'),
        'remove_title': 'Remove the helper?',
        'remove_text': (
            'Removes the helper\'s autostart, program copy, settings and access file and stops it. If possible, its device '
            'entry at plex.tv is deleted too.\n\n'
            'Afterwards the TV no longer shows the watchlist, trends and details of titles outside your server; everything '
            'else keeps working. Until you create the app package again without “Set up the helper” and put it on the TV, '
            'the app briefly shows “{app} helper not reachable” when it looks for it.\n\n'
            'To set it up again: start the setup program, tick “Set up the helper” and create the app package.'),
        'remove_ok': 'Remove', 'cancel': 'Cancel',
        'removed_title': 'Helper removed',
        'open_failed': 'Could not start the setup program. Please start it yourself (the file you downloaded).',
    },
}


def texts(lang):
    t = TEXTS[lang if lang in TEXTS else 'en']
    return dict((k, v.replace('{app}', brand.name())) for k, v in t.items())


def open_log(path):
    """Append to helper.log (one old copy kept at 512 KB). The helper never writes tokens or keys to it."""
    try:
        if os.path.getsize(path) > LOG_MAX: os.replace(path, path + '.1')
    except OSError:
        pass
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        return os.fdopen(fd, 'a', encoding='utf-8', buffering=1)
    except OSError:
        return open(os.devnull, 'w')


def plex_reachable(timeout=10):
    """TLS handshake with plex.tv (certificate checked); no request is sent."""
    try:
        with socket.create_connection(('plex.tv', 443), timeout=timeout) as s:
            with ssl.create_default_context().wrap_socket(s, server_hostname='plex.tv'):
                return True
    except (OSError, ssl.SSLError):
        return False


class Background(object):
    def __init__(self, ctx, helper_file=None, port=helpermod.HELPER_PORT, bind='0.0.0.0', out=None, clock=time.time,
                 plex_check=plex_reachable):
        self.ctx, self.helper_file, self.port, self.bind = ctx, helper_file, port, bind
        self.path = helper_file or ctx.file('helper.json')
        self.out = out or sys.stdout
        self.clock = clock
        self.plex_check = plex_check
        self.stop = threading.Event()
        self.paused = False
        self.plex = None
        self.srv = None
        self.store = None
        self.mtime = None
        self.lock = threading.Lock()
        self.told = set()
        self.exit_code = 0

    def log(self, msg):
        try:
            self.out.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n'); self.out.flush()
        except (OSError, ValueError):
            pass

    def once(self, key, msg):
        if key not in self.told:
            self.told.add(key); self.log(msg)

    # ---- helper.json ----
    def load(self):
        """(Re)read helper.json when it changed (new setup). Missing file: serve nothing until it is back."""
        try: mt = os.stat(self.path).st_mtime
        except OSError: mt = None
        if mt == self.mtime and (self.store or mt is None): return
        self.mtime = mt
        if mt is None:
            if self.store: self.log('helper.json fehlt / missing – Helfer wartet / helper waits')
            self.store = None
            self._stop_server()
            self.once('nofile', 'Kein Helfer eingerichtet / no helper set up: %s' % self.path)
            return
        try:
            store = helpermod.Store.load(self.path)
        except (OSError, ValueError):
            self.once('bad', 'helper.json ungültig / invalid: %s' % self.path); return
        fresh = self.store is None
        self.store = store
        with self.lock:
            if self.srv and self.srv.api:
                self.srv.api.store = store
                self.srv.allow = set([store.allow]) if store.allow else set()
        self.told.discard('nofile'); self.told.discard('bad')
        self.log('Zugang geladen / access loaded: %d Profil(e)%s' % (len(store.profiles), '' if fresh else ' (neu / reloaded)'))

    # ---- server ----
    def _start_server(self):
        from .lanserver import LanServer
        with self.lock:
            if self.srv or not self.store or self.paused: return
            srv = LanServer('helper', self.port, allow=[self.store.allow] if self.store.allow else None, bind=self.bind)
            h = helpermod.Helper(self.store, 'plexneo-helper-' + self.store.key[:8].encode().hex()[:12])
            h.background = True
            h.store_path = self.path
            srv.api = h
            try:
                srv.start()
            except OSError:
                self.once('busy', 'Port %d belegt / in use – neuer Versuch alle 30 s / retrying every 30 s' % self.port)
                return
            self.srv = srv
            self.told.discard('busy')
        self.log('%s Helfer %s läuft auf Port %d (nur Heimnetz) / running on port %d (home network only)' % (
            brand.name(), VERSION, srv.port, srv.port))

    def _stop_server(self):
        with self.lock:
            srv, self.srv = self.srv, None
        if srv: srv.stop()

    def pause(self):
        self.paused = True
        self._stop_server()
        self.log('pausiert / paused')

    def resume(self):
        self.paused = False
        self._start_server()
        self.log('fortgesetzt / resumed')

    # ---- status for the icon ----
    def tv_seen(self):
        srv = self.srv
        if not srv: return ''
        for t, client, path, st in reversed(srv.events):
            if st == 200 and not (client.startswith('127.') or client == '::1'):
                return time.strftime('%H:%M', time.localtime(t)) if time.time() - t < 86400 else time.strftime('%d.%m. %H:%M', time.localtime(t))
        return ''

    def status(self):
        return {'paused': self.paused, 'plex': self.plex, 'tv': self.tv_seen(), 'port': self.port, 'running': bool(self.srv)}

    # ---- loop ----
    def maintain(self, poll=5.0):
        last_check = 0
        while not self.stop.is_set():
            try:
                if service.takeover_requested(self.ctx):
                    self.log('Helfer mit Symbol übernimmt, dieser endet / the helper with icon takes over, this one ends')
                    self.exit_code = 0
                    self.stop.set()
                    break
                self.load()
                if not self.srv and not self.paused: self._start_server()
                if self.clock() - last_check > PLEX_CHECK:
                    last_check = self.clock()
                    ok = self.plex_check()
                    if ok != self.plex: self.log('plex.tv %s' % ('erreichbar / reachable' if ok else 'NICHT erreichbar / NOT reachable'))
                    self.plex = ok
            except Exception as e:                 # keep running; no request data in the message
                self.log('Fehler / error: %s' % type(e).__name__)
            self.stop.wait(poll)

    def shutdown(self):
        self.stop.set()
        self._stop_server()
        service.remove_pid(self.ctx)


def relaunch_hidden(argv):
    """Windows: started with a console window (python.exe) or by the one-time task of service.win_start_in_desktop ->
    start again detached and without a window, then exit. The Startup shortcut of the windowed helper copy / pythonw.exe
    passes --detached and never gets here (no window to hide)."""
    args = ([sys.executable] if getattr(sys, 'frozen', False) else [sys.executable, os.path.abspath(sys.argv[0])]) + list(argv) + ['--detached']
    service.spawn_detached(args)
    return 0


def run(helper_file=None, port=helpermod.HELPER_PORT, bind='0.0.0.0', tray_on=True, detached=False, argv=(), ctx=None):
    """Autostart entry point. Nobody sees a console here, so every error that ends the start goes to helper.log."""
    ctx = ctx or service.Ctx()
    try:
        return _run(ctx, helper_file, port, bind, tray_on, detached, argv)
    except (SystemExit, KeyboardInterrupt):
        raise
    except BaseException:
        log_crash(ctx)
        return 1


def log_crash(ctx):
    import traceback
    lines = traceback.format_exc().strip().splitlines()[-25:]
    try:
        out = open_log(ctx.file('helper.log'))
        out.write(time.strftime('%Y-%m-%d %H:%M:%S ') + 'Start abgebrochen / start failed:\n  ' + '\n  '.join(lines) + '\n')
        out.close()
    except (OSError, ValueError):
        pass


def _run(ctx, helper_file, port, bind, tray_on, detached, argv):
    if os.name == 'nt' and not detached: return relaunch_hidden(argv)
    out = open_log(ctx.file('helper.log'))
    try:                                           # tracebacks (no tokens: the helper never prints them) go to the log too
        sys.stdout = sys.stderr = out
    except (AttributeError, ValueError):
        pass
    from . import tray
    can_tray = bool(tray_on) and tray.available()
    hello = service.probe(port)
    if hello and hello.get('background'):
        # A helper without a desktop (started over SSH / before the login) gives way to this one with the icon;
        # any other running helper stays and this start ends.
        if not (can_tray and service.take_over(ctx, port)):
            out.write(time.strftime('%Y-%m-%d %H:%M:%S ') + 'läuft schon / already running\n'); out.flush()
            return 0
        out.write(time.strftime('%Y-%m-%d %H:%M:%S ') + 'Helfer ohne Symbol abgelöst / took over from the helper '
                  'without icon\n'); out.flush()
    bg = Background(ctx, helper_file, port, bind, out)
    service.write_pid(ctx, wantTray=bool(tray_on), tray=None if can_tray else False)
    bg.log('Start %s %s (%s)' % (brand.name(), VERSION, sys.platform))
    threading.Thread(target=bg.maintain, name='helper-maintain', daemon=True).start()
    try:
        signal.signal(signal.SIGTERM, lambda *a: bg.stop.set())       # stop = clean exit 0 (launchd/systemd: no restart)
    except (ValueError, AttributeError, OSError):
        pass
    lang = service.cli_lang(ctx)
    shown = False
    if tray_on and not can_tray: bg.log('Kein Desktop für das Symbol, weiter ohne / no desktop for the icon, continuing without')
    if can_tray:
        t = texts(lang)
        model = tray.Model(t, bg.status, actions(bg, ctx, t, helper_file))
        rgb = tuple(int(brand.CURRENT['accent'][i:i + 2], 16) for i in (1, 3, 5))
        def ready():
            service.update_pid(ctx, tray=True)
            bg.log('Symbol an / icon shown')
        shown = tray.run(model, bg.stop, rgb, on_ready=ready)
        if not shown:
            service.update_pid(ctx, tray=False)
            bg.log('Symbol nicht möglich, weiter ohne / no icon possible, continuing without')
    try:
        while not bg.stop.is_set(): bg.stop.wait(1.0)
    except KeyboardInterrupt:
        pass
    finally:
        bg.shutdown()
        bg.log('Ende / stopped')
    return bg.exit_code


def actions(bg, ctx, t, helper_file):
    def open_settings():
        """Start the setup program (or reuse a running one) on its helper section."""
        from .app import running_instance
        url = running_instance(32480)
        if url:
            webbrowser.open(url + '#helper'); return
        prefs = service.load_prefs(ctx)
        pg = ctx.program
        base = prefs['args'] if prefs else ([pg['src']] if pg['kind'] == 'exe' else [pg['python'], pg['src']])
        args = [a for a in service.setup_args(ctx, base) if a not in ('--helper', '--background', '--no-tray', '--detached')]
        args = _strip_opts(args, ('--helper-file', '--update-port')) + ['--section', 'helper']
        try:
            if os.name == 'nt': subprocess.Popen(args, creationflags=0x00000010)           # CREATE_NEW_CONSOLE: visible window
            else: subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        except OSError:
            from . import tray
            tray.message(t['about_title'], t['open_failed'])

    def about():
        from . import tray
        from . import ext
        text = t['about_text'] % ctx.settings_dir()
        extra = ext.helper_about(_lang_of(t))              # optional extensions of the edition (ext.py)
        if extra:
            first, rest = text.split('\n\n', 1)
            text = '\n\n'.join([first] + extra + [rest])
        tray.message(t['about_title'], text)

    def quit_():
        bg.exit_code = 0
        bg.stop.set()

    def remove():
        from . import tray
        if not tray.confirm(t['remove_title'], t['remove_text'], t['remove_ok'], t['cancel']): return
        bg.pause()
        r = service.uninstall(ctx, helper_file=helper_file, self_pid=os.getpid())
        bg.log('entfernt / removed: ' + ', '.join(c for _, c, _ in r.items))
        tray.message(t['removed_title'], r.text(_lang_of(t)))
        bg.stop.set()

    return {'pause': bg.pause, 'resume': bg.resume, 'open': open_settings, 'about': about, 'quit': quit_, 'remove': remove}


def _lang_of(t):
    return 'de' if t['quit'] == TEXTS['de']['quit'] else 'en'


def _strip_opts(args, names):
    out, skip = [], False
    for a in args:
        if skip: skip = False; continue
        if a in names: skip = True; continue
        out.append(a)
    return out
