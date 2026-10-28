"""Install the optional helper permanently ("Helfer dauerhaft installieren") and remove it again ("Helfer entfernen").

What "installed" means on each system (docs/research/helper-service.md):
- macOS:   a copy of this program in ~/Library/Application Support/<Name>Setup/bin + a LaunchAgent
           (~/Library/LaunchAgents/<label>.plist) -> starts when the user logs in, menu bar icon possible.
           The LaunchAgent starts "<Name> Helfer.app"/"<Name> Helper.app" (a tiny app bundle in bin/, see build_bundle),
           so that macOS shows the helper under that name and icon in System Settings -> General -> Login Items &
           Extensions and in its "background item added" notice - not as "python3" or as a bare file name.
           Optional `--at-boot` (sudo): LaunchDaemon in /Library/LaunchDaemons that runs as the user without a login
           (no icon).
- Windows: a copy in %LOCALAPPDATA%\\<Name>Setup\\bin + a per-user autostart entry (shortcut "<Name> Helfer" in the
           Startup folder, no admin rights; visible and switchable in Task Manager -> Startup apps). No window at login:
           the .pyz runs with pythonw.exe, the .exe through a second copy "<slug>-helper.exe" that Windows starts as a
           windowed program (see helper_program / pe_windowed).
- Linux:   a copy in ~/.local/share/<Name>Setup/bin + a systemd user unit (~/.config/systemd/user/<slug>-helper.service);
           `loginctl enable-linger` makes it run without a login.

Everything that touches the real system (commands, registry, processes, plex.tv) goes through `Ctx`, so the tests run
with temp folders and fakes and never change the real autostart. Python 3 standard library only.
"""
import array
import json
import ntpath
import os
import plistlib
import posixpath
import re
import shutil
import signal
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

from . import VERSION, brand

DEFAULT_PORT = 32499
PREFS_KIND = 'plexneo-helper-service'
RUN_KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'
WIN_CREATE_NO_WINDOW = 0x08000000
WIN_NEW_GROUP = 0x00000200
WIN_BREAKAWAY = 0x01000000


def platform_key(p=None):
    p = p or sys.platform
    return 'mac' if p == 'darwin' else 'win' if p.startswith('win') else 'linux'


class ServiceError(Exception):
    def __init__(self, code, detail=''):
        Exception.__init__(self, code)
        self.code, self.detail = code, detail


# ---------------------------------------------------------------- system access (replaced by fakes in tests)
def _run(args, timeout=30):
    """-> (returncode, output). Never raises for a missing command (returncode 127)."""
    try:
        p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout,
                           stdin=subprocess.DEVNULL, **_no_window())
        return p.returncode, p.stdout.decode('utf-8', 'replace')
    except (OSError, subprocess.SubprocessError) as e:
        return 127, str(e)


def _no_window():
    return {'creationflags': WIN_CREATE_NO_WINDOW} if os.name == 'nt' else {}


def spawn_detached(args):
    """Start the background helper without a window and without tying it to this process."""
    kw = {'stdin': subprocess.DEVNULL, 'stdout': subprocess.DEVNULL, 'stderr': subprocess.DEVNULL, 'close_fds': True}
    if os.name == 'nt':
        for flags in (WIN_CREATE_NO_WINDOW | WIN_NEW_GROUP | WIN_BREAKAWAY, WIN_CREATE_NO_WINDOW | WIN_NEW_GROUP):
            try: return subprocess.Popen(args, creationflags=flags, **kw).pid
            except OSError:
                if not flags & WIN_BREAKAWAY: raise          # breakaway not allowed in this job -> without it
    return subprocess.Popen(args, start_new_session=True, **kw).pid


class WinReg(object):
    """HKCU Run key via winreg (only imported on Windows)."""
    def get(self, name):
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k: return winreg.QueryValueEx(k, name)[0]
        except OSError:
            return None

    def set(self, name, value):
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k: winreg.SetValueEx(k, name, 0, winreg.REG_SZ, value)

    def delete(self, name):
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k: winreg.DeleteValue(k, name)
            return True
        except OSError:
            return False


def _session_id():
    """Windows session of this process (0 = no desktop, e.g. SSH); None elsewhere."""
    if os.name != 'nt': return None
    from .tray import win_session_id
    return win_session_id()


def pid_alive(pid):
    if not isinstance(pid, int) or pid <= 0: return False
    if os.name == 'nt':
        rc, out = _run(['tasklist', '/FI', 'PID eq %d' % pid, '/FO', 'CSV', '/NH'])
        return rc == 0 and ('"%d"' % pid) in out
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def pid_is_helper(pid, exe):
    """Is this pid really our background helper (protects against a reused pid)?"""
    if os.name == 'nt':
        rc, out = _run(['tasklist', '/FI', 'PID eq %d' % pid, '/FO', 'CSV', '/NH'])
        name = os.path.basename(exe or '').lower()
        return rc == 0 and bool(name) and ('"%s"' % name) in out.lower()
    rc, out = _run(['ps', '-p', str(pid), '-o', 'command='])
    return rc == 0 and '--helper' in out


def kill_pid(pid):
    try:
        os.kill(pid, signal.SIGTERM)                        # Windows: TerminateProcess
        return True
    except OSError:
        return False


def probe(port, timeout=1.5):
    """Answer of a helper on this computer (GET /neo-helper on loopback) or None."""
    import http.client
    try:
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
        c.request('GET', '/neo-helper', headers={'Host': '127.0.0.1:%d' % port})
        r = c.getresponse()
        body = r.read(4096)
        c.close()
        d = json.loads(body.decode('utf-8')) if r.status == 200 else None
        if not isinstance(d, dict) or d.get('name') != 'plex-neo-helper': return None
        # helper of ANOTHER edition (two editions installed on one computer) on this port: not ours ("port_other");
        # older helpers announce no brand -> treated as ours (upgrade path stops them via the pid file)
        if d.get('brand') and d.get('brand') != brand.CURRENT.get('slug'): return None
        return d
    except (OSError, ValueError, http.client.HTTPException):
        return None


class Ctx(object):
    """Platform, folders and system calls. Tests pass platform/home/env and fakes for run/reg/spawn/kill/probe/fetch."""
    def __init__(self, platform=None, home=None, env=None, run=None, reg=None, spawn=None, kill=None, alive=None,
                 is_helper=None, probe=None, fetch=None, uid=None, user=None, program=None, sleep=time.sleep, root=None,
                 lang=None, session=None, shortcut=None):
        self.os = platform_key(platform)
        self.p = ntpath if self.os == 'win' else posixpath
        self.env = dict(os.environ if env is None else env)
        self.home = home or os.path.expanduser('~')
        self.run = run or _run
        self.reg = reg or (WinReg() if self.os == 'win' else None)
        self.spawn = spawn or spawn_detached
        self.kill = kill or kill_pid
        self.alive = alive or pid_alive
        self.is_helper = is_helper or pid_is_helper
        self.probe = probe or (lambda port: globals()['probe'](port))
        self.fetch = fetch
        self.uid = uid if uid is not None else (os.getuid() if hasattr(os, 'getuid') else 0)
        self.user = user or self.env.get('USER') or self.env.get('USERNAME') or ''
        self.program = program or this_program()       # what to copy: see this_program()
        self.sleep = sleep
        self.root = root if root is not None else (self.uid == 0 and self.os != 'win')
        self.lang = lang if lang in TEXTS else None    # None = cli_lang(): settings.json, then the system language
        self.session = session or _session_id
        self.shortcut = shortcut                      # tests: fake for make_shortcut

    def ui_lang(self):
        if not self.lang: self.lang = cli_lang(self)
        return self.lang

    @classmethod
    def for_sudo_user(cls, **kw):
        """`sudo ... --install-helper --at-boot`: folders of the user who called sudo, not of root."""
        name = os.environ.get('SUDO_USER')
        if not name or not hasattr(os, 'getuid') or os.getuid() != 0: return cls(**kw)
        import pwd
        pw = pwd.getpwnam(name)
        env = dict(os.environ, HOME=pw.pw_dir, USER=name)
        env.pop('XDG_CONFIG_HOME', None); env.pop('XDG_DATA_HOME', None)
        c = cls(home=pw.pw_dir, env=env, uid=pw.pw_uid, user=name, **kw)
        c.root, c.gid = True, pw.pw_gid
        return c

    # ---- folders (same rules as settings.settings_dir, but for this ctx) ----
    def name(self):
        return brand.name().replace(' ', '') + 'Setup'

    def settings_dir(self):
        o = self.env.get('PLEXNEO_SETUP_DIR')
        if o: return o
        if self.os == 'mac': return self.p.join(self.home, 'Library', 'Application Support', self.name())
        if self.os == 'win': return self.p.join(self.env.get('APPDATA') or self.p.join(self.home, 'AppData', 'Roaming'), self.name())
        return self.p.join(self.env.get('XDG_CONFIG_HOME') or self.p.join(self.home, '.config'), self.name())

    def bin_dir(self):
        if self.env.get('PLEXNEO_SETUP_DIR') or self.os == 'mac': return self.p.join(self.settings_dir(), 'bin')
        if self.os == 'win': return self.p.join(self.env.get('LOCALAPPDATA') or self.p.join(self.home, 'AppData', 'Local'), self.name(), 'bin')
        return self.p.join(self.env.get('XDG_DATA_HOME') or self.p.join(self.home, '.local', 'share'), self.name(), 'bin')

    def file(self, name):
        return self.p.join(self.settings_dir(), name)

    def label(self):
        owner = re.sub(r'[^a-z0-9-]', '', (brand.CURRENT.get('repo') or 'local/x').split('/')[0].lower()) or 'local'
        return 'io.github.%s.%s.helper' % (owner, brand.CURRENT['slug'])

    def agent_plist(self):
        return self.p.join(self.home, 'Library', 'LaunchAgents', self.label() + '.plist')

    def daemon_plist(self):
        return '/Library/LaunchDaemons/' + self.label() + '.plist'

    def unit_name(self):
        return brand.CURRENT['slug'] + '-helper.service'

    def unit_path(self):
        return self.p.join(self.env.get('XDG_CONFIG_HOME') or self.p.join(self.home, '.config'), 'systemd', 'user', self.unit_name())

    def run_name(self):
        """Name of the Windows autostart entry, in the language of this install ("<Name> Helfer" / "<Name> Helper")."""
        return helper_name(self.ui_lang())

    def bundle_id(self):
        """Bundle identifier of the macOS helper app = launchd label (per brand: io.github.<owner>.<slug>.helper)."""
        return self.label()


def helper_name(lang='en'):
    """The helper's name everywhere the system shows it: brand name + "Helfer"/"Helper" (brand/*.json "name")."""
    return brand.name() + (' Helfer' if lang == 'de' else ' Helper')


def helper_names():
    return [helper_name(l) for l in ('de', 'en')]


def this_program():
    """{'kind': 'exe'|'pyz'|'source', 'src': path to copy (or the script), 'python': interpreter or None}."""
    if getattr(sys, 'frozen', False):
        return {'kind': 'exe', 'src': os.path.abspath(sys.executable), 'python': None}
    here = os.path.abspath(__file__)
    m = re.match(r'^(.*?\.pyz)[\\/]', here)
    if m: return {'kind': 'pyz', 'src': m.group(1), 'python': os.path.abspath(sys.executable)}
    return {'kind': 'source', 'src': os.path.join(os.path.dirname(os.path.dirname(here)), 'plexneo_setup.py'),
            'python': os.path.abspath(sys.executable)}


# ---------------------------------------------------------------- what gets written (pure, unit-tested)
def installed_program(ctx):
    """Path of the copy in bin/ (None for a source checkout, which runs where it is)."""
    pg = ctx.program
    if pg['kind'] == 'source': return None
    ext = '.pyz' if pg['kind'] == 'pyz' else '.exe' if ctx.os == 'win' else ''   # a .pyz keeps .pyz (a zip, not an .exe)
    return ctx.p.join(ctx.bin_dir(), brand.CURRENT['slug'] + '-setup' + ext)


def helper_program(ctx):
    """Windows .exe: the copy in bin/ that the autostart and the tray start - "<slug>-helper.exe", the same program marked
    as a windowed program (pe_windowed). The setup program is a console program; started at login it would open a console
    window (and a taskbar button) for a moment. The console copy "<slug>-setup.exe" stays for the command line and for
    "open settings" in the tray menu. None for the .pyz/source (pythonw.exe, see python_for_autostart) and other systems."""
    if ctx.os != 'win' or ctx.program['kind'] != 'exe': return None
    return ctx.p.join(ctx.bin_dir(), brand.CURRENT['slug'] + '-helper.exe')


def setup_args(ctx, args):
    """Command of the setup program from the helper's command (tray menu "open settings"): the console copy instead of
    the windowed helper copy, so its window with the address and the log shows up as before."""
    hp = helper_program(ctx)
    if hp and args and ctx.p.normcase(args[0]) == ctx.p.normcase(hp): return [installed_program(ctx)] + list(args[1:])
    return list(args)


# PE header fields (Microsoft PE/COFF specification): e_lfanew at 0x3C, then "PE\0\0" + 20-byte file header + optional header;
# in the optional header (PE32 and PE32+ alike) CheckSum is at +64 and Subsystem at +68 (2 = Windows GUI, 3 = console).
PE_GUI, PE_CONSOLE = 2, 3


def _pe_offsets(b):
    if len(b) < 0x40 or b[:2] != b'MZ': raise ValueError('not a Windows program')
    pe = struct.unpack_from('<I', b, 0x3C)[0]
    if pe + 24 + 70 > len(b) or b[pe:pe + 4] != b'PE\0\0': raise ValueError('not a Windows program')
    opt = pe + 24
    if struct.unpack_from('<H', b, opt)[0] not in (0x10b, 0x20b): raise ValueError('unknown PE optional header')
    return opt + 64, opt + 68


def pe_checksum(b, at):
    """PE image checksum (as CheckSumMappedFile / PyInstaller compute it): 16-bit word sum with end-around carry, the
    CheckSum field itself counted as 0, plus the file length."""
    a = array.array('H')
    a.frombytes(bytes(b) + (b'\0' if len(b) % 2 else b''))
    if sys.byteorder == 'big': a.byteswap()
    s = sum(a) - a[at // 2] - a[at // 2 + 1]
    while s >> 16: s = (s & 0xffff) + (s >> 16)
    return s + len(b)


def pe_subsystem(b):
    return struct.unpack_from('<H', b, _pe_offsets(b)[1])[0]


def pe_windowed(data):
    """The same Windows program, marked as a windowed (GUI) program: Windows then gives it no console window - no
    window and no taskbar button when the autostart starts the helper. Only this one header field (plus the header
    checksum) changes; the program code, its icon and its version information (name in Task Manager) stay the same.
    Without a console Python has sys.stdout = None, like with pythonw.exe; the helper writes into helper.log anyway."""
    b = bytearray(data)
    csum, sub = _pe_offsets(b)
    if struct.unpack_from('<H', b, sub)[0] not in (PE_GUI, PE_CONSOLE): raise ValueError('unexpected PE subsystem')
    struct.pack_into('<H', b, sub, PE_GUI)
    struct.pack_into('<I', b, csum, pe_checksum(b, csum))
    return bytes(b)


def no_console(ctx, program):
    """Does Windows start this autostart target without a console window (windowed helper copy, pythonw.exe)?"""
    base = ctx.p.basename(program or '').lower()
    hp = helper_program(ctx)
    return base == 'pythonw.exe' or bool(hp) and base == ctx.p.basename(hp).lower()


def python_for_autostart(ctx, python):
    """Windows: pythonw.exe next to python.exe - the same Python without a console window at every login."""
    if ctx.os == 'win' and python:
        d, b = ctx.p.split(python)
        if b.lower() == 'python.exe':
            w = ctx.p.join(d, 'pythonw.exe')
            if os.path.isfile(w): return w
    return python


def command(ctx, port=DEFAULT_PORT, helper_file=None, tray=True):
    pg = ctx.program
    target = installed_program(ctx) or pg['src']
    if ctx.os == 'mac':                                  # the launcher inside "<Name> Helper.app" (see build_bundle)
        args = [bundle_exe(ctx)]
    elif pg['kind'] != 'exe':
        args = [python_for_autostart(ctx, pg['python']), target]
    else:
        args = [helper_program(ctx) or target]
    args += ['--helper', '--background']
    if not tray: args.append('--no-tray')
    if helper_file: args += ['--helper-file', helper_file]
    if ctx.env.get('PLEXNEO_SETUP_DIR'): args += ['--setup-dir', ctx.env['PLEXNEO_SETUP_DIR']]
    if port != DEFAULT_PORT: args += ['--update-port', str(int(port))]
    return args


def launchd_plist(ctx, args, daemon=False):
    d = {'Label': ctx.label(), 'ProgramArguments': list(args), 'RunAtLoad': True,
         # exit code 0 ("Quit helper" in the menu, SIGTERM from "remove") = stay stopped; a crash = start again
         'KeepAlive': {'SuccessfulExit': False}, 'ThrottleInterval': 30,
         'StandardOutPath': ctx.file('helper.log'), 'StandardErrorPath': ctx.file('helper.log'),
         'EnvironmentVariables': {'HOME': ctx.home}, 'WorkingDirectory': ctx.home}
    if ctx.os == 'mac' and args and '.app/Contents/MacOS/' in args[0]:
        # macOS 13+: list this background item under the helper app's name and icon in Login Items
        d['AssociatedBundleIdentifiers'] = [ctx.bundle_id()]
    if daemon:
        d['UserName'] = ctx.user
        d['ProcessType'] = 'Background'
    else:
        d['ProcessType'] = 'Interactive'          # menu bar icon: no App Nap / background throttling
        d['LimitLoadToSessionType'] = 'Aqua'
    return plistlib.dumps(d)


# ---------------------------------------------------------------- macOS: "<Name> Helfer.app" (pure parts unit-tested)
# Without an app bundle macOS names a LaunchAgent after its executable: "python3" for the .pyz, the bare file name for the
# program file. With ProgramArguments[0] inside a bundle plus AssociatedBundleIdentifiers it shows the bundle's name and
# icon instead (System Settings -> General -> Login Items & Extensions, and the "background item added" notice). The
# bundle is tiny: Info.plist, icon and as executable either the program copy itself (PyInstaller file: then the menu bar
# icon belongs to the app too) or a two-line shell script that starts the .pyz with python3.
LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'


def bundle_path(ctx, lang=None):
    return ctx.p.join(ctx.bin_dir(), helper_name(lang or ctx.ui_lang()) + '.app')


def bundle_exe(ctx, lang=None):
    """The executable inside the bundle carries the helper's name too (Activity Monitor, `ps`)."""
    return ctx.p.join(bundle_path(ctx, lang), 'Contents', 'MacOS', helper_name(lang or ctx.ui_lang()))


def bundle_paths(ctx):
    """Every bundle a previous install may have left (both languages, plus the one in the saved preferences)."""
    out = [ctx.p.join(ctx.bin_dir(), n + '.app') for n in helper_names()]
    prefs = load_prefs(ctx)
    b = prefs.get('bundle') if prefs else ''
    if b and b.endswith('.app') and ctx.p.dirname(b) == ctx.bin_dir() and b not in out: out.append(b)
    return out


def info_plist(ctx, lang=None):
    lang = lang or ctx.ui_lang()
    name = helper_name(lang)
    return plistlib.dumps({
        'CFBundleName': name, 'CFBundleDisplayName': name, 'CFBundleIdentifier': ctx.bundle_id(),
        'CFBundleExecutable': name, 'CFBundleIconFile': 'icon', 'CFBundlePackageType': 'APPL',
        'CFBundleInfoDictionaryVersion': '6.0', 'CFBundleShortVersionString': VERSION, 'CFBundleVersion': VERSION,
        'CFBundleDevelopmentRegion': lang, 'CFBundleLocalizations': [lang],   # one name only: the install language
        'CFBundleGetInfoString': TEXTS[lang]['bundle_about'] % brand.name(),
        'LSUIElement': True,                     # no Dock icon, no app menu: only the optional menu bar icon
        'LSMinimumSystemVersion': '10.13', 'NSHighResolutionCapable': True,
    })


def infoplist_strings(lang):
    """<lang>.lproj/InfoPlist.strings: Finder & co. show the name in the language of the Mac."""
    n = json.dumps(helper_name(lang), ensure_ascii=False)          # "..." with \ and " escaped, same rules as .strings
    return ('"CFBundleName" = %s;\n"CFBundleDisplayName" = %s;\n' % (n, n)).encode('utf-8')


def _sh_quote(a):
    return "'" + a.replace("'", "'\\''") + "'"


def bundle_launcher(ctx):
    """Shell launcher for the .pyz / a source checkout (the PyInstaller program is placed into the bundle instead)."""
    pg = ctx.program
    target = installed_program(ctx) or pg['src']
    return ('#!/bin/sh\n# %s (%s): starts the helper program. Created by --install-helper, removed by --uninstall-helper.\n'
            'exec %s %s "$@"\n') % (helper_name('en'), brand.name(), _sh_quote(pg['python'] or '/usr/bin/python3'), _sh_quote(target))


def build_bundle(ctx, r, program=None):
    """(Re)create "<Name> Helfer.app" in bin/ and return its executable. Older bundles (other language) are replaced."""
    from . import tray
    path, lang = bundle_path(ctx), ctx.ui_lang()
    name = helper_name(lang)
    for old in bundle_paths(ctx): _rm_bundle(ctx, old, unregister=old != path)
    tmp = path + '.new'
    shutil.rmtree(tmp, ignore_errors=True)
    # nur die Sprache der Installation: die Anmeldeobjekte zeigten sonst den englischen Namen (Test am immer laufenden Mac, 27.10.)
    for d in ('MacOS', 'Resources/%s.lproj' % lang): _mkdir_all(ctx, ctx.p.join(tmp, 'Contents', d))
    _write(ctx, ctx.p.join(tmp, 'Contents', 'Info.plist'), info_plist(ctx, lang), 0o644)
    _write(ctx, ctx.p.join(tmp, 'Contents', 'PkgInfo'), b'APPL????', 0o644)
    _write(ctx, ctx.p.join(tmp, 'Contents', 'Resources', lang + '.lproj', 'InfoPlist.strings'), infoplist_strings(lang), 0o644)
    rgb = tuple(int(brand.CURRENT['accent'][i:i + 2], 16) for i in (1, 3, 5))
    _write(ctx, ctx.p.join(tmp, 'Contents', 'Resources', 'icon.icns'), tray.icns(rgb), 0o644)
    exe = ctx.p.join(tmp, 'Contents', 'MacOS', name)
    if ctx.program['kind'] == 'exe' and program:
        shutil.copyfile(program, exe)                 # its own file: the signature below must not touch bin/
        os.chmod(exe, 0o755)
        _chown(ctx, exe)
    else:
        _write(ctx, exe, bundle_launcher(ctx).encode('utf-8'), 0o755)
    os.rename(tmp, path)
    # best effort: an ad-hoc signature over the whole bundle and a Launch Services entry, so that macOS can match
    # AssociatedBundleIdentifiers to this bundle (name + icon). Without them the helper still runs.
    ctx.run(['codesign', '--force', '--sign', '-', '--identifier', ctx.bundle_id(), path], timeout=120)
    ctx.run([LSREGISTER, '-f', path])
    r.add('done', 'bundle', name)
    return bundle_exe(ctx)


def _mkdir_all(ctx, d):
    os.makedirs(d, exist_ok=True)
    x = d
    while getattr(ctx, 'gid', None) is not None and x and x != ctx.bin_dir() and x.startswith(ctx.bin_dir()):
        _chown(ctx, x)
        x = ctx.p.dirname(x)


def _rm_bundle(ctx, path, unregister=True):
    if not os.path.isdir(path): return False
    if unregister: ctx.run([LSREGISTER, '-u', path])
    shutil.rmtree(path, ignore_errors=True)
    shutil.rmtree(path + '.new', ignore_errors=True)
    return not os.path.exists(path)


def _systemd_quote(a):
    a = a.replace('%', '%%').replace('$', '$$')         # systemd expands %specifiers and $VARIABLES in ExecStart
    if re.match(r'^[A-Za-z0-9_@%+=:,./-]+$', a): return a
    return '"' + a.replace('\\', '\\\\').replace('"', '\\"') + '"'


def systemd_unit(ctx, args):
    return ('[Unit]\n'
            'Description=%s Helper (watchlist and Discover rows for the TV, home network only)\n'
            'Documentation=https://github.com/%s\n'
            'After=network.target\n\n'
            '[Service]\n'
            'Type=simple\n'
            'ExecStart=%s\n'
            'Restart=on-failure\n'
            'RestartSec=15\n'
            'NoNewPrivileges=true\n\n'
            '[Install]\n'
            'WantedBy=default.target\n') % (brand.name(), brand.CURRENT.get('repo', ''), ' '.join(_systemd_quote(a) for a in args))


def windows_run_value(args):
    return subprocess.list2cmdline(args)


# ---------------------------------------------------------------- Windows: shortcut "<Name> Helfer" in the Startup folder
# Task Manager -> Startup apps names a Run-key entry after the program it starts ("Python" for the .pyz); a shortcut in
# the user's Startup folder is listed under the shortcut's own name and icon. Same rights as the Run key (none extra).
def startup_dir(ctx):
    return ctx.p.join(ctx.env.get('APPDATA') or ctx.p.join(ctx.home, 'AppData', 'Roaming'),
                      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')


def startup_link(ctx, lang=None):
    return ctx.p.join(startup_dir(ctx), helper_name(lang or ctx.ui_lang()) + '.lnk')


def startup_links(ctx):
    return [ctx.p.join(startup_dir(ctx), n + '.lnk') for n in helper_names()]


def win_icon_path(ctx):
    return ctx.p.join(ctx.bin_dir(), 'helper.ico')


# PowerShell ends a single-quoted string at ANY of these quote characters (not only '), e.g. at the ’ in a Windows user
# name like "D’Angelo" -> double each of them, otherwise the shortcut/delete script breaks (or runs the rest of the path).
_PS_QUOTES = "'\u2018\u2019\u201a\u201b"


def _ps_quote(s):
    return "'" + ''.join(c + c if c in _PS_QUOTES else c for c in s) + "'"


def shortcut_script(path, target, arguments, workdir, icon, description):
    """PowerShell for WScript.Shell.CreateShortcut (part of every Windows; no extra modules). WindowStyle 7 = minimised:
    only matters for python.exe (no pythonw.exe found), which shows its console minimised while it restarts itself hidden;
    the windowed helper copy and pythonw.exe have no window at all."""
    return ('$s = (New-Object -ComObject WScript.Shell).CreateShortcut(%s); $s.TargetPath = %s; $s.Arguments = %s; '
            '$s.WorkingDirectory = %s; $s.IconLocation = %s; $s.Description = %s; $s.WindowStyle = 7; $s.Save()') % tuple(
        _ps_quote(x) for x in (path, target, arguments, workdir, icon + ',0', description))


def make_shortcut(ctx, path, args, icon, description):
    import base64
    script = shortcut_script(path, args[0], subprocess.list2cmdline(args[1:]), ctx.bin_dir(), icon, description)
    enc = base64.b64encode(script.encode('utf-16-le')).decode('ascii')
    rc, out = ctx.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], timeout=60)
    if rc != 0 or not os.path.isfile(path): raise OSError('shortcut: ' + (out.strip().splitlines() or [str(rc)])[-1][:160])


def write_startup_link(ctx, args):
    from . import tray
    rgb = tuple(int(brand.CURRENT['accent'][i:i + 2], 16) for i in (1, 3, 5))
    icon = win_icon_path(ctx)
    _mkdir(ctx, ctx.bin_dir())
    _write(ctx, icon, tray.ico(rgb, (16, 24, 32, 48, 64), tray.app_icon_pixels), 0o644)
    _mkdir(ctx, startup_dir(ctx))
    path = startup_link(ctx)
    # without a console there is nothing to hide: --detached = run right away instead of starting itself a second time
    # (background.relaunch_hidden). Only here - prefs['args'] also serve the one-time task of win_start_in_desktop, whose
    # helper must restart itself to leave the task's job (else Task Scheduler ends it after its time limit).
    if no_console(ctx, args[0]) and '--detached' not in args: args = list(args) + ['--detached']
    (ctx.shortcut or make_shortcut)(ctx, path, args, icon, TEXTS[ctx.ui_lang()]['bundle_about'] % brand.name())
    return path


def _remove_win_autostart(ctx, keep=None):
    """Delete the Startup shortcuts (both languages) and Run-key entries of older versions. -> what was removed."""
    out = []
    for p in startup_links(ctx):
        if p != keep and os.path.isfile(p) and _rm(p): out.append(p)
    for n in helper_names():
        if ctx.reg and ctx.reg.get(n) is not None:
            ctx.reg.delete(n); out.append('HKCU\\' + RUN_KEY + ' → ' + n)
    return out


# ---------------------------------------------------------------- preferences of the installed helper
def load_prefs(ctx):
    try:
        with open(ctx.file('helper-service.json'), encoding='utf-8') as f: d = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(d, dict) or d.get('kind') != PREFS_KIND: return None
    return {'kind': PREFS_KIND, 'schema': 1, 'tray': d.get('tray') is not False, 'autostart': d.get('autostart') is not False,
            'mode': d.get('mode') if d.get('mode') in ('agent', 'daemon', 'startup', 'runkey', 'systemd') else '',
            'args': [str(a) for a in d.get('args') or []][:20], 'port': d.get('port') if isinstance(d.get('port'), int) else DEFAULT_PORT,
            'version': str(d.get('version') or ''), 'lang': d.get('lang') if d.get('lang') in TEXTS else '',
            'name': str(d.get('name') or '')[:80], 'bundle': str(d.get('bundle') or '')}


def installed_name(ctx, prefs=None):
    """Name under which the system lists the installed helper (Login Items / Startup apps)."""
    prefs = prefs if prefs is not None else load_prefs(ctx)
    return (prefs and prefs.get('name')) or helper_name(ctx.ui_lang())


def save_prefs(ctx, prefs):
    path = ctx.file('helper-service.json')
    _mkdir(ctx, ctx.settings_dir())
    _write(ctx, path, json.dumps(prefs, indent=1).encode('utf-8'), 0o600)


def read_pid(ctx):
    try:
        with open(ctx.file('helper.pid'), encoding='utf-8') as f: d = json.load(f)
        return d if isinstance(d, dict) and isinstance(d.get('pid'), int) else None
    except (OSError, ValueError):
        return None


def write_pid(ctx, pid=None, **extra):
    """extra: wantTray (icon requested), tray (None = not decided yet, True = shown, False = no desktop to show it on)."""
    d = {'pid': pid or os.getpid(), 'exe': os.path.abspath(sys.executable), 'started': int(time.time())}
    d.update(extra)
    try: _write(ctx, ctx.file('helper.pid'), json.dumps(d).encode('utf-8'), 0o600)
    except OSError: pass


def update_pid(ctx, **kw):
    d = read_pid(ctx)
    if d and d['pid'] == os.getpid():
        d.update(kw)
        try: _write(ctx, ctx.file('helper.pid'), json.dumps(d).encode('utf-8'), 0o600)
        except OSError: pass


def headless_instance(ctx):
    """pid-file entry of a running helper that wanted its icon but had no desktop for it (started over SSH, Windows
    session 0, before the login): a helper started in the user's desktop session may replace it. Else None."""
    d = read_pid(ctx)
    if not d or d.get('wantTray') is not True or d.get('tray') is not False: return None
    if not ctx.alive(d['pid']) or not ctx.is_helper(d['pid'], d.get('exe')): return None
    return d


def take_over(ctx, port, polite=8.0, hard=8.0):
    """Stop a headless helper (see headless_instance) so this one can run with its icon. True when the port is free.
    First politely: the file helper.takeover asks it to quit (it checks every few seconds) - this also works where the
    other process may not be killed, e.g. Windows across logon sessions (SSH vs. desktop). Then by pid as a fallback."""
    d = headless_instance(ctx)
    if not d: return False
    req = ctx.file('helper.takeover')
    try: _write(ctx, req, json.dumps({'pid': d['pid']}).encode('utf-8'), 0o600)
    except OSError: pass
    try:
        if _wait_free(ctx, port, polite): return True
        stop_running(ctx)
        return _wait_free(ctx, port, hard)
    finally:
        _rm(req)


def _wait_free(ctx, port, seconds):
    for _ in range(int(seconds / 0.5) + 1):
        if not ctx.probe(port): return True
        ctx.sleep(0.5)
    return False


def takeover_requested(ctx, pid=None):
    """Running helper: has a helper with a desktop asked this one to make room (see take_over)?"""
    try:
        with open(ctx.file('helper.takeover'), encoding='utf-8') as f: d = json.load(f)
    except (OSError, ValueError):
        return False
    return isinstance(d, dict) and d.get('pid') == (pid or os.getpid())


def remove_pid(ctx):
    d = read_pid(ctx)
    if d and d.get('pid') == os.getpid(): _rm(ctx.file('helper.pid'))


# ---------------------------------------------------------------- small file helpers
def _mkdir(ctx, d):
    os.makedirs(d, exist_ok=True)
    _chown(ctx, d)


def _chown(ctx, path):
    if getattr(ctx, 'gid', None) is not None and ctx.root and hasattr(os, 'chown'):
        try: os.chown(path, ctx.uid, ctx.gid)
        except OSError: pass


def _excl_open(tmp, mode):
    """New temp file, never an existing one: a planted file or symlink at <name>.tmp (shared --setup-dir, a file another
    user created) is removed first, and O_EXCL refuses one that reappears instead of writing through it."""
    try: os.remove(tmp)
    except OSError: pass
    return os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), mode)


def _write(ctx, path, data, mode):
    tmp = path + '.tmp'
    fd = _excl_open(tmp, mode)
    with os.fdopen(fd, 'wb') as f: f.write(data)
    try: os.chmod(tmp, mode)
    except OSError: pass
    _chown(ctx, tmp)
    os.replace(tmp, path)


def _rm(path):
    try:
        os.remove(path)
        return True
    except OSError:
        return False


# ---------------------------------------------------------------- report ("what was removed, what is left")
class Report(object):
    """Items: (kind, code, detail). kind: done | left | note | error. Texts: TEXTS (CLI, tray) and ui.html (setup page)."""
    def __init__(self, action):
        self.action, self.items = action, []

    def add(self, kind, code, detail=''):
        self.items.append((kind, code, detail)); return self

    @property
    def ok(self):
        return not any(k == 'error' for k, _, _ in self.items)

    def to_json(self):
        """For the setup page: codes plus the finished sentences in both languages (one text source: TEXTS)."""
        return {'action': self.action, 'ok': self.ok, 'items': [{'kind': k, 'code': c, 'detail': d} for k, c, d in self.items],
                'head': dict((l, TEXTS[l]['head_' + self.action]) for l in TEXTS),
                'lines': dict((l, [{'kind': k, 'text': m} for k, m in self.lines(l)]) for l in TEXTS)}

    def lines(self, lang='en'):
        t = TEXTS[lang if lang in TEXTS else 'en']
        out = []
        for k, c, d in self.items:
            msg = t.get(c, c).replace('{app}', brand.name())
            out.append((k, msg % d if '%s' in msg else msg + (' ' + d if d and c not in t else '')))
        if not self.items: out.append(('note', t['nothing']))
        return out

    def text(self, lang='en'):
        mark = {'done': '  [ok]  ', 'left': '  [!]   ', 'note': '  [i]   ', 'error': '  [x]   '}
        t = TEXTS[lang if lang in TEXTS else 'en']
        return '\n'.join([t['head_' + self.action]] + [mark[k] + m for k, m in self.lines(lang)])


# One name per thing (same words as the setup page and the docs): "Helfer"/"helper", "Zugangsdatei"/"access file",
# "Autostart", "Programmkopie"/"program copy", "Symbol"/"icon".
TEXTS = {
    'de': {
        'head_install': 'Helfer dauerhaft installieren:',
        'head_uninstall': 'Helfer entfernen:',
        'head_autostart_off': 'Autostart ausschalten:',
        'nothing': 'Es war nichts installiert – nichts zu tun.',
        'copied': 'Programmkopie angelegt: %s',
        'copy_same': 'Programmkopie ist aktuell: %s',
        'source_checkout': 'Läuft direkt aus dem Quellordner (keine Kopie): %s – diesen Ordner nicht verschieben, sonst findet der Autostart den Helfer nicht mehr.',
        'bundle': 'Helfer-App „%s“ angelegt (im selben Ordner). So erkennt macOS den Helfer an seinem Namen und Symbol.',
        'bundle_removed': 'Helfer-App „%s“ gelöscht.',
        'login_item': 'macOS meldet ihn gleich als neues Hintergrundobjekt. Du findest ihn unter Systemeinstellungen → Allgemein → '
                      'Anmeldeobjekte & Erweiterungen als „%s“ (Bereich „Im Hintergrund erlauben“, bei neueren macOS-Versionen '
                      '„App-Hintergrundaktivitäten“). Dort lässt er sich auch ausschalten.',
        'bundle_about': 'Holt Merkliste, Entdecken-Reihen und Titel-Infos von plex.tv für die %s-App auf dem Fernseher (nur Heimnetz).',
        'agent': 'Autostart eingerichtet (startet bei jeder Anmeldung): %s',
        'daemon': 'Autostart beim Hochfahren eingerichtet (ohne Anmeldung, ohne Symbol): %s',
        'startup': 'Autostart eingerichtet: Verknüpfung „%s“ im Autostart-Ordner. Sie startet den Helfer bei jeder Anmeldung; '
                   'der Task-Manager zeigt sie unter „Autostart-Apps“ als „{app} Setup & Helper“ (mit der .pyz-Datei: '
                   '„Python“), dort lässt sie sich auch deaktivieren.',
        'systemd': 'Autostart eingerichtet (systemd-Benutzerdienst, startet bei jeder Anmeldung): %s',
        'started': 'Helfer läuft jetzt im Hintergrund (Port %s, nur Heimnetz).',
        'not_started': 'Der Helfer antwortet noch nicht. Was los ist, steht im Protokoll: %s',
        'no_gui_session': 'Gerade ist niemand am Bildschirm angemeldet. Der Helfer startet, sobald sich %s anmeldet. '
                          'Mac ohne Bildschirm: Systemeinstellungen → Benutzer:innen & Gruppen → „Automatisch anmelden als“, '
                          'oder mit sudo und --at-boot installieren.',
        'agent_next_login': 'macOS hat den Autostart nicht sofort geladen; er greift bei der nächsten Anmeldung von %s.',
        'started_direct': 'Der Helfer wurde für jetzt direkt gestartet – ohne Symbol, weil es keine Bildschirm-Sitzung gibt. '
                          'Sobald du dich am Mac anmeldest, löst der Autostart ihn ab, dann mit Symbol.',
        'headless_started': 'Der Helfer läuft, aber ohne Symbol: Dieses Fenster (z. B. SSH) hat keinen Desktop, und %s ist '
                            'gerade nicht am Bildschirm angemeldet. Bei der nächsten Anmeldung löst der Autostart ihn ab, dann mit Symbol.',
        'linger': 'Damit der Helfer auch ohne Anmeldung läuft, einmal ausführen: loginctl enable-linger %s',
        'systemctl_failed': 'systemctl --user hat nicht geklappt (%s). Bitte als dein normaler Benutzer ohne sudo ausführen.',
        'tray_on': 'Symbol in der Menüleiste bzw. im Infobereich: an (ausblenden kannst du es in der Helfer-Karte des Einrichtungsprogramms).',
        'tray_off': 'Symbol: ausgeblendet.',
        'stopped': 'Laufenden Helfer beendet (Prozess %s).',
        'autostart_removed': 'Autostart entfernt: %s',
        'program_removed': 'Programmkopie gelöscht: %s',
        'prefs_removed': 'Helfer-Einstellungen und Protokoll gelöscht.',
        'access_removed': 'Zugangsdatei gelöscht: %s',
        'access_kept': 'Zugangsdatei bleibt (für „Helfer starten“ im Einrichtungsprogramm): %s',
        'device_removed': 'plex.tv: Gerät „%s“ entfernt.',
        'device_shared': 'plex.tv: Gerät „%s“ nicht entfernt – es nutzt denselben Zugang wie der Fernseher (sonst wäre der Fernseher abgemeldet).',
        'device_none': 'plex.tv: kein eigenes Helfer-Gerät gefunden. Falls unter plex.tv → Konto → Autorisierte Geräte „%s“ steht, kannst du es dort entfernen.',
        'device_failed': 'plex.tv nicht erreichbar – Geräteliste nicht geprüft. Bei Bedarf unter plex.tv → Konto → Autorisierte Geräte „%s“ entfernen.',
        'folder_removed': 'Einstellungsordner gelöscht (war leer): %s',
        'removed_after_exit': 'Programmkopie, Protokoll und die dann leeren Ordner, die der laufende Helfer noch benutzt, '
                              'werden gelöscht, sobald er sich beendet hat (gleich nach „OK“).',
        'folder_left': 'Einstellungsordner bleibt – darin liegen noch Dateien des Einrichtungsprogramms (nicht vom Helfer): %s',
        'daemon_needs_sudo': 'Autostart beim Hochfahren gefunden – zum Entfernen mit sudo ausführen: %s',
        'no_helper': 'Der Helfer ist noch nicht eingerichtet. Zuerst im Einrichtungsprogramm in der Übersicht „Helfer einrichten“ '
                     'ankreuzen (unter „Erweitert“ „Zugang auf diesem Computer merken“ an lassen) und das App-Paket erstellen.',
        'at_boot_mac_only': '--at-boot gibt es nur auf dem Mac (Linux: loginctl enable-linger, Windows: Anmeldung nötig).',
        'at_boot_needs_sudo': '--at-boot braucht Administratorrechte: sudo davor schreiben.',
        'copy_failed': 'Programm konnte nicht kopiert werden: %s',
        'register_failed': 'Autostart konnte nicht eingerichtet werden: %s',
        'port_other': 'Port %s (über ihn erreicht der Fernseher den Helfer) wird gerade von einem anderen Programm benutzt. '
                      'Der Helfer wartet und startet von selbst, sobald der Port frei ist. Meist belegt ihn das Einrichtungsprogramm '
                      'selbst, weil dort der Helfer oder der Update-Server läuft (dort „Helfer stoppen“ bzw. „Update-Server '
                      'stoppen“ klicken), oder ein zweiter Helfer, z. B. in Docker – beende ihn.',
    },
    'en': {
        'head_install': 'Install the helper permanently:',
        'head_uninstall': 'Remove the helper:',
        'head_autostart_off': 'Turn autostart off:',
        'nothing': 'Nothing was installed – nothing to do.',
        'copied': 'Program copy created: %s',
        'copy_same': 'Program copy is up to date: %s',
        'source_checkout': 'Runs straight from the source folder (no copy): %s – do not move this folder, or the autostart will no longer find the helper.',
        'bundle': 'Helper app “%s” created (in the same folder). This is how macOS recognises the helper by its name and icon.',
        'bundle_removed': 'Helper app “%s” deleted.',
        'login_item': 'macOS will report it as a new background item. You find it under System Settings → General → '
                      'Login Items & Extensions as “%s” (section “Allow in the Background”, on newer macOS versions '
                      '“Background App Activity”). You can also switch it off there.',
        'bundle_about': 'Fetches the watchlist, Discover rows and title details from plex.tv for the %s app on the TV (home network only).',
        'agent': 'Autostart set up (starts every time you log in): %s',
        'daemon': 'Autostart at boot set up (no login needed, no icon): %s',
        'startup': 'Autostart set up: shortcut “%s” in the Startup folder. It starts the helper every time you log in; '
                   'Task Manager lists it under “Startup apps” as “{app} Setup & Helper” (with the .pyz file: “Python”), '
                   'where you can also disable it.',
        'systemd': 'Autostart set up (systemd user service, starts every time you log in): %s',
        'started': 'The helper is now running in the background (port %s, home network only).',
        'not_started': 'The helper is not answering yet. The log says what is going on: %s',
        'no_gui_session': 'Nobody is logged in on the screen right now. The helper starts as soon as %s logs in. '
                          'A Mac without a screen: System Settings → Users & Groups → “Automatically log in as”, '
                          'or install with sudo and --at-boot.',
        'agent_next_login': 'macOS did not load the autostart right away; it takes effect at the next login of %s.',
        'started_direct': 'The helper was started directly for now – without an icon, because there is no screen session. '
                          'As soon as you log in on the Mac, the autostart takes over, then with its icon.',
        'headless_started': 'The helper is running, but without an icon: this window (e.g. SSH) has no desktop, and %s is not '
                            'logged in on the screen right now. At the next login the autostart takes over, then with its icon.',
        'linger': 'To keep the helper running without a login, run this once: loginctl enable-linger %s',
        'systemctl_failed': 'systemctl --user failed (%s). Please run it as your normal user, without sudo.',
        'tray_on': 'Icon in the menu bar / notification area: on (you can hide it in the helper card of the setup program).',
        'tray_off': 'Icon: hidden.',
        'stopped': 'Stopped the running helper (process %s).',
        'autostart_removed': 'Autostart removed: %s',
        'program_removed': 'Program copy deleted: %s',
        'prefs_removed': 'Helper settings and log deleted.',
        'access_removed': 'Access file deleted: %s',
        'access_kept': 'Access file kept (for “Start helper” in the setup program): %s',
        'device_removed': 'plex.tv: device “%s” removed.',
        'device_shared': 'plex.tv: device “%s” not removed – it uses the same access as the TV (removing it would sign the TV out).',
        'device_none': 'plex.tv: no helper device of its own found. If “%s” is listed under plex.tv → Account → Authorized Devices, you can remove it there.',
        'device_failed': 'plex.tv not reachable – device list not checked. If needed, remove “%s” under plex.tv → Account → Authorized Devices.',
        'folder_removed': 'Settings folder deleted (it was empty): %s',
        'removed_after_exit': 'The program copy, the log and the then empty folders that the running helper still uses are '
                              'deleted as soon as it has exited (right after “OK”).',
        'folder_left': 'Settings folder kept – it still holds files of the setup program (not of the helper): %s',
        'daemon_needs_sudo': 'Autostart at boot found – run with sudo to remove it: %s',
        'no_helper': 'The helper is not set up yet. In the setup program, tick “Set up the helper” in the Summary first '
                     '(keep “Remember access on this computer” under “Advanced” ticked) and create the app package.',
        'at_boot_mac_only': '--at-boot is only available on a Mac (Linux: loginctl enable-linger; Windows: a login is needed).',
        'at_boot_needs_sudo': '--at-boot needs administrator rights: put sudo in front.',
        'copy_failed': 'Could not copy the program: %s',
        'register_failed': 'Could not set up autostart: %s',
        'port_other': 'Port %s (the TV reaches the helper through it) is in use by another program right now. The helper '
                      'waits and starts by itself as soon as the port is free. Usually the setup program itself holds it, '
                      'because the helper or the update server is running there (click “Stop helper” or “Stop update server” '
                      'there), or a second helper, for example in Docker – stop that one.',
    },
}


# ---------------------------------------------------------------- status
def status(ctx, helper_file=None):
    prefs = load_prefs(ctx)
    port = prefs['port'] if prefs else DEFAULT_PORT
    hello = ctx.probe(port)
    configured = os.path.isfile(helper_file or ctx.file('helper.json'))
    return {'os': ctx.os, 'installed': bool(prefs), 'autostart': bool(prefs and autostart_present(ctx, prefs['mode'])),
            'running': bool(hello), 'background': bool(hello and hello.get('background')),
            'tray': bool(prefs['tray']) if prefs else True, 'trayPossible': ctx.os in ('mac', 'win') and not (prefs and prefs['mode'] == 'daemon'),
            'mode': prefs['mode'] if prefs else '', 'port': port, 'configured': configured,
            'log': ctx.file('helper.log'), 'program': installed_program(ctx) or ctx.program['src'],
            'settingsDir': ctx.settings_dir(), 'sameVersion': bool(prefs and prefs['version'] == VERSION),
            'name': installed_name(ctx, prefs), 'trayShown': _tray_shown(ctx) if hello else None}


def _tray_shown(ctx):
    """From the running helper's pid file: True = icon visible, False = running without a desktop, None = unknown."""
    d = read_pid(ctx)
    return d.get('tray') if d and d.get('tray') in (True, False) else None


def autostart_present(ctx, mode=None):
    if ctx.os == 'mac':
        return os.path.isfile(ctx.agent_plist()) or os.path.isfile(ctx.daemon_plist())
    if ctx.os == 'win':
        return bool(any(os.path.isfile(p) for p in startup_links(ctx)) or ctx.reg and any(ctx.reg.get(n) for n in helper_names()))
    rc, out = ctx.run(['systemctl', '--user', 'is-enabled', ctx.unit_name()])
    return os.path.isfile(ctx.unit_path()) and rc == 0


# ---------------------------------------------------------------- start / stop the background helper
def stop_running(ctx, report=None):
    """Stop our background helper (pid file, verified). Returns the pid or None."""
    d = read_pid(ctx)
    if not d or not ctx.alive(d['pid']) or not ctx.is_helper(d['pid'], d.get('exe')):
        _rm(ctx.file('helper.pid'))
        return None
    # also ask it to quit (helper.takeover): Windows does not let a process of one logon session (SSH) end one of
    # another (desktop) - the helper reads the request within 5 s and exits by itself
    req = ctx.file('helper.takeover')
    try: _write(ctx, req, json.dumps({'pid': d['pid']}).encode('utf-8'), 0o600)
    except OSError: pass
    ctx.kill(d['pid'])
    for _ in range(40):
        if not ctx.alive(d['pid']): break
        ctx.sleep(0.25)
    _rm(req)
    _rm(ctx.file('helper.pid'))
    if report: report.add('done', 'stopped', str(d['pid']))
    return d['pid']


def start_now(ctx, prefs=None):
    """Start the installed helper now (through the service manager when autostart is on, else as a detached process)."""
    prefs = prefs or load_prefs(ctx)
    if not prefs: raise ServiceError('not_installed')
    if ctx.os == 'mac' and prefs['mode'] == 'agent' and os.path.isfile(ctx.agent_plist()):
        rc, _ = ctx.run(['launchctl', 'kickstart', 'gui/%d/%s' % (ctx.uid, ctx.label())])
        if rc == 0: return True
    if ctx.os == 'linux' and prefs['mode'] == 'systemd' and os.path.isfile(ctx.unit_path()):
        rc, _ = ctx.run(['systemctl', '--user', 'start', ctx.unit_name()])
        if rc == 0: return True
    if ctx.os == 'win' and prefs['tray'] and ctx.session() == 0 and win_start_in_desktop(ctx, prefs):
        return True
    ctx.spawn(prefs['args'] + (['--detached'] if ctx.os == 'win' else []))     # Windows: no second relaunch
    return True


def win_start_in_desktop(ctx, prefs, seconds=8.0):
    """Windows, called from session 0 (SSH, no desktop): start the helper in the user's desktop session instead - with a
    one-time scheduled task that only runs while the user is logged on (/IT) and is deleted right after. Without a desktop
    login nothing starts and the caller falls back to a helper without icon (a later login replaces it, see take_over)."""
    cmd = windows_run_value(prefs['args'])
    if len(cmd) > 261: return False                             # schtasks /TR limit
    tn = ctx.label() + '.start'
    rc, _ = ctx.run(['schtasks', '/Create', '/TN', tn, '/TR', cmd, '/SC', 'ONCE', '/ST', '00:00', '/IT', '/F'])
    if rc != 0: return False
    try:
        rc, _ = ctx.run(['schtasks', '/Run', '/TN', tn])
        return rc == 0 and wait_running(ctx, prefs['port'], seconds)
    finally:
        ctx.run(['schtasks', '/Delete', '/TN', tn, '/F'])


def restart(ctx):
    stop_running(ctx)
    return start_now(ctx)


def wait_running(ctx, port, seconds=10.0):
    end = time.time() + seconds
    while True:
        if ctx.probe(port): return True
        if time.time() >= end: return False
        ctx.sleep(0.5)


# ---------------------------------------------------------------- install
def install(ctx, helper_file=None, port=DEFAULT_PORT, tray=None, at_boot=False, start=True, wait=10.0):
    """Copy the program to bin/, register autostart, start it. Idempotent: running it again updates everything."""
    from . import helper as helpermod
    r = Report('install')
    if helper_file and os.path.abspath(helper_file) == os.path.abspath(ctx.file('helper.json')): helper_file = None
    try:
        helpermod.Store.load(helper_file or ctx.file('helper.json'))
    except (OSError, ValueError):
        return r.add('error', 'no_helper')
    if at_boot and ctx.os != 'mac': return r.add('error', 'at_boot_mac_only')
    if at_boot and not ctx.root: return r.add('error', 'at_boot_needs_sudo')
    old = load_prefs(ctx)
    if tray is None: tray = old['tray'] if old else True
    tray = bool(tray) and not at_boot and ctx.os in ('mac', 'win')
    stop_running(ctx, r)
    # 1. stable program copy
    try:
        dst = _copy_program(ctx, r)
        if ctx.os == 'mac': build_bundle(ctx, r, dst)
    except OSError as e:
        return r.add('error', 'copy_failed', str(e))
    args = command(ctx, port, helper_file, tray)
    mode = 'daemon' if at_boot else {'mac': 'agent', 'win': 'startup', 'linux': 'systemd'}[ctx.os]
    prefs = {'kind': PREFS_KIND, 'schema': 1, 'tray': tray, 'autostart': True, 'mode': mode, 'args': args, 'port': port,
             'version': VERSION, 'program': dst or '', 'lang': ctx.ui_lang(), 'name': helper_name(ctx.ui_lang()),
             'bundle': bundle_path(ctx) if ctx.os == 'mac' else ''}
    save_prefs(ctx, prefs)
    # 2. autostart entry
    try:
        started = _register(ctx, r, mode, args)
    except OSError as e:
        return r.add('error', 'register_failed', str(e))
    if ctx.os == 'mac': r.add('note', 'login_item', helper_name(ctx.ui_lang()))
    r.add('note', 'tray_on' if tray else 'tray_off')
    # 3. running?
    if start and started is not False:
        if not started: start_now(ctx, prefs)
        if wait_running(ctx, port, wait):
            r.add('done', 'started', str(port))
            d = read_pid(ctx)
            if tray and ctx.os == 'win' and d and d.get('tray') is False: r.add('note', 'headless_started', ctx.user)
        elif ctx.probe(port) is None and _port_busy(port): r.add('left', 'port_other', str(port))
        else: r.add('left', 'not_started', ctx.file('helper.log'))
    return r


def _port_busy(port):
    from .lanserver import port_in_use
    return port_in_use(port)


def _copy_program(ctx, r):
    pg, dst = ctx.program, installed_program(ctx)
    if not dst:
        r.add('note', 'source_checkout', pg['src'])
        return None
    _mkdir(ctx, ctx.bin_dir())
    if os.path.abspath(pg['src']) == os.path.abspath(dst):
        r.add('done', 'copy_same', dst)
    else:
        tmp = dst + '.new'
        with open(pg['src'], 'rb') as s, open(tmp, 'wb') as d: shutil.copyfileobj(s, d, 1 << 20)   # plain copy: no quarantine/MOTW stream
        os.chmod(tmp, 0o755)
        _chown(ctx, tmp)
        os.replace(tmp, dst)
        r.add('done', 'copied', dst)
    hp = helper_program(ctx)
    if hp:                                            # Windows .exe: windowed copy for the autostart (see helper_program)
        with open(dst, 'rb') as f:
            try: data = pe_windowed(f.read())
            except ValueError as e: raise OSError('%s: %s' % (dst, e))
        try:
            with open(hp, 'rb') as f: same = f.read() == data
        except OSError:
            same = False
        if not same:
            _write(ctx, hp, data, 0o755)
            r.add('done', 'copied', hp)
    return dst


def _register(ctx, r, mode, args):
    """-> True: already started by the service manager; None: start it ourselves; False: cannot start now."""
    if mode == 'agent':
        path = ctx.agent_plist()
        _mkdir(ctx, ctx.p.dirname(path))
        _write(ctx, path, launchd_plist(ctx, args), 0o644)
        dom = 'gui/%d' % ctx.uid
        ctx.run(['launchctl', 'bootout', '%s/%s' % (dom, ctx.label())])
        for _ in range(3):                                   # right after a bootout launchd may still be busy
            rc, out = ctx.run(['launchctl', 'bootstrap', dom, path])
            if rc == 0: break
            ctx.sleep(1.0)
        r.add('done', 'agent', path)
        if rc != 0:
            gui, _ = ctx.run(['launchctl', 'print', dom])
            # no GUI login now (e.g. SSH to a Mac at the login window): the agent loads at the next login;
            # until then the helper runs as a plain background process (no icon, until the next restart)
            r.add('note', 'no_gui_session' if gui != 0 else 'agent_next_login', ctx.user)
            r.add('note', 'started_direct')
            return None
        return True
    if mode == 'daemon':
        path = ctx.daemon_plist()
        _write_root(path, launchd_plist(ctx, args, daemon=True))
        ctx.run(['launchctl', 'bootout', 'system/' + ctx.label()])
        rc, out = ctx.run(['launchctl', 'bootstrap', 'system', path])
        r.add('done', 'daemon', path)
        if rc != 0: raise OSError(out.strip()[:200])
        return True
    if mode in ('startup', 'runkey'):
        name = ctx.run_name()
        _remove_win_autostart(ctx, keep=startup_link(ctx))  # older entries: other language, Run key of older versions
        write_startup_link(ctx, args)
        r.add('done', 'startup', name)
        return None
    path = ctx.unit_path()
    _mkdir(ctx, ctx.p.dirname(path))
    _write(ctx, path, systemd_unit(ctx, args).encode('utf-8'), 0o644)
    r.add('done', 'systemd', path)
    rc, out = ctx.run(['systemctl', '--user', 'daemon-reload'])
    if rc == 0: rc, out = ctx.run(['systemctl', '--user', 'enable', ctx.unit_name()])
    if rc == 0: rc, out = ctx.run(['systemctl', '--user', 'restart', ctx.unit_name()])
    if rc != 0:
        r.add('left', 'systemctl_failed', out.strip().splitlines()[-1][:160] if out.strip() else str(rc))
        return False
    rc, out = ctx.run(['loginctl', 'show-user', ctx.user, '--property=Linger'])
    if rc == 0 and 'Linger=no' in out: r.add('note', 'linger', ctx.user)
    return True


def _write_root(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f: f.write(data)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


# ---------------------------------------------------------------- uninstall
def remove_autostart(ctx, r, itself=False):
    """itself=True: called by the running helper (icon menu). Unloading its own job would stop it mid-way, so the job is
    unloaded a few seconds after it has exited (it exits with 0, which launchd/systemd do not restart)."""
    if ctx.os == 'mac':
        p = ctx.agent_plist()
        if os.path.isfile(p):
            if itself:
                ctx.spawn(['/bin/sh', '-c', 'sleep 5; launchctl bootout gui/%d/%s 2>/dev/null' % (ctx.uid, ctx.label())])
            else:
                for dom in ('gui/%d' % ctx.uid, 'user/%d' % ctx.uid):
                    ctx.run(['launchctl', 'bootout', '%s/%s' % (dom, ctx.label())])
            _rm(p); r.add('done', 'autostart_removed', p)
        d = ctx.daemon_plist()
        if os.path.isfile(d):
            if ctx.root:
                ctx.run(['launchctl', 'bootout', 'system/' + ctx.label()])
                _rm(d); r.add('done', 'autostart_removed', d)
            else:
                r.add('left', 'daemon_needs_sudo', 'sudo "%s" --uninstall-helper' % (installed_program(ctx) or ctx.program['src']))
    elif ctx.os == 'win':
        for what in _remove_win_autostart(ctx): r.add('done', 'autostart_removed', what)
    else:
        p = ctx.unit_path()
        if os.path.isfile(p):
            ctx.run(['systemctl', '--user', 'disable'] + ([] if itself else ['--now']) + [ctx.unit_name()])
            _rm(p)
            ctx.run(['systemctl', '--user', 'daemon-reload'])
            r.add('done', 'autostart_removed', p)


def uninstall(ctx, keep_access=False, revoke=True, helper_file=None, self_pid=None):
    """Remove everything the helper installed. keep_access=True ("Autostart ausschalten"): only autostart, program copy
    and the helper's settings go, the access file stays. self_pid: called from the running helper itself (tray menu)."""
    from . import helper as helpermod
    r = Report('autostart_off' if keep_access else 'uninstall')
    hfile = helper_file or ctx.file('helper.json')
    try: store = helpermod.Store.load(hfile)
    except (OSError, ValueError): store = None
    remove_autostart(ctx, r, itself=bool(self_pid))
    d = read_pid(ctx)
    if d and d['pid'] != (self_pid or -1): stop_running(ctx, r)
    else: _rm(ctx.file('helper.pid'))
    # program copy: only our own file names, then the folder if empty
    # Windows, called from the running helper (icon menu): its program file and open log cannot be deleted while it runs;
    # a small cmd.exe deletes them (and then the empty folders) a few seconds after the helper has exited.
    later = self_pid and ctx.os == 'win'
    deferred = []
    dst = installed_program(ctx)
    for p in [x for x in (dst, helper_program(ctx)) if x]:
        for f in (p, p + '.new'):
            if not os.path.isfile(f): continue
            gone = _rm_retry(ctx, f, 1 if later else 8)
            if not gone and later:
                deferred.append(f); gone = True
            if gone and f == p: r.add('done', 'program_removed', f)
    if ctx.os == 'mac':
        for b in bundle_paths(ctx):
            if _rm_bundle(ctx, b): r.add('done', 'bundle_removed', ctx.p.basename(b)[:-4])
    if ctx.os == 'win': _rm(win_icon_path(ctx))                 # icon of the Startup shortcut
    _rmdir_chain(ctx, ctx.bin_dir())
    had = [n for n in ('helper-service.json', 'helper.log', 'helper.log.1', 'helper.pid', 'helper.takeover') if os.path.isfile(ctx.file(n))]
    for n in had:
        if not _rm(ctx.file(n)) and later: deferred.append(ctx.file(n))
    if [n for n in had if n not in ('helper.pid', 'helper.takeover')]: r.add('done', 'prefs_removed')
    if keep_access:
        if os.path.isfile(hfile): r.add('note', 'access_kept', hfile)
        return r
    if store and revoke:
        revoke_devices(ctx, store, r)
    # only a helper access file: a mistyped --helper-file pointing at some other file of the user is never deleted
    if os.path.isfile(hfile) and (store or os.path.basename(hfile) == 'helper.json'):
        helpermod.Store.forget(hfile); r.add('done', 'access_removed', hfile)
    sd = ctx.settings_dir()
    if os.path.isdir(sd) and not ctx.env.get('PLEXNEO_SETUP_DIR'):
        left = [n for n in os.listdir(sd) if not n.startswith('.') and ctx.p.join(sd, n) not in deferred]
        if not left:
            try: os.rmdir(sd); r.add('done', 'folder_removed', sd)
            except OSError:
                if later: r.add('done', 'folder_removed', sd)
        elif r.items:
            r.add('note', 'folder_left', '%s (%s)' % (sd, ', '.join(sorted(left))))
    if later and deferred: _delete_after_exit(ctx, self_pid, deferred, [ctx.bin_dir(), ctx.p.dirname(ctx.bin_dir()), sd], r)
    return r


def delete_after_exit_script(pid, files, dirs):
    """PowerShell: wait until the helper process has ended (the user may still be reading the "removed" message), then
    delete its files and the folders - only if they are empty, so nothing else (e.g. the setup program's settings.json)
    is ever deleted."""
    q = lambda xs: ', '.join(_ps_quote(x) for x in xs)
    return ('Wait-Process -Id %d -Timeout 3600 -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; '
            'Remove-Item -LiteralPath %s -Force -ErrorAction SilentlyContinue; '
            'foreach ($d in @(%s)) { if ((Test-Path -LiteralPath $d) -and -not (Get-ChildItem -LiteralPath $d -Force | '
            'Select-Object -First 1)) { Remove-Item -LiteralPath $d -Force -ErrorAction SilentlyContinue } }') % (int(pid), q(files), q(dirs))


def _delete_after_exit(ctx, pid, files, dirs, r):
    import base64
    dirs = [d for d in dirs if d and not (d == ctx.settings_dir() and ctx.env.get('PLEXNEO_SETUP_DIR'))]  # portable: not ours
    enc = base64.b64encode(delete_after_exit_script(pid, files, dirs).encode('utf-16-le')).decode('ascii')
    ctx.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
               '-EncodedCommand', enc])
    r.add('note', 'removed_after_exit')


def _rm_retry(ctx, f, tries=8):
    for _ in range(tries):                    # Windows: the stopped process may hold the file for a moment
        if _rm(f): return True
        ctx.sleep(0.25)
    return False


def _rmdir_chain(ctx, d):
    """bin/ and, on Windows/Linux, its parent <Name>Setup folder in LOCALAPPDATA / ~/.local/share - only when empty."""
    for x in (d, ctx.p.dirname(d)):
        if x == ctx.settings_dir(): break
        try: os.rmdir(x)
        except OSError: break


# ---------------------------------------------------------------- plex.tv device entry of the helper
DEVICES_URL = 'https://plex.tv/devices.xml'
DEVICE_DEL = re.compile(r'^https://plex\.tv/devices/\d{1,12}\.xml$')


def _plex_fetch(method, url, token):
    if not (url == DEVICES_URL and method == 'GET') and not (DEVICE_DEL.match(url) and method == 'DELETE'):
        raise ValueError('url not allowed')
    import ssl
    req = urllib.request.Request(url, method=method, headers={
        'X-Plex-Token': token, 'Accept': 'application/xml', 'X-Plex-Product': brand.name() + ' Helper',
        'X-Plex-Version': VERSION, 'X-Plex-Client-Identifier': 'plexneo-helper-uninstall'})
    try:
        with urllib.request.urlopen(req, timeout=10, context=ssl.create_default_context()) as res:
            return res.status, res.read(1 << 20)
    except urllib.error.HTTPError as e:
        return e.code, b''
    except (urllib.error.URLError, OSError) as e:
        raise ServiceError('network', str(getattr(e, 'reason', e)))


def revoke_devices(ctx, store, r):
    """Remove plex.tv device entries that belong to the helper (product "<Name> Helper" or client id plexneo-helper-…),
    per profile access in helper.json. Never the entry whose access equals the owner's, because the TV uses that
    access too (setup.json) - removing it would sign the TV out. Tokens are never logged or reported."""
    fetch = ctx.fetch or _plex_fetch
    product = brand.name() + ' Helper'
    owner_tok = store.token(store.owner) if store.owner else None
    found = False
    try:
        for uuid, p in list(store.profiles.items()):
            status, body = fetch('GET', DEVICES_URL, p['token'])
            if status != 200: continue
            try: root = ET.fromstring(body)
            except ET.ParseError: continue
            for dv in root.iter('Device'):
                cid, prod, did = dv.get('clientIdentifier') or '', dv.get('product') or '', dv.get('id') or ''
                if not (prod == product or cid.startswith('plexneo-helper-')) or not did.isdigit(): continue
                found = True
                name = dv.get('name') or prod or cid
                tok = dv.get('token')
                if not tok or tok == owner_tok:
                    r.add('left', 'device_shared', name); continue
                st, _ = fetch('DELETE', 'https://plex.tv/devices/%s.xml' % did, p['token'])
                if 200 <= st < 300: r.add('done', 'device_removed', name)
                else: r.add('left', 'device_none', product)
    except ServiceError:
        r.add('left', 'device_failed', product)
        return
    if not found: r.add('note', 'device_none', product)


# ---------------------------------------------------------------- tray / UI settings
def set_tray(ctx, on):
    prefs = load_prefs(ctx)
    if not prefs: raise ServiceError('not_installed')
    prefs['tray'] = bool(on)
    args = [a for a in prefs['args'] if a != '--no-tray']
    if not on: args.insert(args.index('--background') + 1 if '--background' in args else len(args), '--no-tray')
    prefs['args'] = args
    save_prefs(ctx, prefs)
    if not prefs['autostart'] or not autostart_present(ctx, prefs['mode']):
        restart(ctx)
    elif prefs['mode'] in ('startup', 'runkey'):
        stop_running(ctx)
        _register(ctx, Report('install'), 'startup', args)
        save_prefs(ctx, dict(prefs, mode='startup'))
        start_now(ctx, load_prefs(ctx))
    else:
        stop_running(ctx)
        _register(ctx, Report('install'), prefs['mode'], args)      # rewrites the agent/unit and (re)starts it
    return prefs


def cli_lang(ctx):
    """Language of the command line output, the tray menu and the helper's name: the language chosen on the setup page
    (settings.json), else the language of the system, else English. On a Mac the system language is read from the user's
    preferences, because over SSH LANG is that of the other computer (or not set at all)."""
    try:
        with open(ctx.file('settings.json'), encoding='utf-8') as f: lang = json.load(f).get('lang')
        if lang in ('de', 'en'): return lang
    except (OSError, ValueError, AttributeError):
        pass
    for loc in system_langs(ctx):
        loc = (loc or '').lower()
        if not loc or loc in ('c', 'posix') or loc.startswith(('c.', 'posix.')): continue
        return 'de' if loc.startswith(('de', 'german')) else 'en'
    return 'en'


def system_langs(ctx):
    """Preferred languages, most important first (codes like "de-DE", "de_DE.UTF-8", "en")."""
    out = []
    if ctx.os == 'mac':
        try:
            with open(ctx.p.join(ctx.home, 'Library', 'Preferences', '.GlobalPreferences.plist'), 'rb') as f:
                d = plistlib.load(f)
            out += [str(x) for x in (d.get('AppleLanguages') or [])[:1]] + [str(d.get('AppleLocale') or '')]
        except (OSError, ValueError, plistlib.InvalidFileException, AttributeError, TypeError):
            pass
    if ctx.os == 'win' and os.name == 'nt':
        try:
            import ctypes
            lid = ctypes.windll.kernel32.GetUserDefaultUILanguage()
            out.append('de' if lid & 0x3ff == 0x07 else 'en')         # LANG_GERMAN; the display language of Windows
        except (AttributeError, OSError):
            pass
    out += [ctx.env.get(k) or '' for k in ('LC_ALL', 'LC_MESSAGES', 'LANG')] + [(ctx.env.get('LANGUAGE') or '').split(':')[0]]
    if ctx.os == 'win' and not any(out):
        try:
            import locale
            out.append(locale.getlocale()[0] or '')
        except (ValueError, ImportError):
            pass
    return out
