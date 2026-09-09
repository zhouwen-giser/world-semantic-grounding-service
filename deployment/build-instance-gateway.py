"""Build the independent Gateway through the formal package's image gate."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    release = Path(sys.argv[1]).resolve()
    instance = json.loads((release / 'INSTANCE.json').read_text())
    source = Path(instance['gatewayBuildContext']).resolve()
    source.relative_to(release / 'gateway-source')
    helper = source / 'scripts/build-verified-image.sh'
    for required in (source / 'SHA256SUMS', helper,
                     source / 'scripts/verify-deployment-image.mjs'):
        if not required.is_file():
            raise ValueError('FORMAL_GATEWAY_IMAGE_GATE_MISSING')
    node = shutil.which('node')
    if node is None:
        candidates = []
        for candidate in (Path.home() / '.nvm/versions/node').glob('v*/bin/node'):
            version = candidate.parents[1].name.removeprefix('v').split('.')
            if len(version) == 3 and all(part.isdigit() for part in version) and os.access(candidate, os.X_OK):
                candidates.append((tuple(map(int, version)), candidate))
        if not candidates:
            raise ValueError('GATEWAY_BUILD_NODE_UNAVAILABLE')
        node = str(max(candidates)[1])
    environment = dict(os.environ)
    environment['PATH'] = str(Path(node).parent) + os.pathsep + environment.get('PATH', '')
    subprocess.run(['bash', str(helper), instance['gatewayImage'], str(source)],
                   env=environment, check=True)


if __name__ == '__main__':
    main()
