"""installer/build.py: a release payload must never carry values from local.json (home network addresses)."""
import importlib.util
import json
import os
import tempfile
import unittest

import helpers as H  # noqa: F401

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location('neobuild', os.path.join(ROOT, 'installer', 'build.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class LocalValues(unittest.TestCase):
    def test_detects_local_json_values(self):
        d = tempfile.mkdtemp()
        with open(os.path.join(d, 'local.json'), 'w') as f:
            json.dump({'pms': 'http://192.0.2.10:32400', 'logHost': '192.0.2.11:8099', 'allowClients': ['192.0.2.12'], 'x': 1}, f)
        app = b'N.config.apply({"pms":"http://192.0.2.10:32400","logHost":"192.0.2.11:8099"});'
        self.assertEqual(build.local_values_in([app], d), ['logHost', 'pms'])
        self.assertEqual(build.local_values_in([b'var a=1;'], d), [])

    def test_bare_hosts_and_all_text_files(self):
        """Also the bare host/IP of a local.json URL (without http://), only as a whole address; examples not in local.json pass."""
        d = tempfile.mkdtemp()
        with open(os.path.join(d, 'local.json'), 'w') as f:
            json.dump({'pms': 'http://192.0.2.89:32400', 'macIp': '192.0.2.38', 'proxyHost': 'mini.home.example:8080', 'x': 'http://127.0.0.1:1'}, f)
        L = build.local_values_in
        self.assertEqual(L([b'<p>Server 192.0.2.89</p>'], d), ['pms'])                    # IP without http:// and port
        self.assertEqual(L([b'"host":"192.0.2.38"'], d), ['macIp'])
        self.assertEqual(L([b'see mini.home.example for help'], d), ['proxyHost'])
        self.assertEqual(L([b'e.g. 192.0.2.20:5055 or 192.0.2.8 or 192.0.2.389 or 10.192.0.2.38'], d), [])   # examples / partial numbers
        self.assertEqual(L([b'ends with 192.0.2.38.'], d), ['macIp'])                     # end of a sentence
        self.assertEqual(L([b'http://127.0.0.1:2 localhost'], d), [])                     # loopback is not a home value
        entries = [('app.js', b'var a=1;'), ('index.html', b'<a href="http://192.0.2.89:32400/x">'), ('img/x.png', b'192.0.2.38'),
                   ('widget.info', b'host=192.0.2.38')]
        self.assertEqual(L(build.payload_texts(entries), d), ['macIp', 'pms'])           # every text file, not only app.js; images skipped

    def test_no_local_json(self):
        self.assertEqual(build.local_values_in([b'anything'], tempfile.mkdtemp()), [])


class WinVersionInfo(unittest.TestCase):
    def test_names_shown_by_windows(self):
        # Task Manager / Settings -> Startup apps: FileDescription as the name, CompanyName as the publisher
        build.APP_SLUG = 'demoneo'
        v = build.win_version_info({'name': 'Demo Neo'}, '1.2.3-rc.4')
        for k, x in (('FileDescription', 'Demo Neo Setup & Helper'), ('CompanyName', 'Demo Neo'), ('ProductName', 'Demo Neo'),
                     ('FileVersion', '1.2.3-rc.4'), ('OriginalFilename', 'demoneo-setup.exe')):
            self.assertIn('StringStruct(%r, %r)' % (k, x), v)
        self.assertIn('filevers=(1, 2, 3, 4)', v)


if __name__ == '__main__':
    unittest.main()
