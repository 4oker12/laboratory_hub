"""Structural contract for iOS router discovery; physical validation remains required."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SWIFT = (ROOT / "RouterLabMobile/RouterSession.swift").read_text(encoding="utf-8")
VIEW = (ROOT / "RouterLabMobile/ContentView.swift").read_text(encoding="utf-8")
ENTRY = (ROOT / "RouterLabMobile/RouterLabMobileApp.swift").read_text(encoding="utf-8")
PANEL = (ROOT / "RouterLabMobile/Resources/RouterLabNetisPanel.js").read_text(encoding="utf-8")


class DiscoveryContractTest(unittest.TestCase):
    def test_bounded_fingerprint_candidates(self):
        self.assertIn('for host in [preferred, "192.168.2.1", "192.168.1.1", "192.168.0.1"]', SWIFT)
        self.assertIn('message.frameInfo.securityOrigin.host == activeHost', SWIFT)
        self.assertIn('body["model"] as? String == "N2"', SWIFT)
        self.assertIn('body["version"] as? String == "N2-V4.0.1.4317"', SWIFT)
        self.assertIn('expectedNavigation', SWIFT)
        self.assertIn('deviceVerified = true', SWIFT)
        self.assertIn('UserDefaults.standard.set("http://\\(activeHost)"', SWIFT)
        self.assertIn('let timeout = DispatchWorkItem', SWIFT)

    def test_stock_interface_hidden_until_confirmation(self):
        self.assertIn('.opacity(session.deviceVerified ? 1 : 0.01)', VIEW)
        self.assertIn('.allowsHitTesting(session.deviceVerified)', VIEW)
        self.assertIn('session.startDiscovery()', VIEW)
        self.assertIn('session.startDiscovery()', SWIFT)
        self.assertIn("position:fixed;z-index:2147483647;inset:0", PANEL)

    def test_deep_link_without_ip(self):
        self.assertIn("static func isDiscoveryLink", ENTRY)
        self.assertIn('parts.host?.lowercased() == "discover"', ENTRY)
        self.assertIn("RouterLabDeepLink.isDiscoveryLink(url)", VIEW)
        self.assertIn("RouterLabDeepLink.routerAddress(from: url)", VIEW)

    def test_no_configured_wifi_write_without_reverse_contract(self):
        self.assertIn("Изменение SSID и пароля", PANEL)
        self.assertIn("необходимо подтвердить отдельный CGI-контракт", PANEL)


if __name__ == "__main__":
    unittest.main()
