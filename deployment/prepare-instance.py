"""Prepare an isolated instance on the existing development host. Never logs secrets."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import socket
import shutil
import subprocess
import sys
import tarfile

ROOT = Path('/mnt/data/wsgs-live')


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]


def env(container):
    return dict(item.split('=', 1) for item in container['Config']['Env'])


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def main():
    os.umask(0o077)
    release = Path(sys.argv[1]).resolve()
    snapshot = json.loads((release / 'contracts/upstream/gowm-current/SNAPSHOT.json').read_text())
    configuration = json.load(sys.stdin)
    if set(configuration) - {'model', 'upstreamDeploymentRoot'}:
        raise ValueError('UNEXPECTED_INSTANCE_CONFIG')
    model = configuration['model']
    upstream_root = Path(configuration.get('upstreamDeploymentRoot') or '/mnt/data/gowm-gdps-analysis-live')
    if not upstream_root.is_absolute() or not upstream_root.is_dir():
        raise ValueError('UPSTREAM_DEPLOYMENT_ROOT_INVALID')
    upstream_root = upstream_root.resolve()
    if set(model) - {'MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME', 'MODEL_OUTPUT_MODE', 'MODEL_TIMEOUT_MS', 'MODEL_MAX_RETRIES'}:
        raise ValueError('UNEXPECTED_MODEL_CONFIG')
    names = subprocess.check_output(['docker', 'ps', '-a', '--format', '{{.Names}}']).decode().splitlines()
    def upstream(suffix):
        matches = [name for name in names if name.startswith('gowm-analysis-') and name.endswith(suffix)]
        if len(matches) != 1:
            raise ValueError('UPSTREAM_INSTANCE_AMBIGUOUS')
        return inspect(matches[0])
    gateway = upstream('world-capability-gateway-1')
    bootstrap = upstream('world-platform-bootstrap-1')
    database = upstream('postgres-1')
    native = [p.parents[5] for p in upstream_root.glob('.runtime/*/.runtime/gowm/*/packages/platform/world-gateway-contracts/bundle/locks/wsgs-southbound-operation-lock-v2.json')
              if hashlib.sha256(p.read_bytes()).hexdigest() == snapshot['lockSha256']]
    if len(native) != 1:
        raise ValueError('DEPLOYED_GOWM_FORMAL_CONTRACT_MISMATCH')
    formal = release / 'gowm-formal.tar.gz'
    if hashlib.sha256(formal.read_bytes()).hexdigest() != snapshot['source']['sha256']:
        raise ValueError('FORMAL_GATEWAY_BUILD_SOURCE_MISMATCH')
    build_root = release / 'gateway-source'
    with tarfile.open(formal, 'r:gz') as tar:
        roots = set()
        for member in tar:
            p = PurePosixPath(member.name)
            if p.is_absolute() or '..' in p.parts or not (member.isdir() or member.isfile()):
                raise ValueError('UNSAFE_FORMAL_GATEWAY_ARCHIVE')
            roots.add(p.parts[0])
            target = build_root / str(p)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(tar.extractfile(member).read())
                target.chmod(member.mode & 0o777)
        if len(roots) != 1:
            raise ValueError('FORMAL_GATEWAY_ROOT_AMBIGUOUS')
    gateway_build_context = build_root / next(iter(roots))
    network = next(n for n in gateway['NetworkSettings']['Networks'] if n.endswith('_default'))
    secret_dir = ROOT / 'secrets'
    secret_dir.mkdir(parents=True, exist_ok=True)
    private = secret_dir / 'delegation-rs256.pem'
    public_path = secret_dir / 'delegation-rs256.pub'
    if not private.exists():
        subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(private)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        public_path.write_bytes(subprocess.check_output(['openssl', 'pkey', '-in', str(private), '-pubout']))
        private.chmod(0o400)
    public = public_path.read_text()
    # A dedicated volume keeps UID 10001 and never changes host file ownership.
    subprocess.run(['docker', 'volume', 'create', 'wsgs-live-delegation'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--user', '0', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
        '--security-opt', 'no-new-privileges:true', '--mount', 'type=volume,source=wsgs-live-delegation,target=/secrets',
        '-i', gateway['Image'], 'sh', '-c', 'umask 077; cat > /secrets/private.next && chmod 400 /secrets/private.next && chown 10001:10001 /secrets/private.next && mv /secrets/private.next /secrets/private.pem'],
        input=private.read_bytes(), check=True, stdout=subprocess.DEVNULL)
    state_path = secret_dir / 'state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    for key in ['WSGS_DB', 'GATEWAY_DB', 'JWT', 'TRANSPORT', 'ENCRYPTION']:
        state.setdefault(key, secrets.token_hex(32))
    boot_env = env(bootstrap)
    for key in boot_env:
        if key.endswith('_PASSWORD'):
            state.setdefault(key, secrets.token_hex(32))
            boot_env[key] = state[key]
    if 'API_PORT' not in state:
        for port in range(18080, 18100):
            with socket.socket() as probe:
                try:
                    probe.bind(('127.0.0.1', port))
                    state['API_PORT'] = port
                    break
                except OSError:
                    continue
        else:
            raise ValueError('NO_FREE_WSGS_LOOPBACK_PORT')
    save(state_path, state)
    boot_env['DATABASE_URL'] = 'postgresql://gowm:' + state['GATEWAY_DB'] + '@gateway-db:5432/gowm'
    boot_env['GATEWAY_REGISTRY_DATABASE_URL'] = 'postgresql://gowm_gateway_registry_service:' + state['GATEWAY_REGISTRY_DB_PASSWORD'] + '@gateway-db:5432/gowm'
    gateway_env = env(gateway)
    gateway_env.update({'DATABASE_URL': 'postgresql://gowm_gateway_service:' + state['GATEWAY_DB_PASSWORD'] + '@gateway-db:5432/gowm',
        'GATEWAY_AUTH_MODE': 'SIGNED_DELEGATION_V1', 'GATEWAY_DELEGATION_ISSUER': 'wsgs-live',
        'GATEWAY_DELEGATION_AUDIENCE': 'wsgs-gateway', 'GATEWAY_DELEGATION_PUBLIC_KEY': public,
        'GATEWAY_AUTH_SHARED_TOKEN': state['TRANSPORT'], 'GATEWAY_ID': 'wsgs-signed-gateway',
        'GATEWAY_RUNTIME_PRINCIPAL_REF': 'wsgs-consumer', 'GATEWAY_PORT': '8090'})
    inputs = json.loads((release / 'contracts/upstream/gowm-current/PROVIDER_INPUTS.json').read_text())
    actual_registry = json.loads(Path(next(m['Source'] for m in gateway['Mounts'] if m['Destination'] == '/app/config/analysis-registry.json')).read_text())
    if actual_registry['providers'] != [p['registration'] for p in inputs['providers']]:
        # Registration order has no semantics; compare canonical provider identities.
        key = lambda p: p['providerId']
        if sorted(actual_registry['providers'], key=key) != sorted([p['registration'] for p in inputs['providers']], key=key):
            raise ValueError('DEPLOYED_PROVIDER_REGISTRY_MISMATCH')
    mounts = []
    for index, mount in enumerate(gateway['Mounts']):
        target = release / 'gateway-assets' / str(index)
        target.parent.mkdir(parents=True, exist_ok=True)
        source = Path(mount['Source'])
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True)
        else:
            shutil.copyfile(source, target)
        # Public contracts must be readable by the upstream node user.
        if target.is_dir():
            for item in [target, *target.rglob('*')]:
                item.chmod(0o755 if item.is_dir() else 0o644)
        else:
            target.chmod(0o644)
        mounts.append({'type': 'bind', 'source': str(target), 'target': mount['Destination'], 'read_only': True})
    registry_mount = next(m for m in mounts if m['target'] == '/app/config/analysis-registry.json')
    boot_mounts = [m for m in mounts if m['target'] != '/app/config/world-platform-gateway-registry.json'] + [{**registry_mount, 'target': '/app/config/world-platform-gateway-registry.json'}]
    import base64
    runtime_env = {'DATABASE_URL': 'postgresql://wsgs:' + state['WSGS_DB'] + '@postgres:5432/wsgs',
        'WSGS_REQUEST_ENCRYPTION_KEY_BASE64': base64.b64encode(bytes.fromhex(state['ENCRYPTION'])).decode(),
        'GOWM_GATEWAY_BASE_URL': 'http://signed-gateway:8090', 'GOWM_GATEWAY_TOKEN': state['TRANSPORT'],
        'GOWM_DELEGATION_ISSUER': 'wsgs-live', 'GOWM_DELEGATION_AUDIENCE': 'wsgs-gateway',
        'GOWM_DELEGATION_SERVICE_PRINCIPAL_ID': 'wsgs-consumer', 'GOWM_DELEGATION_PRIVATE_KEY_FILE_HOST': str(private),
        'WSGS_READINESS_ACTOR_ID': 'wsgs-readiness', 'WSGS_READINESS_DATA_SCOPE': gateway_env['GATEWAY_DATA_SCOPE_CLAIM'],
        'WSGS_READINESS_DATASET_SCOPES': gateway_env.get('GATEWAY_DATASET_SCOPE_CLAIM', ''),
        'WSGS_READINESS_PERMISSIONS': 'data:read,dataset:read,gateway:execute',
        'WSGS_ALLOW_PREVIEW_CAPABILITIES': 'YES', 'WSGS_HISTORY_TRACE_ENABLED': 'YES', 'WSGS_ADVANCED_HISTORY_ENABLED': 'YES',
        'WSGS_ANALYSIS_PROVIDER_CONTRACT_ROOT': 'contracts/upstream/gowm-current/analysis',
        'WSGS_JWT_HS256_SECRET': state['JWT'], 'WSGS_JWT_ISSUER': 'wsgs-live', 'WSGS_JWT_AUDIENCE': 'wsgs',
        'WSGS_WORLD_ANALYSIS_CONSUMER_PRINCIPALS_JSON': '["wsgs-consumer"]',
        'WSGS_SACS_GEOSPATIAL_CONSUMER_PRINCIPALS_JSON': '["wsgs-consumer"]',
        'WSGS_API_PORT': str(state['API_PORT']), 'POSTGRES_USER': 'wsgs', 'POSTGRES_DB': 'wsgs', 'POSTGRES_PASSWORD': state['WSGS_DB'],
        'WSGS_RUNTIME_IMAGE': 'wsgs:' + release.name, **model}
    gdps_root = release / 'contracts/upstream/gowm-current/gdps'
    recipes = json.loads((gdps_root / 'wsgs-gdps-recipe-lock.json').read_text())
    runtime_env['WSGS_GDPS_PREVIEW_RECIPE_ALLOWLIST'] = ','.join(r['semanticPattern'] for r in recipes['recipes'])
    for key, name in [('RECIPE_LOCK', 'wsgs-gdps-recipe-lock.json'), ('CONSUMER_SNAPSHOT', 'gdps-consumer-snapshot.json'),
                      ('DESCRIPTOR_REGISTRY', 'product-type-descriptors.json'), ('VOCABULARY_REGISTRY', 'product-vocabularies.json')]:
        runtime_env['WSGS_GDPS_' + key + '_FILE'] = 'contracts/upstream/gowm-current/gdps/' + name
        runtime_env['WSGS_GDPS_' + key + '_SHA256'] = 'sha256:' + snapshot['gdpsArtifacts'][name]
    runtime_env['WSGS_GDPS_SEMANTIC_CONCEPT_MAP_FILE'] = 'config/gdps-semantic-concept-map.json'
    runtime_env['WSGS_GDPS_SEMANTIC_CONCEPT_MAP_SHA256'] = 'sha256:' + hashlib.sha256((release / 'config/gdps-semantic-concept-map.json').read_bytes()).hexdigest()
    (release / '.env').write_text(''.join(k + '=' + "'" + v.replace("'", "\\'") + "'" + '\n' for k, v in runtime_env.items()))
    (release / '.env').chmod(0o600)
    image = 'wsgs-gowm:' + snapshot['source']['sha256'][:16]
    health = {'test': ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U gowm -d gowm'], 'interval': '5s', 'timeout': '3s', 'retries': 30}
    overlay = {'services': {
        'gateway-db': {'image': database['Image'], 'environment': {'POSTGRES_USER': 'gowm', 'POSTGRES_DB': 'gowm', 'POSTGRES_PASSWORD': state['GATEWAY_DB']},
            'volumes': ['gateway-data:/var/lib/postgresql'], 'healthcheck': health, 'restart': 'unless-stopped'},
        'gateway-bootstrap': {'image': image, 'command': bootstrap['Config']['Cmd'], 'environment': boot_env, 'volumes': boot_mounts,
            'depends_on': {'gateway-db': {'condition': 'service_healthy'}}, 'restart': 'no'},
        'signed-gateway': {'image': image, 'command': gateway['Config']['Cmd'], 'environment': gateway_env, 'volumes': mounts,
            'networks': ['default', 'upstream'], 'depends_on': {'gateway-bootstrap': {'condition': 'service_completed_successfully'}},
            'read_only': True, 'tmpfs': ['/tmp'], 'restart': 'unless-stopped'},
        'grounding-api': {'environment': {'GOWM_DELEGATION_PRIVATE_KEY_FILE': '/run/wsgs-delegation/private.pem'},
            'volumes': ['delegation:/run/wsgs-delegation:ro']},
        'grounding-worker': {'stop_grace_period': '15m', 'environment': {'GOWM_DELEGATION_PRIVATE_KEY_FILE': '/run/wsgs-delegation/private.pem'},
            'volumes': ['delegation:/run/wsgs-delegation:ro']}},
        'networks': {'upstream': {'external': True, 'name': network}}, 'volumes': {'gateway-data': {}, 'delegation': {'external': True, 'name': 'wsgs-live-delegation'}}}
    save(release / 'compose.instance.json', overlay)
    save(release / 'INSTANCE.json', {'schemaVersion': '1.0', 'source': snapshot['source'], 'gatewayBuildContext': str(gateway_build_context), 'gatewayImage': image,
        'project': 'wsgs-live', 'upstreamDeploymentRoot': str(upstream_root), 'apiLoopbackPort': state['API_PORT'], 'existingGatewayUnchanged': True})
    print(json.dumps({'status': 'PREPARED', 'gatewayImage': image, 'release': release.name}))


if __name__ == '__main__':
    main()
