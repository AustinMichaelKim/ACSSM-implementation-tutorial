#!/usr/bin/env python3
"""Refresh the portable VSIX snapshot; live source changes need no rebuild."""
import argparse
import hashlib
import json
from pathlib import Path
from configure import parse_jsonc

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
raw = args.source.read_bytes()
definitions = parse_jsonc(raw.decode('utf-8'))
if not isinstance(definitions, dict):
    raise ValueError('Expected a snippet object')
for name, definition in definitions.items():
    if not isinstance(definition, dict):
        raise ValueError(f'Invalid snippet: {name}')
    body = definition.get('body')
    if not isinstance(body, str) and not (isinstance(body, list) and all(isinstance(line, str) for line in body)):
        raise ValueError(f'Invalid snippet body: {name}')
target = ROOT / 'extension/snippets/latex.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(raw)
report = {'source': str(args.source.resolve()), 'snapshot': str(target.resolve()),
          'sha256': hashlib.sha256(raw).hexdigest(), 'definitions': len(definitions),
          'snippets': [{'name': name, 'prefix': d.get('prefix'),
                        'description': d.get('description'),
                        'bodySha256': hashlib.sha256(json.dumps(d['body'], ensure_ascii=False).encode()).hexdigest()}
                       for name, d in definitions.items()]}
(ROOT / 'verification/snippet-inventory.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(f'{len(definitions)} definitions copied byte-for-byte; SHA256 {report["sha256"]}')
