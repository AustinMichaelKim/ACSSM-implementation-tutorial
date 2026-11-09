import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('configure', Path(__file__).with_name('configure.py'))
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


class ConfigurationTests(unittest.TestCase):
    def test_active_configuration_is_preserved_and_idempotent(self):
        baseline = configure.ROOT / 'backups/2026-11-09'
        before = configure.read_exact(baseline / 'windows-default-keybindings.json')
        settings = configure.read_exact(baseline / 'wsl-machine-settings.json')
        after, configured, exceptions, count = configure.prepare(before, settings, '/source/latex.json')
        again, configured_again, _, count_again = configure.prepare(after, configured, '/source/latex.json')
        self.assertEqual((after, configured), (again, configured_again))
        self.assertEqual((count, count_again), (9, 0))
        original = configure.parse_jsonc(before)
        merged = configure.parse_jsonc(after)
        for old, new in zip(original, merged):
            self.assertEqual({k: v for k, v in old.items() if k != 'when'},
                             {k: v for k, v in new.items() if k != 'when'})
            if not configure.LATEX.search(old.get('when', '')):
                self.assertEqual(old, new)
        self.assertEqual(len(exceptions), 3)
        self.assertTrue(all('!notebookCellEditorFocused' not in b['when']
                            for b in merged[len(original):]))

    def test_comment_and_string_delimiters_are_not_confused(self):
        source = '// head\r\n{ /* note */ "url":"http://x/\\\"a,}", "body":"$1\\n\\\\theta{}$0", }'
        value = configure.parse_jsonc(source)
        updated = configure.append_members(source, ['    "added": true'], '}')
        self.assertEqual(configure.parse_jsonc(updated), {**value, 'added': True})
        self.assertIn('// head\r\n', updated)
        self.assertIn('/* note */', updated)
        self.assertNotIn('\n', updated.replace('\r\n', ''))

    def test_explicit_different_source_is_not_overwritten(self):
        with self.assertRaises(ValueError):
            configure.prepare('[]', '{"latexSmartTab.notebookSnippetSource":"/existing"}', '/new')

    def test_future_named_binding_keeps_args(self):
        source = '[{"key":"alt+x","command":"editor.action.insertSnippet", "when":"editorTextFocus && editorLangId == latex", "args":{"name":"Bold vector", "langId":"latex"}}]'
        merged, _, _, _ = configure.prepare(source, '{}', '/source')
        entries = configure.parse_jsonc(merged)
        self.assertEqual(entries[1]['command'], 'latexSmartTab.insertSnippetTemplate')
        self.assertEqual(entries[0]['args'], entries[1]['args'])


if __name__ == '__main__':
    unittest.main()
