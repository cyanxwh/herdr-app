#!/usr/bin/env python3
"""Install only epsychic source files, preserving the user's runtime state."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=Path, default=Path(os.environ.get(
        'HERDR_APP_HOME', str(Path.home() / '.config/herdr-app'))))
    parser.add_argument('--apply', action='store_true', help='install; otherwise preview only')
    parser.add_argument('--activate', action='store_true', help='switch the running window after checks')
    args = parser.parse_args()
    if args.activate and not args.apply:
        parser.error('--activate requires --apply')
    source = Path(__file__).resolve().parent
    home = args.home.expanduser().resolve()
    names = ['epsychic-tabs', 'epsychic-new-menu', 'epsychic-issues', 'epsychic-agent-launch']
    files = [Path('layouts/epsychic.json'), Path('layouts/epsychic.svg')]
    for name in names:
        files.extend(p.relative_to(source) for p in sorted((source / 'mods' / name).iterdir())
                     if p.is_file() and p.suffix in {'.js', '.json', '.svg', '.md'})
    for rel in files:
        if rel.suffix == '.json':
            json.loads((source / rel).read_text())
    changed = [rel for rel in files if not (home / rel).is_file()
               or (source / rel).read_bytes() != (home / rel).read_bytes()]
    print(f'{len(files)} source files; {len(changed)} changes; destination: {home}')
    for rel in changed:
        print(rel)
    if not args.apply:
        return
    if not shutil.which('herdr-app'):
        parser.error('herdr-app must be on PATH')
    backup = Path.home() / '.local/state/herdr-app-backups' / (
        datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '-epsychic-install')
    for rel in changed:
        dest = home / rel
        if dest.exists():
            (backup / rel).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copy2(dest, backup / rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as tmp:
            tmp.write((source / rel).read_bytes())
            temp = Path(tmp.name)
        temp.replace(dest)
    if backup.exists():
        print(f'Backup: {backup}')
    env = {**os.environ, 'HERDR_APP_HOME': str(home)}
    for name in names:
        subprocess.run(['herdr-app', 'check', str(home / 'mods' / name)], env=env, check=True)
    if args.activate:
        subprocess.run(['herdr-app', 'do', 'layout.switch', '{"name":"epsychic"}'], env=env, check=True)


if __name__ == '__main__':
    main()
