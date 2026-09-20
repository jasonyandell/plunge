"""Release importer guards; standard library only."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('update_walt', Path(__file__).with_name('update-walt.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportGuards(unittest.TestCase):
    def test_native_flags_and_wrappers_cannot_leak_into_phone(self):
        with patch.dict(os.environ, {'RUSTFLAGS': '-C target-cpu=native',
                                    'CARGO_ENCODED_RUSTFLAGS': 'native',
                                    'CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS': 'native',
                                    'RUSTC_WRAPPER': 'stale-wrapper',
                                    'CARGO_PROFILE_RELEASE_OPT_LEVEL': '0',
                                    'RUSTUP_TOOLCHAIN': 'nightly'}, clear=True):
            env = module.build_environment(Path('/tmp/fresh-target'))
        self.assertNotIn('RUSTFLAGS', env)
        self.assertNotIn('RUSTC_WRAPPER', env)
        self.assertNotIn('RUSTUP_TOOLCHAIN', env)
        self.assertNotIn('CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS', env)
        self.assertEqual(env['CARGO_ENCODED_RUSTFLAGS'], '')
        self.assertEqual(env['CARGO_PROFILE_RELEASE_OPT_LEVEL'], '3')
        self.assertEqual(env['CARGO_TARGET_DIR'], '/tmp/fresh-target')

    def test_dirty_source_is_refused(self):
        with patch.object(module.subprocess, 'check_output', return_value=' M walt/walt/src/lib.rs\n'):
            with self.assertRaisesRegex(RuntimeError, 'Commit or set aside'):
                module.source_identity(Path('/unused'))

    def test_missing_source_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(module.subprocess, 'check_output', side_effect=['', 'abc\n']):
                with self.assertRaisesRegex(RuntimeError, 'Missing source'):
                    module.source_identity(Path(tmp))

    def test_embedded_scheme_changes_the_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in module.SOURCE_PATHS:
                p = root / name
                if p.suffix:
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text('fixture')
                else:
                    p.mkdir(parents=True, exist_ok=True)
            query = root / 'walt/gym/queries/offer-count.scheme'
            query.write_text('first')
            with patch.object(module.subprocess, 'check_output', side_effect=['', 'abc\n', '', 'abc\n']):
                before = module.source_identity(root)
                query.write_text('second')
                after = module.source_identity(root)
            self.assertEqual(before[0], after[0])
            self.assertNotEqual(before[1], after[1])


if __name__ == '__main__':
    unittest.main()
