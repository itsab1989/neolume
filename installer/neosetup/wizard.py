"""Setup state machine behind the web UI. Holds tokens in memory only; public_state() never contains tokens."""
import concurrent.futures
import time
import uuid

from . import brand
from . import helper as helpermod
from . import ext, netutil, package, service, settings
from .lanserver import LanServer, SYNC_PORT, UPDATE_PORT, port_in_use, sync_files, update_files
from .plextv import PlexError, PlexTV, build_profiles


OTHERS_USABLE = ('ok', 'unreachable')      # https-only servers and servers without an address cannot be used by the TV


class StepError(Exception):
    def __init__(self, code, detail=''):
        Exception.__init__(self, code)
        self.code, self.detail = code, detail


class Wizard(object):
    def __init__(self, base_loader, extras=None, prefs=None, plextv_factory=PlexTV, http_get=netutil.http_get,
                 gdm=netutil.gdm_discover, lan_ip=netutil.own_lan_ip, sync_port=SYNC_PORT, update_port=UPDATE_PORT,
                 settings_file=None, helper_file=None, helper_fetch=None, service_ctx=None):
        prefs = prefs or {}
        self.base_loader = base_loader          # callable -> list of (name, bytes) (release package entries)
        self.settings_file = settings_file
        self.remember = bool(prefs)
        self.client_id = prefs.get('clientIdentifier') or 'plexneo-' + uuid.uuid4().hex[:20]
        self.lang = prefs.get('lang') or ''
        self.tv_address = prefs.get('tvAddress') or ''
        self.extra_specs = list(extras or prefs.get('extras') or [])
        self.plex = plextv_factory(self.client_id)
        self.http_get, self.gdm, self.lan_ip = http_get, gdm, lan_ip
        self.sync = LanServer('sync', sync_port, lock_path='/widgetlist.xml')
        self.update = LanServer('update', update_port)
        # optional helper (neosetup/helper.py): shares the update port; survives finish() (own token copies)
        self.helper_file = helper_file
        self.helper_fetch = helper_fetch
        try:
            self.helper_store = helpermod.Store.load(helper_file)
            self.helper_remember = True
        except (OSError, ValueError):
            self.helper_store, self.helper_remember = None, True
        self.helper_wanted = self.helper_store is not None
        self.helper_address = ''               # other device (NAS) running the helper; '' = this computer
        self.helper_skipped = []               # profile titles without watchlist (Plex PIN)
        self.helper = None
        self._service_ctx = service_ctx        # installed helper (service.py); created on first use
        self.service_report = None             # last install/remove report for the page
        self.reset()

    # ---------- helpers ----------
    def reset(self):
        """Forget everything from plex.tv (tokens included)."""
        self.pins = {}
        self.token = None
        self.account = None
        self.servers = []
        self.home = []
        self.server = None
        self.uris = []
        self.profiles = []
        self.package = None
        self.widgetlist = None
        self.extras = []
        self.computer_ip = None
        self.build_info = None
        self.others = []                        # "Weitere Server": servers others shared with the chosen profiles
        self.others_scanned = False
        self.others_skipped = []                # profile titles that could not be checked (Plex PIN)
        if getattr(self, 'sync', None) and self.sync.running: self.sync.stop()
        ext.reset(self)

    def _need(self, what):
        if what == 'login' and not self.token: raise StepError('not_logged_in')
        if what == 'server' and not self.server: raise StepError('no_server')
        if what == 'package' and not self.package: raise StepError('no_package')

    # ---------- step a: login ----------
    def login_start(self, kind):
        if kind not in ('auth', 'link'): raise StepError('bad_input')
        p = self.plex.create_pin(strong=(kind == 'auth'))
        p['created'] = time.time()
        self.pins[kind] = p
        if kind == 'auth': return {'url': self.plex.auth_url(p['code'])}
        return {'code': p['code'], 'url': 'https://plex.tv/link'}

    def login_poll(self):
        if self.token: return {'done': True}
        if not self.pins: raise StepError('no_pin')
        for kind, p in list(self.pins.items()):
            if time.time() - p['created'] > p['expiresIn']:
                del self.pins[kind]; continue
            tok = self.plex.check_pin(p['id'])
            if tok:
                self._logged_in(tok)
                return {'done': True}
        if not self.pins: raise StepError('pin_expired')
        return {'done': False}

    def _logged_in(self, token):
        self.token = token
        self.pins = {}
        self.account = self.plex.user(token)
        self.refresh_servers()

    def refresh_servers(self):
        self._need('login')
        res = self.plex.resources(self.token)
        try: hits = self.gdm()
        except OSError: hits = []
        self.servers = netutil.merge_servers(res, hits)
        return self.servers

    # ---------- steps b + c: server + profiles ----------
    def choose_server(self, machine_id):
        self._need('login')
        srv = next((s for s in self.servers if s['machineIdentifier'] == machine_id), None)
        if not srv: raise StepError('bad_input')
        if not srv.get('owned') or not srv.get('token'): raise StepError('not_owner')
        if not srv['uris']: raise StepError('no_lan_address')
        uri = netutil.pick_reachable(srv['uris'], machine_id, self.http_get)
        if not uri: raise StepError('unreachable')
        home = self.plex.home_users(self.token)
        self.home = home
        # only Plex Home users: tokens of other shared accounts (friends) are dropped while parsing, never kept
        shared = self.plex.shared_servers(self.token, machine_id, [u['id'] for u in home if not u['guest']])
        self.server = srv
        self.uris = [uri] + [u for u in srv['uris'] if u != uri]
        self.profiles = self._check_profiles(uri, build_profiles(self.account, home, shared, srv['token']))
        self.package = None
        return self.profiles

    def _check_profiles(self, uri, profiles):
        """Read-only check of every token at the PMS: number of libraries it sees (None = token not accepted)."""
        def one(p):
            p['libraries'] = netutil.count_sections(uri, p['token'], self.http_get) if p['token'] else None
            if p['libraries'] is None: p['include'] = False
            return p
        with concurrent.futures.ThreadPoolExecutor(4) as ex:
            return list(ex.map(one, profiles))

    def set_profiles(self, include_ids):
        self._need('server')
        if not isinstance(include_ids, list) or not all(isinstance(i, int) for i in include_ids): raise StepError('bad_input')
        wanted = set(include_ids)
        new = [p['id'] in wanted and bool(p['token']) and p.get('libraries') is not None for p in self.profiles]
        if not any(new): raise StepError('no_profiles')
        for p, inc in zip(self.profiles, new): p['include'] = inc
        self.package = None
        self.others, self.others_scanned, self.others_skipped = [], False, []     # depends on the profiles: search again

    def set_extras(self, specs):
        if not isinstance(specs, list) or len(specs) > 10 or not all(isinstance(s, str) and len(s) < 1024 for s in specs):
            raise StepError('bad_input')
        apps = []
        for s in specs:
            if not s.strip(): continue
            path, wid = package.parse_extra_spec(s)
            try: apps.append(package.read_extra_app(path, wid))
            except package.PackageError as e: raise StepError(e.code, e.detail)
        self.extra_specs = [s for s in specs if s.strip()]
        self.extras = apps
        self.package = None
        return [{'id': a['id'], 'title': a['title'], 'file': a['file']} for a in apps]

    def set_tv_address(self, addr):
        addr = (addr or '').strip()
        if addr and not netutil.is_private_ipv4(addr): raise StepError('bad_input')
        self.tv_address = addr
        self.sync.allow = set([addr]) if addr else set()
        self.update.allow = set([addr]) if addr else set()

    # ---------- optional: other servers ("Weitere Server") ----------
    def others_scan(self):
        """Servers OTHER people shared with the chosen profiles (owned=false in each profile's own plex.tv resources).
        Only the user's own access: owner = this sign-in, Plex Home profiles WITHOUT a Plex PIN via switch (same rule as the
        helper; the setup never asks for PINs), friends never. Every server is checked read-only from this computer over
        plain http (GET /identity, no token). Default: not included (checkbox in the summary)."""
        self._need('server')
        own = self.server['machineIdentifier']
        old = dict((e['machineIdentifier'], e.get('include')) for e in self.others)
        protected = dict((u['id'], u.get('protected')) for u in self.home)
        found, skipped = {}, []

        def collect(p, token):
            for r in self.plex.resources(token):
                mid = r['machineIdentifier']
                if r['owned'] or mid == own or not r.get('token'): continue
                e = found.setdefault(mid, {'machineIdentifier': mid, 'name': r['name'] or mid[:8], 'httpsRequired': r.get('httpsRequired', False),
                                           'connections': r['connections'], 'tokens': {}, 'profiles': [], 'include': bool(old.get(mid))})
                e['tokens'][p['id']] = r['token']
                e['profiles'].append(p['title'])

        for p in self.profiles:
            if not p.get('include') or not p.get('token'): continue
            if p['kind'] == 'owner':
                collect(p, self.token)
            elif p['kind'] == 'home':
                if protected.get(p['id']): skipped.append(p['title']); continue
                try: collect(p, self.plex.switch_home_user(self.token, p['id']))
                except PlexError: skipped.append(p['title'])
        others = sorted(found.values(), key=lambda e: e['name'].lower())

        def probe(e):
            e['uris'] = netutil.other_candidate_uris(e)
            if e['httpsRequired']: e['status'], e['reachable'] = 'https', 0
            elif not e['uris']: e['status'], e['reachable'] = 'none', 0
            else:
                ok = [u for u in e['uris'] if netutil.probe_identity_net(u, self.http_get) == e['machineIdentifier']]
                e['uris'] = ok + [u for u in e['uris'] if u not in ok]          # reachable addresses first
                e['status'], e['reachable'] = ('ok' if ok else 'unreachable'), len(ok)
            if e['status'] not in OTHERS_USABLE: e['include'] = False
            return e
        if others:
            with concurrent.futures.ThreadPoolExecutor(4) as ex: others = list(ex.map(probe, others))
        self.others, self.others_scanned, self.others_skipped = others, True, skipped
        self.package = None
        return None

    def set_others(self, ids):
        """ids: machineIdentifiers to include (checkboxes). Servers that require https (or have no address) cannot be chosen."""
        if not isinstance(ids, list) or len(ids) > 50 or not all(isinstance(i, str) and len(i) <= 64 for i in ids): raise StepError('bad_input')
        wanted = set(ids)
        for e in self.others: e['include'] = e['machineIdentifier'] in wanted and e['status'] in OTHERS_USABLE
        self.package = None

    # ---------- steps d + e: summary + package ----------
    def build(self, reset_pins=False):
        """reset_pins: checkbox "Reset app PINs" (way out of a forgotten main-profile PIN); default keeps the PINs on the TV."""
        self._need('server')
        if self.extra_specs and not self.extras: self.set_extras(self.extra_specs)
        pms_host = self.uris[0].split('//', 1)[1].rsplit(':', 1)[0]
        ip = self.lan_ip(pms_host)
        if not ip: raise StepError('no_lan_ip')
        try:
            base = self.base_loader()
            hcfg = self._prepare_helper(ip) if self.helper_wanted else None
            cfg = package.make_config(self.client_id, self.server, self.uris, self.profiles, ip, self.update.port,
                                      reset_pins=bool(reset_pins), helper=hcfg, others=self.others)
            ext.config(self, cfg)                 # optional extensions of the edition (ext.py); public: nothing
            data = package.build_package(base, cfg)
        except package.PackageError as e:
            raise StepError(e.code, e.detail)
        apps = [{'id': brand.widget_id(), 'title': brand.name(), 'file': brand.package_name(), 'size': len(data)}]
        apps += [{'id': a['id'], 'title': a['title'], 'file': a['file'], 'size': len(a['data'])} for a in self.extras]
        self.widgetlist = package.widgetlist(ip, apps)
        self.package, self.computer_ip = data, ip
        self.app_js = dict(package.release_entries(base)).get('app.js', b'')
        self.app_version = package.app_version(base)
        self.build_info = {'size': len(data), 'profiles': len(cfg['profiles']), 'apps': [a['title'] for a in apps],
                           'appVersion': self.app_version, 'resetPins': bool(reset_pins), 'helper': bool(hcfg),
                           'others': [e['name'] for e in self.others if e.get('include')]}
        if self.sync.running: self._load_sync()
        return self.build_info

    # ---------- step f: sync ----------
    def _load_sync(self):
        pk = {brand.package_name(): self.package}
        for a in self.extras: pk[a['file']] = a['data']
        self.sync.set_files(sync_files(self.widgetlist, pk))

    def sync_start(self):
        self._need('package')
        self._load_sync()
        try: self.sync.start()
        except OSError as e:
            busy = getattr(e, 'errno', 0) in (48, 98, 10048) or port_in_use(self.sync.port)
            raise StepError('port_busy' if busy else 'port_denied', str(self.sync.port))

    def sync_stop(self):
        self.sync.stop()
        self.sync.unlock()

    # ---------- step g: update server ----------
    def update_start(self):
        if not getattr(self, 'app_js', None):
            try:
                base = self.base_loader()
            except package.PackageError as e:
                raise StepError(e.code, e.detail)
            self.app_js = dict(package.release_entries(base)).get('app.js', b'')
            self.app_version = package.app_version(base)
        self.update.set_files(update_files(self.app_js, self.app_version))
        if self.helper: self.helper.update_on = True
        try: self.update.start()
        except OSError: raise StepError('port_busy', str(self.update.port))

    def update_stop(self):
        self.update.set_files({})
        if self.helper: self.helper.update_on = False
        if not self.update.api: self.update.stop()

    # ---------- optional helper (watchlist + Discover rows; neosetup/helper.py) ----------
    def set_helper(self, enabled, remember=True, address=''):
        address = (address or '').strip()
        if address and not netutil.is_private_ipv4(address): raise StepError('bad_input')
        self.helper_wanted, self.helper_remember, self.helper_address = bool(enabled), bool(remember), address
        self.package = None
        if not enabled:
            self.helper_stop()
            if self.helper_store and service.load_prefs(self.service_ctx()):
                self.helper_uninstall()             # installed permanently: remove all of it, not only the access file
            self.helper_store = None
            helpermod.Store.forget(self.helper_file)

    def _prepare_helper(self, ip):
        """Collect the plex.tv tokens for the helper: owner = this sign-in; Plex Home profiles WITHOUT a Plex PIN via
        switch (the setup never asks for PINs). Key stays the same on re-setup (TVs keep working)."""
        old = self.helper_store
        store = helpermod.Store(old.key if old else None, allow=self.tv_address)
        protected = dict((u['id'], u.get('protected')) for u in self.home)
        skipped = []
        for p in self.profiles:
            if not p.get('include') or not p.get('token'): continue
            if p['kind'] == 'owner':
                store.add(p['uuid'] or 'owner', self.token, p['title'], 'owner'); continue
            if p['kind'] != 'home' or protected.get(p['id']):
                skipped.append(p['title']); continue
            try: store.add(p['uuid'], self.plex.switch_home_user(self.token, p['id']), p['title'], 'home')
            except Exception: skipped.append(p['title'])
        if not store.profiles: return None
        if old: store.extra = dict(old.extra)
        ext.helper_store(self, store)
        self.helper_store, self.helper_skipped = store, skipped
        if self.helper_remember: store.save(self.helper_file)
        else: helpermod.Store.forget(self.helper_file)
        if self.helper: self.helper.store = store
        host = self.helper_address or ip
        return {'url': 'http://%s:%d' % (host, self.update.port or helpermod.HELPER_PORT), 'key': store.key}

    # ---------- installed helper (background service, service.py) ----------
    def service_ctx(self):
        if self._service_ctx is None: self._service_ctx = service.Ctx()
        return self._service_ctx

    def service_state(self):
        try:
            st = service.status(self.service_ctx(), self.helper_file)
        except Exception:                       # never break the page because of the system check
            return {'installed': False, 'running': False, 'background': False, 'os': service.platform_key(), 'error': True}
        return dict((k, st[k]) for k in ('os', 'installed', 'autostart', 'running', 'background', 'tray', 'trayPossible',
                                         'mode', 'port', 'log', 'program', 'settingsDir', 'sameVersion', 'name'))

    def helper_install(self, tray=True, lang=None):
        """Button "Helfer dauerhaft installieren": needs the remembered access file (made by "Create app package").
        lang: language of the page = language of the helper's name ("<Name> Helfer"/"<Name> Helper") in the system."""
        if not self.helper_store: raise StepError('no_helper')
        ctx = self.service_ctx()
        if lang in ('de', 'en') or self.lang: ctx.lang = lang if lang in ('de', 'en') else self.lang
        if not self.helper_remember:
            self.helper_remember = True
        hfile = self.helper_store.save(self.helper_file)
        if self.helper: self.helper_stop()                    # free the port for the background helper
        r = service.install(ctx, hfile, self.update.port if self.update.port else helpermod.HELPER_PORT, bool(tray))
        self.service_report = r.to_json()
        return self.service_report

    def helper_uninstall(self, keep_access=False):
        """Button "Helfer entfernen": autostart, program copy, its settings, access file, plex.tv device entry."""
        if not keep_access: self.helper_stop()
        r = service.uninstall(self.service_ctx(), keep_access=bool(keep_access), helper_file=self.helper_file or helpermod.store_path())
        if not keep_access:
            self.helper_store, self.helper_wanted = None, False
            self.package = None
        self.service_report = r.to_json()
        return self.service_report

    def helper_tray(self, on):
        try: service.set_tray(self.service_ctx(), bool(on))
        except service.ServiceError as e: raise StepError(e.code)

    def helper_bg(self, run):
        """Start/stop the installed helper now (autostart stays as it is)."""
        ctx = self.service_ctx()
        try:
            if run:
                if self.helper: self.helper_stop()
                service.start_now(ctx)
                service.wait_running(ctx, self.service_state()['port'], 8.0)
            else:
                service.stop_running(ctx)
        except service.ServiceError as e:
            raise StepError(e.code)

    def helper_start(self):
        if not self.helper_store: raise StepError('no_helper')
        if self.service_state().get('background'): raise StepError('helper_background')
        self.helper = helpermod.Helper(self.helper_store, 'plexneo-helper-' + self.client_id[-12:], fetch=self.helper_fetch)
        self.helper.update_on = '/update/app.js' in self.update.files
        if self.helper_remember: self.helper.store_path = self.helper_file
        if self.helper_store.allow: self.update.allow = set([self.helper_store.allow])
        self.update.api = self.helper
        try: self.update.start()
        except OSError:
            self.update.api = None
            raise StepError('port_busy', str(self.update.port))

    def helper_stop(self):
        self.update.api = None
        self.helper = None
        if not self.update.files: self.update.stop()

    def finish(self):
        """Setup done: stop the sync server and drop all setup tokens from memory (the TV has its copy). A running
        optional helper keeps its own plex.tv tokens of the chosen profiles (memory, or the 0600 file if remembered)."""
        self.sync_stop()
        self.reset()

    def shutdown(self):
        """Program ends (Ctrl+C or the "Quit" button): stop every server and forget all tokens in memory."""
        self.sync_stop()
        self.helper_stop()
        self.update.set_files({})
        self.update.stop()
        self.reset()

    # ---------- preferences ----------
    def set_prefs(self, lang=None, remember=None):
        if lang is not None:
            if lang not in ('de', 'en'): raise StepError('bad_input')
            self.lang = lang
        if remember is not None: self.remember = bool(remember)
        if self.remember:
            settings.save({'clientIdentifier': self.client_id, 'lang': self.lang, 'extras': self.extra_specs,
                           'tvAddress': self.tv_address}, self.settings_file)
        else:
            settings.forget(self.settings_file)

    # ---------- UI state (no tokens!) ----------
    def public_state(self):
        def ev(srv):
            return [{'t': int(t), 'client': c, 'path': p, 'status': s} for t, c, p, s in srv.events[-30:]]
        return {
            'clientId': self.client_id[:8] + '…',
            'lang': self.lang, 'remember': self.remember, 'tvAddress': self.tv_address,
            'pending': sorted(self.pins),
            'loggedIn': bool(self.token),
            'account': {'title': self.account['title'], 'thumb': self.account['thumb']} if self.account else None,
            'servers': [{'id': s['machineIdentifier'], 'name': s['name'], 'owned': s['owned'], 'lan': s['lan'],
                         'foreign': bool(s.get('foreign')), 'uris': s['uris'], 'version': s.get('version', '')}
                        for s in self.servers],
            'server': {'id': self.server['machineIdentifier'], 'name': self.server['name'], 'uri': self.uris[0]} if self.server else None,
            'profiles': [{'id': p['id'], 'title': p['title'], 'thumb': p['thumb'], 'kind': p['kind'], 'include': p['include'],
                          'hasToken': bool(p['token']), 'libraries': p.get('libraries'), 'restricted': p['restricted']}
                         for p in self.profiles],
            'extras': [{'id': a['id'], 'title': a['title'], 'file': a['file']} for a in self.extras],
            # other servers: names, status and profile titles only (no tokens, no addresses)
            'others': {'scanned': self.others_scanned, 'skipped': self.others_skipped,
                       'list': [{'id': e['machineIdentifier'], 'name': e['name'], 'status': e['status'], 'include': bool(e.get('include')),
                                 'profiles': e['profiles'], 'reachable': e.get('reachable', 0)} for e in self.others]},
            'extraSpecs': self.extra_specs,
            'package': self.build_info,
            'computer': self.computer_ip,
            'sync': {'running': self.sync.running, 'port': self.sync.port, 'lockedTo': self.sync.locked_to, 'events': ev(self.sync)},
            'update': {'running': self.update.running and bool(self.update.files), 'port': self.update.port, 'events': ev(self.update)},
            'helper': {'configured': bool(self.helper_store), 'wanted': self.helper_wanted, 'remember': self.helper_remember,
                       'address': self.helper_address, 'running': bool(self.update.running and self.update.api),
                       'port': self.update.port, 'profiles': self.helper_store.summary() if self.helper_store else [],
                       'skipped': self.helper_skipped, 'events': ev(self.update) if self.update.api else [],
                       'service': self.service_state(), 'report': self.service_report},
            'ext': ext.state(self),
        }
