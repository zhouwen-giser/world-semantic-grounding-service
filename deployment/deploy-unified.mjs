#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.runtime');
const upstreamEnvFile = path.join(root, 'upstream.env');
const wsgsEnvFile = path.join(root, 'wsgs.env');
const overlayFile = path.join(runtime, 'compose.wsgs.json');
const stateFile = path.join(runtime, 'identity.json');
let manifest, upstream, wsgs, native, base, parseEnv, upstreamValues, wsgsValues, state;
const sha = data => createHash('sha256').update(data).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const secret = () => randomBytes(32).toString('hex');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root, env: options.env || process.env,
    stdio: options.capture ? ['pipe', 'pipe', 'pipe'] : [options.input ? 'pipe' : 'inherit', 'inherit', 'inherit'],
    input: options.input, encoding: options.input ? undefined : 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    // Compose expansion and key-import diagnostics can contain credentials.
    throw Error(command + ' failed; check configuration and prerequisite tools (exit ' + result.status + ')');
  }
  return options.capture ? String(result.stdout).trim() : undefined;
}

function cleanEnvironment(values, additions = {}) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !(key in values))), ...additions };
}

function privateWrite(file, content) {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('Managed configuration cannot be a symlink');
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function saveEnv(file, updates) {
  let content = fs.readFileSync(file, 'utf8');
  for (const [key, raw] of Object.entries(updates)) {
    const value = String(raw);
    if (/[\r\n\0']/.test(value)) throw Error('Unsupported managed environment value: ' + key);
    const line = key + '=' + (/[$#\s]/.test(value) ? "'" + value + "'" : value);
    const match = new RegExp('^' + key + '=.*$', 'm');
    content = match.test(content) ? content.replace(match, () => line) : content + '\n' + line + '\n';
  }
  privateWrite(file, content);
}

function upstreamRun(command, args = []) {
  run(path.join(upstream, 'deploy'), [command, ...args], {
    env: cleanEnvironment(upstreamValues || {}, { ANALYSIS_DEV_ENV_FILE: upstreamEnvFile }),
  });
}

function upstreamConfig() {
  const files = [
    ...['docker-compose.yml', 'docker-compose.world-platform.yml', 'docker-compose.dev.yml'].map(name => path.join(native, name)),
    path.join(base, 'deployment/docker-compose.gdps.yml'),
    path.join(upstream, 'deployment/build-compat.compose.json'), path.join(upstream, 'deployment/analysis.compose.json'),
  ];
  const profiles = ['foundation-admin', 'world-platform', 'analysis'];
  if (upstreamValues.UGV_MQTT_INGEST_ENABLED === 'true') profiles.push('ugv-mqtt');
  if (upstreamValues.GOWM_HISTORY_AUTO_ENABLED === 'true') profiles.push('history-auto');
  return JSON.parse(run('docker', ['compose', '--project-name', upstreamValues.COMPOSE_PROJECT_NAME,
    '--env-file', upstreamEnvFile, ...files.flatMap(file => ['-f', file]),
    ...profiles.flatMap(profile => ['--profile', profile]), 'config', '--format', 'json'], {
    cwd: native, capture: true, env: cleanEnvironment(upstreamValues),
  }));
}

function wsgsCompose(args, capture = false) {
  return run('docker', ['compose', '--project-directory', wsgs, '--project-name', state.wsgsProject,
    '--env-file', wsgsEnvFile, '-f', path.join(wsgs, 'compose.yaml'), '-f', overlayFile, ...args], {
    cwd: wsgs, capture, env: cleanEnvironment(wsgsValues, { WSGS_ENV_FILE: wsgsEnvFile }),
  });
}

function extracted(component, directory) {
  const destination = path.join(runtime, directory);
  const target = path.join(destination, component.root);
  if (!fs.existsSync(target)) run('python3', [path.join(root, 'deployment/extract-bundle.py'), 'extract',
    path.join(root, component.path), destination]);
  if (fs.lstatSync(target).isSymbolicLink()) throw Error('Component root cannot be a symlink');
  try {
    run('python3', [path.join(root, 'deployment/extract-bundle.py'), 'verify-tree', path.join(root, component.path), target], { capture: true });
  } catch {
    throw Error('Cached ' + component.root + ' source differs from the package; use a fresh bundle extraction');
  }
  return target;
}

async function init() {
  run('sha256sum', ['--quiet', '-c', 'SHA256SUMS'], { capture: true });
  manifest = read(path.join(root, 'deployment/MANIFEST.json'));
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(runtime).isSymbolicLink()) throw Error('Runtime cannot be a symlink');
  upstream = extracted(manifest.components.gsap, 'upstream');
  wsgs = extracted(manifest.components.wsgs, 'wsgs');
  ({ parseEnv } = await import(path.join(upstream, 'deployment/deploy.mjs')));
  if (fs.existsSync(upstreamEnvFile)) upstreamValues = parseEnv(fs.readFileSync(upstreamEnvFile, 'utf8'));
  upstreamRun('init');
  upstreamValues = parseEnv(fs.readFileSync(upstreamEnvFile, 'utf8'));
  const source = read(path.join(upstream, 'deployment/SOURCE.json'));
  base = path.join(upstream, '.runtime', source.baseRoot);
  native = path.join(base, '.runtime/gowm', source.nestedGowm.expectedRoot);
  if (fs.existsSync(stateFile)) state = read(stateFile);
  else state = { upstreamProject: upstreamValues.COMPOSE_PROJECT_NAME,
    wsgsProject: upstreamValues.COMPOSE_PROJECT_NAME + '-wsgs', transport: secret(), gatewayAdmin: secret(), passwords: {} };
  if (state.upstreamProject !== upstreamValues.COMPOSE_PROJECT_NAME) throw Error('Recorded deployment project differs from upstream.env');
  const keyFile = path.join(runtime, 'delegation-private.pem');
  if (!fs.existsSync(keyFile)) {
    if (fs.existsSync(stateFile)) throw Error('Existing deployment delegation key is missing');
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    privateWrite(keyFile, keys.privateKey);
    privateWrite(path.join(runtime, 'delegation-public.pem'), keys.publicKey);
  }
  if (!fs.existsSync(wsgsEnvFile)) run('bash', [path.join(wsgs, 'deploy-dev.sh'), '--init', '--env-file', wsgsEnvFile], { cwd: wsgs });
  const config = upstreamConfig();
  const gateway = config.services['world-capability-gateway'];
  const bootstrap = config.services['world-platform-bootstrap'];
  if (!gateway || !bootstrap || !config.services.postgres) throw Error('GSAP combined deployment interface changed');
  for (const key of Object.keys(bootstrap.environment).filter(key => key.endsWith('_PASSWORD'))) state.passwords[key] ||= secret();
  privateWrite(stateFile, JSON.stringify(state, null, 2) + '\n');
  const snapshot = read(path.join(wsgs, 'contracts/upstream/gowm-current/SNAPSHOT.json'));
  const contract = path.join(wsgs, 'contracts/upstream/gowm-current');
  const principal = 'wsgs-unified';
  const updates = {
    GOWM_GATEWAY_BASE_URL: 'http://signed-gateway:8090', GOWM_GATEWAY_TOKEN: state.transport,
    GOWM_DELEGATION_ISSUER: 'wsgs-unified', GOWM_DELEGATION_AUDIENCE: 'wsgs-signed-gateway',
    GOWM_DELEGATION_SERVICE_PRINCIPAL_ID: principal, GOWM_DELEGATION_PRIVATE_KEY_FILE_HOST: keyFile,
    WSGS_READINESS_DATA_SCOPE: gateway.environment.GATEWAY_DATA_SCOPE_CLAIM,
    WSGS_READINESS_DATASET_SCOPES: gateway.environment.GATEWAY_DATASET_SCOPE_CLAIM || '',
    WSGS_READINESS_PERMISSIONS: 'data:read,dataset:read,gateway:execute',
    WSGS_STATIC_SERVICE_PRINCIPAL_ID: principal, WSGS_STATIC_ACTOR_ID: 'wsgs-readiness',
    WSGS_STATIC_DATA_SCOPES: gateway.environment.GATEWAY_DATA_SCOPE_CLAIM,
    WSGS_STATIC_DATASET_SCOPES: gateway.environment.GATEWAY_DATASET_SCOPE_CLAIM || '',
    WSGS_STATIC_PERMISSIONS: 'grounding.read,data:read,dataset:read,gateway:execute',
    GOWM_SOUTHBOUND_LOCK_HOST_FILE: path.join(contract, 'OPERATION_LOCK.json'),
    GOWM_SOUTHBOUND_LOCK_FILE: '/run/wsgs/gowm-southbound-operation-lock.json',
    GOWM_SOUTHBOUND_LOCK_SHA256: 'sha256:' + snapshot.operationalLockSha256,
    WSGS_RUNTIME_IMAGE: 'wsgs-unified:' + manifest.components.wsgs.sha256.slice(0, 16),
    WSGS_DEV_PROJECT: state.wsgsProject, GOWM_AVAILABILITY_MODE: 'REQUIRED_OPERATIONS',
    WSGS_ALLOW_PREVIEW_CAPABILITIES: 'YES', WSGS_HISTORY_TRACE_ENABLED: 'YES', WSGS_ADVANCED_HISTORY_ENABLED: 'YES',
    WSGS_ANALYSIS_PROVIDER_CONTRACT_ROOT: '/app/contracts/upstream/gowm-current/analysis',
    WSGS_WORLD_ANALYSIS_CONSUMER_PRINCIPALS_JSON: JSON.stringify([principal]),
    WSGS_SACS_GEOSPATIAL_CONSUMER_PRINCIPALS_JSON: JSON.stringify([principal]),
    WSGS_GDPS_PREVIEW_RECIPE_ALLOWLIST: read(path.join(contract, 'gdps/wsgs-gdps-recipe-lock.json')).recipes.map(r => r.semanticPattern).join(','),
    WSGS_GDPS_SEMANTIC_CONCEPT_MAP_FILE: '/app/config/gdps-semantic-concept-map.json',
    WSGS_GDPS_SEMANTIC_CONCEPT_MAP_SHA256: 'sha256:' + sha(fs.readFileSync(path.join(wsgs, 'config/gdps-semantic-concept-map.json'))),
  };
  for (const [key, name] of Object.entries({ RECIPE_LOCK: 'wsgs-gdps-recipe-lock.json',
    CONSUMER_SNAPSHOT: 'gdps-consumer-snapshot.json', DESCRIPTOR_REGISTRY: 'product-type-descriptors.json', VOCABULARY_REGISTRY: 'product-vocabularies.json' })) {
    updates['WSGS_GDPS_' + key + '_FILE'] = '/app/contracts/upstream/gowm-current/gdps/' + name;
    updates['WSGS_GDPS_' + key + '_SHA256'] = 'sha256:' + snapshot.gdpsArtifacts[name];
  }
  saveEnv(wsgsEnvFile, updates);
  wsgsValues = parseEnv(fs.readFileSync(wsgsEnvFile, 'utf8'));
  const image = 'gowm-analysis-native:' + source.nestedGowm.sha256;
  const bootEnv = { ...bootstrap.environment, ...state.passwords,
    DATABASE_URL: 'postgresql://gowm:' + state.gatewayAdmin + '@gateway-db:5432/gowm',
    GATEWAY_REGISTRY_DATABASE_URL: 'postgresql://gowm_gateway_registry_service:' + state.passwords.GATEWAY_REGISTRY_DB_PASSWORD + '@gateway-db:5432/gowm' };
  const gatewayEnv = { ...gateway.environment,
    DATABASE_URL: 'postgresql://gowm_gateway_service:' + state.passwords.GATEWAY_DB_PASSWORD + '@gateway-db:5432/gowm',
    GATEWAY_AUTH_MODE: 'SIGNED_DELEGATION_V1', GATEWAY_AUTH_SHARED_TOKEN: state.transport,
    GATEWAY_DELEGATION_ISSUER: updates.GOWM_DELEGATION_ISSUER, GATEWAY_DELEGATION_AUDIENCE: updates.GOWM_DELEGATION_AUDIENCE,
    GATEWAY_DELEGATION_PUBLIC_KEY: fs.readFileSync(path.join(runtime, 'delegation-public.pem'), 'utf8'),
    GATEWAY_RUNTIME_PRINCIPAL_REF: principal, GATEWAY_ID: 'wsgs-signed-gateway', GATEWAY_PORT: '8090' };
  const publicVolumes = service => (service.volumes || []).map(v => {
    if (v.type !== 'bind' || !v.read_only) throw Error('Expected read-only upstream contract mounts');
    if (!path.resolve(v.source).startsWith(upstream + path.sep)) throw Error('Upstream contract mount is outside this bundle');
    return v;
  });
  const staticIdentity = Object.fromEntries(Object.entries(updates).filter(([key]) => key.startsWith('WSGS_STATIC_')));
  if (!staticIdentity.WSGS_STATIC_DATASET_SCOPES) staticIdentity.WSGS_STATIC_DATASET_SCOPES = null;
  const services = {
    'gateway-db': { image: config.services.postgres.image, environment: { POSTGRES_USER: 'gowm', POSTGRES_DB: 'gowm', POSTGRES_PASSWORD: state.gatewayAdmin },
      volumes: ['gateway-data:/var/lib/postgresql'], healthcheck: { test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U gowm -d gowm'], interval: '5s', timeout: '3s', retries: 30 }, restart: 'unless-stopped' },
    'gateway-bootstrap': { image, command: bootstrap.command, environment: bootEnv, volumes: publicVolumes(bootstrap),
      depends_on: { 'gateway-db': { condition: 'service_healthy' } }, restart: 'no', read_only: true, tmpfs: ['/tmp'] },
    'signed-gateway': { image, command: gateway.command, environment: gatewayEnv, volumes: publicVolumes(gateway),
      networks: ['default', 'upstream'], depends_on: { 'gateway-bootstrap': { condition: 'service_completed_successfully' } },
      healthcheck: gateway.healthcheck, read_only: true, tmpfs: ['/tmp'], security_opt: ['no-new-privileges:true'], cap_drop: ['ALL'], restart: 'unless-stopped' },
  };
  for (const service of ['grounding-api', 'grounding-worker']) services[service] = {
    environment: { GOWM_DELEGATION_PRIVATE_KEY_FILE: '/run/wsgs-delegation/private.pem', ...(service === 'grounding-api' ? staticIdentity : {}) },
    volumes: ['delegation:/run/wsgs-delegation:ro'], extra_hosts: ['host.docker.internal:host-gateway'],
    depends_on: { 'signed-gateway': { condition: 'service_healthy' } },
  };
  privateWrite(overlayFile, JSON.stringify({ services,
    networks: { upstream: { external: true, name: config.networks.default.name } },
    volumes: { 'gateway-data': {}, delegation: {} } }, null, 2) + '\n');
  console.log('[unified] initialized upstream.env and wsgs.env; configure MQTT and MODEL values before up');
}

function check() {
  upstreamRun('config-check');
  run('bash', [path.join(wsgs, 'deploy-dev.sh'), '--check', '--env-file', wsgsEnvFile], {
    cwd: wsgs, env: cleanEnvironment(wsgsValues),
  });
  const config = JSON.parse(wsgsCompose(['config', '--format', 'json'], true));
  const api = config.services['grounding-api'].environment;
  if (config.services['signed-gateway'].environment.GATEWAY_AUTH_MODE !== 'SIGNED_DELEGATION_V1'
    || api.GOWM_GATEWAY_BASE_URL !== 'http://signed-gateway:8090'
    || config.networks.upstream.name !== upstreamValues.COMPOSE_PROJECT_NAME + '_default') throw Error('Unified authority/network mapping differs');
  console.log('[unified] configuration PASS; no containers started');
}

function installKey() {
  const name = state.wsgsProject + '_delegation';
  const existing = run('docker', ['volume', 'ls', '--filter', 'name=^' + name + '$', '--format', '{{.Name}}'], { capture: true });
  if (existing) {
    const labels = JSON.parse(run('docker', ['volume', 'inspect', name], { capture: true }))[0].Labels || {};
    if (labels['com.docker.compose.project'] !== state.wsgsProject || labels['com.docker.compose.volume'] !== 'delegation') throw Error('Delegation volume belongs to another deployment');
  } else run('docker', ['volume', 'create', '--label', 'com.docker.compose.project=' + state.wsgsProject,
    '--label', 'com.docker.compose.volume=delegation', name], { capture: true });
  const source = read(path.join(upstream, 'deployment/SOURCE.json'));
  run('docker', ['run', '--rm', '--network', 'none', '--user', '0', '--cap-drop', 'ALL', '--cap-add', 'CHOWN',
    '--security-opt', 'no-new-privileges:true', '--mount', 'type=volume,source=' + name + ',target=/secrets',
    '-i', 'gowm-analysis-native:' + source.nestedGowm.sha256, 'sh', '-c',
    'umask 077; cat > /secrets/private.next && chmod 400 /secrets/private.next && chown 10001:10001 /secrets/private.next && mv /secrets/private.next /secrets/private.pem'],
  { input: fs.readFileSync(path.join(runtime, 'delegation-private.pem')) });
}

export function verifyUnifiedWsgsRuntime(compose) {
  return compose(['exec', '-T', 'grounding-api', 'node', 'validation/scripts/verify-development-runtime.mjs']);
}

function smoke() {
  verifyUnifiedWsgsRuntime(wsgsCompose);
  console.log('[unified] WSGS service/capability readiness PASS; businessAcceptance=NOT_RUN');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['init', 'config-check', 'doctor', 'build-images', 'up', 'status', 'logs', 'smoke', 'down'].includes(command)
    || (command !== 'logs' && args.length)) throw Error('Usage: ./deploy init|config-check|doctor|build-images|up|status|logs [service]|smoke|down');
  await init();
  if (command === 'init') return;
  if (command === 'config-check') check();
  else if (command === 'doctor') { check(); upstreamRun('doctor'); }
  else if (command === 'build-images') { check(); upstreamRun('build-images'); wsgsCompose(['build', 'grounding-api']); }
  else if (command === 'up') {
    const lock = path.join(runtime, 'unified-up.lock');
    const fd = fs.openSync(lock, 'wx', 0o600);
    fs.writeFileSync(fd, String(process.pid));
    try { check(); upstreamRun('up'); await init(); installKey(); wsgsCompose(['build', 'grounding-api']);
      wsgsCompose(['up', '-d', '--no-build', '--wait', '--wait-timeout', wsgsValues.WSGS_DEPLOY_WAIT_SECONDS || '600']); smoke();
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  } else if (command === 'status') { upstreamRun('status'); wsgsCompose(['ps', '-a']); }
  else if (command === 'logs') wsgsCompose(['logs', '--tail', '200', ...args]);
  else if (command === 'smoke') { upstreamRun('smoke'); smoke(); }
  else if (command === 'down') { wsgsCompose(['down']); upstreamRun('down'); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('[unified] ERROR: ' + error.message); process.exitCode = 1; });
}
