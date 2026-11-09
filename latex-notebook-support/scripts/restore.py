#!/usr/bin/env python3
"""Restore the two applied settings and reinstall the backed-up 0.3.2 VSIX.

Dry run by default. Refuses to overwrite settings edited since this application.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true')
parser.add_argument('--code-server', type=Path, default=Path('/home/minseok/.vscode-server/bin/c4453f8ea430795f941c1b2ff6c9321135a74a02/bin/code-server'))
args = parser.parse_args()
manifest = json.loads((ROOT / 'verification/application.json').read_text())
for item in manifest['changed']:
    target, backup = Path(item['path']), Path(item['backup'])
    if hashlib.sha256(target.read_bytes()).hexdigest() != item['sha256']:
        raise SystemExit(f'설정이 적용 후 변경되었습니다. 수동 병합이 필요합니다: {target}\n원본 백업: {backup}')
    if not backup.is_file():
        raise SystemExit(f'백업이 없습니다: {backup}')
    print(f'{backup} -> {target}')
vsix = ROOT / 'backups/2026-11-09/latex-smart-tab-dispatcher-0.3.2.vsix'
command = [str(args.code_server), '--extensions-dir', '/home/minseok/.vscode-server/extensions',
           '--install-extension', str(vsix), '--force']
print('Reinstall:', command)
if args.apply:
    for item in manifest['changed']:
        shutil.copy2(item['backup'], item['path'])
    subprocess.run(command, check=True)
    print('복구 완료. VS Code에서 Developer: Reload Window를 실행하세요.')
else:
    print('미리보기입니다. 실제 복구: python scripts/restore.py --apply')
