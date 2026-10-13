#!/usr/bin/env python3
"""Verify the actual extracted unified bundle without starting containers."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile
from bundle_common import checked_package, extract, sha


def run(command, cwd=None):
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
    if result.returncode:
        # These commands suppress Compose JSON; the remaining diagnostics contain no secrets.
        raise RuntimeError('Verification command failed: ' + str(command[0]) + '\n' + result.stdout + result.stderr)
    return result.stdout


def update_env(path, values):
    content = path.read_text()
    for key, value in values.items():
        content, count = re.subn('^' + key + '=.*$', lambda _: key + '=' + value, content, flags=re.M)
        if count != 1:
            raise ValueError('Expected one environment entry: ' + key)
    path.write_text(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--build-source', action='store_true', help='Install locked npm dependencies and compile the extracted WSGS source')
    args = parser.parse_args()
    data, (_, files, _) = checked_package(args.archive)
    manifest = json.loads(files['deployment/MANIFEST.json'])
    containers_before = run(['docker', 'ps', '-aq']).splitlines()
    with tempfile.TemporaryDirectory(prefix='wsgs-unified-verify-') as folder:
        root = extract(data, Path(folder))
        init_output = run([str(root / 'deploy'), 'init'])
        if '[unified] initialized' not in init_output:
            raise ValueError('Unified init did not complete')
        identity = (root / '.runtime/identity.json').read_bytes()
        key = (root / '.runtime/delegation-private.pem').read_bytes()
        update_env(root / 'upstream.env', {'UGV_MQTT_INGEST_ENABLED': 'false'})
        update_env(root / 'wsgs.env', {'WSGS_MODEL_POLICY': 'MODEL_OPTIONAL', 'MODEL_BASE_URL': '', 'MODEL_API_KEY': '', 'MODEL_NAME': ''})
        run([str(root / 'deploy'), 'init'])
        if identity != (root / '.runtime/identity.json').read_bytes() or key != (root / '.runtime/delegation-private.pem').read_bytes():
            raise ValueError('Repeated init rotated existing identity')
        check_output = run([str(root / 'deploy'), 'config-check'])
        if '[unified] configuration PASS' not in check_output:
            raise ValueError('Unified configuration verification did not complete')
        for name in ['upstream.env', 'wsgs.env', '.runtime/identity.json', '.runtime/delegation-private.pem', '.runtime/compose.wsgs.json']:
            if (root / name).stat().st_mode & 0o777 != 0o600:
                raise ValueError('Private file permissions differ: ' + name)
        overlay = json.loads((root / '.runtime/compose.wsgs.json').read_text())
        gateway = overlay['services']['signed-gateway']
        expected_image = 'gowm-analysis-native:' + manifest['components']['gowm']['sha256']
        if gateway['image'] != expected_image or gateway['environment']['GATEWAY_AUTH_MODE'] != 'SIGNED_DELEGATION_V1':
            raise ValueError('Signed Gateway does not use the exact verified GOWM image')
        if gateway['environment']['GATEWAY_DELEGATION_PUBLIC_KEY'] != (root / '.runtime/delegation-public.pem').read_text():
            raise ValueError('Gateway public key mapping differs')
        source = root / '.runtime/wsgs' / manifest['components']['wsgs']['root']
        snapshot = json.loads((source / 'contracts/upstream/gowm-current/SNAPSHOT.json').read_text())
        if snapshot['analysisPackage']['sha256'] != manifest['components']['gsap']['sha256']:
            raise ValueError('Extracted WSGS consumer snapshot differs from GSAP archive')
        for key in ['RECIPE_LOCK', 'CONSUMER_SNAPSHOT', 'DESCRIPTOR_REGISTRY', 'VOCABULARY_REGISTRY']:
            if 'WSGS_GDPS_' + key + '_SHA256=' not in (root / 'wsgs.env').read_text():
                raise ValueError('GDPS consumer hash configuration missing')
        if args.build_source:
            run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], source)
            run(['npm', 'run', 'gowm:check'], source)
            run(['npm', 'run', 'typecheck'], source)
    if sorted(containers_before) != sorted(run(['docker', 'ps', '-aq']).splitlines()):
        raise ValueError('Container inventory changed during non-starting verification')
    report = {
        'status': 'PASS', 'package': args.archive.name, 'sha256': sha(data),
        'checks': {'archiveInventory': 'PASS', 'nestedSources': 'PASS', 'freshInit': 'PASS',
            'repeatInitPreservesCredentials': 'PASS', 'composeConfiguration': 'PASS',
            'signedGatewayMapping': 'PASS', 'gdpsConsumerMapping': 'PASS', 'privateFilePermissions': 'PASS',
            'extractedSourceBuild': 'PASS' if args.build_source else 'NOT_RUN', 'noContainersStarted': 'PASS'},
        'configurationFixture': {'ugvIngestEnabled': False, 'modelPolicy': 'MODEL_OPTIONAL'},
        'siteAcceptance': 'NOT_RUN', 'realModel': 'NOT_RUN', 'realMqtt': 'NOT_RUN',
        'credentialsIncluded': False,
    }
    destination = args.archive.with_name(args.archive.name.removesuffix('.tar.gz') + '.verification.json')
    destination.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
