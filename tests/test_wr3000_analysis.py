"""Tests do not require or redistribute vendor firmware."""
import importlib.util
import pathlib
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).parents[1] / 'devices/cudy/wr3000/v1-r31-2.4.19/probe_firmware.py'
spec = importlib.util.spec_from_file_location('wr3000_firmware', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class WR3000AnalysisTest(unittest.TestCase):
    def test_extract_contract_markers_from_synthetic_rootfs(self):
        with tempfile.TemporaryDirectory() as root:
            directory = pathlib.Path(root)
            target = directory / 'usr/lib/lua/luci/apprpc/qsetup.lua'
            target.parent.mkdir(parents=True)
            target.write_bytes(b'\x00luci.main.wizard\x00qsetup.apply\x00wireless.wlan00\x00sysauth\x00')
            evidence = module.inspect_rootfs(directory)
            self.assertEqual(evidence['file_count'], 1)
            self.assertIn('wizard', evidence['matches'][0]['categories'])
            self.assertIn('wifi', evidence['matches'][0]['categories'])
            self.assertIn('auth', evidence['matches'][0]['categories'])
            self.assertNotIn('admin-password', str(evidence))

    def test_stock_contract_hints_exclude_arbitrary_private_values(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            file = root / 'usr/lib/lua/luci/apprpc/qsetup.lua'
            file.parent.mkdir(parents=True)
            file.write_bytes(b'\\x1bLua' + b'\\x00qsetup\\x00wireless.wlan00\\x00password-one-time-SECRET\\x00')
            details = module.inspect_stock_contracts(root)
            record = details['usr/lib/lua/luci/apprpc/qsetup.lua']
            self.assertTrue(record['lua_bytecode'])
            self.assertIn('qsetup', record['candidate_identifiers'])
            self.assertIn('wireless.wlan00', record['candidate_identifiers'])
            self.assertNotIn('password-one-time-SECRET', str(details))

    def test_official_target_is_revision_scoped(self):
        self.assertIn('WR3000-R31-', module.FIRMWARE_NAME)
        self.assertNotIn('WR3000V2', module.FIRMWARE_NAME)
        self.assertTrue(module.SOURCE_URL.startswith('https://www.cudy.com/'))

if __name__ == '__main__':
    unittest.main()
