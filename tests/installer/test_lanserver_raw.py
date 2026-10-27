"""Sync/update server with hand-written requests: path traversal and odd request lines, client filter, helper +
static files on one port. Only the exact allow-listed paths may ever return content."""
import json
import socket
import unittest

import helpers as H  # noqa: F401  (sys.path + isolated settings folder)
from neosetup import lanserver
from neosetup.lanserver import LanServer

SECRET = b'ZIP-WITH-TOKENS'


def send(port, data, timeout=2):
    s = socket.create_connection(('127.0.0.1', port), timeout=timeout)
    try:
        s.sendall(data)
        out = b''
        while True:
            try: chunk = s.recv(65536)
            except socket.timeout: break
            if not chunk: break
            out += chunk
        return out
    finally:
        s.close()


def status(resp):
    try: return int(resp.split(b' ', 2)[1])
    except (IndexError, ValueError): return None


class Traversal(unittest.TestCase):
    def setUp(self):
        self.s = LanServer('sync', 0, lock_path='/widgetlist.xml', bind='127.0.0.1')
        self.s.set_files(lanserver.sync_files(b'<rsp/>', {'PlexNeo.zip': SECRET}))
        self.s.start()

    def tearDown(self):
        self.s.stop()

    def get(self, target, version=b'HTTP/1.1', extra=b''):
        return send(self.s.port, b'GET ' + target + b' ' + version + b'\r\nHost: 127.0.0.1\r\nConnection: close\r\n' + extra + b'\r\n')

    def test_only_exact_paths(self):
        self.assertEqual(status(self.get(b'/PlexNeo.zip')), 200)
        for t in (b'/plexneo.zip', b'/PlexNeo.zip%00', b'/PlexNeo%2Ezip', b'/%50lexNeo.zip', b'/./PlexNeo.zip', b'//PlexNeo.zip/',
                  b'/x/../PlexNeo.zip', b'/..%2fPlexNeo.zip', b'/..\\PlexNeo.zip', b'\\PlexNeo.zip', b'/PlexNeo.zip;x',
                  b'/PlexNeo.zip#', b'/etc/passwd', b'/../../../../etc/passwd', b'/%2e%2e/%2e%2e/etc/passwd', b'/C:/Windows/win.ini',
                  b'/neosetup/lanserver.py', b'/widgetlist.xml.bak', b'*', b'/' + b'A' * 8000):
            r = self.get(t)
            self.assertIn(status(r), (400, 404, 414), t[:60])
            self.assertNotIn(SECRET, r, t[:60])

    def test_absolute_form_and_proxy_requests(self):
        for t in (b'http://127.0.0.1/PlexNeo.zip', b'http://evil.example/PlexNeo.zip', b'127.0.0.1:80'):
            r = self.get(t)
            self.assertNotIn(SECRET, r, t)
        r = send(self.s.port, b'CONNECT evil.example:443 HTTP/1.1\r\nHost: evil.example:443\r\n\r\n')
        self.assertIn(status(r), (403, 405))                         # foreign Host (403) or method (405): never a tunnel

    def test_methods(self):
        for m in (b'POST', b'PUT', b'DELETE', b'PATCH', b'OPTIONS', b'TRACE'):
            r = send(self.s.port, m + b' /PlexNeo.zip HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            self.assertEqual(status(r), 405, m)
            self.assertNotIn(SECRET, r)
        r = send(self.s.port, b'FOO /PlexNeo.zip HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
        self.assertEqual(status(r), 501)
        r = send(self.s.port, b'HEAD /PlexNeo.zip HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
        self.assertEqual(status(r), 200)
        self.assertNotIn(SECRET, r)                                  # HEAD has no body

    def test_garbage_request_lines(self):
        for data in (b'\x16\x03\x01\x02\x00\x01\x00\x01\xfc\x03\x03' + b'\x00' * 40, b'GET\r\n\r\n', b'GET /PlexNeo.zip HTTP/9.9\r\n\r\n',
                     b'GET /../PlexNeo.zip\r\n\r\n'):                     # HTTP/0.9 simple request
            r = send(self.s.port, data)
            self.assertNotIn(SECRET, r, data[:20])
        self.assertTrue(self.s.running)
        self.assertEqual(status(self.get(b'/widgetlist.xml')), 200)   # server still fine afterwards

    def test_traversal_not_logged_with_query(self):
        self.get(b'/nope?token=abc')
        self.assertEqual(self.s.events[-1][2], '/nope')

    def test_content_types(self):
        r = self.get(b'/widgetlist.xml')
        self.assertIn(b'Content-Type: text/xml', r)
        self.assertIn(b'Cache-Control: no-store', r)


class ClientFilter(unittest.TestCase):
    def test_lan_only(self):
        s = LanServer('sync', 0)
        for ok in ('127.0.0.1', '::1', '192.168.1.5', '10.1.2.3', '172.16.0.9', '169.254.3.4', '::ffff:192.168.1.5', 'fd00::1'):
            self.assertTrue(s.client_allowed(ok), ok)
        for bad in ('8.8.8.8', '100.64.0.1', '172.32.0.1', '0.0.0.0', '224.0.0.1', '::ffff:8.8.8.8', '2001:4860::1', 'garbage', ''):
            self.assertFalse(s.client_allowed(bad), bad)

    def test_dns_rebinding_host_refused(self):
        """Pentest P1: a web page that rebinds its domain to this computer must not read the package (tokens)."""
        srv = LanServer('sync', 0, lock_path='/widgetlist.xml', bind='127.0.0.1')
        srv.set_files(lanserver.sync_files(b'<rsp/>', {'PlexNeo.zip': SECRET}))
        srv.start()
        self.addCleanup(srv.stop)
        for host in (b'evil.example', b'evil.example:80', b'192.168.1.5.nip.io', b'localhost.evil.example', b'x'):
            r = send(srv.port, b'GET /PlexNeo.zip HTTP/1.1\r\nHost: ' + host + b'\r\nConnection: close\r\n\r\n')
            self.assertEqual(status(r), 403, host)
            self.assertNotIn(SECRET, r)
        for host in (b'127.0.0.1', b'127.0.0.1:80', b'192.168.1.5', b'localhost', b'[::1]:80'):
            r = send(srv.port, b'GET /widgetlist.xml HTTP/1.1\r\nHost: ' + host + b'\r\nConnection: close\r\n\r\n')
            self.assertEqual(status(r), 200, host)
        self.assertEqual(status(send(srv.port, b'GET /widgetlist.xml HTTP/1.0\r\n\r\n')), 200)   # no Host (HTTP/1.0)

    def test_package_only_for_locked_tv(self):
        """Pentest P2: before, any LAN device could download PlexNeo.zip while the server waited for the TV."""
        s = LanServer('sync', 0, lock_path='/widgetlist.xml')
        s.set_files(lanserver.sync_files(b'<rsp/>', {'PlexNeo.zip': SECRET}))
        self.assertFalse(s.client_allowed('192.168.1.60', '/PlexNeo.zip'))      # not locked yet -> no package
        self.assertTrue(s.client_allowed('192.168.1.50', '/widgetlist.xml'))
        s.fetched('192.168.1.50', '/widgetlist.xml')
        self.assertTrue(s.client_allowed('192.168.1.50', '/PlexNeo.zip'))       # the TV gets it
        self.assertFalse(s.client_allowed('192.168.1.60', '/PlexNeo.zip'))
        self.assertTrue(s.client_allowed('127.0.0.1', '/PlexNeo.zip'))          # this computer (UI checks) always
        u = LanServer('update', 0)                                              # no lock path: update files for any LAN client
        self.assertTrue(u.client_allowed('192.168.1.60', '/update/app.js'))

    def test_tv_lock_survives_unlock_cycle(self):
        s = LanServer('sync', 0, lock_path='/widgetlist.xml')
        s.fetched('192.168.1.50', '/PlexNeo.zip')                    # only widgetlist.xml locks
        self.assertIsNone(s.locked_to)
        s.fetched('192.168.1.50', '/widgetlist.xml')
        s.fetched('192.168.1.60', '/widgetlist.xml')                 # second device cannot steal the lock
        self.assertEqual(s.locked_to, '192.168.1.50')
        self.assertFalse(s.client_allowed('192.168.1.60'))


class SharedPort(unittest.TestCase):
    """Update server + helper on one port: helper routes first, then the static update files; nothing else."""
    def test_update_files_and_helper(self):
        from neosetup import helper as HP
        s = LanServer('update', 0, bind='127.0.0.1')
        s.set_files(lanserver.update_files(b'var App={};', '0.0.9'))
        store = HP.Store('k' * 32)
        store.add('u-owner', 'plexTvTok-1234567890', 'Owner', 'owner')
        s.api = HP.Helper(store, 'plexneo-helper-test', fetch=lambda *a, **k: (500, b''))
        s.start()
        try:
            r = send(s.port, b'GET /neo-helper HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
            self.assertEqual(json.loads(r.split(b'\r\n\r\n', 1)[1])['name'], 'plex-neo-helper')
            r = send(s.port, b'GET /update/app.js HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
            self.assertTrue(r.endswith(b'var App={};'))
            r = send(s.port, b'GET /watchlist HTTP/1.1\r\nHost: evil.example\r\nX-Neo-Key: ' + b'k' * 32 +
                     b'\r\nX-Neo-Profile: u-owner\r\nConnection: close\r\n\r\n')
            self.assertEqual(status(r), 403)                          # DNS rebinding: Host must be an IP literal
            r = send(s.port, b'GET /watchlist HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Neo-Key: wrong\r\nConnection: close\r\n\r\n')
            self.assertEqual(status(r), 401)
            r = send(s.port, b'PUT /watchlist/' + b'a' * 24 + b' HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 5000\r\n\r\n')
            self.assertEqual(status(r), 413)
            self.assertNotIn(b'plexTvTok', r)
        finally:
            s.stop()


if __name__ == '__main__':
    unittest.main()
