"""TP-Link Archer C20 v5 same-origin iOS pilot browser mocks, not a physical claim."""
import os
from pathlib import Path
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT/"RouterLabMobile/Resources/RouterLabC20Panel.js").read_text("utf-8")
NETIS_DRIVER = (ROOT/"RouterLabMobile/Resources/RouterLabNetisFW4.js").read_text("utf-8")
NETIS_PANEL = (ROOT/"RouterLabMobile/Resources/RouterLabNetisPanel.js").read_text("utf-8")
ORIGIN = "http://192.168.0.1"


class ArcherC20IOSPilotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        chrome = os.getenv("ROUTERLAB_CHROMIUM") or (
            r"C:\Program Files\Google\Chrome\Application\chrome.exe"
            if os.name == "nt" else "/usr/bin/chromium")
        cls.browser = cls.playwright.chromium.launch(
            headless=True, executable_path=chrome, args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.model = "TP-Link Archer C20 v5"
        self.gdpr_ok = True
        self.stock_authorizes = True
        self.logged = []
        self.page.route(ORIGIN + "/**", self.route)

    def tearDown(self):
        self.page.close()

    def route(self, route):
        url = route.request.url
        if url == ORIGIN+"/":
            route.fulfill(status=200, content_type="text/html", body=f"""
            <html><head><title>{self.model}</title></head>
            <body><h1>{self.model}</h1>
            <input id="stockPassword" type="password" />
            <button id="stockLogin">Log in</button>
            <script>
              window.authorized = false; window.loginClicks = 0; window.ACT_GL = 5;
              document.querySelector('#stockLogin').addEventListener('click', () => {{
                window.loginClicks++;
                const f = document.querySelector('#stockPassword');
                window.authorized = {'true' if self.stock_authorizes else 'false'} &&
                  f.value === 'correctPassword123';
                f.value = '';
              }});
              window.$ = {{
                // Physical TP-Link queues list read, then populates the array
                // asynchronously when $.exe(callback) completes.
                act: (op,obj,stack,ignored,attrs) => {{
                  const rows=[];
                  window.pendingVendorRead={{op,obj,rows}};
                  return rows;
                }},
                exe: (done) => {{
                  const pending=window.pendingVendorRead;
                  window.pendingVendorRead=null;
                  setTimeout(() => {{
                    if (pending && window.authorized && pending.op===5) {{
                      if (pending.obj==='LAN_WLAN') pending.rows.push(
                        {{SSID:'C20_24',X_TP_Band:'2.4GHz',__stack:'1,3,0,0,0,0',Enable:'1'}},
                        {{SSID:'C20_5',X_TP_Band:'5GHz',__stack:'1,4,0,0,0,0',Enable:'1'}});
                      if (pending.obj==='WAN_IP_CONN') pending.rows.push(
                        {{enable:'1',X_TP_IPv4Enabled:'1',addressingType:'DHCP'}});
                    }}
                    if (typeof done==='function') done(0);
                  }}, 30);
                  return 0;
                }}
              }};
            </script></body></html>
            """)
        elif url.endswith("/cgi/getGDPRParm") and route.request.method == "POST":
            self.logged.append((route.request.method,route.request.post_data or "",url))
            if self.gdpr_ok:
                route.fulfill(status=200, content_type="text/plain",
                              body='var nn="'+'a'*128+'"; var ee="10001"; var seq=858738839;')
            else:
                route.fulfill(status=200, content_type="text/plain", body='unexpected')
        else:
            self.logged.append((route.request.method,route.request.post_data or "",url))
            route.abort()

    def launch(self):
        self.page.goto(ORIGIN+"/")
        self.page.evaluate("""() => {
          window.webkit = {messageHandlers:{routerlab:{postMessage:(data) => {
            window.__routerlabEvents = window.__routerlabEvents || [];
            window.__routerlabEvents.push(data);
          }}}};
        }""")
        self.page.add_script_tag(content=SOURCE)

    def panel(self):
        return self.page.locator("#routerlab-tplink-c20-ios")

    def wait_probe(self):
        self.page.wait_for_function("""() =>
          (window.__routerlabEvents||[]).some(m=>m.type==='tplinkProbe')""")

    def test_model_and_gdpr_both_required_before_panel_or_probe(self):
        self.model="TP-Link TL-WR841"
        self.launch()
        self.page.wait_for_timeout(200)
        self.assertEqual(self.panel().count(),0)
        self.assertEqual(self.page.evaluate("window.__routerlabEvents||[]"),[])
        self.assertEqual(self.logged,[])

    def test_protocol_mismatch_does_not_show_panel(self):
        self.gdpr_ok=False
        self.launch()
        self.page.wait_for_timeout(300)
        self.assertEqual(self.panel().count(),0)
        self.assertEqual(self.page.evaluate("window.__routerlabEvents||[]"),[])

    def test_c20_detected_but_login_not_assumed_from_http_200(self):
        self.launch()
        self.wait_probe()
        self.assertEqual(self.page.evaluate("window.__routerlabEvents"), [{
            "type":"tplinkProbe","supported":True,"model":"Archer C20",
            "firmwareConfirmed":False
        }])
        panel = self.panel()
        self.assertTrue(panel.locator("#auth").is_visible())
        self.assertFalse(panel.locator("#dashboard").is_visible())
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)
        self.assertEqual(self.logged[0][0],"POST")
        self.assertEqual(self.logged[0][1],"")
        self.assertEqual(len(self.logged),1)

    def test_success_one_stock_login_then_actual_24_5_and_wan_read(self):
        self.launch(); self.wait_probe()
        panel = self.panel()
        panel.locator("#admin-pass").fill("correctPassword123")
        panel.locator("#login-submit").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-tplink-c20-ios').shadowRoot
          .querySelector('#dashboard').style.display === 'block'""",timeout=12000)
        self.assertEqual(self.page.evaluate("window.loginClicks"),1)
        self.assertEqual(panel.locator("#admin-pass").input_value(),"")
        self.assertEqual(panel.locator("#ssid24").inner_text(),"C20_24")
        self.assertEqual(panel.locator("#ssid5").inner_text(),"C20_5")
        self.assertEqual(panel.locator("#wan-type").inner_text(),"DHCP")
        trace=panel.locator("#log").text_content()
        self.assertIn("GDPR_PARAMS_HTTP_200",trace)
        self.assertIn("WLAN_VENDOR_EXEC_ACCEPTED",trace)
        self.assertIn("WLAN_VENDOR_CALLBACK_OK",trace)
        self.assertIn("WLAN_PROTECTED_24_5_VERIFIED",trace)
        self.assertIn("SESSION_READBACK_VERIFIED",trace)
        self.assertNotIn("correctPassword123",trace)
        self.assertNotIn("C20_24",trace)
        self.assertEqual(len(self.logged),1)
        self.assertNotIn("correctPassword123",panel.locator("#log").text_content())
        panel.locator("#lock").click()
        self.assertFalse(panel.locator("#dashboard").is_visible())

    def test_native_login_shows_stock_tp_link_not_unverified_netis_overlay(self):
        # Regression for the real iPhone report: both vendor scripts inject
        # on every router document, but only the matching model gets a panel.
        self.page.goto(ORIGIN+"/")
        self.page.evaluate("""() => {
          window.webkit={messageHandlers:{routerlab:{postMessage:(data)=>{
            window.__routerlabEvents=window.__routerlabEvents||[];
            window.__routerlabEvents.push(data);
          }}}};
        }""")
        self.page.add_script_tag(content=NETIS_DRIVER)
        self.page.add_script_tag(content=NETIS_PANEL)
        self.page.add_script_tag(content=SOURCE)
        self.wait_probe()
        self.assertFalse(self.page.locator("#routerlab-netis-ios-pilot").is_visible(),
                         "Netis panel must be invisible on a TP-Link page")
        self.assertTrue(self.panel().is_visible())
        self.panel().locator("#stock-auth").click()
        self.assertFalse(self.panel().is_visible())
        self.assertFalse(self.page.locator("#routerlab-netis-ios-pilot").is_visible())
        self.assertTrue(self.page.locator("#stockLogin").is_visible(),
                        "Real TP-Link login button must be exposed")
        self.assertTrue(self.page.locator("#stockPassword").is_visible())
        self.assertTrue(self.page.locator("#routerlab-c20-restore").is_visible())
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)

    def test_stock_login_reload_preserves_recovery_and_prevents_password_reset(self):
        self.launch(); self.wait_probe()
        panel = self.panel()
        panel.locator("#stock-auth").click()
        self.assertFalse(panel.is_visible())
        # The physical C20 reloads/navigates after its own login. The
        # new document must not suddenly cover the stock page with RouterLab.
        self.page.reload()
        self.page.add_script_tag(content=SOURCE)
        self.page.wait_for_function("""() => {
          const panel=document.querySelector('#routerlab-tplink-c20-ios');
          return panel && document.querySelector('#routerlab-c20-restore');
        }""")
        self.assertFalse(self.panel().is_visible())
        self.assertTrue(self.page.locator("#stockLogin").is_visible())
        self.assertTrue(self.page.locator("#routerlab-c20-restore").is_visible())
        self.assertIn("STOCK_FLOW_RESTORED_AFTER_NAV",
            self.panel().locator("#log").text_content())
        self.assertIn("STOCK_LOGIN_UI_SHOWN",
            self.panel().locator("#log").text_content())
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)
        self.page.locator("#routerlab-c20-restore").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-tplink-c20-ios').shadowRoot
            .querySelector('#status').textContent.includes('WLAN_PROTECTED_READ_UNCONFIRMED')""")
        self.assertTrue(self.panel().locator("#diagnostics").is_visible())
        self.assertTrue(self.panel().locator("#diagnostics").evaluate("(e) => e.open"))
        self.assertFalse(self.panel().locator("#auth").is_visible())
        self.assertNotIn("correctPassword123",self.panel().locator("#log").text_content())
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)

    def test_stock_login_recovery_even_if_postlogin_title_has_no_model(self):
        self.launch(); self.wait_probe()
        self.panel().locator("#stock-auth").click()
        self.model = "Administration"
        self.page.reload()
        self.page.add_script_tag(content=SOURCE)
        self.page.wait_for_function("""() =>
          Boolean(document.querySelector('#routerlab-c20-restore'))""")
        self.assertFalse(self.panel().is_visible())
        self.assertTrue(self.page.locator("#routerlab-c20-restore").is_visible())
        self.assertIn("STOCK_FLOW_RESTORED_AFTER_NAV",
                      self.panel().locator("#log").text_content())

    def test_postlogin_recovery_when_gdpr_endpoint_stops_responding(self):
        self.launch(); self.wait_probe()
        self.panel().locator("#stock-auth").click()
        # Some authenticated stock pages stop returning pre-login RSA params.
        # A previous bounded fingerprint may only restore diagnostics, NEVER
        # silently assert authentication or submit a second password.
        self.gdpr_ok=False
        self.model="Administration"
        self.page.reload()
        self.page.add_script_tag(content=SOURCE)
        self.page.wait_for_function("""() =>
          Boolean(document.querySelector('#routerlab-c20-restore'))""")
        self.assertFalse(self.panel().is_visible())
        self.assertTrue(self.page.locator("#routerlab-c20-restore").is_visible())
        self.assertIn("GDPR_FINGERPRINT_NOT_CONFIRMED",
                      self.panel().locator("#log").text_content())
        self.assertIn("POSTLOGIN_RECOVERY_FROM_PRIOR_FINGERPRINT",
                      self.panel().locator("#log").text_content())
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)

    def test_native_stock_login_fallback_without_synthetic_submission(self):
        self.launch(); self.wait_probe()
        panel = self.panel()
        panel.locator("#stock-auth").click()
        self.assertFalse(panel.is_visible())
        self.assertTrue(self.page.locator("#routerlab-c20-restore").is_visible())
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)
        # This is a real tap/keyboard on TP-Link's page, not a RouterLab CGI packet.
        self.page.locator("#stockPassword").fill("correctPassword123")
        self.page.locator("#stockLogin").click()
        self.assertEqual(self.page.evaluate("window.loginClicks"),1)
        self.page.locator("#routerlab-c20-restore").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-tplink-c20-ios').shadowRoot
            .querySelector('#dashboard').style.display === 'block'""")
        self.assertTrue(panel.is_visible())
        self.assertEqual(panel.locator("#ssid24").inner_text(),"C20_24")
        self.assertEqual(panel.locator("#ssid5").inner_text(),"C20_5")
        self.assertEqual(self.page.evaluate("window.loginClicks"),1)
        self.assertEqual(len(self.logged),1)

    def test_refresh_never_resends_password_after_one_attempt(self):
        self.stock_authorizes = False
        self.launch(); self.wait_probe()
        panel = self.panel()
        panel.locator("#admin-pass").fill("wrongPassword123")
        panel.locator("#login-submit").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-tplink-c20-ios').shadowRoot
            .querySelector('#status').textContent.includes('WLAN_PROTECTED_READ_UNCONFIRMED')""",timeout=12000)
        panel.locator("#refresh").click()
        self.assertEqual(self.page.evaluate("window.loginClicks"),1)
        self.assertFalse(panel.locator("#auth").is_visible())

    def test_wrong_password_never_claims_login_or_resubmits(self):
        self.stock_authorizes = False
        self.launch(); self.wait_probe()
        panel = self.panel()
        panel.locator("#admin-pass").fill("wrongPassword123")
        panel.locator("#login-submit").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-tplink-c20-ios').shadowRoot
          .querySelector('#status').textContent.includes('WLAN_PROTECTED_READ_UNCONFIRMED')""", timeout=12000)
        self.assertFalse(panel.locator("#dashboard").is_visible())
        self.assertEqual(self.page.evaluate("window.loginClicks"),1)
        self.assertEqual(len(self.logged),1)
        self.assertNotIn("wrongPassword123",panel.locator("#log").text_content())

    def test_already_authenticated_stock_session_readback(self):
        self.launch(); self.wait_probe()
        self.page.evaluate("""() => {
            window.authorized=true;
            document.querySelector('#stockPassword').style.display='none';
            document.querySelector('#stockLogin').style.display='none';
        }""")
        self.panel().locator("#refresh").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-tplink-c20-ios').shadowRoot
          .querySelector('#dashboard').style.display === 'block'""")
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)
        self.assertEqual(len(self.logged),1)

if __name__=="__main__":
    unittest.main()
