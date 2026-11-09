#!/usr/bin/env python3
"""Merge Notebook-only copies of the current user's LaTeX bindings, preserving JSONC.

prepare writes reviewable copies. apply writes only the two explicit input paths,
after a byte-for-byte backup. Repeated application does not duplicate bindings.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
from datetime import datetime, timezone

NOTEBOOK = ('(notebookType == jupyter-notebook && notebookCellType == markup && '
            'editorLangId == markdown && notebookCellEditorFocused)')
LATEX = re.compile(r'\beditorLangId\s*==\s*(?:latex|[\'\"]latex[\'\"])')
ROOT = Path(__file__).resolve().parents[1]


def mask_comments(text):
    result = list(text)
    i = 0
    while i < len(text):
        if text[i] == '"':
            i += 1
            while i < len(text):
                if text[i] == '\\':
                    i += 2
                elif text[i] == '"':
                    i += 1
                    break
                else:
                    i += 1
        elif text.startswith('//', i):
            end = text.find('\n', i)
            end = len(text) if end < 0 else end
            result[i:end] = ' ' * (end - i)
            i = end
        elif text.startswith('/*', i):
            end = text.find('*/', i + 2)
            if end < 0:
                raise ValueError('Unclosed JSONC comment')
            end += 2
            for j in range(i, end):
                if text[j] not in '\r\n':
                    result[j] = ' '
            i = end
        else:
            i += 1
    return ''.join(result)


def significant(text):
    """Mask string interiors too, retaining structural token offsets."""
    result = list(mask_comments(text))
    i = 0
    while i < len(result):
        if result[i] == '"':
            i += 1
            while i < len(result):
                c = result[i]
                if c == '\\':
                    result[i:i + 2] = [' ', ' ']
                    i += 2
                elif c == '"':
                    i += 1
                    break
                else:
                    if c not in '\r\n':
                        result[i] = ' '
                    i += 1
        else:
            i += 1
    return ''.join(result)


def parse_jsonc(text):
    text = text.lstrip('\ufeff')
    masked = list(mask_comments(text))
    structural = significant(text)
    for match in re.finditer(r',\s*(?=[}\]])', structural):
        masked[match.start()] = ' '
    return json.loads(''.join(masked))


def append_members(text, additions, closing):
    if not additions:
        return text
    structure = significant(text)
    end = structure.rfind(closing)
    if end < 0 or structure[end + 1:].strip():
        raise ValueError('Unexpected JSONC root structure')
    previous = end - 1
    while structure[previous].isspace():
        previous -= 1
    nl = '\r\n' if '\r\n' in text else '\n'
    before = text[:end]
    if structure[previous] not in '[{,':
        before = before[:previous + 1] + ',' + before[previous + 1:]
    rendered = (',' + nl).join(additions).replace('\n', nl) if nl == '\n' else (',' + nl).join(s.replace('\n', nl) for s in additions)
    return before + nl + '    // Jupyter Markdown editing: LaTeX Smart Tab' + nl + rendered + nl + text[end:]


def notebook_bindings(bindings):
    candidates = []
    exceptions = []
    for binding in bindings:
        when = binding.get('when', '')
        if not LATEX.search(when):
            continue
        command = binding.get('command', '')
        body = binding.get('args', {}).get('snippet', '')
        if command == 'latex-workshop.build' or '\\documentclass' in body:
            exceptions.append({'key': binding['key'], 'command': command,
                               'reason': 'TeX build' if command == 'latex-workshop.build' else 'Full TeX document template'})
            continue
        copy = dict(binding)
        # Remove our TeX-only exclusion before producing the Notebook counterpart.
        when = re.sub(r'\(\s*' + LATEX.pattern + r'\s*&&\s*!notebookCellEditorFocused\s*\)',
                      'editorLangId == latex', when)
        copy['when'] = LATEX.sub(NOTEBOOK, when)
        copy['when'] = re.sub(r'\bhasSnippetCompletions\b', 'latexSmartTab.notebookHasSnippetCompletions', copy['when'])
        if command == 'editor.action.insertSnippet':
            copy['command'] = 'latexSmartTab.insertSnippetTemplate'
        variants = [copy]
        if command == 'latexSmartTab.expandSnippet' and not re.search(r'!?\binSnippetMode\b', copy['when']):
            variants = []
            for in_snippet in [False, True]:
                variant = dict(copy)
                variant['when'] += ' && ' + ('inSnippetMode' if in_snippet else '!inSnippetMode')
                variant['args'] = {**copy.get('args', {}), 'inSnippetMode': in_snippet}
                variants.append(variant)
        for variant in variants:
            if variant not in bindings and variant not in candidates:
                candidates.append(variant)
    return candidates, exceptions


def guard_original_latex_bindings(text):
    """Edit only JSON string values of when properties, leaving all other bytes."""
    masked = mask_comments(text)
    replacements = []
    i = 0
    decoder = json.JSONDecoder()
    while i < len(masked):
        if masked[i] != '"':
            i += 1
            continue
        token, end = decoder.raw_decode(masked, i)
        after = end
        while after < len(masked) and masked[after].isspace():
            after += 1
        if token == 'when' and after < len(masked) and masked[after] == ':':
            start = after + 1
            while masked[start].isspace():
                start += 1
            value, value_end = decoder.raw_decode(masked, start)
            if isinstance(value, str) and LATEX.search(value) and '!notebookCellEditorFocused' not in value:
                guarded = LATEX.sub('(editorLangId == latex && !notebookCellEditorFocused)', value)
                replacements.append((start, value_end, json.dumps(guarded, ensure_ascii=False)))
        i = end
    for start, end, value in reversed(replacements):
        text = text[:start] + value + text[end:]
    return text


def prepare(keybindings_text, settings_text, snippet_source):
    bindings = parse_jsonc(keybindings_text)
    additions, exceptions = notebook_bindings(bindings)
    guarded_text = guard_original_latex_bindings(keybindings_text)
    keybindings = append_members(guarded_text, [
        '\n'.join('    ' + line for line in json.dumps(b, ensure_ascii=False, indent=4).splitlines())
        for b in additions], ']')
    settings = parse_jsonc(settings_text)
    key = 'latexSmartTab.notebookSnippetSource'
    if key in settings and settings[key] != snippet_source:
        raise ValueError(f'{key} already points elsewhere; review its existing value before changing it')
    updated_settings = append_members(settings_text, [
        '    ' + json.dumps(key) + ': ' + json.dumps(snippet_source, ensure_ascii=False)
    ] if key not in settings else [], '}')
    assert parse_jsonc(keybindings) == parse_jsonc(guarded_text) + additions
    assert parse_jsonc(updated_settings) == {**settings, key: snippet_source}
    return keybindings, updated_settings, exceptions, len(additions)


def read_exact(path):
    return path.read_bytes().decode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'apply'])
    parser.add_argument('--keybindings', type=Path, required=True)
    parser.add_argument('--settings', type=Path, required=True, help='WSL Machine/settings.json')
    parser.add_argument('--snippets', type=Path, required=True, help='Active Profile latex.json, readable from WSL')
    parser.add_argument('--output', type=Path, default=ROOT / 'prepared')
    args = parser.parse_args()
    # Validate all source definitions; never rewrite or normalize the original.
    snippets = parse_jsonc(read_exact(args.snippets))
    if not isinstance(snippets, dict):
        raise ValueError('latex.json must have an object root')
    original_keys = read_exact(args.keybindings)
    original_settings = read_exact(args.settings)
    keys, settings, exceptions, count = prepare(original_keys, original_settings, str(args.snippets.resolve()))
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'keybindings.json').write_bytes(keys.encode('utf-8'))
    (args.output / 'wsl-settings.json').write_bytes(settings.encode('utf-8'))
    report = {'mode': args.mode, 'addedNotebookBindings': count, 'texOnlyBindings': exceptions,
              'snippets': len(snippets), 'snippetSource': str(args.snippets.resolve()), 'changed': []}
    if args.mode == 'apply':
        backup = ROOT / 'backups' / ('apply-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
        backup.mkdir(parents=True, exist_ok=False)
        for name, path, before, after in [('keybindings.json', args.keybindings, original_keys, keys),
                                          ('wsl-settings.json', args.settings, original_settings, settings)]:
            if before != after:
                if read_exact(path) != before:
                    raise ValueError(f'File changed during preparation: {path}')
                shutil.copy2(path, backup / name)
                path.write_bytes(after.encode('utf-8'))
                report['changed'].append({'path': str(path), 'backup': str(backup / name),
                                          'sha256': hashlib.sha256(after.encode('utf-8')).hexdigest()})
    (args.output / 'merge-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
