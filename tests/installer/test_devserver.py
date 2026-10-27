"""tools/dev.py (development servers on ports 80/8090/8099): DNS-rebinding guard (pentest P1)."""
import http.server
import importlib.util
import os
import socket
import threading
import unittest

import helpers as H  # noqa: F401

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location('devpy', os.path.join(ROOT, 'tools', 'dev.py'))
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class Ok(dev.Guard):
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Length', '6'); self.end_headers(); self.wfile.write(b'SECRET')


def get(port, host):
    s = socket.create_connection(('127.0.0.1', port), timeout=3)
    s.sendall(b'GET /PlexNeo.zip HTTP/1.1\r\n' + (b'Host: ' + host + b'\r\n' if host is not None else b'') + b'Connection: close\r\n\r\n')
    out = b''
    while True:
        d = s.recv(4096)
        if not d: break
        out += d
    s.close()
    return int(out.split(b' ', 2)[1]), out


class DevHost(unittest.TestCase):
    def test_client_ok_lan_only(self):
        # ALLOW fehlte nach einem Merge (NameError bei jeder Anfrage) – client_ok muss ohne Ausnahme laufen
        self.assertTrue(dev.client_ok('127.0.0.1'))
        self.assertFalse(dev.client_ok('8.8.8.8'))

    def test_host_ok(self):
        for h in (None, '192.168.1.5', '192.168.1.5:80', '127.0.0.1:8090', 'localhost', '[::1]:80'):
            self.assertTrue(dev.host_ok(h), h)
        for h in ('evil.example', 'evil.example:80', '192.168.1.5.nip.io', 'localhost.evil', '', 'x'):
            self.assertFalse(dev.host_ok(h), h)

    def test_rebinding_refused(self):
        srv = dev.Server(('127.0.0.1', 0), Ok)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close); self.addCleanup(srv.shutdown)
        p = srv.server_address[1]
        self.assertEqual(get(p, b'127.0.0.1:%d' % p)[0], 200)
        st, body = get(p, b'evil.example')
        self.assertEqual(st, 403); self.assertNotIn(b'SECRET', body)


if __name__ == '__main__':
    unittest.main()
