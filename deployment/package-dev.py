#!/usr/bin/env python3
"""Create a source deployment bundle; includes no local credentials or generated output."""
from pathlib import Path
import hashlib
import tarfile

root = Path(__file__).resolve().parents[1]
output = root / 'output' / 'deployment'
output.mkdir(parents=True, exist_ok=True)
archive = output / 'wsgs-development.tar.gz'
entries = ['deploy-dev.sh', '.env.example', '.dockerignore', 'Dockerfile', 'compose.yaml', 'README.md', 'package.json',
           'package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'vitest.config.ts', 'packages', 'services',
           'contracts', 'database', 'config', 'validation', 'deployment', 'docs', 'tests']

def filtered(info):
    parts = Path(info.name).parts
    if any(p in {'node_modules', 'dist', '__pycache__', 'secrets', '.git'} for p in parts):
        return None
    name = parts[-1]
    if (name.startswith('.env') and name != '.env.example') or name.endswith(('.pem', '.key', '.log', '.tsbuildinfo')) or name in {'live-site-references.json', 'compose.dev.generated.json'}:
        return None
    if info.issym():
        target = (root / Path(*parts[1:])).resolve()
        if not target.is_relative_to(root):
            raise ValueError('External symlink cannot be packaged: ' + info.name)
    info.uid = info.gid = 0
    info.uname = info.gname = ''
    return info

with tarfile.open(archive, 'w:gz') as bundle:
    for entry in entries:
        bundle.add(root / entry, arcname='wsgs-development/' + entry, filter=filtered)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(archive.suffix + '.sha256').write_text(f'{digest}  {archive.name}\n')
print(archive)
