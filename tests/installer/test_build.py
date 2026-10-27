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

    def test_no_local_json(self):
        self.assertEqual(build.local_values_in([b'anything'], tempfile.mkdtemp()), [])


if __name__ == '__main__':
    unittest.main()
