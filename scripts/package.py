import hashlib
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'plugin.json').read_text(encoding='utf-8'))
output = root.parent / 'deliverables'
output.mkdir(exist_ok=True)
files = [root / name for name in ['plugin.json', 'mcp.json', '.mcp.json', 'README.md',
         'VERIFICATION.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'tsconfig.json',
         'runtime.sha256.json', 'AGENTS.md', '.gitignore', '.gitattributes']]
for folder in ['.codex-plugin', '.github', 'docs', 'dist', 'assets', 'skills', 'src', 'tests', 'scripts']:
    files.extend(p for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
files.sort(key=lambda p: p.relative_to(root).as_posix())
hashes = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
archive = output / f"vegetation-quota-{manifest['version']}.zip"
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as target:
    for file in files:
        target.write(file, f"{manifest['name']}/{file.relative_to(root).as_posix()}")
    target.writestr(f"{manifest['name']}/files.sha256.json", json.dumps(hashes, indent=2) + '\n')
with zipfile.ZipFile(archive) as target:
    assert target.testzip() is None
    assert len(target.namelist()) == len(files) + 1
    for name in target.namelist():
        assert '..' not in Path(name).parts and not name.startswith('/')
        assert not any(part in ['node_modules', '.npm-cache', '.env', 'artifacts'] for part in Path(name).parts)
    for name, digest in hashes.items():
        assert hashlib.sha256(target.read(f"{manifest['name']}/{name}")).hexdigest() == digest
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / f'{archive.name}.sha256').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
print(json.dumps({'archive': str(archive), 'files': len(files) + 1, 'sha256': digest}, indent=2))
