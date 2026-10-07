import json
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CLI = ROOT / "routerlab.py"
MANIFEST = ROOT / "devices" / "xiaomi" / "mi-router-4a-gigabit-r4a" / "3.0.24-int" / "device.json"


class RegistryTest(unittest.TestCase):
    def test_manifest_is_versioned_and_identifies_exact_image(self):
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(data["id"], "xiaomi-r4a-3.0.24-int")
        self.assertEqual(data["hardware"], "R4A")
        self.assertEqual(data["firmware"]["version"], "3.0.24")
        self.assertEqual(
            data["firmware"]["sha256"],
            "609b5b59b7b00365451fa358b5a79e0e4078b8a9a7aeb6a994a641287a093548",
        )

    def test_root_dispatcher_lists_target_without_device_business_logic(self):
        proc = subprocess.run(
            [sys.executable, str(CLI), "list"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertIn("xiaomi-r4a-3.0.24-int", proc.stdout)
        source = CLI.read_text(encoding="utf-8")
        self.assertNotIn("set_wan", source)
        self.assertNotIn("set_wifi", source)
        self.assertNotIn("stok", source)


if __name__ == "__main__":
    unittest.main()
