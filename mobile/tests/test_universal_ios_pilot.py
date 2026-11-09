"""Browser-level tests for passive RouterLab identity; no physical C54 claim."""
import os
import pathlib
import unittest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1] / "RouterLabMobile" / "Resources"
REGISTRY = (ROOT / "RouterLabDeviceRegistry.js").read_text(encoding="utf-8")
PANEL = (ROOT / "RouterLabUniversalPanel.js").read_text(encoding="utf-8")
HUB = (ROOT / "RouterLabAdapterHub.js").read_text(encoding="utf-8")
C54 = (ROOT / "RouterLabC54Driver.js").read_text(encoding="utf-8")
ORIGIN = "http://192.168.0.1"

class UniversalIOSPilotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        chromium = os.environ.get("ROUTERLAB_CHROMIUM") or (
            r"C:\Program Files\Google\Chrome\Application\chrome.exe"
            if os.name == "nt" else "/usr/bin/chromium")
        cls.browser = cls.playwright.chromium.launch(
            headless=True, executable_path=chromium, args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.http_calls = []
        def route(req):
            self.http_calls.append(req.request.url)
            req.fulfill(status=200, content_type="text/html",
                        body="<html><head><title>TP-Link</title></head><body>Local Password</body></html>")
        self.page.route(ORIGIN + "/**", route)
        self.page.goto(ORIGIN + "/")
        self.page.evaluate("""() => {
          window.__messages = [];
          window.webkit={messageHandlers:{routerlab:{postMessage:m=>window.__messages.push(m)}}};
        }""")

    def tearDown(self):
        self.page.close()

    def inject(self):
        self.page.add_script_tag(content=REGISTRY)
        self.page.add_script_tag(content=HUB)
        self.page.add_script_tag(content=C54)
        self.page.add_script_tag(content=PANEL)

    def panel(self):
        return self.page.locator("#routerlab-universal-panel")

    def messages(self, type):
        return self.page.evaluate(
            "(type) => window.__messages.filter(m=>m.type===type)", type)

    def test_c54_title_is_identified_without_any_cgi_request(self):
        self.page.evaluate("document.title = 'Archer C54'")
        self.inject()
        self.panel().wait_for(state="attached")
        self.assertIn("TP-Link Archer C54", self.panel().locator(".view").inner_text())
        self.assertEqual(self.messages("routerFingerprint")[0]["model"], "Archer C54")
        self.assertEqual(self.messages("routerFingerprint")[0]["evidence"], "TITLE")
        self.assertEqual(len(self.http_calls),1)  # only the original GET /
        self.assertIn("Запись заблокирована",self.panel().locator(".view").inner_text())

    def test_c54_from_passive_stock_global_without_visible_name(self):
        self.page.evaluate("""() => {
          document.title = 'TP-Link';
          window.deviceInfo={modelName:'Archer C54',hardwareVersion:'V1'};
        }""")
        self.inject()
        self.panel().wait_for(state="attached")
        event=self.messages("routerFingerprint")[0]
        self.assertEqual(event["model"],"Archer C54")
        self.assertEqual(event["evidence"],"META")
        self.assertEqual(len(self.http_calls),1)

    def test_existing_c20_panel_has_precedence(self):
        self.page.evaluate("document.title = 'Archer C20'")
        self.inject()
        self.page.wait_for_timeout(450)
        self.assertEqual(self.panel().count(),0)
        self.assertEqual(self.messages("routerFingerprint"),[])

    def test_netis_n2_remains_with_its_own_cgi_adapter(self):
        self.page.evaluate("document.title = 'Netis N2'")
        self.inject()
        self.page.wait_for_timeout(450)
        self.assertEqual(self.panel().count(),0)

    def test_cudy_known_model_gets_read_only_generic_panel(self):
        self.page.evaluate("document.title = 'Cudy WR1300'")
        self.inject()
        self.panel().wait_for(state="attached")
        self.assertEqual(self.messages("routerFingerprint")[0]["id"],"cudy-wr1300")
        self.assertIn("API не проверен",self.panel().locator(".view").inner_text())

    def test_future_archer_model_identifies_without_a_write_adapter(self):
        self.page.evaluate("document.title = 'Archer AX23'")
        self.inject()
        self.panel().wait_for(state="attached")
        self.assertEqual(self.messages("routerFingerprint")[0]["id"],"generic-tplink")

    def test_ambiguous_models_are_not_misidentified(self):
        self.page.evaluate("document.title='Archer AX23 and Archer AX55'")
        self.inject()
        self.page.wait_for_timeout(450)
        self.assertEqual(self.panel().count(),0)
        self.assertEqual(self.messages("routerFingerprint"),[])

    def test_model_catalog_for_manual_picker_is_from_registry(self):
        self.inject()
        models=self.messages("routerModelCatalog")[0]["models"]
        ids={m["id"] for m in models}
        self.assertTrue({"tplink-archer-c54","tplink-archer-c20",
                         "netis-n2","cudy-wr1200","cudy-wr1300","cudy-wr3000"} <= ids)

    def test_manual_c54_with_model_hidden_routes_specific_driver_without_cgi(self):
        self.inject()
        result=self.page.evaluate("""() =>
          window.__RouterLabUniversalPanel.selectManual('tplink-archer-c54')""")
        self.assertTrue(result["accepted"])
        self.assertFalse(result["verified"])
        self.assertFalse(result["writeEnabled"])
        self.panel().wait_for(state="attached")
        self.assertIn("TP-Link Archer C54", self.panel().locator(".view").inner_text())
        self.assertIn("tplink-c54-v1",self.panel().locator("#adapter-route").inner_text())
        self.assertIn("Модель выбрана вручную",self.panel().locator("#identity-label").inner_text())
        fingerprint=self.messages("routerFingerprint")[0]
        self.assertEqual(fingerprint["evidence"],"MANUAL")
        self.assertEqual(fingerprint["model"],"Archer C54")
        self.assertEqual(len(self.http_calls),1)

    def test_manual_selection_wrong_model_is_only_an_unverified_route(self):
        self.page.evaluate("document.title='TP-Link'")
        self.inject()
        result=self.page.evaluate("""() =>
          window.__RouterLabUniversalPanel.selectManual('cudy-wr3000')""")
        self.assertTrue(result["accepted"])
        self.assertEqual(self.messages("routerFingerprint")[0]["model"],"WR3000")
        self.assertIn("API не проверен",self.panel().locator(".view").inner_text())
        self.assertEqual(len(self.http_calls),1)

    def test_manual_selection_bad_id_never_mounts_or_requests(self):
        self.inject()
        result=self.page.evaluate("""() =>
          window.__RouterLabUniversalPanel.selectManual('tplink-archer-c54;fetch()')""")
        self.assertFalse(result["accepted"])
        self.assertEqual(self.panel().count(),0)
        self.assertEqual(self.messages("routerFingerprint"),[])
        self.assertEqual(len(self.http_calls),1)

    def test_manual_choice_can_replace_initial_auto_candidate(self):
        self.page.evaluate("document.title='Cudy WR1300'")
        self.inject()
        self.panel().wait_for(state="attached")
        self.assertEqual(self.messages("routerFingerprint")[0]["id"],"cudy-wr1300")
        self.page.evaluate("""() =>
          window.__RouterLabUniversalPanel.selectManual('tplink-archer-c54')""")
        self.assertIn("Archer C54",self.panel().locator("#device").inner_text())
        last=self.messages("routerFingerprint")[-1]
        self.assertEqual(last["evidence"],"MANUAL")
        self.assertEqual(last["id"],"tplink-archer-c54")

    def test_vendor_without_model_is_hint_not_claim(self):
        self.inject()
        self.page.wait_for_timeout(450)
        self.assertEqual(self.panel().count(),0)
        self.assertEqual(self.messages("routerFingerprint"),[])
        self.assertEqual(self.messages("routerFingerprintHint")[0]["vendor"],"TP-Link")

if __name__ == "__main__":
    unittest.main()
