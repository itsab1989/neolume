"""Start the real setup web UI with plex.tv, the PMS and GDM mocked (tests/installer/helpers.py) for browser tests.
Prints 'READY <ui-url>' and serves until killed or the page's "Quit" button. No network, no real accounts."""
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import helpers as H  # noqa: E402  (also isolates the settings folder)
from neosetup import service  # noqa: E402
from neosetup.plextv import PlexTV  # noqa: E402
from neosetup.webui import UIServer  # noqa: E402
from neosetup.wizard import Wizard  # noqa: E402

GDM = [{'machineIdentifier': H.MID, 'address': '192.0.2.20', 'port': 32400, 'name': 'Home Server'}]


def fake_service():
    """"Install helper permanently" without touching the real autostart: temp home, fake launchctl/registry/processes."""
    import tempfile
    d = tempfile.mkdtemp(prefix='neo-e2e-svc-')
    src = os.path.join(d, 'neolume-setup')
    with open(src, 'wb') as f: f.write(b'binary')
    state = {'on': False}

    def run(args, timeout=30):
        if args[:2] == ['launchctl', 'bootstrap']: state['on'] = True
        if args[:2] == ['launchctl', 'bootout']: state['on'] = False
        return 0, ''
    c = service.Ctx(platform='darwin', home=os.path.join(d, 'home'), env={'PLEXNEO_SETUP_DIR': os.environ['PLEXNEO_SETUP_DIR']}, run=run, spawn=lambda a: state.update(on=True),
                    kill=lambda p: state.update(on=False), alive=lambda p: False, probe=lambda port: {'name': 'plex-neo-helper', 'background': True} if state['on'] else None,
                    fetch=lambda m, u, tok: (200, b'<MediaContainer/>'), uid=501, user='e2e', program={'kind': 'exe', 'src': src, 'python': None},
                    sleep=lambda s: None)
    return c


def main():
    fetch = H.FakeFetch(after=2)

    def plex(method, url, headers, body=None, timeout=15):
        if method == 'POST' and url.endswith('/switch'):
            return 201, b'<user authenticationToken="homeTvTok-1234567890"/>'
        return fetch(method, url, headers, body, timeout)
    w = Wizard(H.base_entries, prefs={}, plextv_factory=lambda cid: PlexTV(cid, fetch=plex), http_get=H.FakePMS(),
               gdm=lambda: GDM, lan_ip=lambda towards: '192.0.2.10', sync_port=0, update_port=0,
               helper_fetch=lambda *a, **k: (200, b'{"MediaContainer":{"Metadata":[]}}'), service_ctx=fake_service())
    ui = UIServer(w, 0)
    print('READY %s' % ui.url, flush=True)
    t = threading.Thread(target=ui.serve_forever, daemon=True)
    t.start()
    t.join()
    w.shutdown()
    print('QUIT', flush=True)


if __name__ == '__main__':
    main()
