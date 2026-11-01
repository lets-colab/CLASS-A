import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'import_gate.py'


class SourceGateTests(unittest.TestCase):
    def check(self, root):
        return subprocess.run([sys.executable, str(SCRIPT), '--root', str(root), '--json'], capture_output=True, text=True)

    def test_no_source_is_blocked_not_passed(self):
        with tempfile.TemporaryDirectory() as td:
            result = self.check(td)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(json.loads(result.stdout)['state'], 'SOURCE_MISSING')

    def test_valid_static_export_is_only_staged(self):
        with tempfile.TemporaryDirectory() as td:
            site = Path(td) / 'site'
            site.mkdir()
            (site / 'index.html').write_text('<!doctype html><html><head><title>Sample</title></head><body>Example</body></html>', encoding='utf-8')
            result = self.check(td)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            report = json.loads(result.stdout)
            self.assertEqual(report['state'], 'SOURCE_STAGED_UNVERIFIED')
            self.assertEqual(report['type'], 'static')
            self.assertEqual(len(report['sha256']), 64)

    def test_non_site_documentation_cannot_pass_as_source(self):
        with tempfile.TemporaryDirectory() as td:
            site = Path(td) / 'site'
            site.mkdir()
            (site / 'README.md').write_text('import pending', encoding='utf-8')
            self.assertEqual(self.check(td).returncode, 2)

    def test_env_file_blocks_import(self):
        with tempfile.TemporaryDirectory() as td:
            site = Path(td) / 'site'
            site.mkdir()
            (site / 'index.html').write_text('<html>works</html>', encoding='utf-8')
            (site / '.env').write_text('SECRET=secret', encoding='utf-8')
            result = self.check(td)
            self.assertEqual(result.returncode, 3)
            self.assertEqual(json.loads(result.stdout)['state'], 'UNSAFE_SOURCE')

    def test_missing_local_static_asset_blocks_import(self):
        with tempfile.TemporaryDirectory() as td:
            site = Path(td) / 'site'
            site.mkdir()
            (site / 'index.html').write_text('<html><script src="./missing.js"></script></html>', encoding='utf-8')
            result = self.check(td)
            self.assertEqual(result.returncode, 4)
            self.assertEqual(json.loads(result.stdout)['state'], 'REFERENCES_MISSING')

    def test_existing_local_static_asset_is_accepted(self):
        with tempfile.TemporaryDirectory() as td:
            site = Path(td) / 'site'
            site.mkdir()
            (site / 'index.html').write_text('<html><img src="/assets/a.png"></html>', encoding='utf-8')
            (site / 'assets').mkdir()
            (site / 'assets' / 'a.png').write_bytes(b'valid for gate test')
            self.assertEqual(self.check(td).returncode, 0)


if __name__ == '__main__':
    unittest.main()
