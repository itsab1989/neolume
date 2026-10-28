"""Optional extensions of an edition (neosetup/ext.py): without an extension package every hook is a no-op, the helper
file keeps unknown blocks unchanged, and POST is only accepted for routes an extension owns."""
import json
import os
import tempfile
import unittest
import urllib.error
import urllib.request

import helpers as H  # noqa: F401  (import path + isolated settings folder)
from neosetup import brand, ext
from neosetup.helper import Helper, Store
from neosetup.lanserver import LanServer


class Ext(unittest.TestCase):
    def test_noop_without_package(self):
        saved = dict(brand.CURRENT)
        try:
            brand.CURRENT['features'] = ['no-such-feature']
            ext._cache.clear()
            self.assertEqual(ext.state(None), {})
            self.assertEqual(ext.actions(None), {})
            cfg = {'a': 1}
            ext.config(None, cfg)
            self.assertEqual(cfg, {'a': 1})
        finally:
            brand.CURRENT.clear(); brand.CURRENT.update(saved); ext._cache.clear()

    def test_brand_features(self):
        saved = dict(brand.CURRENT)
        try:
            brand.load_dict({'name': 'X', 'features': ['ok-1', 'Bad Name', 3]})
            self.assertEqual(brand.features(), ['ok-1'])
            brand.load_dict({'name': 'X'})
            self.assertEqual(brand.features(), [])
        finally:
            brand.CURRENT.clear(); brand.CURRENT.update(saved)

    def test_helper_file_keeps_extra_blocks(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, 'helper.json')
        s = Store(None, {'u-owner': {'token': H.OWNER_TOK, 'title': 'Owner', 'kind': 'owner'}})
        s.extra['addon'] = {'x': 1}
        s.extra['key'] = 'must-not-override'
        s.save(p)
        with open(p) as f: raw = json.load(f)
        self.assertEqual((raw['addon'], raw['key']), ({'x': 1}, s.key))
        self.assertEqual(Store.load(p).extra, {'addon': {'x': 1}})

    def test_post_refused_without_extension(self):
        h = Helper(Store(None, {'u-owner': {'token': H.OWNER_TOK, 'title': 'Owner', 'kind': 'owner'}}), 'plexneo-helper-test')
        self.assertEqual(h.ext, [])
        srv = LanServer('helper', 0, bind='127.0.0.1')
        srv.api = h
        srv.start()
        try:
            for path in ('/neo-helper', '/watchlist', '/anything'):
                with self.assertRaises(urllib.error.HTTPError) as c:
                    urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:%d%s' % (srv.port, path), data=b'{}', method='POST'), timeout=5)
                self.assertEqual(c.exception.code, 405, path)
            with self.assertRaises(urllib.error.HTTPError) as c:
                urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:%d/neo-helper' % srv.port, data=b'x' * 5000, method='POST'), timeout=5)
            self.assertEqual(c.exception.code, 413)
        finally:
            srv.stop()


if __name__ == '__main__':
    unittest.main()
