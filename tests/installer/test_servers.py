"""LAN sync/update server (path allow-list, LAN filter, lock) and local UI (Host/CSRF/Origin checks)."""
import http.client
import json
import threading
import unittest

import helpers as H
from neosetup import lanserver
from neosetup.lanserver import LanServer
from neosetup.webui import UIServer
from neosetup.wizard import Wizard


def req(port, method, path, headers=None, body=None):
    c = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, data


class Sync(unittest.TestCase):
    def setUp(self):
        self.s = LanServer('sync', 0, lock_path='/widgetlist.xml', bind='127.0.0.1')
        self.s.set_files(lanserver.sync_files(b'<rsp/>', {'PlexNeo.zip': b'ZIPDATA'}))
        self.s.start()

    def tearDown(self):
        self.s.stop()

    def test_allow_list(self):
        p = self.s.port
        self.assertEqual(req(p, 'GET', '/widgetlist.xml'), (200, b'<rsp/>'))
        self.assertEqual(req(p, 'GET', '/PlexNeo.zip?x=1'), (200, b'ZIPDATA'))
        for bad in ('/', '/../../etc/passwd', '/PlexNeo.zip/', '/%2e%2e/x', '/widgetlist.xml/..', '/http://evil/'):
            self.assertEqual(req(p, 'GET', bad)[0], 404, bad)
        self.assertEqual(req(p, 'POST', '/widgetlist.xml', body=b'x')[0], 405)
        self.assertEqual(req(p, 'HEAD', '/PlexNeo.zip')[0], 200)
        fetched = [e for e in self.s.events if e[3] == 200]
        self.assertEqual(fetched[0][1:], ('127.0.0.1', '/widgetlist.xml', 200))

    def test_set_files_validation(self):
        for bad in ('noslash', '/a/../b', '/a?b'):
            with self.assertRaises(ValueError): self.s.set_files({bad: (b'', 'x')})

    def test_lock_to_first_tv(self):
        self.assertTrue(self.s.client_allowed('192.168.1.50'))
        self.assertFalse(self.s.client_allowed('8.8.8.8'))
        self.s.fetched('127.0.0.1', '/widgetlist.xml')          # loopback never locks
        self.assertIsNone(self.s.locked_to)
        self.s.fetched('192.168.1.50', '/widgetlist.xml')
        self.assertEqual(self.s.locked_to, '192.168.1.50')
        self.assertFalse(self.s.client_allowed('192.168.1.51'))
        self.assertTrue(self.s.client_allowed('192.168.1.50'))
        self.assertTrue(self.s.client_allowed('127.0.0.1'))
        self.s.unlock()
        self.assertTrue(self.s.client_allowed('192.168.1.51'))

    def test_allow_single_tv(self):
        self.s.allow = {'192.168.1.50'}
        self.assertTrue(self.s.client_allowed('192.168.1.50'))
        self.assertFalse(self.s.client_allowed('192.168.1.51'))


class Update(unittest.TestCase):
    def test_files_have_no_secrets(self):
        f = lanserver.update_files(b'var App={};', '0.0.2')
        self.assertEqual(sorted(f), ['/neo-helper', '/update/app.js', '/update/manifest.json'])
        m = json.loads(f['/update/manifest.json'][0])
        self.assertEqual(m['size'], 11)
        self.assertEqual(len(m['sha256']), 64)


class UI(unittest.TestCase):
    def setUp(self):
        self.w = Wizard(H.base_entries, prefs={}, sync_port=0, update_port=0, settings_file='/nonexistent/x.json')
        self.ui = UIServer(self.w, 0)
        self.port = self.ui.server_address[1]
        threading.Thread(target=self.ui.serve_forever, daemon=True).start()
        self.host = '127.0.0.1:%d' % self.port

    def tearDown(self):
        self.ui.shutdown(); self.ui.server_close()

    def post(self, action, body=b'{}', **hdr):
        h = {'Host': self.host, 'Content-Type': 'application/json', 'X-Neo-Csrf': self.ui.csrf}
        h.update(hdr)
        return req(self.port, 'POST', '/api/' + action, h, body)

    def test_page_embeds_csrf_and_csp(self):
        st, body = req(self.port, 'GET', '/', {'Host': self.host})
        self.assertEqual(st, 200)
        self.assertIn(self.ui.csrf.encode(), body)
        self.assertNotIn(b'__CSRF__', body)
        c = http.client.HTTPConnection('127.0.0.1', self.port); c.request('GET', '/', headers={'Host': self.host})
        r = c.getresponse(); r.read(); c.close()
        self.assertIn("frame-ancestors 'none'", r.getheader('Content-Security-Policy'))

    def test_bind_loopback_only(self):
        with self.assertRaises(ValueError): UIServer(self.w, 0, host='0.0.0.0')

    def test_dns_rebinding_host(self):
        self.assertEqual(req(self.port, 'GET', '/', {'Host': 'evil.example:%d' % self.port})[0], 403)
        self.assertEqual(self.post('state', Host='evil.example')[0], 403)

    def test_deeply_nested_json(self):
        """Pentest: 30 000 nested arrays raised RecursionError (not ValueError) -> handler died with a traceback."""
        st, body = self.post('profiles', b'{"ids":' + b'[' * 30000 + b']' * 30000 + b'}')
        self.assertEqual(st, 400)
        self.assertIn(b'bad_input', body)

    def test_csrf(self):
        self.assertEqual(self.post('state', **{'X-Neo-Csrf': 'wrong'})[0], 403)
        st, body = self.post('state')
        self.assertEqual(st, 200)
        self.assertTrue(json.loads(body)['ok'])

    def test_origin_and_content_type(self):
        self.assertEqual(self.post('state', Origin='http://evil.example')[0], 403)
        self.assertEqual(self.post('state', Origin='http://' + self.host)[0], 200)
        self.assertEqual(self.post('state', **{'Content-Type': 'text/plain'})[0], 415)

    def test_input_validation(self):
        self.assertEqual(self.post('nope')[0], 404)
        self.assertEqual(self.post('state', b'[1,2]')[0], 400)
        st, body = self.post('choose_server', json.dumps({'id': {'x': 1}}).encode())
        self.assertEqual(json.loads(body)['error'], 'bad_input')
        st, body = self.post('login_start', json.dumps({'kind': 'other'}).encode())
        self.assertEqual(json.loads(body)['error'], 'bad_input')
        st, body = self.post('build')
        self.assertEqual(json.loads(body)['error'], 'no_server')
        st, body = self.post('build', json.dumps({'resetPins': 'yes'}).encode())
        self.assertEqual(json.loads(body)['error'], 'bad_input')      # only a real boolean


if __name__ == '__main__':
    unittest.main()
