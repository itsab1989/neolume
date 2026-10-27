#!/usr/bin/env python3
"""Smoke test for a built setup program (binary or .pyz): start it, load the page, start the update server (proves the
embedded app payload loads), fetch the manifest, press "Quit" and check that it exits. No plex.tv, no port 80.

    python3 installer/smoke_test.py dist-setup/plexneo-setup-macos-arm64        (binary)
    python3 installer/smoke_test.py python3 dist-setup/plexneo-setup.pyz        (command + args)
"""
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def main(cmd):
    ui, upd = free_port(), free_port()
    env = dict(os.environ, PLEXNEO_SETUP_DIR=tempfile.mkdtemp(prefix='neo-smoke-'))
    out = open(os.path.join(env['PLEXNEO_SETUP_DIR'], 'out.log'), 'w+')
    ver = subprocess.run(cmd + ['--version'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120, env=env)
    print('version:', ver.stdout.decode().strip())
    assert ver.returncode == 0, ver.stdout
    p = subprocess.Popen(cmd + ['--no-browser', '--port', str(ui), '--update-port', str(upd)], stdout=out, stderr=subprocess.STDOUT, env=env)
    try:
        base = 'http://127.0.0.1:%d/' % ui
        html = None
        for _ in range(240):                    # onefile binaries unpack first: allow up to 60 s
            try:
                html = urllib.request.urlopen(base, timeout=2).read().decode('utf-8'); break
            except OSError:
                if p.poll() is not None: break
                time.sleep(0.25)
        assert html, 'UI did not start'
        csrf = re.search(r"var CSRF = '([^']+)'", html).group(1)

        def api(action):
            r = urllib.request.Request(base + 'api/' + action, data=b'{}', headers={'Content-Type': 'application/json', 'X-Neo-Csrf': csrf})
            return json.loads(urllib.request.urlopen(r, timeout=30).read())
        assert api('state')['ok']
        r = api('update_start')
        assert r['ok'], r
        m = json.loads(urllib.request.urlopen('http://127.0.0.1:%d/update/manifest.json' % upd, timeout=5).read())
        print('embedded app version:', m['version'], 'app.js bytes:', m['size'])
        assert m['size'] > 10000, m
        assert api('quit')['ok']
        p.wait(20)
        assert p.returncode == 0, p.returncode
        print('SMOKE OK')
        return 0
    finally:
        if p.poll() is None: p.kill()
        out.seek(0)
        print(out.read())


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args: sys.exit(__doc__)
    sys.exit(main(args))
