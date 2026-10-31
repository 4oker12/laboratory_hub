"""Read-only router detection: fail closed and never leak page content."""
import pathlib
import unittest
from playwright.sync_api import sync_playwright

RUNTIME = (pathlib.Path(__file__).resolve().parents[1] / "RouterLabMobile/Resources/RouterLabRuntime.js").read_text()


class ConsumerProbeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def probe(self, html):
        page = self.browser.new_page()
        try:
            page.set_content(html)
            page.evaluate('''() => {
                window.__messages = [];
                window.webkit = { messageHandlers: { routerlab: {
                    postMessage: m => window.__messages.push(m)
                } } };
            }''')
            page.add_script_tag(content=RUNTIME)
            page.evaluate('window.__RouterLabMobile.probe()')
            return page.evaluate('window.__messages.filter(x => x.type === "deviceInfo").pop()')
        finally:
            page.close()

    def test_c20_exact_stock_version(self):
        result = self.probe('''<html><head><title>Archer C20</title></head><body>
        Версия устройства: Archer C20 v5 00000002<br>
        Версия встроенного ПО: 3.16.0 0.9.1 v6038.0 Build 200821 Rel.52349n
        <input type="password" value="never-export-secret">
        </body></html>''')
        self.assertEqual((result['model'], result['revision'], result['build']),
                         ('Archer C20', 'v5', '200821'))
        self.assertNotIn('never-export-secret', str(result))

    def test_unknown_router_fails_closed(self):
        result = self.probe('<html><head><title>Home router</title></head><body>unknown</body></html>')
        self.assertEqual(result['model'], '')
        self.assertEqual(result['build'], '')

    def test_c20_without_revision_cannot_match_exact_adapter(self):
        result = self.probe('<html><head><title>Archer C20</title></head><body>TP-Link</body></html>')
        self.assertEqual(result['model'], 'Archer C20')
        self.assertEqual(result['revision'], '')


if __name__ == '__main__':
    unittest.main()