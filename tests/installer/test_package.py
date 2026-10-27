import datetime
import io
import json
import os
import shutil
import tempfile
import unittest
import zipfile

import helpers as H
from neosetup import package
from neosetup.package import PackageError

SERVER = {'machineIdentifier': H.MID, 'name': 'Home Server'}
PROFILES = [
    {'id': 1, 'uuid': 'u-owner', 'title': 'Owner', 'thumb': '', 'kind': 'owner', 'restricted': False, 'token': H.OWNER_TOK, 'include': True},
    {'id': 2, 'uuid': 'u-kid', 'title': 'Kid', 'thumb': '', 'kind': 'home', 'restricted': True, 'restrictionProfile': 'little_kid', 'token': H.KID_TOK, 'include': True},
    {'id': 77, 'uuid': 'friend-77', 'title': 'buddy', 'thumb': '', 'kind': 'friend', 'restricted': False, 'token': H.FRIEND_TOK, 'include': True},
    {'id': 4, 'uuid': 'u-new', 'title': 'NoShare', 'thumb': '', 'kind': 'home', 'restricted': False, 'token': None, 'include': True},
]


def unzip(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z: return dict((n, z.read(n)) for n in z.namelist())


class Config(unittest.TestCase):
    def test_schema(self):
        now = datetime.datetime(2026, 10, 26, 12, 0, 0, tzinfo=datetime.timezone.utc)
        c = package.make_config('plexneo-x1234567', SERVER, ['http://192.0.2.20:32400'], PROFILES, '192.0.2.10', 32499, now)
        self.assertEqual(c['schema'], 1)
        self.assertEqual(c['kind'], 'plexneo-setup')
        self.assertEqual(c['createdAt'], '2026-10-26T12:00:00Z')
        self.assertEqual(c['server'], {'machineIdentifier': H.MID, 'name': 'Home Server', 'uris': ['http://192.0.2.20:32400']})
        self.assertEqual([p['title'] for p in c['profiles']], ['Owner', 'Kid'])    # friend (even if included) + tokenless dropped
        self.assertNotIn(H.FRIEND_TOK, json.dumps(c))
        self.assertEqual(c['profiles'][1]['token'], H.KID_TOK)
        self.assertEqual(c['profiles'][1]['restrictionProfile'], 'little_kid')
        self.assertEqual(c['computer'], {'address': '192.0.2.10', 'updatePort': 32499})
        self.assertNotIn('include', c['profiles'][0])
        self.assertNotIn('resetAppPins', c)                             # default: app PINs are kept on re-setup
        r = package.make_config('plexneo-x1234567', SERVER, ['http://192.0.2.20:32400'], PROFILES, '192.0.2.10', 32499, now, reset_pins=True)
        self.assertIs(r['resetAppPins'], True)


class Build(unittest.TestCase):
    def cfg(self):
        return package.make_config('plexneo-x1234567', SERVER, ['http://192.0.2.20:32400'], PROFILES, '192.0.2.10', 32499)

    def test_package_layout(self):
        files = unzip(package.build_package(H.base_entries(), self.cfg()))
        self.assertIn("var DEV_HOST = ''", files['boot.js'].decode())          # release loader forced
        self.assertNotIn('bench.js', files)                                    # dev prototype dropped
        cfg = json.loads(files['setup.json'].decode())
        self.assertEqual(len(cfg['profiles']), 2)                              # old setup.json replaced
        for n in ('widget.info', 'index.html', 'config.xml', 'app.js', 'icons.png', 'icon/w4_00000000_106x87.png'):
            self.assertIn(n, files)

    def test_deterministic(self):
        c = self.cfg()
        self.assertEqual(package.build_package(H.base_entries(), c), package.build_package(H.base_entries(), c))

    def test_needs_profiles_and_complete_base(self):
        c = self.cfg(); c['profiles'] = []
        with self.assertRaises(PackageError): package.build_package(H.base_entries(), c)
        base = [e for e in H.base_entries() if e[0] != 'app.js']
        with self.assertRaises(PackageError) as ctx: package.build_package(base, self.cfg())
        self.assertEqual(ctx.exception.code, 'incomplete')

    def test_unsafe_entries(self):
        for bad in ('../evil.js', '/abs.js', 'a\\b.js', 'x/../../y'):
            with self.assertRaises(PackageError, msg=bad): package.release_entries(H.base_entries() + [(bad, b'')])
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as z: z.writestr('../../etc/x', b'1')
        with self.assertRaises(PackageError): package.read_zip_entries(buf.getvalue())
        with self.assertRaises(PackageError): package.read_zip_entries(b'not a zip')

    def test_app_version(self):
        self.assertEqual(package.app_version(H.base_entries()), '0.0.2')


class WidgetList(unittest.TestCase):
    def test_xml(self):
        x = package.widgetlist('192.0.2.10', [
            {'id': 'TestApp', 'title': 'Test App', 'file': 'TestApp.zip', 'size': 123},
            {'id': 'Other_App', 'title': 'A <&> B', 'file': 'OtherApp.zip', 'size': 9}]).decode()
        self.assertIn('<widget id="TestApp">', x)
        self.assertIn('<download>http://192.0.2.10/TestApp.zip</download>', x)
        self.assertIn('<compression size="123" type="zip"/>', x)
        self.assertIn('A &lt;&amp;&gt; B', x)
        self.assertIn('<download>http://192.0.2.10/OtherApp.zip</download>', x)

    def test_validation(self):
        with self.assertRaises(PackageError): package.widgetlist('evil.example/x', [])
        with self.assertRaises(PackageError):
            package.widgetlist('192.0.2.10', [{'id': 'a"b', 'title': '', 'file': 'x.zip', 'size': 1}])
        with self.assertRaises(PackageError):
            package.widgetlist('192.0.2.10', [{'id': 'ab', 'title': '', 'file': '../x.zip', 'size': 1}])


class ExtraApps(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def mk(self, name, entries):
        p = os.path.join(self.dir, name)
        with zipfile.ZipFile(p, 'w') as z:
            for n, d in entries: z.writestr(n, d)
        return p

    def test_read(self):
        p = self.mk('OtherApp.zip', [('config.xml', b'<widget><widgetname>Other App</widgetname></widget>'), ('a.js', b'')])
        a = package.read_extra_app(p)
        self.assertEqual((a['id'], a['title'], a['file']), ('OtherApp', 'Other App', 'OtherApp.zip'))
        self.assertEqual(package.read_extra_app(p, 'Other_Id')['id'], 'Other_Id')

    def test_reject(self):
        with self.assertRaises(PackageError): package.read_extra_app(os.path.join(self.dir, 'missing.zip'))
        with self.assertRaises(PackageError): package.read_extra_app(self.mk('NoApp.zip', [('x', b'')]))
        with self.assertRaises(PackageError): package.read_extra_app(self.mk('Neolume.zip', [('config.xml', b'')]))
        with self.assertRaises(PackageError): package.read_extra_app(self.mk('bad name.zip', [('config.xml', b'')]))

    def test_spec(self):
        self.assertEqual(package.parse_extra_spec('Other_App=/x/OtherApp.zip'), ('/x/OtherApp.zip', 'Other_App'))
        self.assertEqual(package.parse_extra_spec(' /x/App.zip '), ('/x/App.zip', None))
        self.assertEqual(package.parse_extra_spec('C:\\Apps\\App.zip'), ('C:\\Apps\\App.zip', None))


class FromRepo(unittest.TestCase):
    def test_base_from_repo(self):
        d = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(d, 'loader', 'icon')); os.makedirs(os.path.join(d, 'app'))
            os.makedirs(os.path.join(d, 'loader-icons', 'w4')); os.makedirs(os.path.join(d, 'loader-icons', 'original'))
            for n, data in (('loader/boot.js', b"var DEV_HOST = '';"), ('loader/index.html', b'<title>x</title>'), ('loader/widget.info', b''),
                            ('loader/config.xml', b'<x>icon/icon_106x87.png</x><widgetname itemtype="string">x</widgetname>'),
                            ('loader/icon/icon_106x87.png', b'old'), ('loader-icons/original/icon_106x87.png', b'pub'),
                            ('loader-icons/w4/icon_106x87.png', b'new'), ('app/app.js', b'App'), ('app/bench.js', b'x'),
                            ('app/icons.png', b'p')):
                with open(os.path.join(d, n), 'wb') as f: f.write(data)
            e = dict(package.base_from_repo(d))                      # public brand: icon "original", name in config.xml
            icon = [n for n in e if n.startswith('icon/')][0]
            self.assertRegex(icon, r'^icon/original_[0-9a-f]{8}_106x87\.png$')
            self.assertEqual(e[icon], b'pub')
            self.assertIn(b'<widgetname itemtype="string">Neolume</widgetname>', e['config.xml'])
            self.assertIn(b'<title>Neolume</title>', e['index.html'])
            e = dict(package.base_from_repo(d, 'w4'))                 # explicit icon set
            icon = [n for n in e if n.startswith('icon/')][0]
            self.assertRegex(icon, r'^icon/w4_[0-9a-f]{8}_106x87\.png$')
            self.assertEqual(e[icon], b'new')
            self.assertIn(icon.encode(), e['config.xml'])
            self.assertNotIn('bench.js', e)
            self.assertEqual(e['app.js'], b'App')
            with open(os.path.join(d, 'app', 'app.min.js'), 'wb') as f: f.write(b'Min')
            e = dict(package.base_from_repo(d))
            self.assertEqual(e['app.js'], b'Min')                  # release build preferred, like dev.py --release
            self.assertNotIn('app.min.js', e)
        finally:
            shutil.rmtree(d)


if __name__ == '__main__':
    unittest.main()
