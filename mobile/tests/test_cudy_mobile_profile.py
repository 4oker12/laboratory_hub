import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROFILE = ROOT / "adapters" / "cudy" / "wr1300-v4-r98-2.5.41.json"


class CudyMobileProfileTest(unittest.TestCase):
    def test_exact_hardware_and_firmware_profile(self):
        data = json.loads(PROFILE.read_text(encoding="utf-8"))
        self.assertEqual(data["id"], "cudy-wr1300-v4-r98-2.5.41")
        self.assertEqual((data["vendor"], data["model"], data["hardware_revision"],
                          data["board"], data["firmware"]),
                         ("Cudy", "WR1300", "V4", "R98", "2.5.41"))

    def test_only_identification_is_enabled(self):
        data = json.loads(PROFILE.read_text(encoding="utf-8"))
        self.assertEqual(data["enabled_operations"], ["identify"])
        self.assertIn("apply_wan", data["disabled_operations"])
        self.assertIn("apply_wifi", data["disabled_operations"])
        self.assertEqual(data["evidence"]["authentication"], "unverified")
        self.assertEqual(data["evidence"]["cold_boot_persistence"], "unverified")


if __name__ == "__main__":
    unittest.main()
