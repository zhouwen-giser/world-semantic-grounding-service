import pathlib, subprocess, json, os, time, hashlib

base = pathlib.Path('/mnt/data/wsgs-live')
release = base / 'releases/5a14773927a4c6ea'
new = release / 'wsgs-development'
old = pathlib.Path((release / 'previous-release.txt').read_text().strip())
image = 'wsgs:dev-5a14773927a4c6ea'
targets = ['grounding-api', 'grounding-worker']
def compose(root, image_override=None):
    env = dict(os.environ, WSGS_ENV_FILE=str(root / '.env'))
    if image_override: env['WSGS_RUNTIME_IMAGE'] = image_override
    cmd = ['docker', 'compose', '-p', 'wsgs-dev', '--env-file', str(root / '.env'), '-f', str(root / 'compose.yaml'), '-f', str(root / 'compose.dev.generated.json')]
    return cmd, env
def run(root, args, image_override=None):
    cmd, env = compose(root, image_override)
    return subprocess.run(cmd + args, env=env, cwd=root, capture_output=True, text=True)
def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
before = {s: inspect('wsgs-dev-' + s + '-1') for s in targets}
db_id = inspect('wsgs-dev-postgres-1')['Id']
old_config_result = run(old, ['config', '--format', 'json'])
assert old_config_result.returncode == 0, 'old compose config failed'
old_config = json.loads(old_config_result.stdout)
override = json.loads((new / 'compose.dev.generated.json').read_text())
override['secrets'] = old_config.get('secrets', {})
for service in targets:
    override['services'][service]['volumes'] = old_config['services'][service].get('volumes', [])
(new / 'compose.dev.generated.json').write_text(json.dumps(override, indent=2) + '\n')
os.chmod(new / 'compose.dev.generated.json', 0o600)
new_config_result = run(new, ['config', '--format', 'json'], image)
assert old_config_result.returncode == new_config_result.returncode == 0, 'compose config failed'
configs = [json.loads(r.stdout) for r in [old_config_result, new_config_result]]
for section in ['secrets', 'volumes', 'networks']:
    assert configs[0].get(section) == configs[1].get(section), 'shared configuration changed: ' + section
for service in targets:
    normalized = [{k:v for k,v in config['services'][service].items() if k not in ['build', 'image']} for config in configs]
    assert normalized[0] == normalized[1], 'service configuration changed: ' + service
assert (old / '.env').read_bytes() == (new / '.env').read_bytes(), 'environment changed'
# Keep the new image override explicit for future operations from this release.
override = json.loads((new / 'compose.dev.generated.json').read_text())
for s in targets: override['services'][s]['image'] = image
(new / 'compose.dev.generated.json').write_text(json.dumps(override, indent=2) + '\n')
os.chmod(new / 'compose.dev.generated.json', 0o600)
count_js = """const{default:pg}=await import('pg');const p=new pg.Pool({connectionString:process.env.DATABASE_URL});try{const r=await p.query(\"SELECT count(*)::int n FROM wsgs.grounding_job WHERE status IN ('ACCEPTED','RUNNING')\");console.log(r.rows[0].n)}finally{await p.end()}"""
def active_jobs():
    r=subprocess.run(['docker','exec','wsgs-dev-grounding-worker-1','node','--input-type=module','-e',count_js],capture_output=True,text=True,timeout=10)
    assert r.returncode == 0, 'job count failed'
    return int(r.stdout.strip())
initial = active_jobs()
print(json.dumps({'configurationPreserved':True,'initialJobs':initial}),flush=True)
try:
    r=run(old,['stop','grounding-api']);assert r.returncode==0,'API stop failed'
    deadline=time.monotonic()+130
    while active_jobs():
        assert time.monotonic()<deadline,'drain timed out'
        time.sleep(5)
    r=run(new,['up','-d','--no-deps','--no-build','--wait','--wait-timeout','90',*targets])
    (release/'rollout.log').write_text(r.stdout+r.stderr)
    assert r.returncode==0,'targeted rollout failed'
    expected=json.loads(subprocess.check_output(['docker','image','inspect',image]))[0]['Id']
    after={s:inspect('wsgs-dev-'+s+'-1') for s in targets}
    for s in targets:
        assert after[s]['Image']==expected,'image mismatch'
        assert after[s]['State'].get('Health',{}).get('Status')=='healthy','unhealthy'
        assert sorted(after[s]['Config']['Env'])==sorted(before[s]['Config']['Env']),'runtime environment changed'
        mounts = lambda container: sorted(container['Mounts'], key=lambda m: m['Destination'])
        assert mounts(after[s])==mounts(before[s]),'mounts changed'
    assert inspect('wsgs-dev-postgres-1')['Id']==db_id,'database replaced'
    tmp=base/'current.pending';tmp.unlink(missing_ok=True);tmp.symlink_to(new);tmp.replace(base/'current')
    evidence={'status':'PASS','image':expected,'services':targets,'initialJobs':initial,'health':{s:'healthy' for s in targets},'runtimeEnvironmentUnchanged':True,'mountsUnchanged':True,'databaseUnchanged':True,'noBusinessRequestSubmitted':True}
    (release/'rollout-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
    print(json.dumps(evidence))
except Exception:
    rollback=run(old,['up','-d','--no-deps','--no-build',*targets])
    print(json.dumps({'rollbackExit':rollback.returncode}))
    raise
