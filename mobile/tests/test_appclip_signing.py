import datetime as dt
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "prepare_appclip_signing.py"
TEAM = "ABCDE12345"


class PrepareAppClipSigningTests(unittest.TestCase):
    def run_case(self, *, invalid_clip_app_id=False, expired=False, no_devices=False,
                 wrong_team=False, wrong_method=False, wrong_device=False,
                 same_profile=False, method="development"):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            paths = {}
            for kind, identifier in (("parent", "dev.routerlab.mobile"),
                                     ("clip", "dev.routerlab.mobile.Clip")):
                profile = {
                    "Name": f"RouterLab {kind}",
                    "UUID": "mock-parent" if same_profile else f"mock-{kind}",
                    "TeamIdentifier": ["WRONG12345" if wrong_team and kind == "clip" else TEAM],
                    "ExpirationDate": dt.datetime.utcnow() + dt.timedelta(days=-1 if expired and kind == "clip" else 30),
                    "Entitlements": {
                        "application-identifier": TEAM + "." + (
                            "other.bundle" if invalid_clip_app_id and kind == "clip" else identifier
                        ),
                        "get-task-allow": (method == "development") != (wrong_method and kind == "clip"),
                    },
                    "ProvisionedDevices": ([] if no_devices and kind == "clip" else
                                           ["OTHER-UDID"] if wrong_device and kind == "clip" else
                                           ["MOCK-UDID"]),
                }
                paths[kind] = p / (kind + ".plist")
                paths[kind].write_bytes(plistlib.dumps(profile))
                (p / (kind + ".mobileprovision")).write_bytes(b"MOCK ORIGINAL PROFILE")

            spec_out = p / "signed.yml"
            export_out = p / "ExportOptions.plist"
            command = [
                sys.executable, str(SCRIPT),
                "--parent", str(paths["parent"]),
                "--clip", str(paths["clip"]),
                "--parent-source", str(p / "parent.mobileprovision"),
                "--clip-source", str(p / "clip.mobileprovision"),
                "--team", TEAM,
                "--device-udid", "MOCK-UDID",
                "--method", method,
                "--spec", str(ROOT / "project-with-appclip.yml"),
                "--output-spec", str(spec_out),
                "--export-options", str(export_out),
                "--provisioning-dir", str(p / "profiles"),
            ]
            result = subprocess.run(command, text=True, capture_output=True, check=False)
            if any((invalid_clip_app_id, expired, no_devices, wrong_team,
                    wrong_method, wrong_device, same_profile)):
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(spec_out.exists())
            else:
                self.assertEqual(result.returncode, 0, result.stderr)
                signed = spec_out.read_text()
                self.assertEqual(signed.count("CODE_SIGN_STYLE: Manual"), 2)
                self.assertIn("PROVISIONING_PROFILE_SPECIFIER: 'RouterLab clip'", signed)
                export = plistlib.loads(export_out.read_bytes())
                self.assertEqual(export["provisioningProfiles"]["dev.routerlab.mobile.Clip"], "RouterLab clip")
                self.assertEqual(export["method"], method)
                self.assertTrue((p / "profiles/mock-parent.mobileprovision").exists())
                self.assertTrue((p / "profiles/mock-clip.mobileprovision").exists())

    def test_valid_distinct_profiles(self):
        self.run_case()

    def test_valid_ad_hoc_profiles(self):
        self.run_case(method="ad-hoc")

    def test_reject_wrong_clip_bundle(self):
        self.run_case(invalid_clip_app_id=True)

    def test_reject_expired_clip_profile(self):
        self.run_case(expired=True)

    def test_reject_profile_without_registered_devices(self):
        self.run_case(no_devices=True)

    def test_reject_other_team(self):
        self.run_case(wrong_team=True)

    def test_reject_other_distribution_method(self):
        self.run_case(wrong_method=True)

    def test_reject_profile_for_different_iphone(self):
        self.run_case(wrong_device=True)

    def test_reject_reused_profile(self):
        self.run_case(same_profile=True)


if __name__ == "__main__":
    unittest.main()
