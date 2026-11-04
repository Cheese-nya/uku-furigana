import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest

# Storage does not require a GUI; isolate the launcher from pywebview here.
sys.modules.setdefault('webview', types.ModuleType('webview'))
spec = importlib.util.spec_from_file_location('desktop_runner', Path(__file__).resolve().parents[1] / 'desktop_runner.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class DesktopCorrectionsTest(unittest.TestCase):
    def test_corrections_survive_new_api_instance_and_unicode_titles(self):
        with tempfile.TemporaryDirectory() as directory:
            api = launcher.Api(directory)
            self.assertEqual(api.load_corrections(), {})
            data = {'歪な鳥篭': [{'line': '二人で', 'start': 0, 'surface': '二人', 'reading': 'ふたり', 'type': 'hiragana'}]}
            self.assertTrue(api.save_corrections(data)['success'])
            self.assertEqual(launcher.Api(directory).load_corrections(), data)
            self.assertFalse((Path(directory) / 'corrections.tmp').exists())
            self.assertTrue(api.save_corrections({'歪な鳥篭': []})['success'])
            self.assertEqual(launcher.Api(directory).load_corrections(), {'歪な鳥篭': []})

    def test_v2_database_keeps_legacy_file_and_survives_restarts(self):
        with tempfile.TemporaryDirectory() as directory:
            api = launcher.Api(directory)
            legacy = {'台本': [{'line': '二人で', 'start': 0, 'surface': '二人', 'reading': 'ふたり', 'type': 'hiragana'}]}
            api.save_corrections(legacy)
            legacy_bytes = (Path(directory) / 'corrections.json').read_bytes()
            self.assertEqual(api.load_correction_database(), legacy)
            data = {'version': 2, 'glossary': {}, 'scripts': {'script:test': {'title': '改名', 'overrides': legacy['台本']}}}
            self.assertTrue(api.save_correction_database(data)['success'])
            self.assertEqual(launcher.Api(directory).load_correction_database(), data)
            self.assertEqual((Path(directory) / 'corrections.json').read_bytes(), legacy_bytes)
            self.assertFalse((Path(directory) / 'corrections-v2.tmp').exists())
            self.assertFalse(api.save_correction_database({'version': 3})['success'])
            self.assertEqual(api.load_correction_database(), data)

    def test_corrupt_database_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'corrections-v2.json'
            path.write_text('{broken', encoding='utf-8')
            api = launcher.Api(directory)
            with self.assertRaises(ValueError):
                api.load_correction_database()
            self.assertFalse(api.save_correction_database({'version': 2, 'glossary': {}, 'scripts': {}})['success'])
            self.assertEqual(path.read_text(encoding='utf-8'), '{broken')

    def test_invalid_data_does_not_replace_existing_corrections(self):
        with tempfile.TemporaryDirectory() as directory:
            api = launcher.Api(directory)
            api.save_corrections({'test': []})
            self.assertFalse(api.save_corrections(None)['success'])
            self.assertEqual(api.load_corrections(), {'test': []})


class DesktopLibraryTest(unittest.TestCase):
    def test_missing_library_returns_none_and_save_round_trips_across_restarts(self):
        with tempfile.TemporaryDirectory() as directory:
            api = launcher.Api(directory)
            self.assertIsNone(api.load_library_database())
            data = {'version': 1, 'books': {'book:1': {'title': '歪な鳥篭', 'content': '二人で行っておいで。'}}}
            self.assertTrue(api.save_library_database(data)['success'])
            self.assertEqual(launcher.Api(directory).load_library_database(), data)
            self.assertFalse((Path(directory) / 'library-v1.tmp').exists())
            updated = {'version': 1, 'books': {}}
            self.assertTrue(api.save_library_database(updated)['success'])
            self.assertEqual(api.load_library_database(), updated)
            # The frontend migrates version 1 and writes version 2 back.
            migrated = {'version': 2, 'books': {'book:1': {'title': '歪な鳥篭', 'category': 'other'}}}
            self.assertTrue(api.save_library_database(migrated)['success'])
            self.assertEqual(launcher.Api(directory).load_library_database(), migrated)

    def test_invalid_library_data_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            api = launcher.Api(directory)
            good = {'version': 1, 'books': {}}
            self.assertTrue(api.save_library_database(good)['success'])
            for bad in (None, [], {'version': 3, 'books': {}}, {'version': '2', 'books': {}}, {'version': 1}, {'version': 2, 'books': []}):
                self.assertFalse(api.save_library_database(bad)['success'])
            self.assertEqual(api.load_library_database(), good)

    def test_corrupt_library_file_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'library-v1.json'
            path.write_text('{broken', encoding='utf-8')
            api = launcher.Api(directory)
            with self.assertRaises(ValueError):
                api.load_library_database()
            # A fresh save must refuse to clobber a corrupt file.
            self.assertFalse(api.save_library_database({'version': 1, 'books': {}})['success'])
            self.assertEqual(path.read_text(encoding='utf-8'), '{broken')
            self.assertFalse((Path(directory) / 'library-v1.tmp').exists())


class DesktopTelemetryPreferencesTest(unittest.TestCase):
    def test_ids_survive_new_api_instance(self):
        with tempfile.TemporaryDirectory() as directory:
            api = launcher.Api(directory)
            self.assertEqual(api.load_telemetry_preferences(), {})
            data = {'uku.telemetry.installId.v1': 'install-1', 'uku.telemetry.visitorId.v1': 'visitor-1'}
            self.assertTrue(api.save_telemetry_preferences(data)['success'])
            self.assertEqual(launcher.Api(directory).load_telemetry_preferences(), data)
            self.assertFalse((Path(directory) / 'telemetry-preferences.tmp').exists())
            if os.name == 'posix':
                self.assertEqual((Path(directory) / 'telemetry-preferences.json').stat().st_mode & 0o777, 0o600)

    def test_invalid_payload_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            api = launcher.Api(directory)
            self.assertTrue(api.save_telemetry_preferences({'uku.telemetry.installId.v1': 'install-1'})['success'])
            self.assertFalse(api.save_telemetry_preferences(None)['success'])
            self.assertFalse(api.save_telemetry_preferences({'key': 1})['success'])
            self.assertEqual(api.load_telemetry_preferences(), {'uku.telemetry.installId.v1': 'install-1'})


class DefaultDataDirTest(unittest.TestCase):
    def test_migrates_legacy_directory_once(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = Path(directory) / 'FuriganaDubbingStudio'
            legacy.mkdir()
            (legacy / 'library-v1.json').write_text('{}', encoding='utf-8')
            root = launcher.default_data_dir(directory)
            self.assertEqual(root, Path(directory) / 'UkuFurigana')
            self.assertEqual((root / 'library-v1.json').read_text(encoding='utf-8'), '{}')
            self.assertFalse(legacy.exists())

    def test_existing_new_directory_wins(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'UkuFurigana').mkdir()
            (Path(directory) / 'FuriganaDubbingStudio').mkdir()
            self.assertEqual(launcher.default_data_dir(directory), Path(directory) / 'UkuFurigana')
            self.assertTrue((Path(directory) / 'FuriganaDubbingStudio').exists())

if __name__ == '__main__':
    unittest.main()
