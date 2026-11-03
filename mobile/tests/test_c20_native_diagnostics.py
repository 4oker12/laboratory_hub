"""The Archer C20 diagnostics must survive changes of the stock HTML document.

These are structural privacy and regression contracts; browser mocks cover
protocol and UI behavior, physical iPhone still needs field verification.
"""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
SESSION=(ROOT/"RouterLabMobile/RouterSession.swift").read_text(encoding="utf-8")
VIEW=(ROOT/"RouterLabMobile/ContentView.swift").read_text(encoding="utf-8")
C20=(ROOT/"RouterLabMobile/Resources/RouterLabC20Panel.js").read_text(encoding="utf-8")


class C20NativeDiagnosticsContract(unittest.TestCase):
    def test_native_diagnostics_survive_webview_reload(self):
        self.assertIn("@Published private(set) var c20Diagnostics", SESSION)
        self.assertIn("RouterLabC20DiagnosticsV1", SESSION)
        self.assertIn("UserDefaults.standard.set(c20Diagnostics", SESSION)
        self.assertIn("case \"tplinkDiagnostic\":", SESSION)
        self.assertIn('c20Event("JS_" + code)', SESSION)
        self.assertIn('c20Event("NATIVE_STOCK_NAV_FINISHED")', SESSION)
        self.assertIn('c20Event("NATIVE_NAV_START")', SESSION)
        self.assertIn('c20Event("NATIVE_STOCK_NAV_FAILED")', SESSION)

    def test_native_log_always_accessible_outside_injected_web_panel(self):
        self.assertIn('session.verifiedDevice == "TP-Link Archer C20"', VIEW)
        self.assertIn("Диагностика · логи", VIEW)
        self.assertIn("UIPasteboard.general.string = session.c20DiagnosticsText", VIEW)
        self.assertIn("session.clearC20Diagnostics()", VIEW)
        self.assertIn("Text(session.c20DiagnosticsText)", VIEW)

    def test_log_codes_cannot_contain_credential_or_request_payload(self):
        self.assertIn('"^[A-Z0-9_]+$"', SESSION)
        self.assertIn("never record a full URL or query/fragment", SESSION)
        self.assertIn("STOCK_RESOURCE_OBSERVER_READY", C20)
        self.assertIn("STOCK_CGI_GDPR_OBSERVED", C20)
        self.assertIn("STOCK_LOGIN_UI_SHOWN", C20)
        self.assertIn("STOCK_FLOW_RESTORED_AFTER_NAV", C20)
        self.assertIn("sessionStorage.setItem(TRACE_KEY", C20)
        self.assertIn("sessionStorage.setItem(key,JSON.stringify({at:Date.now()}))", C20)
        self.assertNotIn("note(password)", C20)
        self.assertNotIn("note(entry.name)", C20)
        self.assertNotIn("note(xhr.responseText)", C20)

    def test_stock_login_recovery_does_not_impersonate_success(self):
        self.assertIn("resumedStockFlow", C20)
        self.assertIn("POSTLOGIN_RECOVERY_FROM_PRIOR_FINGERPRINT", C20)
        self.assertIn("WLAN_PROTECTED_24_5_VERIFIED", C20)
        self.assertIn("SESSION_READBACK_VERIFIED", C20)
        self.assertIn("no password", SESSION.lower() if "no password" in SESSION.lower() else C20.lower())


if __name__ == "__main__":
    unittest.main()
