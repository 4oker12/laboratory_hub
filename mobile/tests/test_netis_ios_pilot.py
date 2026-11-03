"""Netis iPhone pilot: browser transport mock, never a physical-router claim."""
import base64
import json
import os
import pathlib
import unittest
from urllib.parse import parse_qs
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1] / "RouterLabMobile" / "Resources"
PROTOCOL = (ROOT / "RouterLabNetisFW4.js").read_text(encoding="utf-8")
PANEL = (ROOT / "RouterLabNetisPanel.js").read_text(encoding="utf-8")
ORIGIN = "http://192.168.1.1"
VERSION = "N2-V4.0.1.4317"


class NetisIOSPilotTest(unittest.TestCase):
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
        self.configured = False
        self.firmware = VERSION
        self.fail_app = None
        self.set_calls = []
        self.page.route(ORIGIN + "/**", self.route)
        self.page.goto(ORIGIN + "/login.html")
        self.inject()

    def tearDown(self):
        self.page.close()

    def inject(self):
        self.page.add_script_tag(content=PROTOCOL)
        self.page.add_script_tag(content=PANEL)
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-netis-ios-pilot')?.shadowRoot
            ?.querySelector('#status')?.textContent !== 'Проверяем роутер…'""")

    def route(self, route):
        request = route.request
        if request.url.endswith("/login.html"):
            route.fulfill(status=200, content_type="text/html",
                          body="<html><head><title>netis</title></head><body>Stock UI</body></html>")
            return
        if request.url.endswith("/cgi-bin/skk_set.cgi"):
            self.set_calls.append(parse_qs(request.post_data or "", keep_blank_values=True))
            route.abort("failed")  # expected Wi-Fi disconnect during physical Apply
            return
        if request.url.endswith("/cgi-bin/login.cgi"):
            route.fulfill(status=200, content_type="text/plain", body='["SUCCESS"]')
            return
        if request.url.endswith("/cgi-bin/skk_get.cgi"):
            fields = parse_qs(request.post_data or "", keep_blank_values=True)
            app = fields.get("app", [""])[0]
            if app == self.fail_app:
                route.fulfill(status=403, content_type="text/plain", body='["DENIED"]')
                return
            base = dict(model="N2", version=self.firmware, vender="CIS",
                        passwd="1" if self.configured else "0")
            if app == "guide":
                base.update(wl2g_idx="6", wl5g_idx="0",
                            wlan=[{"rfPower": "100"} for _ in range(12)])
            if app == "wlan":
                radios = [{"rfPower": "100"} for _ in range(12)]
                radios[6].update(ssid=base64.b64encode(b"RouterLab24").decode(),
                                 channel="6", wlanEnabled="1")
                radios[0].update(ssid=base64.b64encode(b"RouterLab5G").decode(),
                                 channel="36", wlanEnabled="1")
                base.update(wl2g_idx="6", wl5g_idx="0",
                            wlan=radios)
            if app == "wan_lan":
                base.update(wan=[{"type": "1"}], lanIpAddr="192.168.1.1",
                            dhcpEnabled="1", connected="1")
            if app == "igmp":
                base.update(igmpProxyEnabled="0", igmpSnoopEnabled="0")
            if app == "routerState":
                base.update(connected="1")
            route.fulfill(status=200, content_type="text/plain", body=json.dumps(base))
            return
        route.abort()

    def text(self):
        return self.page.locator("#routerlab-netis-ios-pilot #status").inner_text()

    def test_factory_form_is_explicit_and_never_applies_automatically(self):
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-netis-ios-pilot').shadowRoot
            .querySelector('#form').style.display === 'block'""")
        self.assertIn("Заводской", self.text())
        self.assertEqual(self.set_calls, [])

    def test_factory_apply_once_manual_reconnect_and_readback(self):
        self.page.locator("#routerlab-netis-ios-pilot #admin").fill("test_admin_1234")
        self.page.locator("#routerlab-netis-ios-pilot #ssid2").fill("RouterLab24")
        self.page.locator("#routerlab-netis-ios-pilot #ssid5").fill("RouterLab5G")
        self.page.locator("#routerlab-netis-ios-pilot #wifi").fill("test_wifi_1234")
        self.page.locator("#routerlab-netis-ios-pilot #confirm").check()
        self.page.locator("#routerlab-netis-ios-pilot #apply").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-netis-ios-pilot').shadowRoot
            .querySelector('#status').textContent.includes('SET отправлен')""")
        self.assertEqual(len(self.set_calls), 1)
        self.assertEqual(self.set_calls[0].get("app"), ["wan_set_shortcut"])
        self.assertEqual(len(self.set_calls[0]), 24)

        # Reload while still factory: the saved attempt blocks a duplicate SET.
        self.page.reload()
        self.inject()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-netis-ios-pilot').shadowRoot
            .querySelector('#status').textContent.includes('Повтор SET заблокирован')""")
        self.assertIn("Повтор SET заблокирован", self.text())
        self.assertEqual(len(self.set_calls), 1)

        # Manual user reconnect is represented by changed router replies, not app automation.
        self.configured = True
        self.page.locator("#routerlab-netis-ios-pilot #refresh").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-netis-ios-pilot').shadowRoot
            .querySelector('#status').textContent.includes('параметры WAN')""")
        self.assertEqual(len(self.set_calls), 1)
        self.assertIn("CONFIGURED", self.text())
        readback = self.page.locator("#routerlab-netis-ios-pilot #readback").inner_text()
        self.assertIn("WAN: DHCP", readback)
        self.assertIn("RouterLab24", readback)
        self.assertIn("RouterLab5G", readback)

    def test_partial_readback_reports_error_without_success(self):
        self.configured = True
        self.fail_app = "wlan"
        self.page.reload()
        self.inject()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-netis-ios-pilot').shadowRoot
            .querySelector('#status').textContent.includes('повторное чтение не завершено')""")
        self.assertIn("CGI wlan: ERROR", self.page.locator(
            "#routerlab-netis-ios-pilot #readback").inner_text())
        self.assertEqual(self.set_calls, [])

    def test_unknown_firmware_has_no_write_controls(self):
        self.firmware = "N2-V4.0.1.9999"
        self.page.reload()
        self.inject()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-netis-ios-pilot').shadowRoot
            .querySelector('#status').textContent.includes('не поддерживаются')""")
        self.assertIn("не поддерживаются", self.text())
        self.assertFalse(self.page.locator("#routerlab-netis-ios-pilot #form").is_visible())
        self.assertEqual(self.set_calls, [])


if __name__ == "__main__":
    unittest.main()
