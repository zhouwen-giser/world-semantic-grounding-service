#!/usr/bin/env python3
"""Merge the exact published GSAP joint package with its WSGS consumer package."""
import argparse
import json
import os
from pathlib import Path
from bundle_common import checked_package, read_archive, sha, write_archive

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gsap-package', type=Path)
    parser.add_argument('--wsgs-package', type=Path, default=ROOT / 'output/deployment/wsgs-development.tar.gz')
    parser.add_argument('--output', type=Path, default=ROOT / 'output/deployment')
    args = parser.parse_args()
    if args.gsap_package is None:
        directory = Path(os.environ.get('WSGS_ANALYSIS_RELEASE_DIR', str(ROOT.parent / 'gowm-spatiotemporal-analysis-providers/output/deployment/current')))
        candidates = sorted(directory.glob('gowm-gdps-analysis-dev-server-*.tar.gz'))
        if len(candidates) != 1:
            raise ValueError('Expected one published GSAP package; specify --gsap-package')
        args.gsap_package = candidates[0]
    gsap_data, (gsap_root, gsap, _) = checked_package(args.gsap_package)
    wsgs_data, (wsgs_root, wsgs, _) = checked_package(args.wsgs_package)
    source = json.loads(gsap['deployment/SOURCE.json'])
    combined = gsap['packages/' + source['packageName']]
    if sha(combined) != source['sha256']:
        raise ValueError('GSAP combined source digest differs')
    _, gdps, _ = read_archive(combined)
    gowm_lock = json.loads(gdps['deployment/gowm-dev-package-lock.json'])
    gowm = gdps['packages/' + gowm_lock['packageName']]
    if sha(gowm) != gowm_lock['sha256'] or gowm_lock['sha256'] != source['nestedGowm']['sha256']:
        raise ValueError('Nested GOWM package digest differs')
    read_archive(gowm)
    snapshot = json.loads(wsgs['contracts/upstream/gowm-current/SNAPSHOT.json'])
    if (snapshot['analysisPackage']['sha256'] != sha(gsap_data)
        or snapshot['source']['combinedSha256'] != sha(combined)
        or snapshot['source']['sha256'] != sha(gowm)):
        raise ValueError('WSGS consumers differ from GSAP deployment; refresh WSGS from these exact published packages')
    provenance = json.loads(wsgs['SOURCE.json'])
    manifest = {
        'schemaVersion': 'gowm-gdps-gsap-wsgs-unified-deployment/1.0',
        'delivery': 'ONLINE_SOURCE_BUILD', 'siteAcceptance': 'NOT_RUN',
        'components': {
            'gsap': {'path': 'packages/' + args.gsap_package.name, 'root': gsap_root, 'sha256': sha(gsap_data), 'version': json.loads(gsap['analysis/package.json'])['version']},
            'wsgs': {'path': 'packages/' + args.wsgs_package.name, 'root': wsgs_root, 'sha256': sha(wsgs_data),
                'version': provenance['softwareVersion'], 'branch': provenance['gitBranch'], 'gitCommit': provenance['gitCommit']},
            'gdps': {'packageName': source['packageName'], 'version': source['gdpsVersion'], 'sha256': sha(combined)},
            'gowm': {'packageName': gowm_lock['packageName'], 'version': source['gowmVersion'], 'sha256': sha(gowm)},
        },
        'providerCounts': source['counts'],
        'upstreamSnapshot': snapshot,
        'wsgsSource': provenance,
        'gsapRecordedBuild': json.loads((args.gsap_package.parent / 'BUILD.json').read_text()) if (args.gsap_package.parent / 'BUILD.json').exists() else {'status': 'NOT_PROVIDED'},
    }
    name = 'gowm-gdps-gsap-wsgs-dev-server-' + provenance['softwareVersion']
    files = {
        'packages/' + args.gsap_package.name: gsap_data,
        'packages/' + args.gsap_package.name + '.sha256': f'{sha(gsap_data)}  {args.gsap_package.name}\n'.encode(),
        'packages/' + args.wsgs_package.name: wsgs_data,
        'packages/' + args.wsgs_package.name + '.sha256': f'{sha(wsgs_data)}  {args.wsgs_package.name}\n'.encode(),
        'deployment/MANIFEST.json': (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode(),
        'README.md': (ROOT / 'docs/unified-development-deployment.md').read_bytes(),
        'config/upstream.env.example': gsap['.env.example'],
        'config/wsgs.env.example': wsgs['.env.example'],
        'deploy': b'#!/usr/bin/env bash\nset -euo pipefail\nexec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deployment/deploy-unified.mjs" "$@"\n',
    }
    for filename in ['deploy-unified.mjs', 'bundle_common.py', 'extract-bundle.py']:
        files['deployment/' + filename] = (ROOT / 'deployment' / filename).read_bytes()
    target = args.output / (name + '.tar.gz')
    digest = write_archive(target, name, files, {'deploy': 0o755})
    report = {'status': 'PASS', 'package': str(target.resolve()), 'sha256': digest,
        'components': manifest['components'], 'providerCounts': source['counts'], 'siteAcceptance': 'NOT_RUN'}
    target.with_name(name + '.build.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
