"""Installed helper (service.py, background.py, tray.py): service files per OS, install/uninstall idempotency, removal
report, plex.tv device clean-up, CLI flags. Everything runs in temp folders with fakes – the real autostart (launchctl,
registry, systemctl) is never touched."""
import contextlib
import io
import json
import os
import plistlib
import posixpath
import shutil
import tempfile
import threading
import time
import unittest
from unittest import mock

import helpers as H
from neosetup import app, brand, service, tray
from neosetup import background as BG
from neosetup import helper as HP

KEY = 'k' * 24
OTHER_BRAND = {'name': 'Demo Neo', 'widgetId': 'DemoNeo', 'slug': 'demoneo', 'repo': 'demo-owner/demo-neo'}
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OWNER_TOK = 'ownerTok-1234567890'
KID_TOK = 'kidTok-1234567890ab'


class FakeSys(object):
    """Records every system call; answers like a healthy system unless told otherwise."""
    def __init__(self, rc=None):
        self.calls, self.spawned, self.killed = [], [], []
        self.rc = rc or {}                   # first word(s) of a command -> (rc, out)
        self.reg = {}
        self.links = {}                      # Startup shortcuts written through make_shortcut (Windows)
        self.running = False
        self.alive = set()

    def run(self, args, timeout=30):
        self.calls.append(list(args))
        for k, v in self.rc.items():
            if ' '.join(args).startswith(k): return v
        if args[:2] in (['launchctl', 'bootstrap'], ['schtasks', '/Run']) or args[:3] == ['systemctl', '--user', 'restart']: self.running = True
        if args[:2] == ['launchctl', 'bootout'] or args[:4] == ['systemctl', '--user', 'disable', '--now']: self.running = False
        return 0, ''

    def spawn(self, args):
        self.spawned.append(args if isinstance(args, str) else list(args))
        if not isinstance(args, str): self.running = True
        return 4242

    def kill(self, pid):
        self.killed.append(pid); self.alive.discard(pid); self.running = False
        return True

    def probe(self, port):
        return {'name': 'plex-neo-helper', 'background': True} if self.running else None

    def shortcut(self, ctx, path, args, icon, description):
        with open(path, 'w') as f: json.dump({'args': args, 'icon': icon, 'description': description}, f)
        self.links[path] = list(args)


def fake_pe(subsystem=3, pe32plus=True, tail=b'payload of the program'):
    """Smallest file with a real PE header (MZ stub, "PE\\0\\0", file header, optional header) - enough for pe_windowed."""
    import struct
    opt = bytearray(240 if pe32plus else 224)
    struct.pack_into('<H', opt, 0, 0x20b if pe32plus else 0x10b)
    struct.pack_into('<H', opt, 68, subsystem)
    mz = bytearray(0x40); mz[:2] = b'MZ'; struct.pack_into('<I', mz, 0x3C, 0x40)
    return bytes(mz) + b'PE\0\0' + bytes(20) + bytes(opt) + tail


def ref_checksum(b, at):
    """Reference: the word-by-word loop of the PE specification / CheckSumMappedFile."""
    import struct
    n = len(b)
    b = bytearray(b); b[at:at + 4] = bytes(4)
    if n % 2: b += b'\0'
    s = 0
    for i in range(0, len(b), 2):
        s += struct.unpack_from('<H', b, i)[0]
        s = (s & 0xffff) + (s >> 16)
    return s + n


class FakeReg(object):
    def __init__(self, store): self.d = store
    def get(self, n): return self.d.get(n)
    def set(self, n, v): self.d[n] = v
    def delete(self, n): return self.d.pop(n, None) is not None


class Base(unittest.TestCase):
    os_ = 'darwin'

    def setUp(self):
        brand.load(None, 'public')
        self.dir = tempfile.mkdtemp(prefix='neo-svc-')
        self.home = os.path.join(self.dir, 'home')
        os.makedirs(self.home)
        self.src = os.path.join(self.dir, 'Downloads', 'neolume-setup')
        os.makedirs(os.path.dirname(self.src))
        with open(self.src, 'wb') as f: f.write(fake_pe() if self.os_ == 'win32' else b'#!binary v1')
        self.sys = FakeSys()
        self.ctx = self.make_ctx()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def make_ctx(self, **kw):
        env = {'APPDATA': os.path.join(self.home, 'AppData', 'Roaming'), 'LOCALAPPDATA': os.path.join(self.home, 'AppData', 'Local')}
        c = service.Ctx(platform=kw.pop('platform', self.os_), home=self.home, env=env, run=self.sys.run, reg=FakeReg(self.sys.reg), spawn=self.sys.spawn,
                        kill=self.sys.kill, alive=lambda p: p in self.sys.alive, is_helper=lambda p, e: True, probe=self.sys.probe,
                        uid=501, user='alex', program={'kind': 'exe', 'src': self.src, 'python': None}, sleep=lambda s: None,
                        shortcut=self.sys.shortcut, session=kw.pop('session', lambda: 1),
                        fetch=kw.pop('fetch', lambda m, u, t: (200, b'<MediaContainer/>')), **kw)
        c.p = posixpath                      # real files in the temp folder, also for the "Windows" runs
        return c

    def setup_helper(self, ctx=None):
        ctx = ctx or self.ctx
        s = HP.Store(KEY); s.add('u-owner', OWNER_TOK, 'Owner', 'owner'); s.add('u-kid', KID_TOK, 'Kid', 'home')
        return s.save(ctx.file('helper.json'))

    def read(self, p):
        with open(p) as f: return f.read()

    def plist(self):
        with open(self.ctx.agent_plist(), 'rb') as f: return plistlib.loads(f.read())

    def codes(self, r):
        return [c for _, c, _ in r.items]


# ---------------------------------------------------------------- generated files
class Files(Base):
    def test_launch_agent_plist(self):
        args = service.command(self.ctx)
        d = plistlib.loads(service.launchd_plist(self.ctx, args))
        self.assertEqual(d['Label'], 'io.github.itsab1989.neolume.helper')
        app_exe = os.path.join(self.ctx.bin_dir(), 'Neolume Helper.app', 'Contents', 'MacOS', 'Neolume Helper')
        self.assertEqual(d['ProgramArguments'], [app_exe, '--helper', '--background'])
        self.assertEqual(d['AssociatedBundleIdentifiers'], ['io.github.itsab1989.neolume.helper'])
        self.assertTrue(d['RunAtLoad'])
        self.assertEqual(d['KeepAlive'], {'SuccessfulExit': False})      # "Quit helper" stays quit, a crash restarts
        self.assertEqual(d['LimitLoadToSessionType'], 'Aqua')
        self.assertEqual(d['StandardErrorPath'], self.ctx.file('helper.log'))
        self.assertNotIn('UserName', d)
        self.assertIn('/Library/Application Support/NeolumeSetup/bin/', d['ProgramArguments'][0])

    def test_launch_daemon_plist(self):
        d = plistlib.loads(service.launchd_plist(self.ctx, service.command(self.ctx, tray=False), daemon=True))
        self.assertEqual(d['UserName'], 'alex')
        self.assertNotIn('LimitLoadToSessionType', d)
        self.assertIn('--no-tray', d['ProgramArguments'])
        self.assertEqual(d['EnvironmentVariables']['HOME'], self.home)
        self.assertEqual(self.ctx.daemon_plist(), '/Library/LaunchDaemons/io.github.itsab1989.neolume.helper.plist')

    def test_systemd_unit(self):
        c = self.make_ctx(platform='linux')
        c.program = {'kind': 'exe', 'src': '/home/b/My Apps/neolume-setup-linux-x64', 'python': None}
        u = service.systemd_unit(c, ['/home/b/My Apps/x', '--helper', '--background', '--helper-file', '/d/100%.json'])
        self.assertIn('ExecStart="/home/b/My Apps/x" --helper --background --helper-file /d/100%%.json\n', u)
        for line in ('Restart=on-failure', 'WantedBy=default.target', 'Type=simple', 'NoNewPrivileges=true'): self.assertIn(line, u)
        self.assertTrue(c.unit_path().endswith('/.config/systemd/user/neolume-helper.service'))
        self.assertTrue(c.bin_dir().endswith('/.local/share/NeolumeSetup/bin'))

    def test_windows_command_and_paths(self):
        c = service.Ctx(platform='win32', home='C:\\Users\\Alex', env={'APPDATA': 'C:\\Users\\Alex\\AppData\\Roaming',
                        'LOCALAPPDATA': 'C:\\Users\\Alex\\AppData\\Local'}, reg=FakeReg({}),
                        program={'kind': 'exe', 'src': 'C:\\Users\\Alex\\Downloads\\neolume-setup-windows-x64.exe', 'python': None})
        self.assertEqual(c.bin_dir(), 'C:\\Users\\Alex\\AppData\\Local\\NeolumeSetup\\bin')
        self.assertEqual(c.settings_dir(), 'C:\\Users\\Alex\\AppData\\Roaming\\NeolumeSetup')
        args = service.command(c)
        helper = 'C:\\Users\\Alex\\AppData\\Local\\NeolumeSetup\\bin\\neolume-helper.exe'       # windowed copy: no window at login
        self.assertEqual(args[0], helper)
        self.assertEqual(service.windows_run_value(args), helper + ' --helper --background')
        self.assertTrue(service.no_console(c, helper))
        setup = service.setup_args(c, [helper.upper(), '--helper', '--background'])   # tray "open settings": console copy
        self.assertEqual(setup, ['C:\\Users\\Alex\\AppData\\Local\\NeolumeSetup\\bin\\neolume-setup.exe', '--helper', '--background'])
        self.assertFalse(service.no_console(c, setup[0]))
        self.assertEqual(service.setup_args(c, ['C:\\other.exe', '--x']), ['C:\\other.exe', '--x'])
        self.assertEqual(service.windows_run_value(['C:\\Program Files\\x.exe', '--helper']), '"C:\\Program Files\\x.exe" --helper')
        self.assertEqual(c.run_name(), 'Neolume Helper')
        c.program = {'kind': 'pyz', 'src': 'C:\\dl\\neolume-setup.pyz', 'python': 'C:\\Py\\python.exe'}
        self.assertEqual(service.installed_program(c), 'C:\\Users\\Alex\\AppData\\Local\\NeolumeSetup\\bin\\neolume-setup.pyz')
        with mock.patch('os.path.isfile', lambda p: p == 'C:\\Py\\pythonw.exe'):
            self.assertEqual(service.command(c)[0], 'C:\\Py\\pythonw.exe')         # no console window at login
            self.assertTrue(service.no_console(c, service.command(c)[0]))
        self.assertIsNone(service.helper_program(c))
        self.assertEqual(service.command(c)[0], 'C:\\Py\\python.exe')               # no pythonw.exe there: python.exe

    def test_command_variants(self):
        c = self.make_ctx()
        c.program = {'kind': 'pyz', 'src': '/dl/neolume-setup.pyz', 'python': '/usr/bin/python3'}
        self.assertEqual(service.command(c, 32500, '/x/h.json', tray=False)[:1], [service.bundle_exe(c)])   # Mac: through the app
        self.assertEqual(service.command(c, 32500, '/x/h.json', tray=False)[1:], ['--helper', '--background', '--no-tray', '--helper-file', '/x/h.json', '--update-port', '32500'])
        self.assertIn("exec '/usr/bin/python3' '%s' \"$@\"" % os.path.join(c.bin_dir(), 'neolume-setup.pyz'), service.bundle_launcher(c))
        lin = self.make_ctx(platform='linux')
        lin.program = c.program
        self.assertEqual(service.command(lin)[:2], ['/usr/bin/python3', os.path.join(lin.bin_dir(), 'neolume-setup.pyz')])
        c.program = {'kind': 'source', 'src': '/repo/installer/plexneo_setup.py', 'python': '/usr/bin/python3'}
        self.assertIn("'/repo/installer/plexneo_setup.py'", service.bundle_launcher(c))
        self.assertIsNone(service.installed_program(c))
        c.env['PLEXNEO_SETUP_DIR'] = '/portable'
        self.assertEqual(service.command(c)[-2:], ['--setup-dir', '/portable'])
        self.assertEqual(c.bin_dir(), '/portable/bin')

    def test_other_brand_label(self):
        brand.load_dict(OTHER_BRAND)
        try:
            self.assertEqual(self.ctx.label(), 'io.github.demo-owner.demoneo.helper')
            self.assertTrue(self.ctx.settings_dir().endswith('DemoNeoSetup'))
            self.assertEqual(self.ctx.run_name(), 'Demo Neo Helper')
        finally:
            brand.load(None, 'public')


# ---------------------------------------------------------------- install / uninstall
class MacInstall(Base):
    def test_needs_helper_first(self):
        r = service.install(self.ctx)
        self.assertEqual(self.codes(r), ['no_helper'])
        self.assertFalse(r.ok)
        self.assertFalse(os.path.exists(self.ctx.agent_plist()))
        self.assertFalse(os.path.exists(self.ctx.bin_dir()))

    def test_install_twice_then_remove_twice(self):
        self.setup_helper()
        for round_ in (1, 2):
            r = service.install(self.ctx)
            self.assertTrue(r.ok, r.text())
            self.assertEqual(self.codes(r)[-5:], ['bundle', 'agent', 'login_item', 'tray_on', 'started'])
            dst = os.path.join(self.ctx.bin_dir(), 'neolume-setup')
            with open(dst, 'rb') as f: self.assertEqual(f.read(), b'#!binary v1')
            self.assertEqual(os.stat(dst).st_mode & 0o777, 0o755)
            app_dir = os.path.join(self.ctx.bin_dir(), 'Neolume Helper.app')
            app_exe = os.path.join(app_dir, 'Contents', 'MacOS', 'Neolume Helper')
            with open(app_exe, 'rb') as f: self.assertEqual(f.read(), b'#!binary v1')      # the program itself runs in the app
            self.assertEqual(os.stat(app_exe).st_mode & 0o777, 0o755)
            info = plistlib.loads(open(os.path.join(app_dir, 'Contents', 'Info.plist'), 'rb').read())
            self.assertEqual((info['CFBundleName'], info['CFBundleExecutable'], info['CFBundleIdentifier']),
                             ('Neolume Helper', 'Neolume Helper', 'io.github.itsab1989.neolume.helper'))
            self.assertTrue(info['LSUIElement'])
            with open(os.path.join(app_dir, 'Contents', 'Resources', 'icon.icns'), 'rb') as f: self.assertEqual(f.read(4), b'icns')
            # nur die Installationssprache (hier en): die Anmeldeobjekte zeigen sonst einen anderen Namen als die Texte
            self.assertIn('"Neolume Helper"', self.read(os.path.join(app_dir, 'Contents', 'Resources', 'en.lproj', 'InfoPlist.strings')))
            self.assertFalse(os.path.exists(os.path.join(app_dir, 'Contents', 'Resources', 'de.lproj')))
            self.assertEqual(info['CFBundleLocalizations'], ['en'])
            self.assertIn(['codesign', '--force', '--sign', '-', '--identifier', 'io.github.itsab1989.neolume.helper', app_dir], self.sys.calls)
            d = self.plist()
            self.assertEqual(d['ProgramArguments'][0], app_exe)
            self.assertEqual(d['AssociatedBundleIdentifiers'], ['io.github.itsab1989.neolume.helper'])
            self.assertIn('“Neolume Helper”', r.text('en'))
            self.assertIn(['launchctl', 'bootstrap', 'gui/501', self.ctx.agent_plist()], self.sys.calls)
            prefs = service.load_prefs(self.ctx)
            self.assertTrue(prefs['tray'] and prefs['autostart'])
            self.assertEqual(prefs['mode'], 'agent')
            self.assertEqual(os.stat(self.ctx.file('helper-service.json')).st_mode & 0o777, 0o600)
        self.assertEqual(os.listdir(os.path.dirname(self.ctx.agent_plist())), [self.ctx.label() + '.plist'])
        st = service.status(self.ctx)
        self.assertTrue(st['installed'] and st['autostart'] and st['running'] and st['background'])
        with open(self.ctx.file('helper.log'), 'w') as f: f.write('log')
        r = service.uninstall(self.ctx)
        self.assertTrue(r.ok)
        self.assertEqual(self.codes(r), ['autostart_removed', 'program_removed', 'bundle_removed', 'prefs_removed', 'device_none', 'access_removed', 'folder_removed'])
        self.assertIn([service.LSREGISTER, '-u', os.path.join(self.ctx.bin_dir(), 'Neolume Helper.app')], self.sys.calls)
        self.assertIn(['launchctl', 'bootout', 'gui/501/' + self.ctx.label()], self.sys.calls)
        for p in (self.ctx.agent_plist(), self.ctx.bin_dir(), self.ctx.settings_dir()): self.assertFalse(os.path.exists(p), p)
        self.assertTrue(os.path.isfile(self.src))                    # the downloaded original is not ours to delete
        r2 = service.uninstall(self.ctx)
        self.assertEqual(r2.items, [])
        self.assertIn('nothing to do', r2.text('en'))

    def test_no_gui_session(self):
        self.setup_helper()
        self.sys.rc['launchctl bootstrap'] = (5, 'Bootstrap failed: 5: Input/output error')
        self.sys.rc['launchctl print'] = (113, 'Could not find domain for')
        self.sys.rc['launchctl kickstart'] = (113, 'Could not find service')
        r = service.install(self.ctx)
        self.assertTrue(r.ok)
        self.assertEqual(self.codes(r)[-5:], ['no_gui_session', 'started_direct', 'login_item', 'tray_on', 'started'])
        self.assertEqual(len([c for c in self.sys.calls if c[:2] == ['launchctl', 'bootstrap']]), 3)
        self.assertEqual(self.sys.spawned[-1][1:], ['--helper', '--background'])     # kickstart failed too -> plain process
        self.assertTrue(self.sys.spawned[-1][0].endswith('.app/Contents/MacOS/Neolume Helper'))
        self.assertIn('Automatically log in', r.text('en'))
        self.assertIn('alex', r.text('de'))

    def test_tray_off_and_toggle(self):
        self.setup_helper()
        r = service.install(self.ctx, tray=False)
        self.assertIn('tray_off', self.codes(r))
        self.assertIn('--no-tray', self.plist()['ProgramArguments'])
        service.set_tray(self.ctx, True)
        self.assertNotIn('--no-tray', self.plist()['ProgramArguments'])
        self.assertTrue(service.load_prefs(self.ctx)['tray'])
        service.set_tray(self.ctx, False)
        self.assertEqual(self.plist()['ProgramArguments'][1:], ['--helper', '--background', '--no-tray'])
        r = service.install(self.ctx)                                # re-install keeps the choice
        self.assertIn('tray_off', self.codes(r))

    def test_stops_running_helper_by_pid(self):
        self.setup_helper()
        service.install(self.ctx)
        service.write_pid(self.ctx, 777); self.sys.alive.add(777)
        r = service.uninstall(self.ctx)
        self.assertEqual(self.sys.killed, [777])
        self.assertIn('stopped', self.codes(r))
        self.assertFalse(os.path.exists(self.ctx.file('helper.pid')))

    def test_foreign_pid_is_not_killed(self):
        service.write_pid(self.ctx, 778); self.sys.alive.add(778)
        self.ctx.is_helper = lambda p, e: False
        self.assertIsNone(service.stop_running(self.ctx))
        self.assertEqual(self.sys.killed, [])

    def test_keep_access_and_other_files_stay(self):
        self.setup_helper()
        service.install(self.ctx)
        with open(self.ctx.file('settings.json'), 'w') as f: f.write('{}')
        r = service.uninstall(self.ctx, keep_access=True)
        self.assertEqual(r.action, 'autostart_off')
        self.assertIn('access_kept', self.codes(r))
        self.assertTrue(os.path.isfile(self.ctx.file('helper.json')))
        self.assertFalse(os.path.exists(self.ctx.agent_plist()))
        r = service.uninstall(self.ctx)
        self.assertIn('access_removed', self.codes(r))
        self.assertEqual(r.items[-1][1], 'folder_left')
        self.assertIn('settings.json', r.items[-1][2])
        self.assertTrue(os.path.isfile(self.ctx.file('settings.json')))       # the setup program's file is not the helper's

    def test_at_boot_rules(self):
        self.setup_helper()
        self.assertEqual(self.codes(service.install(self.ctx, at_boot=True)), ['at_boot_needs_sudo'])
        lin = self.make_ctx(platform='linux')
        self.setup_helper(lin)
        self.assertEqual(self.codes(service.install(lin, at_boot=True)), ['at_boot_mac_only'])

    def test_daemon_left_without_sudo(self):
        with mock.patch('os.path.isfile', side_effect=lambda p: p == self.ctx.daemon_plist()):
            r = Report = service.Report('uninstall')
            service.remove_autostart(self.ctx, r)
        self.assertEqual(self.codes(Report), ['daemon_needs_sudo'])
        self.assertIn('sudo', Report.text('en'))

    def test_self_removal_from_icon_menu(self):
        self.setup_helper()
        service.install(self.ctx)
        service.write_pid(self.ctx, os.getpid())
        del self.sys.calls[:]
        r = service.uninstall(self.ctx, self_pid=os.getpid())
        self.assertNotIn(['launchctl', 'bootout', 'gui/501/' + self.ctx.label()], self.sys.calls)   # would kill us mid-way
        self.assertTrue(any(a[0] == '/bin/sh' and 'launchctl bootout gui/501/' in a[2] for a in self.sys.spawned))
        self.assertEqual(self.sys.killed, [])
        self.assertIn('access_removed', self.codes(r))


class WinInstall(Base):
    os_ = 'win32'

    def test_install_and_remove(self):
        self.setup_helper()
        r = service.install(self.ctx)
        self.assertTrue(r.ok, r.text())
        self.assertIn('startup', self.codes(r))
        dst = os.path.join(self.home, 'AppData', 'Local', 'NeolumeSetup', 'bin', 'neolume-setup.exe')
        self.assertTrue(os.path.isfile(dst))
        link = os.path.join(self.home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Neolume Helper.lnk')
        helper = os.path.join(os.path.dirname(dst), 'neolume-helper.exe')
        with open(dst, 'rb') as f: self.assertEqual(service.pe_subsystem(f.read()), service.PE_CONSOLE)   # command line
        with open(helper, 'rb') as f: self.assertEqual(service.pe_subsystem(f.read()), service.PE_GUI)    # autostart
        # windowed: nothing to hide, so no second start (--detached); prefs keep the plain command (schtasks start)
        self.assertEqual(self.sys.links, {link: [helper, '--helper', '--background', '--detached']})
        self.assertEqual(service.load_prefs(self.ctx)['args'], [helper, '--helper', '--background'])
        with open(service.win_icon_path(self.ctx), 'rb') as f: self.assertEqual(f.read(4), b'\x00\x00\x01\x00')
        self.assertEqual(self.sys.spawned[-1], [helper, '--helper', '--background', '--detached'])
        self.assertEqual(self.sys.calls, [])                   # session with a desktop: no schtasks
        self.sys.reg['Neolume Helper'] = 'old Run entry of an older version'
        r = service.install(self.ctx)
        self.assertEqual([d for _, c, d in r.items if c == 'copied'], [dst])       # helper copy unchanged: not rewritten
        self.assertEqual(self.sys.reg, {})                      # replaced by the shortcut
        self.assertTrue(service.status(self.ctx)['autostart'])
        self.assertEqual(service.status(self.ctx)['name'], 'Neolume Helper')
        r = service.uninstall(self.ctx)
        self.assertFalse(os.path.exists(link))
        self.assertIn('autostart_removed', self.codes(r))
        self.assertFalse(os.path.exists(os.path.join(self.home, 'AppData', 'Local', 'NeolumeSetup')))
        self.assertFalse(os.path.exists(self.ctx.settings_dir()))
        self.assertEqual(service.uninstall(self.ctx).items, [])

    def test_self_removal_defers_exe_delete(self):
        self.setup_helper()
        service.install(self.ctx)
        service.write_pid(self.ctx, os.getpid(), wantTray=True, tray=True)
        with open(self.ctx.file('helper.log'), 'w') as f: f.write('log')
        real_rm = service._rm
        held = (service.helper_program(self.ctx), self.ctx.file('helper.log'))     # open while the helper runs
        with mock.patch.object(service, '_rm', lambda p: False if p in held else real_rm(p)):
            r = service.uninstall(self.ctx, self_pid=os.getpid())
        import base64
        ps = [a for a in self.sys.spawned if a[0] == 'powershell.exe']
        self.assertEqual(len(ps), 1)
        script = base64.b64decode(ps[0][-1]).decode('utf-16-le')
        self.assertTrue(script.startswith('Wait-Process -Id %d ' % os.getpid()))
        for p in held + (self.ctx.bin_dir(), self.ctx.settings_dir(), os.path.dirname(self.ctx.bin_dir())):
            self.assertIn("'%s'" % p, script)
        self.assertNotIn('-Recurse', script)                        # folders only when empty
        for c in ('program_removed', 'prefs_removed', 'access_removed', 'folder_removed', 'removed_after_exit'): self.assertIn(c, self.codes(r))
        self.assertFalse(os.path.exists(service.installed_program(self.ctx)))     # console copy: not running, gone now
        self.assertFalse(os.path.exists(self.ctx.file('helper.json')))


class PeWindowed(unittest.TestCase):
    def test_marks_console_program_windowed(self):
        import struct
        for plus in (True, False):
            b = fake_pe(pe32plus=plus, tail=b'odd length payload!')
            w = service.pe_windowed(b)
            self.assertEqual(service.pe_subsystem(b), service.PE_CONSOLE)
            self.assertEqual(service.pe_subsystem(w), service.PE_GUI)
            cs = service._pe_offsets(w)[0]
            self.assertEqual(struct.unpack_from('<I', w, cs)[0], ref_checksum(w, cs))
            self.assertEqual(len(w), len(b))
            self.assertEqual(sum(1 for x, y in zip(b, w) if x != y), 1 + sum(1 for x, y in zip(b[cs:cs + 4], w[cs:cs + 4]) if x != y))
            self.assertEqual(service.pe_windowed(w), w)                         # idempotent

    def test_checksum_matches_reference(self):
        import random
        rnd = random.Random(7)
        for n in (300, 301, 4097):
            b = fake_pe(tail=bytes(rnd.randrange(256) for _ in range(n)))
            cs = service._pe_offsets(b)[0]
            self.assertEqual(service.pe_checksum(b, cs), ref_checksum(b, cs))

    def test_rejects_other_files(self):
        for bad in (b'#!binary v1', b'MZ' + bytes(100), fake_pe(subsystem=9)):
            self.assertRaises(ValueError, service.pe_windowed, bad)


class LinuxInstall(Base):
    os_ = 'linux'

    def test_install_linger_and_remove(self):
        self.setup_helper()
        self.sys.rc['loginctl show-user'] = (0, 'Linger=no\n')
        r = service.install(self.ctx)
        self.assertTrue(r.ok, r.text())
        self.assertEqual(self.codes(r)[-4:], ['systemd', 'linger', 'tray_off', 'started'])
        self.assertIn(['systemctl', '--user', 'enable', 'neolume-helper.service'], self.sys.calls)
        self.assertIn('--no-tray', self.read(self.ctx.unit_path()))
        self.assertIn('loginctl enable-linger alex', r.text('en'))
        r = service.uninstall(self.ctx)
        self.assertIn(['systemctl', '--user', 'disable', '--now', 'neolume-helper.service'], self.sys.calls)
        self.assertFalse(os.path.exists(self.ctx.unit_path()))
        self.assertIn('folder_removed', self.codes(r))

    def test_systemctl_missing(self):
        self.setup_helper()
        self.sys.rc['systemctl --user daemon-reload'] = (1, 'Failed to connect to bus: No medium found')
        r = service.install(self.ctx)
        self.assertIn('systemctl_failed', self.codes(r))
        self.assertIn('No medium found', r.text('en'))


# ---------------------------------------------------------------- plex.tv device entry
class Devices(Base):
    def devices(self, xml, deleted, status=200):
        def fetch(method, url, token):
            if method == 'GET': return status, xml.encode()
            deleted.append((url, token)); return 200, b''
        return fetch

    def test_removes_only_the_helpers_own_entry(self):
        self.setup_helper()
        xml = ('<MediaContainer>'
               '<Device id="11" name="Neolume Helper" product="Neolume Helper" clientIdentifier="plexneo-helper-6b6b6b" token="helperTok-12345"/>'
               '<Device id="12" name="Neolume (TV)" product="Neolume" clientIdentifier="plexneo-abc" token="%s"/>'
               '<Device id="13" name="Shared" product="Neolume Helper" clientIdentifier="plexneo-helper-x" token="%s"/>'
               '</MediaContainer>') % (OWNER_TOK, OWNER_TOK)
        deleted = []
        self.ctx.fetch = self.devices(xml, deleted)
        r = service.uninstall(self.ctx)
        self.assertEqual(sorted(set(u for u, _ in deleted)), ['https://plex.tv/devices/11.xml'])
        self.assertIn('device_removed', self.codes(r))
        self.assertIn('device_shared', self.codes(r))
        text = r.text('de') + r.text('en') + json.dumps(r.to_json())
        for tok in (OWNER_TOK, KID_TOK, 'helperTok-12345', KEY): self.assertNotIn(tok, text)

    def test_network_error_gives_instructions(self):
        self.setup_helper()
        def fetch(m, u, t): raise service.ServiceError('network')
        self.ctx.fetch = fetch
        r = service.uninstall(self.ctx)
        self.assertIn('device_failed', self.codes(r))
        self.assertIn('Authorized Devices', r.text('en'))
        self.assertIn('Autorisierte Geräte', r.text('de'))
        self.assertIn('access_removed', self.codes(r))

    def test_fixed_urls_only(self):
        self.assertRaises(ValueError, service._plex_fetch, 'GET', 'https://evil.example/devices.xml', 'x')
        self.assertRaises(ValueError, service._plex_fetch, 'DELETE', 'https://plex.tv/devices.xml', 'x')
        self.assertRaises(ValueError, service._plex_fetch, 'DELETE', 'https://plex.tv/devices/1/../x.xml', 'x')


# ---------------------------------------------------------------- report + CLI
class ReportAndCli(Base):
    def test_report_json_has_both_languages(self):
        r = service.Report('install').add('done', 'copied', '/x').add('left', 'not_started', '/log')
        j = r.to_json()
        self.assertFalse(j['ok'] is False)
        self.assertEqual(j['lines']['de'][0], {'kind': 'done', 'text': 'Programmkopie angelegt: /x'})
        self.assertEqual(j['head']['en'], 'Install the helper permanently:')
        self.assertTrue(set(service.TEXTS['de']) == set(service.TEXTS['en']))

    def cli(self, *argv):
        out = io.StringIO()
        with mock.patch.object(service.Ctx, 'for_sudo_user', classmethod(lambda cls, **kw: self.ctx)), contextlib.redirect_stdout(out):
            rc = app.main(['--brand', 'public'] + list(argv))
        brand.load(None, 'public')
        return rc, out.getvalue()

    def test_cli_install_status_uninstall(self):
        rc, out = self.cli('--install-helper')
        self.assertEqual(rc, 1)
        self.assertIn('[x]', out)
        self.setup_helper()
        rc, out = self.cli('--install-helper', '--no-tray')
        self.assertEqual(rc, 0, out)
        self.assertIn('[ok]', out)
        self.assertIn('--no-tray', self.plist()['ProgramArguments'])
        rc, out = self.cli('--helper-status')
        self.assertEqual(rc, 0)
        self.assertEqual(len(out.strip().splitlines()), 7)
        self.assertIn('Neolume Helper (System Settings', out)
        rc, out = self.cli('--uninstall-helper', '--keep-access')
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.isfile(self.ctx.file('helper.json')))
        rc, out = self.cli('--uninstall-helper')
        self.assertEqual(rc, 0)
        self.assertFalse(os.path.exists(self.ctx.file('helper.json')))

    def test_cli_language(self):
        self.ctx.env['LANG'] = 'de_DE.UTF-8'
        self.assertEqual(service.cli_lang(self.ctx), 'de')
        self.ctx.env['LANG'] = 'C'
        self.assertEqual(service.cli_lang(self.ctx), 'en')
        os.makedirs(self.ctx.settings_dir(), exist_ok=True)
        with open(self.ctx.file('settings.json'), 'w') as f: json.dump({'lang': 'de'}, f)
        self.assertEqual(service.cli_lang(self.ctx), 'de')

    def test_flags_parse(self):
        with mock.patch.object(app, 'helper_cli', return_value=7) as hc:
            self.assertEqual(app.main(['--brand', 'public', '--uninstall-helper', '--keep-access']), 7)
            a = hc.call_args[0][0]
            self.assertTrue(a.uninstall_helper and a.keep_access and a.tray is None)
            app.main(['--brand', 'public', '--install-helper', '--at-boot', '--no-tray'])
            a = hc.call_args[0][0]
            self.assertTrue(a.install_helper and a.at_boot)
            self.assertIs(a.tray, False)
        brand.load(None, 'public')


# ---------------------------------------------------------------- icon + background runtime
class TrayParts(unittest.TestCase):
    def test_icons(self):
        p = tray.png(36)
        self.assertTrue(p.startswith(b'\x89PNG\r\n\x1a\n'))
        i = tray.ico((46, 196, 182))
        self.assertEqual(i[:6], b'\x00\x00\x01\x00\x02\x00')
        rows = tray.icon_pixels(16)
        self.assertEqual(len(rows), 16)
        self.assertTrue(any(r[3::4].count(255) for r in rows))

    def test_menu_model(self):
        st = {'paused': False, 'plex': None, 'tv': '', 'port': 32499}
        hit = threading.Event()
        t = BG.texts('de')
        m = tray.Model(t, lambda: st, {'pause': hit.set})
        items = m.items()
        self.assertEqual([i[0] for i in items], [None, None, None, '-', 'pause', 'open', 'about', '-', 'quit', 'remove'])
        self.assertEqual(items[0][1], 'Helfer läuft (Port 32499, nur Heimnetz)')
        self.assertEqual(items[1][1], 'plex.tv: wird geprüft …')
        self.assertEqual(items[8][1], 'Helfer beenden')
        self.assertEqual(items[9][1], 'Helfer entfernen …')
        m.click('pause'); self.assertTrue(hit.wait(2))
        st.update(paused=True, plex=False, tv='21:14')
        items = m.items()
        self.assertEqual(items[4][:2], ('resume', 'Fortsetzen'))
        self.assertIn('21:14', items[2][1])
        self.assertIn('pausiert', m.tooltip())
        self.assertEqual(set(BG.TEXTS['de']), set(BG.TEXTS['en']))
        self.assertIn('TLS 1.1', BG.texts('en')['about_text'])

    def test_no_tray_on_linux_or_when_disabled(self):
        with mock.patch.dict(os.environ, {'PLEXNEO_NO_TRAY': '1'}): self.assertFalse(tray.available())
        with mock.patch.object(tray.sys, 'platform', 'linux'), mock.patch.object(tray.os, 'name', 'posix'):
            self.assertFalse(tray.available())


class Background(Base):
    def test_reload_pause_resume_and_tv_seen(self):
        self.setup_helper()
        out = io.StringIO()
        bg = BG.Background(self.ctx, port=0, bind='127.0.0.1', out=out, plex_check=lambda: True)
        try:
            bg.load(); bg._start_server()
            self.assertTrue(bg.srv.running)
            self.assertTrue(bg.srv.api.background)
            port = bg.srv.port
            import urllib.request
            with urllib.request.urlopen('http://127.0.0.1:%d/neo-helper' % port, timeout=5) as r:
                self.assertTrue(json.loads(r.read())['background'])
            self.assertEqual(bg.tv_seen(), '')                   # loopback is not the TV
            bg.srv.event('192.168.1.50', '/watchlist', 200)
            self.assertRegex(bg.tv_seen(), r'^\d\d:\d\d$')
            s = HP.Store(KEY); s.add('u-owner', OWNER_TOK, 'Owner', 'owner'); s.save(self.ctx.file('helper.json'))
            os.utime(self.ctx.file('helper.json'), (time.time() + 5, time.time() + 5))
            bg.load()
            self.assertEqual(list(bg.srv.api.store.profiles), ['u-owner'])     # new setup picked up without restart
            bg.pause(); self.assertIsNone(bg.srv)
            self.assertTrue(bg.status()['paused'])
            bg.resume(); self.assertIsNotNone(bg.srv)
            os.remove(self.ctx.file('helper.json')); bg.load()
            self.assertIsNone(bg.srv)                            # access file gone: serve nothing
            log = out.getvalue()
            for secret in (OWNER_TOK, KID_TOK, KEY): self.assertNotIn(secret, log)
        finally:
            bg.shutdown()

    def test_maintain_checks_plex(self):
        self.setup_helper()
        bg = BG.Background(self.ctx, port=0, bind='127.0.0.1', out=io.StringIO(), plex_check=lambda: False)
        th = threading.Thread(target=bg.maintain, kwargs={'poll': 0.05}, daemon=True); th.start()
        try:
            for _ in range(100):
                if bg.srv and bg.plex is False: break
                time.sleep(0.05)
            self.assertFalse(bg.status()['plex'])
            self.assertTrue(bg.status()['running'])
        finally:
            bg.shutdown(); th.join(2)

    def test_icon_menu_actions(self):
        self.setup_helper()
        service.install(self.ctx)
        bg = BG.Background(self.ctx, port=0, bind='127.0.0.1', out=io.StringIO(), plex_check=lambda: True)
        acts = BG.actions(bg, self.ctx, BG.texts('en'), None)
        with mock.patch('neosetup.app.running_instance', return_value=None), mock.patch.object(BG.subprocess, 'Popen') as po:
            acts['open']()
            self.assertEqual(po.call_args[0][0], [service.bundle_exe(self.ctx), '--section', 'helper'])
        with mock.patch.object(tray, 'confirm', return_value=False):
            acts['remove']()
        self.assertTrue(os.path.isfile(self.ctx.file('helper.json')))           # "Cancel" removes nothing
        shown = []
        with mock.patch.object(tray, 'confirm', return_value=True), mock.patch.object(tray, 'message', lambda t, x: shown.append(x)):
            acts['remove']()
        self.assertTrue(bg.stop.is_set())
        self.assertFalse(os.path.exists(self.ctx.file('helper.json')))
        self.assertFalse(os.path.exists(self.ctx.agent_plist()))
        self.assertIn('Remove the helper:', shown[0])
        acts['quit']()
        self.assertEqual(bg.exit_code, 0)

    def test_strip_opts(self):
        self.assertEqual(BG._strip_opts(['x', '--helper-file', 'f', '--a', '--update-port', '1'], ('--helper-file', '--update-port')), ['x', '--a'])


# ---------------------------------------------------------------- setup page actions
class WizardService(Base):
    def test_install_and_remove_from_page(self):
        from neosetup.wizard import Wizard, StepError
        hfile = self.setup_helper()
        w = Wizard(H.base_entries, prefs={}, sync_port=0, update_port=0, helper_file=hfile, service_ctx=self.ctx,
                   settings_file=os.path.join(self.dir, 's.json'))
        try:
            st = w.public_state()['helper']
            self.assertTrue(st['configured'])
            self.assertFalse(st['service']['installed'])
            rep = w.helper_install(True)
            self.assertTrue(rep['ok'])
            sv = w.public_state()['helper']['service']
            self.assertTrue(sv['installed'] and sv['background'] and sv['tray'])
            self.assertRaises(StepError, w.helper_start)             # second helper on the same port: no
            w.helper_tray(False)
            self.assertFalse(w.public_state()['helper']['service']['tray'])
            service.write_pid(self.ctx, 991); self.sys.alive.add(991)
            w.helper_bg(False)
            self.assertEqual(self.sys.killed, [991])
            self.assertFalse(w.public_state()['helper']['service']['background'])
            rep = w.helper_uninstall(False)
            self.assertIn('access_removed', [i['code'] for i in rep['items']])
            st = w.public_state()['helper']
            self.assertFalse(st['configured'])
            self.assertEqual(st['report']['action'], 'uninstall')
            self.assertNotIn(OWNER_TOK, json.dumps(w.public_state()))
        finally:
            w.shutdown()


# ---------------------------------------------------------------- names per brand and language, takeover, console output
class NamesAndLanguage(Base):
    def test_both_brands_get_their_own_names(self):
        seen = {}
        try:
            # the public brand and a second one: brand/private.json where it exists, else a made-up profile
            other = os.path.join(ROOT, 'brand', 'private.json')
            for bid in ('public', 'other'):
                if bid == 'public': brand.load(ROOT, 'public')
                elif os.path.isfile(other): brand.load(ROOT, 'private')
                else: brand.load_dict(OTHER_BRAND)
                app_name = brand.name()
                if bid == 'public': self.assertEqual(app_name, 'Neolume')
                for lang, word in (('de', 'Helfer'), ('en', 'Helper')):
                    c = self.make_ctx(lang=lang)
                    w = self.make_ctx(platform='win32', lang=lang)
                    name = '%s %s' % (app_name, word)
                    info = plistlib.loads(service.info_plist(c))
                    plist = plistlib.loads(service.launchd_plist(c, service.command(c)))
                    self.assertEqual(info['CFBundleName'], name)
                    self.assertEqual(info['CFBundleDisplayName'], name)
                    self.assertTrue(info['CFBundleIdentifier'].endswith('.%s.helper' % brand.CURRENT['slug']))
                    self.assertEqual(plist['Label'], info['CFBundleIdentifier'])
                    self.assertEqual(plist['AssociatedBundleIdentifiers'], [info['CFBundleIdentifier']])
                    self.assertIn('/%s.app/Contents/MacOS/%s' % (name, name), plist['ProgramArguments'][0])
                    self.assertIn('/%sSetup/' % app_name.replace(' ', ''), plist['ProgramArguments'][0])
                    self.assertTrue(service.startup_link(w).endswith('/Startup/%s.lnk' % name))
                    self.assertEqual(w.run_name(), name)
                    self.assertIn(name, BG.texts(lang)['about_title'])
                    seen[(bid, lang)] = (info['CFBundleIdentifier'], plist['ProgramArguments'][0], service.startup_link(w))
            self.assertEqual(len(set(v[0] for v in seen.values())), 2)   # one id per brand, the same for both languages
            self.assertEqual(len(set(v[1] for v in seen.values())), 4)
            self.assertEqual(len(set(v[2] for v in seen.values())), 4)
        finally:
            brand.load(None, 'public')

    def test_german_install_then_english_replaces_bundle(self):
        self.setup_helper()
        de = self.make_ctx(lang='de')
        r = service.install(de)
        self.assertIn('Helfer-App „Neolume Helfer“ angelegt', r.text('de'))
        self.assertIn('Anmeldeobjekte & Erweiterungen als „Neolume Helfer“', r.text('de'))
        self.assertTrue(os.path.isdir(os.path.join(de.bin_dir(), 'Neolume Helfer.app')))
        self.assertEqual(service.status(de)['name'], 'Neolume Helfer')
        en = self.make_ctx(lang='en')
        service.install(en)
        self.assertEqual(sorted(os.listdir(en.bin_dir())), ['Neolume Helper.app', 'neolume-setup'])
        self.assertIn([service.LSREGISTER, '-u', os.path.join(en.bin_dir(), 'Neolume Helfer.app')], self.sys.calls)
        r = service.uninstall(de)                                         # removal finds it in any language
        self.assertIn('Helfer-App „Neolume Helper“ gelöscht.', r.text('de'))
        self.assertFalse(os.path.exists(en.bin_dir()))

    def test_infoplist_strings_escape(self):
        brand.load_dict({'name': 'My Neo', 'widgetId': 'MyNeo', 'slug': 'myneo'})
        try:
            self.assertEqual(service.infoplist_strings('de').decode('utf-8').splitlines()[0], '"CFBundleName" = "My Neo Helfer";')
        finally:
            brand.load(None, 'public')

    def test_cli_language_from_mac_system_settings(self):
        prefs = os.path.join(self.home, 'Library', 'Preferences')
        os.makedirs(prefs)
        with open(os.path.join(prefs, '.GlobalPreferences.plist'), 'wb') as f:
            plistlib.dump({'AppleLanguages': ['de-DE', 'en-US'], 'AppleLocale': 'de_DE'}, f, fmt=plistlib.FMT_BINARY)
        self.ctx.env['LANG'] = 'en_US.UTF-8'                            # SSH from an English computer
        self.assertEqual(service.cli_lang(self.ctx), 'de')
        lin = self.make_ctx(platform='linux')
        lin.env['LANG'] = 'C.UTF-8'; lin.env['LANGUAGE'] = 'de_DE:en'
        self.assertEqual(service.cli_lang(lin), 'de')                     # C locale says nothing, LANGUAGE does
        lin.env.pop('LANGUAGE')
        self.assertEqual(service.cli_lang(lin), 'en')
        os.makedirs(self.ctx.settings_dir(), exist_ok=True)
        with open(self.ctx.file('settings.json'), 'w') as f: json.dump({'lang': 'en'}, f)
        self.assertEqual(service.cli_lang(self.ctx), 'en')                # chosen on the setup page wins

    def test_cli_output_follows_language(self):
        self.setup_helper()
        self.ctx.lang = 'de'
        out = io.StringIO()
        a = mock.Mock(helper_status=False, install_helper=True, uninstall_helper=False, update_port=0, helper_file=None, tray=None, at_boot=False)
        app.helper_cli(a, self.ctx, out)
        self.assertIn('Helfer dauerhaft installieren:', out.getvalue())
        out = io.StringIO()
        a.install_helper, a.helper_status = False, True
        app.helper_cli(a, self.ctx, out)
        self.assertIn('Name im System:', out.getvalue())
        self.assertIn('Läuft:', out.getvalue())

    def test_every_cli_text_survives_old_code_pages(self):
        """Windows console over SSH (cp1252/cp850): no UnicodeEncodeError, readable ASCII for arrows and quotes."""
        for enc in ('cp1252', 'cp850', 'ascii'):
            raw = io.BytesIO()
            st = io.TextIOWrapper(raw, encoding=enc, errors='strict')
            with mock.patch.object(app.sys, 'stdout', st):
                app.safe_console(['stdout'])
                for lang, t in service.TEXTS.items():
                    for k, v in sorted(t.items()): print(v.replace('%s', 'x'))
                    for v in BG.texts(lang).values(): print(v.replace('%s', 'x'))
                print(app._icon_state({'trayPossible': True, 'tray': True, 'running': True, 'trayShown': False}, True))
                st.flush()
            text = raw.getvalue().decode(enc)
            self.assertIn('Systemeinstellungen -> Allgemein -> Anmeldeobjekte & Erweiterungen', text)
            self.assertTrue('"Allow in the Background"' in text or '“Allow in the Background”' in text, enc)   # cp1252 has “”
            if enc != 'ascii': self.assertIn('gelöscht', text)


class TakeOver(Base):
    def setUp(self):
        Base.setUp(self)
        os.makedirs(self.ctx.settings_dir())

    def test_headless_helper_gives_way_to_desktop_one(self):
        service.write_pid(self.ctx, 555, wantTray=True, tray=False); self.sys.alive.add(555); self.sys.running = True
        self.assertTrue(service.headless_instance(self.ctx))
        self.assertTrue(service.take_over(self.ctx, 32499))
        self.assertEqual(self.sys.killed, [555])
        self.assertFalse(os.path.exists(self.ctx.file('helper.pid')))

    def test_headless_helper_leaves_when_asked(self):
        self.setup_helper()
        bg = BG.Background(self.ctx, port=0, bind='127.0.0.1', out=io.StringIO(), plex_check=lambda: True)
        with open(self.ctx.file('helper.takeover'), 'w') as f: json.dump({'pid': os.getpid() + 1}, f)
        self.assertFalse(service.takeover_requested(self.ctx))                     # meant for another process
        with open(self.ctx.file('helper.takeover'), 'w') as f: json.dump({'pid': os.getpid()}, f)
        th = threading.Thread(target=bg.maintain, kwargs={'poll': 0.05}, daemon=True); th.start()
        th.join(3)
        self.assertTrue(bg.stop.is_set())
        self.assertEqual(bg.exit_code, 0)
        bg.shutdown()

    def test_helper_with_icon_or_without_wish_stays(self):
        for extra in ({'wantTray': True, 'tray': True}, {'wantTray': False, 'tray': False}, {'wantTray': True, 'tray': None}, {}):
            service.write_pid(self.ctx, 556, **extra); self.sys.alive.add(556); self.sys.running = True
            self.assertFalse(service.take_over(self.ctx, 32499), extra)
        self.assertEqual(self.sys.killed, [])

    def test_background_start_takes_over_only_with_a_desktop(self):
        self.setup_helper()
        calls = []
        hello = {'name': 'plex-neo-helper', 'background': True}
        with mock.patch.object(service, 'probe', return_value=hello), mock.patch.object(tray, 'available', return_value=True), \
                mock.patch.object(service, 'take_over', side_effect=lambda c, p: calls.append(p) or False):
            self.assertEqual(BG.run(port=32499, ctx=self.ctx, detached=True), 0)        # nothing to replace: ends
        self.assertEqual(calls, [32499])
        self.assertIn('already running', self.read(self.ctx.file('helper.log')))
        calls[:] = []
        with mock.patch.object(service, 'probe', return_value=hello), mock.patch.object(tray, 'available', return_value=False), \
                mock.patch.object(service, 'take_over', side_effect=lambda c, p: calls.append(p) or True):
            self.assertEqual(BG.run(port=32499, ctx=self.ctx, detached=True), 0)        # no desktop here: never replaces
        self.assertEqual(calls, [])

    def test_start_failure_is_logged(self):
        with mock.patch.object(BG, '_run', side_effect=UnicodeEncodeError('charmap', '→', 0, 1, 'x')):
            self.assertEqual(BG.run(ctx=self.ctx), 1)
        log = self.read(self.ctx.file('helper.log'))
        self.assertIn('start failed', log)
        self.assertIn('UnicodeEncodeError', log)

    def test_status_shows_headless(self):
        self.setup_helper()
        service.install(self.ctx)
        service.write_pid(self.ctx, 557, wantTray=True, tray=False)
        st = service.status(self.ctx)
        self.assertIs(st['trayShown'], False)
        self.assertIn('without a desktop', app._icon_state(st, False))
        self.assertIn('ohne Desktop', app._icon_state(st, True))
        service.write_pid(self.ctx, 557, wantTray=True, tray=True)
        self.assertEqual(app._icon_state(service.status(self.ctx), True), 'an, sichtbar')


class WinSessionZero(Base):
    os_ = 'win32'

    def test_ssh_install_starts_in_desktop_session(self):
        self.setup_helper()
        c = self.make_ctx(session=lambda: 0)
        r = service.install(c)
        self.assertTrue(r.ok, r.text())
        tasks = [x for x in self.sys.calls if x[0] == 'schtasks']
        self.assertEqual([x[1] for x in tasks], ['/Create', '/Run', '/Delete'])
        self.assertIn('/IT', tasks[0])
        self.assertEqual(self.sys.spawned, [])                  # started by the task, not as a session-0 process

    def test_no_desktop_login_falls_back_and_says_so(self):
        self.setup_helper()
        c = self.make_ctx(session=lambda: 0)
        self.sys.rc['schtasks /Create'] = (1, 'ERROR: Access is denied.')
        orig = self.sys.spawn
        def spawn(args):
            service.write_pid(c, 4242, wantTray=True, tray=False)
            return orig(args)
        c.spawn = spawn
        r = service.install(c)
        self.assertIn('headless_started', self.codes(r))
        self.assertIn('next login', r.text('en'))


class Hardening(Base):
    """Pre-release review 1.0.5: quoting and file handling of the installed helper."""
    def test_powershell_quote_handles_typographic_apostrophes(self):
        # PowerShell also ends '...' at ‘ ’ ‚ ‛ – a user folder like C:\Users\D’Angelo must stay ONE literal
        for ch in ("'", '\u2018', '\u2019', '\u201a', '\u201b'):
            q = service._ps_quote('C:\\Users\\D%sAngelo\\x' % ch)
            self.assertEqual(q, "'C:\\Users\\D%s%sAngelo\\x'" % (ch, ch))
        s = service.delete_after_exit_script(7, ['C:\\Users\\D\u2019Angelo\\a.exe'], [])
        self.assertIn("'C:\\Users\\D\u2019\u2019Angelo\\a.exe'", s)

    def test_systemd_quote_escapes_variables_and_specifiers(self):
        self.assertEqual(service._systemd_quote('/home/a$HOME/x%n'), '"/home/a$$HOME/x%%n"')

    def test_write_never_follows_a_planted_temp_file(self):
        target = os.path.join(self.dir, 'victim.txt')
        with open(target, 'w') as f: f.write('keep')
        path = self.ctx.file('helper.pid')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        os.symlink(target, path + '.tmp')
        service._write(self.ctx, path, b'{"pid": 1}', 0o600)
        self.assertEqual(self.read(target), 'keep')
        self.assertEqual(self.read(path), '{"pid": 1}')
        self.assertFalse(os.path.islink(path))
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)

    def test_token_file_never_written_through_planted_temp_file(self):
        target = os.path.join(self.dir, 'victim.txt')
        with open(target, 'w') as f: f.write('keep')
        path = self.ctx.file('helper.json')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        os.symlink(target, path + '.tmp')
        s = HP.Store(KEY); s.add('u-owner', OWNER_TOK, 'Owner', 'owner'); s.save(path)
        self.assertEqual(self.read(target), 'keep')
        self.assertNotIn(OWNER_TOK, self.read(target))
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)

    def test_uninstall_keeps_a_wrong_helper_file(self):
        other = os.path.join(self.dir, 'notes.txt')
        with open(other, 'w') as f: f.write('my notes')
        r = service.uninstall(self.ctx, helper_file=other)
        self.assertTrue(os.path.isfile(other))
        self.assertNotIn('access_removed', self.codes(r))


if __name__ == '__main__':
    unittest.main()


class ProbeBrandTest(unittest.TestCase):
    """VM-Test 28.10.: Helfer einer ANDEREN Ausgabe auf dem Port zaehlt nicht als eigener (sonst "laeuft: ja" falsch)."""
    def _probe(self, answer):
        import http.server, threading, json as _json
        body = _json.dumps(answer).encode()
        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
            def log_message(self, *a): pass
        srv = http.server.HTTPServer(('127.0.0.1', 0), H)
        t = threading.Thread(target=srv.handle_request); t.start()
        try: return service.probe(srv.server_address[1])
        finally: t.join(); srv.server_close()

    def test_own_other_and_old(self):
        from neosetup import brand
        own = brand.CURRENT.get('slug')
        self.assertIsNotNone(self._probe({'name': 'plex-neo-helper', 'brand': own}))
        self.assertIsNone(self._probe({'name': 'plex-neo-helper', 'brand': own + '-other'}))
        self.assertIsNotNone(self._probe({'name': 'plex-neo-helper'}))          # aeltere Helfer ohne Marke: wie bisher
        self.assertIsNone(self._probe({'name': 'something-else'}))
