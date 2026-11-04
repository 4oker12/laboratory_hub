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
        self.public_readback = False
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
              document.querySelector('#stockLogin').addEventListener('click', (event) => {{
                window.loginClicks++;
                const f = document.querySelector('#stockPassword');
                window.authorized = event.isTrusted && {'true' if self.stock_authorizes else 'false'} &&
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
                    if (pending && (window.authorized || {'true' if self.public_readback else 'false'}) && pending.op===5) {{
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
        elif url.endswith("/cgi_gdpr") and route.request.method == "POST":
            self.logged.append((route.request.method,"REDACTED",url))
            route.fulfill(status=200, content_type="text/plain", body="test ack")
        elif url.endswith("/cgi/getGDPRParm") and route.request.method == "POST":
            self.logged.append((route.request.method,route.request.post_data or "",url))
            if self.gdpr_ok:
                route.fulfill(status=200, content_type="text/plain",
                              body='var nn="'+'a'*128+'"; var ee="10001"; var seq=858738839;')
            else:
                route.fulfill(status=500, content_type="text/plain", body='unexpected')
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
    def probe_events(self):
        return self.page.evaluate("""() =>
          (window.__routerlabEvents||[]).filter(m=>m.type==='tplinkProbe')""")


    def test_model_and_gdpr_both_required_before_panel_or_probe(self):

        self.model="TP-Link TL-WR841"
        self.launch()
        self.page.wait_for_timeout(250)
        self.assertEqual(self.panel().count(),0)
        self.assertEqual(self.probe_events(),[])
        self.assertEqual(self.logged,[])

    def test_protocol_mismatch_does_not_show_panel(self):

        # Our own POST to getGDPRParm is gone. A vendor endpoint returning
        # HTTP 500 must not invalidate a passively recognized C20.
        self.gdpr_ok=False
        self.launch(); self.wait_probe()
        self.assertTrue(self.panel().is_visible())
        self.page.evaluate("""() => fetch('/cgi/getGDPRParm',{method:'POST'}).catch(()=>{})""")
        self.assertTrue(self.panel().is_visible())
        self.assertEqual(len(self.logged),1)
        self.assertIn("PASSIVE_MARKUP_VENDOR_OK",self.panel().locator("#log").text_content())
        self.assertNotIn("GDPR_FINGERPRINT_NOT_CONFIRMED",self.panel().locator("#log").text_content())

    def test_c20_detected_but_login_not_assumed_from_http_200(self):
        self.launch()
        self.wait_probe()
        self.assertEqual(self.probe_events(), [{
            "type":"tplinkProbe","supported":True,"model":"Archer C20",
            "firmwareConfirmed":False
        }])
        panel = self.panel()
        self.assertTrue(panel.locator("#auth").is_visible())
        self.assertFalse(panel.locator("#dashboard").is_visible())
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)
        self.assertEqual(len(self.logged),0,"No RouterLab GDPR parameter POST is allowed")

    def test_success_one_stock_login_then_actual_24_5_and_wan_read(self):
        self.launch(); self.wait_probe()
        panel = self.panel()
        self.assertTrue(panel.locator("#auth").is_visible())
        self.assertIn("NATIVE_LOGIN_HITTEST_OK",panel.locator("#log").text_content())
        # These are real stock inputs/buttons, never copies inside Shadow DOM.
        self.page.locator("#stockPassword").fill("correctPassword123")
        self.page.locator("#stockLogin").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-tplink-c20-ios').shadowRoot
          .querySelector('#dashboard').style.display === 'block'""",timeout=12000)
        self.assertEqual(self.page.evaluate("window.loginClicks"),1)
        self.assertEqual(self.page.locator("#stockPassword").input_value(),"")
        self.assertEqual(panel.locator("#ssid24").inner_text(),"C20_24")
        self.assertEqual(panel.locator("#ssid5").inner_text(),"C20_5")
        self.assertEqual(panel.locator("#wan-type").inner_text(),"DHCP")
        trace=panel.locator("#log").text_content()
        self.assertIn("PASSIVE_MARKUP_VENDOR_OK",trace)
        self.assertIn("WLAN_VENDOR_EXEC_ACCEPTED",trace)
        self.assertIn("WLAN_VENDOR_CALLBACK_OK",trace)
        self.assertIn("WLAN_PROTECTED_24_5_VERIFIED",trace)
        self.assertIn("SESSION_READBACK_VERIFIED",trace)
        self.assertIn("NATIVE_STOCK_LOGIN_TAP",trace)
        self.assertIn("NATIVE_LOGIN_TAP_OVERLAY",trace)
        self.assertNotIn("NATIVE_LOGIN_TAP_STOCK_FALLBACK",trace)
        self.assertIn("STOCK_BUTTON_TRUSTED_CLICK",trace)
        self.assertNotIn("STOCK_BUTTON_SYNTHETIC_CLICK",trace)
        self.assertNotIn("correctPassword123",trace)
        self.assertNotIn("C20_24",trace)
        self.assertEqual(len(self.logged),0)
        self.assertNotIn("correctPassword123",panel.locator("#log").text_content())
        panel.locator("#lock").click()
        self.assertFalse(panel.locator("#dashboard").is_visible())


    def test_existing_session_probe_never_submits_login_and_fails_closed(self):
        self.launch(); self.wait_probe()
        panel=self.panel()
        self.assertTrue(panel.locator("#auth").is_visible())
        panel.locator("#check-existing").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-tplink-c20-ios').shadowRoot
            .querySelector('#status').textContent.includes('WLAN_PROTECTED_READ_UNCONFIRMED')""")
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)
        trace=panel.locator("#log").text_content()
        self.assertIn("EXISTING_SESSION_READ_REQUESTED",trace)
        self.assertNotIn("SESSION_READBACK_VERIFIED",trace)
        self.assertNotIn("CONFIG_READBACK_OK_AUTH_NOT_PROVEN",trace)
        self.assertFalse(panel.locator("#dashboard").is_visible())
        self.assertTrue(panel.locator("#auth").is_visible(),
                        "Failed no-password probe must restore the real login controls")

    def test_public_readback_must_not_be_mistaken_for_login(self):
        # Deliberately simulate a firmware that exposes the WLAN rows before
        # admin login. Readback success is NOT sufficient to claim login.
        self.public_readback=True
        self.launch(); self.wait_probe()
        panel=self.panel()
        panel.locator("#check-existing").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-tplink-c20-ios').shadowRoot
            .querySelector('#dashboard').style.display === 'block'""",timeout=12000)
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)
        self.assertEqual(panel.locator("#ssid24").inner_text(),"C20_24")
        self.assertEqual(panel.locator("#ssid5").inner_text(),"C20_5")
        self.assertIn("CONFIG_READBACK_OK_AUTH_NOT_PROVEN",panel.locator("#log").text_content())
        self.assertNotIn("SESSION_READBACK_VERIFIED",panel.locator("#log").text_content())
        self.assertIn("не доказана",panel.locator("#status").inner_text())

    def test_native_stock_controls_retain_parent_and_accept_trusted_tap(self):
        self.launch(); self.wait_probe()
        panel=self.panel()
        self.page.wait_for_function("""() => {
          const root=document.querySelector('#routerlab-tplink-c20-ios').shadowRoot;
          return root.querySelector('#log').textContent.includes('NATIVE_LOGIN_HITTEST_OK');
        }""")
        self.assertTrue(panel.locator("#auth").is_visible())
        self.assertEqual(self.page.locator("#stockPassword").evaluate("(e)=>e.parentNode.tagName"),"BODY")
        self.assertEqual(self.page.locator("#stockLogin").evaluate("(e)=>e.parentNode.tagName"),"BODY")
        self.assertEqual(panel.locator("#admin-pass").count(),0)
        self.assertEqual(panel.locator("#login-submit").count(),0)
        self.page.locator("#stockPassword").fill("correctPassword123")
        self.page.locator("#stockLogin").click()
        trace=panel.locator("#log").text_content()
        self.assertIn("NATIVE_STOCK_LOGIN_TAP",trace)
        self.assertIn("STOCK_BUTTON_TRUSTED_CLICK",trace)
        self.assertNotIn("STOCK_BUTTON_SYNTHETIC_CLICK",trace)
        self.assertNotIn("correctPassword123",trace)


    def test_first_party_manual_click_is_trusted_in_a_real_browser(self):

        self.launch(); self.wait_probe()
        self.page.locator("#stockPassword").fill("correctPassword123")
        self.page.locator("#stockLogin").click()
        trace=self.panel().locator("#log").text_content()
        self.assertIn("STOCK_BUTTON_TRUSTED_CLICK",trace)
        self.assertIn("NATIVE_LOGIN_TAP_OVERLAY",trace)
        self.assertNotIn("STOCK_BUTTON_SYNTHETIC_CLICK",trace)
        self.assertFalse(self.panel().locator("#login-error-panel").is_visible())

    def test_transient_webkit_hit_test_recovers_without_stock_fallback(self):
        self.page.goto(ORIGIN+"/")
        self.page.evaluate("""() => {
          window.webkit={messageHandlers:{routerlab:{postMessage:()=>{}}}};
          const original=document.elementFromPoint.bind(document);
          let calls=0;
          document.elementFromPoint=(x,y)=>{
            calls++;
            if (calls === 1) return document.body;
            return original(x,y);
          };
        }""")
        self.page.add_script_tag(content=SOURCE)
        self.page.wait_for_function("""() => {
          const p=document.querySelector('#routerlab-tplink-c20-ios');
          return p && p.shadowRoot.querySelector('#log').textContent
            .includes('NATIVE_LOGIN_HITTEST_RECOVERED');
        }""",timeout=10000)
        trace=self.panel().locator("#log").text_content()
        self.assertIn("NATIVE_LOGIN_HITTEST_RETRY",trace)
        self.assertNotIn("NATIVE_LOGIN_HITTEST_FAILED",trace)
        self.assertNotIn("STOCK_LOGIN_UI_SHOWN",trace)
        self.assertTrue(self.panel().locator("#auth").is_visible())

    def test_persistent_hittest_block_reports_target_and_falls_back(self):

        self.page.goto(ORIGIN+"/")
        self.page.evaluate("""() => {
          window.webkit={messageHandlers:{routerlab:{postMessage:()=>{}}}};
          document.elementFromPoint=()=>document.body;
        }""")
        self.page.add_script_tag(content=SOURCE)
        self.page.wait_for_function("""() => {
          const p=document.querySelector('#routerlab-tplink-c20-ios');
          return p && p.shadowRoot.querySelector('#log').textContent
            .includes('NATIVE_LOGIN_HITTEST_FAILED');
        }""",timeout=12000)
        panel=self.panel()
        trace=panel.locator("#log").text_content()
        self.assertIn("NATIVE_LOGIN_HITTEST_FIELD_BLOCKED",trace)
        self.assertIn("NATIVE_LOGIN_HITTEST_BUTTON_BLOCKED",trace)
        self.assertIn("HIT_FIELD_BLOCK_TAG_BODY",trace)
        self.assertIn("HIT_VIEW_SCALE_",trace)
        self.assertTrue(panel.is_visible())
        self.assertTrue(panel.locator("#login-error-panel").is_visible())
        self.assertFalse(self.page.locator("#stockLogin").is_visible())
        self.assertNotIn("STOCK_LOGIN_UI_SHOWN",trace)

    def test_xhr_login_lifecycle_logs_http_code_but_never_encrypted_body(self):
        self.launch(); self.wait_probe()
        self.page.evaluate("""() => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST','/cgi_gdpr');
          xhr.send('SYNTHETIC_ENCRYPTED_PASSWORD_MUST_NEVER_BE_LOGGED');
        }""")
        self.page.wait_for_function("""() => {
          const host=document.querySelector('#routerlab-tplink-c20-ios');
          return host && host.shadowRoot.querySelector('#log')
            .textContent.includes('XHR_GDPR_HTTP_200');
        }""")
        data=self.panel().locator("#log").text_content()
        self.assertIn("XHR_OBSERVER_INSTALLED",data)
        self.assertIn("XHR_GDPR_POST_SENT",data)
        self.assertIn("XHR_GDPR_HTTP_200",data)
        self.assertNotIn("SYNTHETIC_ENCRYPTED_PASSWORD_MUST_NEVER_BE_LOGGED",data)
        self.assertNotIn("/cgi_gdpr",data)

    def test_native_login_shows_stock_tp_link_not_unverified_netis_overlay(self):

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
        self.assertFalse(self.page.locator("#routerlab-netis-ios-pilot").is_visible())
        self.assertTrue(self.panel().is_visible())
        self.assertTrue(self.panel().locator("#auth").is_visible())
        self.assertEqual(self.panel().locator("#stock-auth").count(),0)
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)

    def test_stock_login_reload_preserves_recovery_and_prevents_password_reset(self):

        # Reproduce exact physical iPhone symptom: stale navigation marker
        # and the real stock login still visible.
        self.launch(); self.wait_probe()
        self.page.evaluate("""() => sessionStorage.setItem(
          'routerlab_c20_stock_flow_v2', JSON.stringify({at:Date.now()}))""")
        self.page.reload()
        self.page.add_script_tag(content=SOURCE)
        self.page.wait_for_function("""() => {
          const panel=document.querySelector('#routerlab-tplink-c20-ios');
          return panel && panel.shadowRoot.querySelector('#log').textContent
            .includes('LOGIN_MARKER_REJECTED_STOCK_FORM_VISIBLE');
        }""",timeout=12000)
        panel=self.panel()
        self.assertTrue(panel.is_visible())
        self.assertTrue(panel.locator("#auth").is_visible())
        trace=panel.locator("#log").text_content()
        self.assertIn("STOCK_FLOW_RESTORED_AFTER_NAV",trace)
        self.assertIn("LOGIN_FORM_READY",trace)
        self.assertNotIn("WLAN_READ_STARTED",trace)
        self.assertNotIn("PRELOGIN_SESSION_READ_CHECK",trace)
        self.assertIn("Введите пароль",panel.locator("#status").inner_text())
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)
        self.assertEqual(len(self.logged),0)

    def test_stale_marker_visible_login_skips_cgi_and_clears_marker(self):

        self.launch(); self.wait_probe()
        self.page.evaluate("""() => sessionStorage.setItem(
          'routerlab_c20_stock_flow_v2', JSON.stringify({at:Date.now()}))""")
        self.page.reload()
        self.page.add_script_tag(content=SOURCE)
        self.page.wait_for_function("""() => {
          const panel=document.querySelector('#routerlab-tplink-c20-ios');
          return panel && panel.shadowRoot.querySelector('#log').textContent
            .includes('LOGIN_MARKER_REJECTED_STOCK_FORM_VISIBLE');
        }""",timeout=12000)
        self.assertFalse(self.page.evaluate("""() =>
          Boolean(sessionStorage.getItem('routerlab_c20_stock_flow_v2'))"""))
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)
        self.assertTrue(self.panel().locator("#auth").is_visible())
        self.assertIn("NATIVE_LOGIN_SKIN_PLACED",self.panel().locator("#log").text_content())
        self.assertEqual(len(self.logged),0,"No protected CGI before a fresh tap")

    def test_unhittable_stock_controls_fail_open_to_native_login_page(self):

        self.page.goto(ORIGIN+"/")
        self.page.evaluate("""() => {
          window.webkit={messageHandlers:{routerlab:{postMessage:(data)=>{
            window.__routerlabEvents=window.__routerlabEvents||[];
            window.__routerlabEvents.push(data);
          }}}};
          window.__normalElementFromPoint=document.elementFromPoint.bind(document);
          document.elementFromPoint=()=>document.body;
        }""")
        self.page.add_script_tag(content=SOURCE)
        self.wait_probe()
        self.page.wait_for_function("""() => {
          const p=document.querySelector('#routerlab-tplink-c20-ios');
          return p && p.shadowRoot.querySelector('#log').textContent
            .includes('NATIVE_LOGIN_HITTEST_FAILED');
        }""",timeout=12000)
        self.assertTrue(self.panel().is_visible())
        self.assertTrue(self.panel().locator("#login-error-panel").is_visible())
        self.assertFalse(self.page.locator("#stockPassword").is_visible())
        self.assertFalse(self.page.locator("#stockLogin").is_visible())
        self.page.evaluate("document.elementFromPoint=window.__normalElementFromPoint")
        self.panel().locator("#retry-login").click()
        self.page.wait_for_function("""() => {
          const p=document.querySelector('#routerlab-tplink-c20-ios');
          return p && p.shadowRoot.querySelector('#log').textContent
            .includes('LOGIN_USER_RETRY_REQUESTED');
        }""")
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)

    def test_stock_login_recovery_even_if_postlogin_title_has_no_model(self):

        self.launch(); self.wait_probe()
        self.page.locator("#stockPassword").fill("correctPassword123")
        self.page.locator("#stockLogin").click()
        self.assertIn("NATIVE_STOCK_LOGIN_TAP",self.panel().locator("#log").text_content())
        self.model="Administration"
        self.page.reload()
        self.page.add_script_tag(content=SOURCE)
        self.page.wait_for_function("""() => {
          const panel=document.querySelector('#routerlab-tplink-c20-ios');
          return panel && panel.shadowRoot.querySelector('#log').textContent
            .includes('PASSIVE_ORIGIN_SESSION_RECOVERY');
        }""")
        self.assertTrue(self.panel().is_visible())
        self.assertTrue(self.panel().locator("#auth").is_visible())
        self.assertNotIn("WLAN_READ_STARTED",self.panel().locator("#log").text_content())

    def test_postlogin_recovery_when_gdpr_endpoint_stops_responding(self):

        self.launch(); self.wait_probe()
        self.page.locator("#stockPassword").fill("correctPassword123")
        self.page.locator("#stockLogin").click()
        self.gdpr_ok=False
        self.model="Administration"
        self.page.reload()
        self.page.add_script_tag(content=SOURCE)
        self.page.wait_for_function("""() => {
          const panel=document.querySelector('#routerlab-tplink-c20-ios');
          return panel && panel.shadowRoot.querySelector('#log').textContent
            .includes('PASSIVE_ORIGIN_SESSION_RECOVERY');
        }""")
        self.assertTrue(self.panel().is_visible())
        self.assertIn("POSTLOGIN_RSA_REPROBE_SKIPPED",self.panel().locator("#log").text_content())
        self.assertEqual(len(self.logged),0)

    def test_native_stock_login_fallback_without_synthetic_submission(self):

        # No route from RouterLab to visible stock UI remains.
        self.launch(); self.wait_probe()
        panel=self.panel()
        self.assertTrue(panel.is_visible())
        self.assertEqual(panel.locator("#stock-auth").count(),0)
        self.assertFalse(self.page.locator("#routerlab-c20-restore").is_visible())
        self.assertTrue(self.page.locator("#stockPassword").is_visible())
        self.assertTrue(self.page.locator("#stockLogin").is_visible())
        self.assertEqual(self.page.evaluate("window.loginClicks"),0)

    def test_refresh_never_resends_password_after_one_attempt(self):

        self.stock_authorizes=False
        self.launch(); self.wait_probe()
        panel=self.panel()
        self.page.locator("#stockPassword").fill("wrongPassword123")
        self.page.locator("#stockLogin").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-tplink-c20-ios').shadowRoot
            .querySelector('#log').textContent.includes('READ_FAILED_WLAN_PROTECTED_READ_UNCONFIRMED')""",timeout=12000)
        panel.locator("#refresh").click()
        self.assertEqual(self.page.evaluate("window.loginClicks"),1)
        self.assertTrue(panel.locator("#auth").is_visible())

    def test_wrong_password_never_claims_login_or_resubmits(self):

        self.stock_authorizes=False
        self.launch(); self.wait_probe()
        panel=self.panel()
        self.page.locator("#stockPassword").fill("wrongPassword123")
        self.page.locator("#stockLogin").click()
        self.page.wait_for_function("""() =>
          document.querySelector('#routerlab-tplink-c20-ios').shadowRoot
            .querySelector('#log').textContent.includes('READ_FAILED_WLAN_PROTECTED_READ_UNCONFIRMED')""",timeout=12000)
        self.assertFalse(panel.locator("#dashboard").is_visible())
        self.assertTrue(panel.locator("#auth").is_visible())
        self.assertEqual(self.page.evaluate("window.loginClicks"),1)
        self.assertEqual(len(self.logged),0)
        self.assertNotIn("wrongPassword123",panel.locator("#log").text_content())
        self.assertNotIn("STOCK_BUTTON_SYNTHETIC_CLICK",panel.locator("#log").text_content())

    def test_millisecond_timeline_and_js_bridge(self):
        self.launch(); self.wait_probe()
        trace=self.panel().locator("#log").text_content()
        self.assertRegex(trace,r"\b\d{2}:\d{2}:\d{2}\.\d{3} DOCUMENT_BOOTSTRAP")
        events=self.page.evaluate("""() => (window.__routerlabEvents||[])
          .filter(x=>x.type==='tplinkDiagnostic')""")
        self.assertTrue(events)
        self.assertRegex(events[-1]['time'],r"^\d{2}:\d{2}:\d{2}\.\d{3}$")
        self.assertEqual(len(self.logged),0)

    def test_login_xhr_error_records_ready_state_online_and_unload(self):
        self.launch(); self.wait_probe()
        self.page.locator("#stockPassword").fill("correctPassword123")
        self.page.locator("#stockLogin").click()
        self.page.route(ORIGIN+"/cgi_gdpr",lambda route:route.abort())
        self.page.evaluate("""() => {
          const xhr=new XMLHttpRequest();
          xhr.open('POST','/cgi_gdpr',true);
          xhr.send('ENCRYPTED_DO_NOT_LOG');
        }""")
        self.page.wait_for_function("""() => {
          const p=document.querySelector('#routerlab-tplink-c20-ios');
          return p.shadowRoot.querySelector('#log').textContent
            .includes('LOGIN_XHR_ONERROR_RS_');
        }""")
        trace=self.panel().locator("#log").text_content()
        self.assertIn("LOGIN_XHR_ONLINE_YES",trace)
        self.assertIn("LOGIN_XHR_READY_STATE_",trace)
        self.assertIn("XHR_GDPR_NETWORK_ERROR",trace)
        self.assertNotIn("ENCRYPTED_DO_NOT_LOG",trace)

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
        self.assertEqual(len(self.logged),0)

if __name__=="__main__":
    unittest.main()
