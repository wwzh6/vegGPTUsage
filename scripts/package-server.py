import argparse
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
output = parser.parse_args().output
names = ['dist/sync.mjs', 'scripts/server-sync.mjs',
         'scripts/systemd/vegetation-quota-sync.service',
         'scripts/systemd/vegetation-quota-sync.timer',
         'docs/SERVER-SYNC.md', 'THIRD_PARTY_NOTICES.md']
files = {name: (root / name).read_bytes() for name in names}
digest = hashlib.sha256(files['dist/sync.mjs']).hexdigest()
assert digest == json.loads((root / 'runtime.sha256.json').read_text())['dist/sync.mjs']
files['runtime.sha256.json'] = (json.dumps({'dist/sync.mjs': digest}) + '\n').encode()
manifest = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
files['files.sha256.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, data in files.items():
        entry = zipfile.ZipInfo(name)
        entry.create_system = 3
        entry.external_attr = 0o100644 << 16
        entry.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(entry, data)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    for entry in archive.infolist():
        assert entry.external_attr >> 16 & 0o777 == 0o644
        assert archive.read(entry.filename) == files[entry.filename]
checksum = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix(output.suffix + '.sha256').write_text(f'{checksum}  {output.name}\n')
print(json.dumps({'archive': str(output), 'sha256': checksum, 'files': len(files)}))
