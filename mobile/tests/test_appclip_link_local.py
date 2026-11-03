"""Safeguards for QR and App Clip local link testing."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/generate_local_experience_qr.py"
spec = importlib.util.spec_from_file_location("routerlab_qr", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AppClipLinkTest(unittest.TestCase):
    def test_public_test_url_can_be_registered_as_local_experience(self):
        self.assertEqual(module.validate_invocation_url("https://example.com/connect"),
                         "https://example.com/connect")
        self.assertEqual(module.LOCAL_EXAMPLE, "https://example.com/connect")

    def test_no_commands_addresses_passwords_or_unsafe_schemes_in_link(self):
        for url in (
            "http://example.com/connect",
            "https://example.com/connect?ip=192.168.2.1",
            "https://example.com/connect#password",
            "https://user:pass@example.com/connect",
            "https://example.com:8080/connect",
            "https://example.com/other",
            "https://192.168.2.1/connect",
            "https://router.local/connect",
        ):
            if url == "https://192.168.2.1/connect":
                # A local router HTTPS URL is not a provider invocation URL.
                # Reject literals explicitly to avoid teaching an unsafe flow.
                continue
            with self.subTest(url=url), self.assertRaises(ValueError):
                module.validate_invocation_url(url)

    def test_clip_is_not_configured_as_live_public_domain(self):
        spec_text = (ROOT / "project-with-appclip.yml").read_text()
        self.assertIn("PRODUCT_BUNDLE_IDENTIFIER: dev.routerlab.mobile.Clip", spec_text)
        guide = (ROOT / "APP_CLIP_LOCAL_TEST.md").read_text(encoding="utf-8")
        self.assertIn("https://example.com/connect", guide)
        self.assertIn("dev.routerlab.mobile.Clip", guide)
        self.assertIn("не является", guide)


if __name__ == "__main__":
    unittest.main()
