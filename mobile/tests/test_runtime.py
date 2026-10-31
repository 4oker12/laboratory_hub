"""Browser-level tests of the injected RouterLab runtime (not an iOS device test)."""
import json
import pathlib
import unittest
from playwright.sync_api import sync_playwright

JS = (pathlib.Path(__file__).resolve().parents[1] / "RouterLabMobile" / "Resources" / "RouterLabRuntime.js").read_text()
HTML = '''<!doctype html><html><head><title>Mock Router</title></head><body>
<form id="router-form" onsubmit="event.preventDefault(); window._submitted = true">
<label>Login <input name="userName" value="admin"></label>
<label>Password <input id="login-password" type="password"></label>
<label>SSID <input id="wifi-ssid" name="SSID"></label>
<label>Wi-Fi key <input name="wpaPsk" type="password"></label>
<button id="apply" type="submit">Apply</button>
</form></body></html>'''

class RuntimeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.page.set_content(HTML)
        self.page.evaluate('''() => {
            window.__events = [];
            window.webkit = { messageHandlers: { routerlab: { postMessage: m => window.__events.push(m) } } };
        }''')
        self.page.add_script_tag(content=JS)
        self.page.evaluate("window.__RouterLabMobile.setMode('record')")

    def tearDown(self):
        self.page.close()

    def record(self):
        self.page.locator('#login-password').fill('admin-super-secret')
        self.page.locator('#wifi-ssid').fill('TestNetwork')
        self.page.locator('[name=wpaPsk]').fill('wifi-super-secret')
        self.page.locator('#apply').click()
        return self.page.evaluate("window.__events.filter(e => e.type === 'step').map(e => e.step)")

    def test_secret_redaction_and_record(self):
        steps = self.record()
        self.assertGreaterEqual(len(steps), 4)
        raw = json.dumps(steps)
        self.assertNotIn('admin-super-secret', raw)
        self.assertNotIn('wifi-super-secret', raw)
        self.assertNotIn('TestNetwork', raw)
        self.assertEqual(next(s for s in steps if s['selector'] == '#login-password')['placeholder'], 'adminPassword')
        self.assertEqual(next(s for s in steps if s['selector'] == '#wifi-ssid')['placeholder'], 'wifiSSID')
        self.assertEqual(next(s for s in steps if 'wpaPsk' in s['selector'])['placeholder'], 'wifiPassword')
        self.assertEqual(steps[-1]['kind'], 'click')

    def test_replay_executes_stock_events(self):
        steps = self.record()
        self.page.evaluate("""() => {
            document.querySelector('#login-password').value = '';
            document.querySelector('#wifi-ssid').value = '';
            document.querySelector('[name=wpaPsk]').value = '';
            window._submitted = false;
            window.__RouterLabMobile.stop();
        }""")
        payload = {'steps': steps, 'start': 0, 'secrets': {
            'adminPassword': 'replayed-admin-password', 'wifiSSID': 'ReplayedSSID',
            'wifiPassword': 'replayed-wifi-password'}}
        self.page.evaluate('(payload) => window.__RouterLabMobile.play(payload)', payload)
        self.page.wait_for_function("window.__events.some(e => e.type === 'replayComplete')")
        result = self.page.evaluate("""() => ({
           admin: document.querySelector('#login-password').value,
           ssid: document.querySelector('#wifi-ssid').value,
           wifi: document.querySelector('[name=wpaPsk]').value,
           submitted: window._submitted
        })""")
        self.assertEqual(result, {'admin': 'replayed-admin-password', 'ssid': 'ReplayedSSID',
                                  'wifi': 'replayed-wifi-password', 'submitted': True})

    def test_missing_secret_stops_without_writing(self):
        steps = [{'kind':'set','selector':'#login-password','placeholder':'adminPassword','value':None,'path':'blank'}]
        self.page.evaluate('(steps) => window.__RouterLabMobile.play({steps, start:0, secrets:{}})', steps)
        self.page.wait_for_function("window.__events.some(e => e.type === 'replayError')")
        self.assertEqual('', self.page.locator('#login-password').input_value())

    def test_mismatched_route_fails_closed(self):
        steps = [{'kind':'click','selector':'#apply','path':'/not-this-page'}]
        self.page.evaluate('(steps) => window.__RouterLabMobile.play({steps, start:0, secrets:{}})', steps)
        self.page.wait_for_function("window.__events.some(e => e.type === 'replayError')")
        self.assertFalse(self.page.evaluate('Boolean(window._submitted)'))

if __name__ == '__main__':
    unittest.main()