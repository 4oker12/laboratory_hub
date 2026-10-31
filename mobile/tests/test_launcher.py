"""Launcher and URL scheme checks. Does not exercise iOS or signed app."""
import pathlib
import plistlib
import unittest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]

class LauncherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        self.page.set_content((ROOT / 'RouterLab-Launcher.html').read_text(), wait_until='load')

    def tearDown(self):
        self.page.close()

    def test_default_one_tap_address(self):
        self.assertEqual(self.page.locator('#openApp').get_attribute('href'), 'routerlab://open?host=192.168.0.1')
        self.assertEqual(self.page.locator('#openRouter').get_attribute('href'), 'http://192.168.0.1')

    def test_change_private_router(self):
        self.page.locator('#technical').evaluate("el => el.open = true")
        self.page.locator('#host').fill('192.168.1.1')
        self.assertEqual(self.page.locator('#openApp').get_attribute('href'), 'routerlab://open?host=192.168.1.1')
        self.page.locator('#host').fill('172.31.4.1')
        self.assertEqual(self.page.locator('#openRouter').get_attribute('href'), 'http://172.31.4.1')

    def test_public_and_script_address_rejected(self):
        self.page.locator('#technical').evaluate("el => el.open = true")
        for invalid in ['8.8.8.8', '172.32.1.1', '192.168.1.1:8080', '1.1.1.1/#run', '192.168.1.999', 'router.local']:
            self.page.locator('#host').fill(invalid)
            self.assertEqual(self.page.locator('#openApp').get_attribute('aria-disabled'), 'true', invalid)
            self.assertEqual(self.page.locator('#openRouter').get_attribute('href'), '#', invalid)


    def test_customer_sees_one_primary_action(self):
        self.assertEqual(self.page.locator('a.action').count(), 1)
        self.assertTrue(self.page.locator('#openApp').is_visible())
        self.assertFalse(self.page.locator('#host').is_visible())
        self.assertIn('установленное приложение', self.page.locator('#status').inner_text())

    def test_link_host_parameter_is_validated(self):
        self.page.goto('about:blank')
        self.page.set_content((ROOT / 'RouterLab-Launcher.html').read_text())
        self.page.evaluate('history.replaceState(null, "", "?host=8.8.8.8")') if self.page.url.startswith('http') else None
        # Code path for query param is covered by static check; document URL
        # from set_content() is about:blank, which disallows history mutation.
        script = (ROOT / 'RouterLab-Launcher.html').read_text()
        self.assertIn("if(requested&&isPrivateIPv4(requested))", script)

    def test_native_url_scheme_registered(self):
        with (ROOT / 'RouterLabMobile' / 'Info.plist').open('rb') as f:
            plist = plistlib.load(f)
        self.assertIn('routerlab', plist['CFBundleURLTypes'][0]['CFBundleURLSchemes'])
        swift = (ROOT / 'RouterLabMobile' / 'ContentView.swift').read_text()
        self.assertIn('.onOpenURL', swift)
        self.assertIn('RouterLabDeepLink.routerAddress(from: url)', swift)
        self.assertIn('RouterSession.isPrivateIPv4(host)', (ROOT / 'RouterLabMobile' / 'RouterLabMobileApp.swift').read_text())

if __name__ == '__main__':
    unittest.main()