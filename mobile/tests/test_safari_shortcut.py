"""Verify no-Mac Safari shortcut bootstrap against mocked router-origin DOM."""
import pathlib
import unittest
from playwright.sync_api import sync_playwright

SCRIPT = (pathlib.Path(__file__).resolve().parents[1] / 'RouterLab-Safari-Shortcut.js').read_text()
HTML = '''<html><head><title>Router Mock</title></head><body>
<input id="pass" type="password"><button id="save">Save</button>
</body></html>'''

class SafariPilotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def test_local_router_injection_and_local_storage_record(self):
        page = self.browser.new_page()
        page.set_content(HTML)
        # This environment forbids navigation to any HTTP address, including loopback.
        # Test the DOM/storage path with an in-memory origin substitute; keep the
        # original host guard unchanged in the distribution artifact.
        page.evaluate("""() => { const store = {};
          Object.defineProperty(window, 'localStorage', { configurable: true, value: {
            getItem: k => store[k] ?? null, setItem: (k,v) => {store[k] = String(v)}
          }});
        }""")
        pilot = SCRIPT.replace('const host = location.hostname;', "const host = '192.168.0.1';")
        pilot = pilot.replace('!/^https?:$/.test(location.protocol)', 'false')
        page.add_script_tag(content=pilot)
        self.assertTrue(page.locator('#routerlab-safari-controls').count() == 1)
        page.evaluate("window.__RLSafari.mode='record'; window.__RouterLabMobile.setMode('record')")
        page.locator('#pass').fill('NEVER_STORE_THIS_PASSWORD')
        page.locator('#save').click()
        steps = page.evaluate("window.__RLSafari.steps")
        self.assertEqual(steps[0]['placeholder'], 'adminPassword')
        self.assertNotIn('NEVER_STORE_THIS_PASSWORD', page.evaluate("localStorage.getItem('routerlab_safari_v1_192.168.0.1_steps')"))
        page.close()

    def test_external_host_denied(self):
        page = self.browser.new_page()
        page.on('dialog', lambda dialog: dialog.accept())
        page.goto('about:blank')
        page.add_script_tag(content=SCRIPT)
        self.assertFalse(page.evaluate('Boolean(window.__RLSafari)'))
        page.close()

if __name__ == '__main__':
    unittest.main()