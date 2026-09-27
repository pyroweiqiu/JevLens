"""Inspect a distributable ZIP, including decompressed bytes, without printing secrets."""
import io
import json
from pathlib import Path, PurePosixPath
import re
import sys
import zipfile


def check(data):
    keys = []
    for path in Path('conf').glob('*'):
        if path.is_file() and 'keys' in path.name.lower():
            keys.extend(re.findall(rb'sk-or-v1-[A-Za-z0-9_-]+', path.read_bytes()))
    patterns = [rb'sk-or-v1-[A-Za-z0-9_-]{16,}', rb'\bsk-[A-Za-z0-9_-]{24,}',
                rb'\bgh[pousr]_[A-Za-z0-9]{20,}', rb'\bgithub_pat_[A-Za-z0-9_]{30,}',
                rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----']
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        names = archive.namelist()
        if len(names) != len(set(names)) or sum(e.file_size for e in entries) > 20 * 1024 * 1024:
            raise ValueError('Duplicate entries or oversized package')
        if 'manifest.json' not in names:
            raise ValueError('manifest.json must be at ZIP root')
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if (path.is_absolute() or '..' in path.parts or '\\' in entry.filename
                    or any(p.startswith('.') for p in path.parts)
                    or path.parts[0] in ('conf', 'node_modules', 'third_party', 'server', 'tests')
                    or path.suffix.lower() not in ('.json', '.js', '.mjs', '.html', '.css', '.svg', '.png')):
                raise ValueError('Unexpected package entry')
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Symlink in package')
            content = archive.read(entry)
            if any(re.search(p, content) for p in patterns) or any(k in content for k in keys):
                raise ValueError('Possible credential in package; value withheld')
        manifest = json.loads(archive.read('manifest.json'))
        if manifest['manifest_version'] != 3 or not manifest.get('version'):
            raise ValueError('Invalid manifest')
        for size in ('16', '32', '48', '128'):
            if manifest.get('icons', {}).get(size) not in names:
                raise ValueError('Missing extension icon')
        print(f"PASS ZIP: {len(entries)} production files, root manifest, icons, no detected credentials")


try:
    check(sys.stdin.buffer.read() if sys.argv[1] == '--stdin' else Path(sys.argv[1]).read_bytes())
except Exception:
    # Never echo archive contents or exception strings that could include a credential.
    print('FAIL ZIP: invalid structure, unexpected file, missing icon, or possible credential', file=sys.stderr)
    sys.exit(1)
