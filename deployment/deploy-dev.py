#!/usr/bin/env python3
"""Development deployment: anonymous API, server-owned authority, no shell dotenv evaluation."""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', default=str(ROOT / '.env'))
    parser.add_argument('--init', action='store_true', help='Create configuration without overwriting an existing file')
    parser.add_argument('--check', action='store_true', help='Validate configuration without starting containers')
    parser.add_argument('--no-build', action='store_true', help='Use an already built/loaded runtime image')
    args = parser.parse_args()
    env_file = Path(args.env_file).resolve()
    if args.init:
        password = secrets.token_hex(24)
        content = (ROOT / '.env.example').read_text()
        replacements = {
            'REPLACE_WITH_A_RANDOM_POSTGRES_PASSWORD': password,
            'REPLACE_WITH_THE_SAME_URL_ENCODED_PASSWORD': password,
            'REPLACE_WITH_BASE64_OF_32_RANDOM_BYTES': base64.b64encode(secrets.token_bytes(32)).decode(),
            'REPLACE_WITH_AT_LEAST_32_RANDOM_UTF8_BYTES': secrets.token_hex(32),
            'WSGS_AUTH_MODE=JWT_SERVICE': 'WSGS_AUTH_MODE=STATIC_TRUSTED',
            'WSGS_API_BIND_ADDRESS=127.0.0.1': 'WSGS_API_BIND_ADDRESS=0.0.0.0',
        }
        for old, new in replacements.items():
            content = content.replace(old, new)
        with open(env_file, 'x', opener=lambda p, f: os.open(p, f, 0o600)) as output:
            output.write(content)
        print(f'Created {env_file}. Configure the authorized GOWM endpoint, delegation key, scopes and model, then rerun without --init.')
        return
    if not env_file.is_file():
        raise ValueError('Environment file missing; run ./deploy-dev.sh --init first')
    environment = dict(os.environ, WSGS_ENV_FILE=str(env_file))
    base = ['docker', 'compose', '--project-directory', str(ROOT), '--env-file', str(env_file), '-f', str(ROOT / 'compose.yaml')]
    # Capture expanded configuration so credentials are never printed.
    def configuration(command):
        result = subprocess.run(command + ['config', '--format', 'json'], env=environment, capture_output=True, text=True)
        if result.returncode:
            raise ValueError('Compose configuration failed; check required entries and syntax in the selected .env file')
        return json.loads(result.stdout)
    config = configuration(base)
    api = config['services']['grounding-api']['environment']
    if api.get('WSGS_AUTH_MODE') != 'STATIC_TRUSTED' or api.get('WSGS_API_BIND_ADDRESS') != '0.0.0.0':
        raise ValueError('Development deployment requires WSGS_AUTH_MODE=STATIC_TRUSTED and WSGS_API_BIND_ADDRESS=0.0.0.0 in the selected env file')
    required = ['DATABASE_URL', 'WSGS_REQUEST_ENCRYPTION_KEY_BASE64', 'GOWM_GATEWAY_BASE_URL', 'GOWM_GATEWAY_TOKEN',
                'GOWM_DELEGATION_ISSUER', 'GOWM_DELEGATION_AUDIENCE', 'GOWM_DELEGATION_SERVICE_PRINCIPAL_ID', 'WSGS_READINESS_DATA_SCOPE']
    if api.get('WSGS_MODEL_POLICY') == 'MODEL_REQUIRED':
        required += ['MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME']
    invalid = [key for key in required if not api.get(key) or 'REPLACE_' in str(api[key]) or 'replace.invalid' in str(api[key])]
    if invalid:
        raise ValueError('Configure required values: ' + ', '.join(invalid))
    if len(base64.b64decode(api['WSGS_REQUEST_ENCRYPTION_KEY_BASE64'], validate=True)) != 32:
        raise ValueError('WSGS_REQUEST_ENCRYPTION_KEY_BASE64 must decode to 32 bytes')
    key_path = Path(config['secrets']['gowm_delegation_private_key']['file'])
    if not key_path.is_file():
        raise ValueError('GOWM_DELEGATION_PRIVATE_KEY_FILE_HOST must point to an existing registered delegation key')
    static = {
        'WSGS_STATIC_SERVICE_PRINCIPAL_ID': api.get('GOWM_DELEGATION_SERVICE_PRINCIPAL_ID'),
        'WSGS_STATIC_ACTOR_ID': api.get('WSGS_READINESS_ACTOR_ID'),
        'WSGS_STATIC_DATA_SCOPES': api.get('WSGS_READINESS_DATA_SCOPES') or api.get('WSGS_READINESS_DATA_SCOPE'),
        'WSGS_STATIC_DATASET_SCOPES': api.get('WSGS_READINESS_DATASET_SCOPES') or '',
        'WSGS_STATIC_PERMISSIONS': 'grounding.read,' + api.get('WSGS_READINESS_PERMISSIONS', 'data:read,dataset:read'),
    }
    for name in static:
        static[name] = api.get(name) or static[name]
        if 'REPLACE_' in str(static[name]):
            raise ValueError('Configure ' + name + ' or its readiness counterpart')
    # Empty datasetScopes means no dataset grant, not an invalid empty scope entry.
    if not static['WSGS_STATIC_DATASET_SCOPES']:
        static['WSGS_STATIC_DATASET_SCOPES'] = None
    override = ROOT / 'compose.dev.generated.json'
    overlay = {'services': {
        'grounding-api': {'environment': static, 'extra_hosts': ['host.docker.internal:host-gateway']},
        'grounding-worker': {'extra_hosts': ['host.docker.internal:host-gateway']}
    }}
    upstream_network = api.get('WSGS_DEV_UPSTREAM_NETWORK')
    if upstream_network:
        overlay['networks'] = {'upstream': {'external': True, 'name': upstream_network}}
        for service in ('grounding-api', 'grounding-worker'):
            overlay['services'][service]['networks'] = ['default', 'upstream']
    override.write_text(json.dumps(overlay, indent=2) + '\n')
    project = api.get('WSGS_DEV_PROJECT') or 'wsgs-dev'
    wait = int(api.get('WSGS_DEPLOY_WAIT_SECONDS') or '180')
    command = base + ['-f', str(override), '--project-name', project]
    configuration(command)
    if args.check:
        print('Development configuration valid; anonymous access enabled. Upstream connectivity is checked during deployment.')
        return
    if not args.no_build:
        subprocess.run(command + ['build'], env=environment, check=True)
    subprocess.run(command + ['up', '-d', '--wait', '--wait-timeout', str(wait)], env=environment, check=True)
    # Liveness is insufficient: verify actual dependencies and anonymous capability access inside API container.
    probe = "for(const p of ['/health/ready','/v1/capabilities']){const r=await fetch('http://127.0.0.1:'+process.env.PORT+p);if(!r.ok)throw Error(p+' HTTP '+r.status)}"
    subprocess.run(command + ['exec', '-T', 'grounding-api', 'node', '--input-type=module', '-e', probe], env=environment, check=True)
    print(f"Development deployment ready: http://<server-ip>:{api.get('WSGS_API_PORT', '8080')}/v1/capabilities (no authentication)")


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'Development deployment failed: {error}', file=sys.stderr)
        sys.exit(1)
