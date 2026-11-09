#!/usr/bin/env python3
"""Build a deterministic unsigned VSIX from this source tree, without network."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {'.git', 'node_modules', '.vscode-test', '__pycache__', '.pytest_cache'}
SKIP_FILES = {'package-lock.json', 'host-results.json', '.DS_Store'}
STAMP = (2026, 9, 28, 0, 0, 0)

def manifest(package: dict) -> bytes:
    ns = 'http://schemas.microsoft.com/developer/vsx-schema/2011'
    ET.register_namespace('', ns)
    tag = lambda name: '{' + ns + '}' + name
    root = ET.Element(tag('PackageManifest'), {'Version': '2.0.0'})
    meta = ET.SubElement(root, tag('Metadata'))
    ET.SubElement(meta, tag('Identity'), {
        'Language': 'en-US', 'Id': package['name'], 'Version': package['version'],
        'Publisher': package['publisher']})
    ET.SubElement(meta, tag('DisplayName')).text = package['displayName']
    ET.SubElement(meta, tag('Description'), {'{http://www.w3.org/XML/1998/namespace}space': 'preserve'}).text = package['description']
    ET.SubElement(meta, tag('Tags')).text = 'latex,snippets,tab'
    ET.SubElement(meta, tag('Categories')).text = ','.join(package.get('categories', []))
    ET.SubElement(meta, tag('GalleryFlags')).text = 'Public'
    properties = ET.SubElement(meta, tag('Properties'))
    for key, value in {
        'Microsoft.VisualStudio.Code.Engine': package['engines']['vscode'],
        'Microsoft.VisualStudio.Code.ExtensionDependencies': '',
        'Microsoft.VisualStudio.Code.ExtensionPack': '',
        'Microsoft.VisualStudio.Code.ExtensionKind': ','.join(package.get('extensionKind', ['workspace'])),
        'Microsoft.VisualStudio.Code.LocalizedLanguages': '',
        'Microsoft.VisualStudio.Code.EnabledApiProposals': ''}.items():
        ET.SubElement(properties, tag('Property'), {'Id': key, 'Value': value})
    installation = ET.SubElement(root, tag('Installation'))
    ET.SubElement(installation, tag('InstallationTarget'), {'Id': 'Microsoft.VisualStudio.Code'})
    ET.SubElement(root, tag('Dependencies'))
    assets = ET.SubElement(root, tag('Assets'))
    for kind, name in [('Microsoft.VisualStudio.Code.Manifest','package.json'),
                       ('Microsoft.VisualStudio.Services.Content.Details','README.md'),
                       ('Microsoft.VisualStudio.Services.Content.Changelog','CHANGELOG.md'),
                       ('Microsoft.VisualStudio.Services.Content.License','LICENSE.txt')]:
        ET.SubElement(assets, tag('Asset'), {'Type': kind, 'Path': 'extension/'+name, 'Addressable': 'true'})
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)

def content_types() -> bytes:
    ns = 'http://schemas.openxmlformats.org/package/2006/content-types'
    root = ET.Element('Types', {'xmlns': ns})
    for extension, mime in {'json':'application/json','js':'application/javascript',
            'md':'text/markdown','txt':'text/plain','xml':'application/xml',
            'py':'text/x-python','tap':'text/plain','log':'text/plain'}.items():
        ET.SubElement(root, 'Default', {'Extension': extension, 'ContentType': mime})
    ET.SubElement(root, 'Override', {'PartName':'/extension.vsixmanifest', 'ContentType':'text/xml'})
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)

def write_entry(archive: zipfile.ZipFile, name: str, data: bytes) -> None:
    info = zipfile.ZipInfo(name, STAMP)
    info.create_system = 3
    info.external_attr = (0o100644 << 16)
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, data, compresslevel=9)

def main() -> None:
    package = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT.parent/(package['name']+'-'+package['version']+'.vsix'))
    args = parser.parse_args()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    for name in ['extension.js','core.js','boundary-hop.js','test/host-regression.js','LICENSE.txt','VERIFICATION.json']:
        if not (ROOT/name).is_file():
            raise SystemExit('Required source file missing: '+name)
    entries = []
    for file in sorted(ROOT.rglob('*')):
        if not file.is_file(): continue
        rel = file.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts): continue
        if file.name in SKIP_FILES or file.suffix in {'.vsix','.zip','.pyc'} or file.resolve()==output: continue
        entries.append(('extension/'+rel.as_posix(), file.read_bytes()))
    with zipfile.ZipFile(output, 'w') as archive:
        write_entry(archive, '[Content_Types].xml', content_types())
        write_entry(archive, 'extension.vsixmanifest', manifest(package))
        for name, data in entries: write_entry(archive,name,data)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None: raise SystemExit('VSIX CRC verification failed')
    print(str(output))

if __name__ == '__main__':
    main()
