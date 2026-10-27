"""Start the real setup web UI with plex.tv, the PMS and GDM mocked (tests/installer/helpers.py) for browser tests.
Prints 'READY <ui-url>' and serves until killed or the page's "Quit" button. No network, no real accounts."""
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import helpers as H  # noqa: E402  (also isolates the settings folder)
from neosetup.plextv import PlexTV  # noqa: E402
from neosetup.webui import UIServer  # noqa: E402
from neosetup.wizard import Wizard  # noqa: E402

GDM = [{'machineIdentifier': H.MID, 'address': '192.0.2.20', 'port': 32400, 'name': 'Home Server'}]


def main():
    fetch = H.FakeFetch(after=2)

    def plex(method, url, headers, body=None, timeout=15):
        if method == 'POST' and url.endswith('/switch'):
            return 201, b'<user authenticationToken="homeTvTok-1234567890"/>'
        return fetch(method, url, headers, body, timeout)
    w = Wizard(H.base_entries, prefs={}, plextv_factory=lambda cid: PlexTV(cid, fetch=plex), http_get=H.FakePMS(),
               gdm=lambda: GDM, lan_ip=lambda towards: '192.0.2.10', sync_port=0, update_port=0,
               helper_fetch=lambda *a, **k: (200, b'{"MediaContainer":{"Metadata":[]}}'))
    ui = UIServer(w, 0)
    print('READY %s' % ui.url, flush=True)
    t = threading.Thread(target=ui.serve_forever, daemon=True)
    t.start()
    t.join()
    w.shutdown()
    print('QUIT', flush=True)


if __name__ == '__main__':
    main()
