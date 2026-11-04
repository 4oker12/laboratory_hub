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
        self.assertIn('c20Event("JS_" + code, sourceTime: body["time"] as? String)', SESSION)
        self.assertIn('c20Event("NATIVE_STOCK_NAV_FINISHED")', SESSION)
        self.assertIn('c20Event("NATIVE_NAV_START")', SESSION)
        self.assertIn('c20Event("NATIVE_STOCK_NAV_FAILED")', SESSION)

    def test_native_navigation_shield_prevents_stock_ui_flash(self):
        self.assertIn("@Published var c20PanelReady = false", SESSION)
        self.assertIn("c20PanelReady = false", SESSION)
        self.assertIn("c20PanelReady = true", SESSION)
        self.assertIn("c20NavigationShield", VIEW)
        self.assertIn("!session.c20PanelReady", VIEW)
        self.assertIn("session.verifiedDevice == \"TP-Link Archer C20\"", VIEW)

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
        self.assertNotIn("note('STOCK_LOGIN_UI_SHOWN')", C20)
        self.assertIn("LOGIN_LAYOUT_UNSTABLE", C20)
        self.assertIn("LOGIN_XHR_ONERROR_RS_", C20)
        self.assertIn("PAGEHIDE_NAVIGATING", C20)
        self.assertIn("PASSIVE_MARKUP_VENDOR_OK", C20)
        self.assertNotIn("req.open('POST',location.origin+'/cgi/getGDPRParm'", C20)
        self.assertIn("STOCK_FLOW_RESTORED_AFTER_NAV", C20)
        self.assertIn("sessionStorage.setItem(TRACE_KEY", C20)
        self.assertIn("sessionStorage.setItem(key,JSON.stringify({at:Date.now()}))", C20)
        self.assertNotIn("note(password)", C20)
        self.assertNotIn("note(entry.name)", C20)
        self.assertNotIn("note(xhr.responseText)", C20)

    def test_c20_cookie_snapshot_reports_only_session_presence_and_change(self):
        self.assertIn("captureC20CookieState", SESSION)
        self.assertIn("httpCookieStore.getAllCookies", SESSION)
        self.assertIn("NATIVE_COOKIE_COUNT_CHANGED", SESSION)
        self.assertIn("NATIVE_JSESSIONID_PRESENCE_CHANGED", SESSION)
        self.assertIn("NATIVE_COOKIE_BASELINE_MISSING", SESSION)
        self.assertNotIn("c20Event(cookie.value)", SESSION)
        self.assertNotIn("c20Event($0.value)", SESSION)

    def test_login_xhr_monitor_does_not_inspect_secret_payload(self):
        self.assertIn("STOCK_BUTTON_SYNTHETIC_CLICK", C20)
        self.assertIn("HIT_VIEW_SCALE_", C20)
        self.assertIn("NATIVE_LOGIN_HITTEST_FAILED", C20)
        self.assertIn("STOCK_BUTTON_TRUSTED_CLICK", C20)
        self.assertIn("XHR_OBSERVER_INSTALLED", C20)
        self.assertIn("XHR_", C20)
        self.assertIn("Reflect.apply(originalSend,this,arguments)", C20)
        self.assertNotIn("note(xhr.responseText)", C20)
        self.assertNotIn("note(arguments[0])", C20)
        self.assertNotIn("note(document.cookie)", C20)

    def test_stock_login_recovery_does_not_impersonate_success(self):
        self.assertIn("resumedStockFlow", C20)
        self.assertIn("POSTLOGIN_RSA_REPROBE_SKIPPED", C20)
        self.assertIn("WLAN_PROTECTED_24_5_VERIFIED", C20)
        self.assertIn("SESSION_READBACK_VERIFIED", C20)
        self.assertIn("no password", SESSION.lower() if "no password" in SESSION.lower() else C20.lower())


if __name__ == "__main__":
    unittest.main()
