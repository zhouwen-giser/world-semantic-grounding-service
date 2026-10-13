"""Source integrity, deterministic bytes, and rejection before extraction."""
import gzip
import io
import json
from pathlib import Path
import tarfile
import tempfile
import subprocess
import sys
import unittest
from bundle_common import checked_package, extract, sha, verify_tree, write_archive


class BundleTests(unittest.TestCase):
    def test_reproducible_and_executable(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            files = {'deploy': b'#!/bin/sh\nexit 0\n', 'contracts/public.json': b'{}\n'}
            first, second = root / 'one.tar.gz', root / 'two.tar.gz'
            write_archive(first, 'bundle', files, {'deploy': 0o755})
            write_archive(second, 'bundle', files, {'deploy': 0o755})
            self.assertEqual(first.read_bytes(), second.read_bytes())
            checked_package(first)
            target = extract(first, root / 'extracted')
            self.assertEqual((target / 'deploy').stat().st_mode & 0o777, 0o755)
            self.assertEqual((target / 'contracts/public.json').read_bytes(), b'{}\n')

    def archive(self, names):
        stream = io.BytesIO()
        with gzip.GzipFile(fileobj=stream, mode='wb', mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w') as archive:
            for name, kind, data in names:
                entry = tarfile.TarInfo(name)
                entry.type = kind
                if kind == tarfile.REGTYPE:
                    entry.size = len(data)
                    archive.addfile(entry, io.BytesIO(data))
                else:
                    entry.linkname = '../../outside'
                    archive.addfile(entry)
        return stream.getvalue()

    def test_rejects_escape_links_duplicates_and_incomplete_inventory(self):
        cases = [
            [('bundle/../../outside', tarfile.REGTYPE, b'unsafe')],
            [('bundle/link', tarfile.SYMTYPE, b'')],
            [('bundle/link', tarfile.LNKTYPE, b'')],
            [('bundle/file', tarfile.REGTYPE, b'a'), ('bundle/file', tarfile.REGTYPE, b'b')],
            [('bundle/SHA256SUMS', tarfile.REGTYPE, b''), ('bundle/unlisted', tarfile.REGTYPE, b'bad')],
            [('bundle/file', tarfile.REGTYPE, b'no inventory')],
            [('bundle/SHA256SUMS', tarfile.REGTYPE, b'0' * 64 + b'  ./file\n'), ('bundle/file', tarfile.REGTYPE, b'tampered')],
        ]
        for entries in cases:
            with self.subTest(entries=entries):
                with tempfile.TemporaryDirectory() as folder:
                    with self.assertRaises(ValueError):
                        extract(self.archive(entries), Path(folder) / 'extracted')
                    self.assertFalse((Path(folder) / 'extracted').exists())

    def test_external_digest_detects_corruption(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = Path(folder) / 'source.tar.gz'
            write_archive(archive, 'bundle', {'file': b'original'})
            archive.write_bytes(archive.read_bytes() + b'changed')
            with self.assertRaises(ValueError):
                checked_package(archive)

    def test_cached_source_is_bound_to_the_selected_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old, new = root / 'old.tar.gz', root / 'new.tar.gz'
            write_archive(old, 'bundle', {'source.js': b'old source'})
            write_archive(new, 'bundle', {'source.js': b'new source'})
            cached = extract(old, root / 'cache')
            (cached / 'generated-runtime.json').write_text('{}')
            self.assertEqual(verify_tree(old, cached), 'bundle')
            with self.assertRaises(ValueError):
                verify_tree(new, cached)
            (cached / 'source.js').write_bytes(b'tampered')
            with self.assertRaises(ValueError):
                verify_tree(old, cached)

    def test_unified_build_rejects_a_different_consumer_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            native = root / 'gowm.tar.gz'
            write_archive(native, 'gowm', {'public-contract.json': b'{}'})
            native_data = native.read_bytes()
            joint = root / 'gdps.tar.gz'
            lock = {'packageName': native.name, 'sha256': sha(native_data)}
            write_archive(joint, 'gdps', {'packages/' + native.name: native_data,
                'deployment/gowm-dev-package-lock.json': json.dumps(lock).encode()})
            joint_data = joint.read_bytes()
            analysis = root / 'gsap.tar.gz'
            write_archive(analysis, 'gsap', {'packages/' + joint.name: joint_data,
                'deployment/SOURCE.json': json.dumps({'packageName': joint.name, 'sha256': sha(joint_data), 'nestedGowm': lock}).encode()})
            consumer = root / 'wsgs.tar.gz'
            write_archive(consumer, 'wsgs', {'contracts/upstream/gowm-current/SNAPSHOT.json': json.dumps({
                'analysisPackage': {'sha256': '0' * 64}, 'source': {'combinedSha256': sha(joint_data), 'sha256': sha(native_data)}}).encode()})
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('package-unified.py')),
                '--gsap-package', str(analysis), '--wsgs-package', str(consumer), '--output', str(root / 'output')],
                capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('WSGS consumers differ from GSAP deployment', result.stderr)
            self.assertFalse((root / 'output').exists())


if __name__ == '__main__':
    unittest.main()
