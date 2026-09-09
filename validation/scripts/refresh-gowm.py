"""Consume the latest published deployment, never a checkout or backup directory."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import posixpath
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def latest(directory, pattern):
    candidates = []
    for path in Path(directory).iterdir():
        match = re.fullmatch(pattern, path.name)
        if match and path.is_file() and not path.is_symlink():
            candidates.append((tuple(int(n) for n in match[1].split('.')), path))
    if not candidates:
        raise ValueError('LATEST_FORMAL_PACKAGE_MISSING')
    candidates.sort()
    version, path = candidates[-1]
    if sum(v == version for v, _ in candidates) != 1:
        raise ValueError('LATEST_FORMAL_PACKAGE_AMBIGUOUS')
    data = path.read_bytes()
    checksum = path.with_name(path.name + '.sha256').read_text().strip().split()
    if checksum != [digest(data), path.name]:
        raise ValueError('LATEST_FORMAL_PACKAGE_INTEGRITY_MISMATCH')
    return path, data


def archive(data):
    files = {}
    roots = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        for member in tar:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or member.issym() or member.islnk():
                raise ValueError('UNSAFE_ARCHIVE_MEMBER')
            roots.add(path.parts[0])
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError('UNSUPPORTED_ARCHIVE_MEMBER')
            name = '/'.join(path.parts[1:])
            if name in files:
                raise ValueError('DUPLICATE_ARCHIVE_MEMBER')
            files[name] = tar.extractfile(member).read()
    if len(roots) != 1:
        raise ValueError('ARCHIVE_ROOT_AMBIGUOUS')
    return files


def safe_path(value):
    p = PurePosixPath(value.removeprefix('./'))
    if p.is_absolute() or '..' in p.parts or not p.parts:
        raise ValueError('UNSAFE_MANIFEST_PATH')
    return str(p)


def prepare(gowm_dir, combined_dir, destination):
    source, data = latest(gowm_dir, r'gowm-dev-server-(\d+\.\d+\.\d+)\.tar\.gz')
    combined, combined_data = latest(combined_dir, r'gdps-gowm-dev-server-(\d+\.\d+\.\d+)-gowm-\d+\.\d+\.\d+\.tar\.gz')
    outer = archive(combined_data)
    nested = json.loads(outer['deployment/gowm-dev-package-lock.json'])
    runtime_version = source.name.removeprefix('gowm-dev-server-').removesuffix('.tar.gz')
    if nested.get('packageName') != source.name or nested.get('softwareVersion') != runtime_version or not re.fullmatch(r'[0-9a-f]{40}', nested.get('sourceCommit', '')):
        raise ValueError('LATEST_GOWM_SOURCE_RECORD_MISMATCH')
    if nested['sha256'] != digest(data) or outer['packages/' + safe_path(nested['packageName'])] != data:
        raise ValueError('LATEST_GOWM_COMBINED_SOURCE_MISMATCH')
    files = archive(data)
    prefix = 'packages/platform/world-gateway-contracts/'
    package = json.loads(files[prefix + 'package.json'])
    exports = package['exports']
    manifest_path = safe_path(exports['./manifest'])
    manifest = json.loads(files[prefix + manifest_path])
    bundle = str(PurePosixPath(manifest_path).parent)
    if package['name'] != '@gowm/world-gateway-contracts' or manifest['packageName'] != package['name'] or manifest['packageVersion'] != package['version']:
        raise ValueError('CONSUMER_PACKAGE_AUTHORITY_MISMATCH')
    entries = {}
    for entry in manifest['files']:
        name = safe_path(entry['path'])
        if name in entries:
            raise ValueError('DUPLICATE_MANIFEST_ENTRY')
        content = files[prefix + bundle + '/' + name]
        if digest(content) != entry['sha256'] or len(content) != entry['bytes']:
            raise ValueError('CONSUMER_MANIFEST_INTEGRITY_MISMATCH')
        entries[name] = content
    lock_path = safe_path(exports['./wsgs-lock'])
    lock_relative = str(PurePosixPath(lock_path).relative_to(bundle))
    lock = json.loads(entries[lock_relative])
    if lock['consumerContractPackage']['version'] != package['version']:
        raise ValueError('CONSUMER_LOCK_VERSION_MISMATCH')
    # Select the published schema by its declared contract version, not filename.
    lock_schemas = [name for name, content in entries.items() if name.endswith('wsgs-southbound-operation-lock-v2.schema.json') and json.loads(content).get('properties', {}).get('gatewayContractVersion', {}).get('const') == lock['gatewayContractVersion']]
    if len(lock_schemas) != 1:
        raise ValueError('CONSUMER_LOCK_SCHEMA_AMBIGUOUS')
    source_lock = json.loads(files['SOURCE_LOCK.json']) if 'SOURCE_LOCK.json' in files else nested
    # Some public schemas reference supporting contracts shipped in the same
    # checksummed deployment archive but omitted from the consumer manifest.
    # Materialize only that reference closure; never fetch or synthesize schemas.
    supporting = {}
    def refs(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key == '$ref' and isinstance(item, str):
                    yield item.split('#')[0]
                else:
                    yield from refs(item)
        elif isinstance(value, list):
            for item in value:
                yield from refs(item)
    queue = [name for name in entries if name.startswith('schemas/') and name.endswith('.json')]
    for name in queue:
        for ref in refs(json.loads(entries[name])):
            if not ref:
                continue
            if ':' in ref or ref.startswith('/'):
                raise ValueError('EXTERNAL_SCHEMA_REFERENCE_UNSUPPORTED')
            target = safe_path(posixpath.normpath(posixpath.join(posixpath.dirname(name), ref)))
            if target in entries:
                continue
            if not target.startswith('schemas/'):
                raise ValueError('SCHEMA_REFERENCE_OUTSIDE_ROOT')
            origin = 'contracts/' + target.removeprefix('schemas/')
            if origin not in files:
                raise ValueError('FORMAL_SCHEMA_DEPENDENCY_MISSING: ' + target)
            entries[target] = files[origin]
            supporting[target] = {'sourcePath': origin, 'sha256': digest(files[origin])}
            queue.append(target)
    for name, content in entries.items():
        target = destination / 'bundle' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    (destination / 'bundle' / 'MANIFEST.json').write_bytes(files[prefix + manifest_path])
    (destination / 'package.json').write_bytes(files[prefix + 'package.json'])
    analysis_dir = Path(os.environ.get('WSGS_ANALYSIS_RELEASE_DIR', str(ROOT.parent / 'gowm-spatiotemporal-analysis-providers/output/deployment/current')))
    analysis_path, analysis_data = latest(analysis_dir, r'gowm-gdps-analysis-dev-server-(\d+\.\d+\.\d+)\.tar\.gz')
    analysis = archive(analysis_data)
    analysis_source = json.loads(analysis['deployment/SOURCE.json'])
    if analysis_source['sha256'] != digest(combined_data) or analysis['packages/' + combined.name] != combined_data:
        raise ValueError('LATEST_ANALYSIS_COMBINED_SOURCE_MISMATCH')
    registry = json.loads(analysis['deployment/generated/registry.json'])
    manifests = []
    for provider in registry['providers']:
        name = safe_path(provider['manifestPath'])
        generated = 'deployment/generated/manifests/' + PurePosixPath(name).name
        if generated in analysis:
            content = analysis[generated]
        elif provider['providerId'] == 'gdps.geospatial-products':
            content = outer['deployment/generated/gdps-provider-manifest.json']
        elif name in files:
            content = files[name]
        else:
            raise ValueError('FORMAL_PROVIDER_MANIFEST_MISSING')
        manifests.append({'registration': provider, 'manifest': json.loads(content)})
    vocabulary_source = 'packages/platform/contract-runtime/src/catalog-revisions.ts'
    vocabularies = {}
    for key, ref in re.findall(r'import (references|relations|statuses) from "([^"]+)"', files[vocabulary_source].decode()):
        name = safe_path(posixpath.normpath(posixpath.join(posixpath.dirname(vocabulary_source), ref)))
        vocabularies[key] = json.loads(files[name])
    if set(vocabularies) != {'references', 'relations', 'statuses'}:
        raise ValueError('CATALOG_VOCABULARY_AUTHORITY_MISSING')
    (destination / 'PROVIDER_INPUTS.json').write_text(json.dumps({'providers': manifests, 'vocabularies': vocabularies}, ensure_ascii=False) + '\n')
    analysis_files = []
    for name, content in sorted(analysis.items()):
        if not name.startswith(('analysis/contracts/', 'analysis/integration/')):
            continue
        relative = name.removeprefix('analysis/')
        target = destination / 'analysis' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        analysis_files.append({'path': relative, 'sha256': 'sha256:' + digest(content)})
    analysis_manifest = {'schemaVersion': '1.0', 'repository': 'zhouwen-giser/gowm-spatiotemporal-analysis-providers',
        'branch': 'published', 'commit': analysis_source['analysisSource']['gitCommit'], 'tree': digest(analysis_data),
        'capturedAt': analysis_source['generatedAt'], 'files': analysis_files}
    (destination / 'analysis/source.json').write_text(json.dumps(analysis_manifest, indent=2) + '\n')
    (destination / 'gdps').mkdir()
    for name in ['product-type-descriptors.json', 'product-vocabularies.json']:
        (destination / 'gdps' / name).write_bytes(outer['gdps/config/' + name])
    snapshot = {'schemaVersion': '1.0', 'policy': 'LATEST_FORMAL_AT_BUILD_AND_DEPLOY',
        'runtimeVersion': source.name.removeprefix('gowm-dev-server-').removesuffix('.tar.gz'),
        'packageVersion': package['version'], 'gatewayContractVersion': lock['gatewayContractVersion'],
        'source': {'package': source.name, 'sha256': digest(data), 'combinedPackage': combined.name, 'combinedSha256': digest(combined_data), 'sourceLock': source_lock},
        'lockPath': 'bundle/' + lock_relative, 'lockSha256': digest(entries[lock_relative]),
        'lockSchemaPath': 'bundle/' + lock_schemas[0], 'manifestSha256': digest(files[prefix + manifest_path]), 'supportingSchemas': supporting,
        'analysisPackage': {'name': analysis_path.name, 'sha256': digest(analysis_data)},
        'providerInputsSha256': digest((destination / 'PROVIDER_INPUTS.json').read_bytes()),
        'analysisSourceSha256': digest((destination / 'analysis/source.json').read_bytes())}
    (destination / 'SNAPSHOT.json').write_text(json.dumps(snapshot, indent=2) + '\n')
    subprocess.run(['node', 'validation/scripts/project-current-gowm.mjs', str(destination)], cwd=ROOT, check=True)
    subprocess.run(['node', 'validation/scripts/verify-current-gowm.mjs', str(destination)], cwd=ROOT, check=True)
    if latest(gowm_dir, r'gowm-dev-server-(\d+\.\d+\.\d+)\.tar\.gz')[1] != data or latest(combined_dir, r'gdps-gowm-dev-server-(\d+\.\d+\.\d+)-gowm-\d+\.\d+\.\d+\.tar\.gz')[1] != combined_data:
        raise ValueError('FORMAL_RELEASE_CHANGED_DURING_REFRESH')
    if latest(analysis_dir, r'gowm-gdps-analysis-dev-server-(\d+\.\d+\.\d+)\.tar\.gz')[1] != analysis_data:
        raise ValueError('FORMAL_RELEASE_CHANGED_DURING_REFRESH')
    return json.loads((destination / 'SNAPSHOT.json').read_text())


def main():
    upstream = ROOT / 'contracts/upstream'
    gowm = os.environ.get('WSGS_GOWM_RELEASE_DIR', str(ROOT.parent / 'geospatial-operational-world-model/output/deployment'))
    combined = os.environ.get('WSGS_GDPS_GOWM_RELEASE_DIR', str(ROOT.parent / 'geospatial-data-product-service/output/deployment'))
    guard = upstream / '.gowm-refresh.lock'
    fd = os.open(guard, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with tempfile.TemporaryDirectory(prefix='.gowm-refresh-', dir=upstream) as tmp:
            staged = Path(tmp)
            snapshot = prepare(gowm, combined, staged)
            revision = digest((staged / 'SNAPSHOT.json').read_bytes())
            releases = upstream / 'gowm-releases'
            releases.mkdir(exist_ok=True)
            target = releases / revision
            if not target.exists():
                shutil.copytree(staged, target)
            link = upstream / '.gowm-current-next'
            link.symlink_to('gowm-releases/' + revision, target_is_directory=True)
            link.replace(upstream / 'gowm-current')
            print(json.dumps({'status': 'PASS', 'snapshot': revision, 'packageVersion': snapshot['packageVersion']}))
    finally:
        os.close(fd)
        guard.unlink()


if __name__ == '__main__':
    main()
