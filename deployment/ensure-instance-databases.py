"""Preserve healthy databases during application-only upgrades."""
import json
from pathlib import Path
import subprocess
import sys


def main():
    release = Path(sys.argv[1]).resolve()
    compose = ['docker', 'compose', '--project-name', 'wsgs-live', '--project-directory', str(release),
               '--env-file', str(release / '.env'), '-f', str(release / 'compose.yaml'),
               '-f', str(release / 'compose.instance.json')]
    for service in ('gateway-db', 'postgres'):
        identifiers = subprocess.check_output(compose + ['ps', '-a', '-q', service], text=True).split()
        created = not identifiers
        if not identifiers:
            configuration = json.loads(subprocess.check_output(compose + ['config', '--format', 'json'], text=True))
            image = configuration['services'][service]['image']
            image_id = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Id}}', image], text=True).strip()
            subprocess.run(compose + ['up', '-d', '--pull', 'never', '--no-deps', '--wait', '--wait-timeout', '180', service], check=True)
            print(json.dumps({'service': service, 'createdFromImage': image_id}))
            identifiers = subprocess.check_output(compose + ['ps', '-a', '-q', service], text=True).split()
        if len(identifiers) != 1:
            raise ValueError('INSTANCE_DATABASE_AMBIGUOUS')
        state = json.loads(subprocess.check_output(
            ['docker', 'inspect', '--format', '{{json .State}}', identifiers[0]], text=True))
        if not state.get('Running') or state.get('Health', {}).get('Status') != 'healthy':
            raise ValueError('INSTANCE_DATABASE_NOT_HEALTHY')
        print(json.dumps({'service': service, 'status': 'HEALTHY', 'preserved': not created}))


if __name__ == '__main__':
    main()
