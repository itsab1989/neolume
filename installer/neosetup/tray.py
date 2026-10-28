"""Optional icon of the background helper: macOS menu bar (NSStatusItem) and Windows notification area (Shell_NotifyIconW).

Native through ctypes - no extra packages (pystray would need Pillow plus PyObjC/Xlib, 10-20 MB more in every build).
Linux, Docker, SSH sessions and every error: no icon, the helper simply keeps running without it (`available()` False or
`run()` returns False). The menu holds only the essentials (Model.items): status lines, pause/resume, open settings,
what is this, quit, remove.

Threading: the icon's event loop runs on the main thread (AppKit requires it); the helper's servers run in threads.
"""
import ctypes
import ctypes.util
import os
import struct
import subprocess
import sys
import threading
import zlib


# ---------------------------------------------------------------- icon pixels (pure, unit-tested)
def icon_pixels(n, rgb=(0, 0, 0)):
    """n x n RGBA rows: a small TV (frame + stand) with a dot = "helper for the TV"."""
    rows = []
    t = max(2, n // 12)
    x0, x1, y0, y1 = int(n * .1), int(n * .9), int(n * .16), int(n * .72)
    cx, cy, rad = n / 2.0, (y0 + y1) / 2.0, n * .13
    for y in range(n):
        row = bytearray()
        for x in range(n):
            frame = x0 <= x < x1 and y0 <= y < y1 and (x < x0 + t or x >= x1 - t or y < y0 + t or y >= y1 - t)
            stand = (int(n * .46) <= x < int(n * .54) and y1 <= y < int(n * .82)) or (int(n * .3) <= x < int(n * .7) and int(n * .82) <= y < int(n * .82) + t)
            dot = (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= rad * rad
            row += bytes(rgb) + (b'\xff' if frame or stand or dot else b'\x00')
        rows.append(bytes(row))
    return rows


def png(n, rgb=(0, 0, 0)):
    raw = b''.join(b'\x00' + r for r in icon_pixels(n, rgb))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def app_icon_pixels(n, rgb):
    """n x n RGBA rows of the helper app icon (macOS Login Items, Finder): the same TV glyph in white on a rounded square in
    the brand colour (brand/*.json "accent")."""
    g = max(1, int(n * .62))
    glyph = icon_pixels(g, (255, 255, 255))
    off, inset, rad = (n - g) // 2, n * .1, n * .2
    lo, hi = inset, n - inset
    rows = []
    for y in range(n):
        row = bytearray()
        gy = y - off
        for x in range(n):
            cx = min(max(x + .5, lo + rad), hi - rad)
            cy = min(max(y + .5, lo + rad), hi - rad)
            inside = lo <= x + .5 <= hi and lo <= y + .5 <= hi and (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= rad * rad
            gx = x - off
            if inside and 0 <= gx < g and 0 <= gy < g and glyph[gy][gx * 4 + 3]: row += b'\xff\xff\xff\xff'
            elif inside: row += bytes(rgb) + b'\xff'
            else: row += b'\x00\x00\x00\x00'
        rows.append(bytes(row))
    return rows


def _png_rows(n, rows):
    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def icns(rgb):
    """macOS .icns with PNG entries (16-256 px, @1x and @2x), built without iconutil."""
    pngs = dict((n, _png_rows(n, app_icon_pixels(n, rgb))) for n in (32, 64, 128, 256))
    entries = [(b'ic11', 32), (b'ic12', 64), (b'ic07', 128), (b'ic13', 256), (b'ic08', 256)]
    body = b''.join(t + struct.pack('>I', len(pngs[n]) + 8) + pngs[n] for t, n in entries)
    return b'icns' + struct.pack('>I', len(body) + 8) + body


def ico(rgb, sizes=(16, 32), pixels=None):
    """Classic .ico (32-bit BGRA DIBs), loadable by LoadImageW on every Windows version. pixels: icon_pixels (tray glyph)
    or app_icon_pixels (the helper's app icon, e.g. for the Startup shortcut)."""
    imgs = []
    for n in sizes:
        px = b''.join(bytes(b for i in range(0, len(r), 4) for b in (r[i + 2], r[i + 1], r[i], r[i + 3])) for r in reversed((pixels or icon_pixels)(n, rgb)))
        mask = b'\x00' * (((n + 31) // 32) * 4 * n)
        hdr = struct.pack('<IiiHHIIiiII', 40, n, n * 2, 1, 32, 0, len(px) + len(mask), 0, 0, 0, 0)
        imgs.append((n, hdr + px + mask))
    out, off = struct.pack('<HHH', 0, 1, len(imgs)), 6 + 16 * len(imgs)
    for n, data in imgs:
        out += struct.pack('<BBBBHHII', n % 256, n % 256, 0, 0, 1, 32, len(data), off)
        off += len(data)
    return out + b''.join(d for _, d in imgs)


# ---------------------------------------------------------------- menu model (pure, unit-tested)
class Model(object):
    """What the icon shows. `status()` -> dict(paused, plex (True/False/None), tv (str or ''), port); actions are callables."""
    def __init__(self, texts, status, actions):
        self.t, self.status, self.actions = texts, status, actions

    def tooltip(self):
        s = self.status()
        return self.t['tip_paused'] if s['paused'] else self.t['tip']

    def items(self):
        """[(id, title, enabled)]; id None = status line, '-' = separator."""
        s, t = self.status(), self.t
        plex = t['plex_ok'] if s['plex'] else t['plex_unknown'] if s['plex'] is None else t['plex_bad']
        out = [(None, t['paused'] if s['paused'] else t['running'] % s['port'], False), (None, plex, False),
               (None, t['tv_seen'] % s['tv'] if s['tv'] else t['tv_never'], False), ('-', '', False),
               ('resume' if s['paused'] else 'pause', t['resume'] if s['paused'] else t['pause'], True),
               ('open', t['open'], True), ('about', t['about'], True), ('-', '', False),
               ('quit', t['quit'], True), ('remove', t['remove'], True)]
        return out

    def click(self, ident):
        fn = self.actions.get(ident)
        if fn:
            threading.Thread(target=fn, name='tray-' + ident, daemon=True).start()


# ---------------------------------------------------------------- dialogs (confirm / message)
def _osa_quote(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


def confirm(title, text, ok, cancel):
    """True if the user pressed `ok`. macOS: AppleScript dialog; Windows: MessageBoxW; elsewhere False."""
    if sys.platform == 'darwin':
        script = 'display dialog %s with title %s buttons {%s, %s} default button %s cancel button %s with icon caution' % (
            _osa_quote(text), _osa_quote(title), _osa_quote(cancel), _osa_quote(ok), _osa_quote(cancel), _osa_quote(cancel))
        try:
            p = subprocess.run(['osascript', '-e', script], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=600)
            return p.returncode == 0 and ('button returned:' + ok) in p.stdout.decode('utf-8', 'replace')
        except (OSError, subprocess.SubprocessError):
            return False
    if os.name == 'nt':
        return ctypes.windll.user32.MessageBoxW(None, text, title, 0x1 | 0x30 | 0x10000 | 0x40000) == 1   # OKCANCEL|WARNING|SETFOREGROUND|TOPMOST
    return False


def message(title, text):
    if sys.platform == 'darwin':
        script = 'display dialog %s with title %s buttons {"OK"} default button "OK"' % (_osa_quote(text), _osa_quote(title))
        try: subprocess.run(['osascript', '-e', script], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
        except (OSError, subprocess.SubprocessError): pass
    elif os.name == 'nt':
        ctypes.windll.user32.MessageBoxW(None, text, title, 0x40 | 0x10000 | 0x40000)


# ---------------------------------------------------------------- availability
def available():
    """A desktop to show an icon on? macOS: a window server session of this user; Windows: always (interactive login);
    Linux and the rest: no icon (headless)."""
    if os.environ.get('PLEXNEO_NO_TRAY'): return False
    if sys.platform == 'darwin':
        try:
            cg = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
            cg.CGSessionCopyCurrentDictionary.restype = ctypes.c_void_p
            d = cg.CGSessionCopyCurrentDictionary()
            if not d: return False
            cf = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
            cf.CFRelease.argtypes = [ctypes.c_void_p]
            cf.CFRelease(d)
            return True
        except (OSError, AttributeError):
            return False
    if os.name == 'nt': return win_session_id() != 0          # unknown (None): try it
    return False


def win_session_id():
    """Windows session of this process: 0 = services / SSH (no desktop, no notification area), >0 = a user's desktop."""
    try:
        sid = ctypes.c_ulong(0)
        if ctypes.windll.kernel32.ProcessIdToSessionId(ctypes.windll.kernel32.GetCurrentProcessId(), ctypes.byref(sid)):
            return sid.value
    except (AttributeError, OSError):
        pass
    return None


def run(model, stop, rgb, on_ready=None):
    """Show the icon and run its event loop on this (main) thread until stop.is_set(). False = no icon possible."""
    try:
        if sys.platform == 'darwin': return _MacTray(model, stop).run(on_ready)
        if os.name == 'nt': return _WinTray(model, stop, rgb).run(on_ready)
    except Exception as e:                       # never let the icon take the helper down
        sys.stderr.write('tray: %s: %s\n' % (type(e).__name__, e))
    return False


# ---------------------------------------------------------------- macOS (Objective-C runtime through ctypes)
class _MacTray(object):
    def __init__(self, model, stop):
        self.model, self.stop = model, stop
        self.keep = []                            # ctypes callbacks must stay alive
        o = ctypes.cdll.LoadLibrary(ctypes.util.find_library('objc') or '/usr/lib/libobjc.A.dylib')
        ctypes.cdll.LoadLibrary('/System/Library/Frameworks/AppKit.framework/AppKit')
        o.objc_getClass.restype = ctypes.c_void_p; o.objc_getClass.argtypes = [ctypes.c_char_p]
        o.sel_registerName.restype = ctypes.c_void_p; o.sel_registerName.argtypes = [ctypes.c_char_p]
        o.objc_allocateClassPair.restype = ctypes.c_void_p
        o.objc_allocateClassPair.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t]
        o.class_addMethod.restype = ctypes.c_bool
        o.class_addMethod.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p]
        o.objc_registerClassPair.argtypes = [ctypes.c_void_p]
        self.o = o
        self.msg = ctypes.cast(o.objc_msgSend, ctypes.c_void_p).value

    def cls(self, name):
        return self.o.objc_getClass(name.encode())

    def sel(self, name):
        return self.o.sel_registerName(name.encode())

    def send(self, obj, sel, *args, **kw):
        """objc_msgSend with an exact prototype (required on arm64): kw restype, argtypes."""
        restype, argtypes = kw.get('restype', ctypes.c_void_p), kw.get('argtypes', [ctypes.c_void_p] * len(args))
        f = ctypes.CFUNCTYPE(restype, ctypes.c_void_p, ctypes.c_void_p, *argtypes)(self.msg)
        return f(obj, self.sel(sel), *args)

    def ns(self, s):
        return self.send(self.cls('NSString'), 'stringWithUTF8String:', s.encode('utf-8'), argtypes=[ctypes.c_char_p])

    def run(self, on_ready):
        S = self.send
        app = S(self.cls('NSApplication'), 'sharedApplication')
        S(app, 'setActivationPolicy:', 1, restype=ctypes.c_bool, argtypes=[ctypes.c_long])       # accessory: no Dock icon
        # target object for menu clicks, menu refresh and the stop timer
        name = b'NeoHelperTrayTarget'
        k = self.o.objc_allocateClassPair(self.cls('NSObject'), name, 0)
        if not k: k = None
        IMP = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
        def clicked(this, _cmd, sender):
            ident = self.ids.get(S(sender, 'tag', restype=ctypes.c_long, argtypes=[]))
            if ident: self.model.click(ident)
        def needs_update(this, _cmd, menu):
            self.fill(menu)
        def tick(this, _cmd, timer):
            if self.stop.is_set():
                S(app, 'stop:', None)
                ev = S(self.cls('NSEvent'), 'otherEventWithType:location:modifierFlags:timestamp:windowNumber:context:subtype:data1:data2:',
                       15, _Point(0, 0), 0, 0.0, 0, None, 0, 0, 0,
                       argtypes=[ctypes.c_ulong, _Point, ctypes.c_ulong, ctypes.c_double, ctypes.c_long, ctypes.c_void_p,
                                 ctypes.c_short, ctypes.c_long, ctypes.c_long])
                S(app, 'postEvent:atStart:', ev, True, restype=None, argtypes=[ctypes.c_void_p, ctypes.c_bool])
            else:
                S(self.button, 'setToolTip:', self.ns(self.model.tooltip()), restype=None)
        for selname, fn in (('menuClicked:', clicked), ('menuNeedsUpdate:', needs_update), ('tick:', tick)):
            cb = IMP(fn); self.keep.append(cb)
            if k: self.o.class_addMethod(k, self.sel(selname), ctypes.cast(cb, ctypes.c_void_p), b'v@:@')
        if k: self.o.objc_registerClassPair(k)
        target = S(S(self.cls('NeoHelperTrayTarget'), 'alloc'), 'init')
        self.target = target
        bar = S(self.cls('NSStatusBar'), 'systemStatusBar')
        item = S(bar, 'statusItemWithLength:', -1.0, argtypes=[ctypes.c_double])
        S(item, 'retain')
        self.button = S(item, 'button')
        data = png(36)
        nsdata = S(self.cls('NSData'), 'dataWithBytes:length:', data, len(data), argtypes=[ctypes.c_char_p, ctypes.c_ulong])
        img = S(S(self.cls('NSImage'), 'alloc'), 'initWithData:', nsdata)
        if img:
            S(img, 'setSize:', _Size(18, 18), restype=None, argtypes=[_Size])
            S(img, 'setTemplate:', True, restype=None, argtypes=[ctypes.c_bool])         # follows light/dark menu bar
            S(self.button, 'setImage:', img, restype=None)
        else:
            S(self.button, 'setTitle:', self.ns('TV'), restype=None)
        S(self.button, 'setToolTip:', self.ns(self.model.tooltip()), restype=None)
        menu = S(S(self.cls('NSMenu'), 'alloc'), 'init')
        S(menu, 'setAutoenablesItems:', False, restype=None, argtypes=[ctypes.c_bool])
        S(menu, 'setDelegate:', target, restype=None)
        self.fill(menu)
        S(item, 'setMenu:', menu, restype=None)
        self.menu = menu
        S(self.cls('NSTimer'), 'scheduledTimerWithTimeInterval:target:selector:userInfo:repeats:', 1.0, target, self.sel('tick:'), None, True,
          argtypes=[ctypes.c_double, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_bool])
        if on_ready: on_ready()
        S(app, 'run', restype=None, argtypes=[])
        S(bar, 'removeStatusItem:', item, restype=None)
        return True

    def fill(self, menu):
        S = self.send
        S(menu, 'removeAllItems', restype=None, argtypes=[])
        self.ids = {}
        for i, (ident, title, enabled) in enumerate(self.model.items()):
            if ident == '-':
                S(menu, 'addItem:', S(self.cls('NSMenuItem'), 'separatorItem'), restype=None); continue
            mi = S(S(self.cls('NSMenuItem'), 'alloc'), 'initWithTitle:action:keyEquivalent:', self.ns(title),
                   self.sel('menuClicked:') if ident else None, self.ns(''))
            S(mi, 'setTarget:', self.target, restype=None)
            S(mi, 'setTag:', i + 1, restype=None, argtypes=[ctypes.c_long])
            S(mi, 'setEnabled:', bool(enabled), restype=None, argtypes=[ctypes.c_bool])
            S(menu, 'addItem:', mi, restype=None)
            S(mi, 'release', restype=None, argtypes=[])
            if ident: self.ids[i + 1] = ident


class _Point(ctypes.Structure):
    _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double)]


class _Size(ctypes.Structure):
    _fields_ = [('w', ctypes.c_double), ('h', ctypes.c_double)]


# ---------------------------------------------------------------- Windows (Win32 through ctypes)
class _WinTray(object):
    WM_APP_TRAY = 0x8000 + 1
    TIMER = 1

    def __init__(self, model, stop, rgb):
        self.model, self.stop, self.rgb = model, stop, rgb
        self.added = False

    def run(self, on_ready):
        from ctypes import wintypes as W
        u32, s32, k32 = ctypes.windll.user32, ctypes.windll.shell32, ctypes.windll.kernel32
        LRESULT = ctypes.c_ssize_t
        WNDPROC = ctypes.WINFUNCTYPE(LRESULT, W.HWND, W.UINT, W.WPARAM, W.LPARAM)

        class WNDCLASSEXW(ctypes.Structure):
            _fields_ = [('cbSize', W.UINT), ('style', W.UINT), ('lpfnWndProc', WNDPROC), ('cbClsExtra', ctypes.c_int),
                        ('cbWndExtra', ctypes.c_int), ('hInstance', W.HINSTANCE), ('hIcon', W.HICON), ('hCursor', W.HANDLE),
                        ('hbrBackground', W.HBRUSH), ('lpszMenuName', W.LPCWSTR), ('lpszClassName', W.LPCWSTR), ('hIconSm', W.HICON)]

        class GUID(ctypes.Structure):
            _fields_ = [('a', W.DWORD), ('b', W.WORD), ('c', W.WORD), ('d', ctypes.c_ubyte * 8)]

        class NOTIFYICONDATAW(ctypes.Structure):
            _fields_ = [('cbSize', W.DWORD), ('hWnd', W.HWND), ('uID', W.UINT), ('uFlags', W.UINT), ('uCallbackMessage', W.UINT),
                        ('hIcon', W.HICON), ('szTip', ctypes.c_wchar * 128), ('dwState', W.DWORD), ('dwStateMask', W.DWORD),
                        ('szInfo', ctypes.c_wchar * 256), ('uVersion', W.UINT), ('szInfoTitle', ctypes.c_wchar * 64),
                        ('dwInfoFlags', W.DWORD), ('guidItem', GUID), ('hBalloonIcon', W.HICON)]

        u32.DefWindowProcW.restype = LRESULT
        u32.DefWindowProcW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
        u32.CreateWindowExW.restype = W.HWND
        u32.CreateWindowExW.argtypes = [W.DWORD, W.LPCWSTR, W.LPCWSTR, W.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                        W.HWND, W.HMENU, W.HINSTANCE, W.LPVOID]
        u32.LoadImageW.restype = W.HANDLE
        u32.LoadImageW.argtypes = [W.HINSTANCE, W.LPCWSTR, W.UINT, ctypes.c_int, ctypes.c_int, W.UINT]
        u32.CreatePopupMenu.restype = W.HMENU
        u32.AppendMenuW.argtypes = [W.HMENU, W.UINT, ctypes.c_size_t, W.LPCWSTR]
        u32.TrackPopupMenu.restype = ctypes.c_int
        u32.TrackPopupMenu.argtypes = [W.HMENU, W.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.HWND, W.LPVOID]
        u32.SetTimer.restype = ctypes.c_size_t
        u32.SetTimer.argtypes = [W.HWND, ctypes.c_size_t, W.UINT, W.LPVOID]
        u32.PostMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
        u32.SetForegroundWindow.argtypes = [W.HWND]
        u32.DestroyMenu.argtypes = [W.HMENU]
        u32.DestroyWindow.argtypes = [W.HWND]
        u32.RegisterWindowMessageW.restype = W.UINT
        u32.RegisterWindowMessageW.argtypes = [W.LPCWSTR]
        s32.Shell_NotifyIconW.argtypes = [W.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
        s32.Shell_NotifyIconW.restype = W.BOOL
        k32.GetModuleHandleW.restype = W.HMODULE
        k32.GetModuleHandleW.argtypes = [W.LPCWSTR]

        hinst = k32.GetModuleHandleW(None)
        taskbar_created = u32.RegisterWindowMessageW('TaskbarCreated')
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.uID = 1
        nid.uFlags = 0x1 | 0x2 | 0x4                                  # NIF_MESSAGE | NIF_ICON | NIF_TIP
        nid.uCallbackMessage = self.WM_APP_TRAY

        import tempfile
        path = os.path.join(tempfile.gettempdir(), 'neo-helper-%d.ico' % os.getpid())
        with open(path, 'wb') as f: f.write(ico(self.rgb))
        nid.hIcon = u32.LoadImageW(None, path, 1, 0, 0, 0x10 | 0x40)   # IMAGE_ICON, LR_LOADFROMFILE | LR_DEFAULTSIZE
        try: os.remove(path)
        except OSError: pass
        if not nid.hIcon: nid.hIcon = u32.LoadIconW(None, ctypes.c_void_p(32512))      # IDI_APPLICATION

        def add():
            nid.szTip = self.model.tooltip()[:127]
            self.added = bool(s32.Shell_NotifyIconW(1 if self.added else 0, ctypes.byref(nid)))   # NIM_MODIFY / NIM_ADD
            return self.added

        def menu(hwnd):
            pt = W.POINT()
            u32.GetCursorPos(ctypes.byref(pt))
            hm = u32.CreatePopupMenu()
            ids = {}
            for i, (ident, title, enabled) in enumerate(self.model.items()):
                if ident == '-': u32.AppendMenuW(hm, 0x800, 0, None); continue           # MF_SEPARATOR
                u32.AppendMenuW(hm, 0 if enabled and ident else 0x1, i + 1, title)        # MF_STRING / MF_GRAYED
                if ident: ids[i + 1] = ident
            u32.SetForegroundWindow(hwnd)
            cmd = u32.TrackPopupMenu(hm, 0x100 | 0x80 | 0x2, pt.x, pt.y, 0, hwnd, None)   # RETURNCMD|NONOTIFY|RIGHTBUTTON
            u32.PostMessageW(hwnd, 0, 0, 0)
            u32.DestroyMenu(hm)
            if cmd in ids: self.model.click(ids[cmd])

        def proc(hwnd, msg, wp, lp):
            if msg == self.WM_APP_TRAY and (lp & 0xFFFF) in (0x0202, 0x0205, 0x007B):     # LBUTTONUP, RBUTTONUP, CONTEXTMENU
                menu(hwnd); return 0
            if msg == 0x0113:                                                             # WM_TIMER
                if self.stop.is_set(): u32.DestroyWindow(hwnd)
                elif not self.added: add()
                else:
                    tip = self.model.tooltip()[:127]
                    if tip != nid.szTip: add()
                return 0
            if msg == taskbar_created:                                                    # Explorer restarted
                self.added = False; add(); return 0
            if msg == 0x0002:                                                             # WM_DESTROY
                if self.added: s32.Shell_NotifyIconW(2, ctypes.byref(nid))              # NIM_DELETE
                u32.PostQuitMessage(0); return 0
            return u32.DefWindowProcW(hwnd, msg, wp, lp)

        self.proc = WNDPROC(proc)
        wc = WNDCLASSEXW()
        wc.cbSize = ctypes.sizeof(WNDCLASSEXW)
        wc.lpfnWndProc = self.proc
        wc.hInstance = hinst
        wc.lpszClassName = 'NeoHelperTray'
        if not u32.RegisterClassExW(ctypes.byref(wc)): raise OSError('RegisterClassExW')
        hwnd = u32.CreateWindowExW(0, 'NeoHelperTray', 'NeoHelperTray', 0, 0, 0, 0, 0, None, None, hinst, None)
        if not hwnd: raise OSError('CreateWindowExW')
        nid.hWnd = hwnd
        add()                                         # may fail right after logon (no taskbar yet): the timer retries
        u32.SetTimer(hwnd, self.TIMER, 1000, None)
        if on_ready: on_ready()
        msg = W.MSG()
        while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            u32.TranslateMessage(ctypes.byref(msg))
            u32.DispatchMessageW(ctypes.byref(msg))
        return True
