#!/usr/bin/env python3
"""Create a source deployment bundle; includes no local credentials or generated output."""
from pathlib import Path
import json
import subprocess
from bundle_common import write_archive

root = Path(__file__).resolve().parents[1]
output = root / 'output' / 'deployment'
output.mkdir(parents=True, exist_ok=True)
archive = output / 'wsgs-development.tar.gz'
entries = ['deploy-dev.sh', '.env.example', '.dockerignore', 'Dockerfile', 'compose.yaml', 'README.md', 'VERSION', 'package.json',
           'package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'vitest.config.ts', 'packages', 'services',
           'contracts', 'database', 'config', 'validation', 'deployment', 'docs', 'tests']

files, modes = {}, {}

def collect(path, ancestors=()):
    relative = path.relative_to(root)
    parts = relative.parts
    if any(p in {'node_modules', 'dist', '__pycache__', 'secrets', '.git'} for p in parts):
        return
    name = parts[-1]
    if (name.startswith('.env') and name != '.env.example') or name.endswith(('.pem', '.key', '.log', '.tsbuildinfo')) or name in {'live-site-references.json', 'compose.dev.generated.json'}:
        return
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root):
        raise ValueError('External symlink cannot be packaged: ' + str(relative))
    if path.is_dir():
        if resolved in ancestors:
            raise ValueError('Cyclic source symlink: ' + str(relative))
        for child in sorted(path.iterdir()):
            collect(child, (*ancestors, resolved))
    elif path.is_file():
        files[str(relative)] = path.read_bytes()
        modes[str(relative)] = path.stat().st_mode
    else:
        raise ValueError('Unsupported source entry: ' + str(relative))

for entry in entries:
    collect(root / entry)
provenance = {
    'schemaVersion': 'wsgs-source-deployment/1.0',
    'gitCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'gitBranch': subprocess.check_output(['git', 'branch', '--show-current'], cwd=root, text=True).strip(),
    'workingTreeStatus': subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).splitlines(),
    'softwareVersion': json.loads(files['package.json'])['version'],
    'upstreamSnapshot': json.loads(files['contracts/upstream/gowm-current/SNAPSHOT.json']),
    'delivery': 'ONLINE_SOURCE_BUILD',
    'siteAcceptance': 'NOT_RUN',
}
files['SOURCE.json'] = (json.dumps(provenance, ensure_ascii=False, indent=2) + '\n').encode()
write_archive(archive, 'wsgs-development', files, modes)
print(archive)
