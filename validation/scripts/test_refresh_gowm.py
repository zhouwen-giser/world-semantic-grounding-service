import importlib.util
import io
import json
import os
from unittest.mock import patch
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('refresh', Path(__file__).with_name('refresh-gowm.py'))
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)
PATTERN = r'gowm-dev-server-(\d+\.\d+\.\d+)\.tar\.gz'


class PublishedReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="wsgs~ refresh-契约-")
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def package(self, version, data=b'published'):
        p = self.root / ('gowm-dev-server-' + version + '.tar.gz')
        p.write_bytes(data)
        p.with_name(p.name + '.sha256').write_text(refresh.digest(data) + '  ' + p.name + '\n', encoding="utf-8", newline="\n")
        return p

    def test_selects_future_release_not_lexical_order_or_backup(self):
        self.package('0.7.1')
        self.package('0.9.0')
        expected = self.package('0.10.0')
        backup = self.root / 'previous-gowm-dev-server-99.0.0'
        backup.mkdir()
        (backup / 'gowm-dev-server-99.0.0.tar.gz').write_bytes(b'ignored')
        self.assertEqual(refresh.latest(self.root, PATTERN)[0], expected)

    def test_corrupt_latest_never_falls_back(self):
        self.package('0.7.1')
        self.package('1.0.0').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'INTEGRITY_MISMATCH'):
            refresh.latest(self.root, PATTERN)

    def test_missing_checksum_never_falls_back(self):
        self.package('0.7.1')
        p = self.package('1.0.0')
        p.with_name(p.name + '.sha256').unlink()
        with self.assertRaises(FileNotFoundError):
            refresh.latest(self.root, PATTERN)

    def test_same_version_republication_requires_matching_checksum(self):
        p = self.package('1.0.0')
        before = refresh.latest(self.root, PATTERN)[1]
        p.write_bytes(b'republication')
        with self.assertRaisesRegex(ValueError, 'INTEGRITY_MISMATCH'):
            refresh.latest(self.root, PATTERN)
        self.package('1.0.0', b'republication')
        self.assertNotEqual(refresh.latest(self.root, PATTERN)[1], before)

    def test_equivalent_version_candidates_are_ambiguous(self):
        self.package('1.0.0')
        self.package('01.0.0')
        with self.assertRaisesRegex(ValueError, 'AMBIGUOUS'):
            refresh.latest(self.root, PATTERN)

    def test_archive_rejects_traversal_and_symlinks(self):
        for name, kind in [('root/../escape', tarfile.REGTYPE), ('root/link', tarfile.SYMTYPE)]:
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode='w:gz') as tar:
                info = tarfile.TarInfo(name)
                info.type = kind
                tar.addfile(info)
            with self.assertRaisesRegex(ValueError, 'UNSAFE_ARCHIVE_MEMBER'):
                refresh.archive(data.getvalue())


class FullConsumerRefreshTests(unittest.TestCase):
    """Synthetic future publication with the current public contracts, never live evidence."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="wsgs~ refresh-契约-")
        self.root = Path(self.temp.name)
        self.current = refresh.ROOT / 'contracts/upstream/gowm-current'
        self.snapshot = json.loads((self.current / 'SNAPSHOT.json').read_text(encoding="utf-8"))
        self.dirs = [self.root / n for n in ['gowm', 'combined', 'analysis']]
        for p in self.dirs:
            p.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def publish(self, directory, name, files):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w:gz') as archive:
            for p, data in sorted(files.items()):
                member = tarfile.TarInfo('formal/' + p)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        data = output.getvalue()
        target = directory / name
        target.write_bytes(data)
        target.with_name(name + '.sha256').write_text(refresh.digest(data) + '  ' + name + '\n', encoding="utf-8", newline="\n")
        return data

    def fixture(self, missing_dependency=False):
        encode = lambda value: json.dumps(value).encode()
        def future(value):
            if isinstance(value, dict): return {k: future(v) for k, v in value.items()}
            if isinstance(value, list): return [future(v) for v in value]
            return '9.0.0' if value == self.snapshot['packageVersion'] else value
        prefix = 'packages/platform/world-gateway-contracts/'
        files = {prefix + 'package.json': encode(future(json.loads((self.current / 'package.json').read_text(encoding="utf-8"))))}
        manifest = future(json.loads((self.current / 'bundle/MANIFEST.json').read_text(encoding="utf-8")))
        for entry in manifest['files']:
            data = (self.current / 'bundle' / entry['path']).read_bytes()
            if 'wsgs-southbound-operation-lock-v2' in entry['path']:
                data = encode(future(json.loads(data)))
            entry['sha256'], entry['bytes'] = refresh.digest(data), len(data)
            files[prefix + 'bundle/' + entry['path']] = data
        files[prefix + 'bundle/MANIFEST.json'] = encode(manifest)
        for p, record in self.snapshot['supportingSchemas'].items():
            if not missing_dependency:
                files[record['sourcePath']] = (self.current / 'bundle' / p).read_bytes()
        inputs = json.loads((self.current / 'PROVIDER_INPUTS.json').read_text(encoding="utf-8"))
        imports = []
        for name, value in inputs['vocabularies'].items():
            p = 'packages/platform/contract-runtime/src/' + name + '.json'
            files[p] = encode(value)
            imports.append('import ' + name + ' from "./' + name + '.json";')
        files['packages/platform/contract-runtime/src/catalog-revisions.ts'] = '\n'.join(imports).encode()
        providers = []
        gdps = None
        for i, item in enumerate(inputs['providers']):
            registration = dict(item['registration'])
            registration['manifestPath'] = 'manifests/provider-' + str(i) + '.json'
            files[registration['manifestPath']] = encode(item['manifest'])
            providers.append(registration)
            if registration['providerId'] == 'gdps.geospatial-products': gdps = item['manifest']
        name = 'gowm-dev-server-9.0.0.tar.gz'
        data = self.publish(self.dirs[0], name, files)
        combined_name = 'gdps-gowm-dev-server-9.0.0-gowm-9.0.0.tar.gz'
        outer = {'packages/' + name: data, 'deployment/gowm-dev-package-lock.json': encode({'packageName': name, 'sha256': refresh.digest(data), 'softwareVersion': '9.0.0', 'sourceCommit': 'b' * 40}),
                 'deployment/generated/gdps-provider-manifest.json': encode(gdps)}
        for n in ['product-type-descriptors.json', 'product-vocabularies.json']:
            outer['gdps/config/' + n] = (self.current / 'gdps' / n).read_bytes()
        combined = self.publish(self.dirs[1], combined_name, outer)
        analysis = {'packages/' + combined_name: combined,
                    'deployment/SOURCE.json': encode({'sha256': refresh.digest(combined), 'analysisSource': {'gitCommit': 'a' * 40}, 'generatedAt': '2026-09-07T00:00:00Z'}),
                    'deployment/generated/registry.json': encode({'providers': providers})}
        for p in (self.current / 'analysis').rglob('*'):
            if p.is_file() and p.name != 'source.json':
                analysis['analysis/' + p.relative_to(self.current / 'analysis').as_posix()] = p.read_bytes()
        self.publish(self.dirs[2], 'gowm-gdps-analysis-dev-server-9.0.0.tar.gz', analysis)

    def run_refresh(self):
        dest = self.root / 'snapshot'
        dest.mkdir()
        with patch.dict(os.environ, {'WSGS_ANALYSIS_RELEASE_DIR': str(self.dirs[2])}):
            return refresh.prepare(self.dirs[0], self.dirs[1], dest)

    def test_future_full_publication_validates_without_version_ceiling(self):
        self.fixture()
        result = self.run_refresh()
        self.assertEqual(result['packageVersion'], '9.0.0')
        self.assertEqual(result['gatewayContractVersion'], '9.0.0')

    def test_missing_dependency_blocks_full_refresh(self):
        self.fixture(missing_dependency=True)
        with self.assertRaisesRegex(ValueError, 'FORMAL_SCHEMA_DEPENDENCY_MISSING'):
            self.run_refresh()

    def test_publication_change_during_projection_blocks_refresh(self):
        self.fixture()
        original = refresh.subprocess.run
        def changed(*args, **kwargs):
            result = original(*args, **kwargs)
            self.publish(self.dirs[0], 'gowm-dev-server-10.0.0.tar.gz', {'marker': b'new publication'})
            return result
        with patch.object(refresh.subprocess, 'run', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'FORMAL_RELEASE_CHANGED_DURING_REFRESH'):
                self.run_refresh()


if __name__ == '__main__':
    unittest.main()
