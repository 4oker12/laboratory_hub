"""Tests do not require or redistribute vendor firmware."""
import importlib.util
import pathlib
import json
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).parents[1] / 'devices/cudy/wr3000/v1-r31-2.4.19/probe_firmware.py'
spec = importlib.util.spec_from_file_location('wr3000_firmware', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class WR3000AnalysisTest(unittest.TestCase):
    def test_extract_contract_markers_from_synthetic_rootfs(self):
        with tempfile.TemporaryDirectory() as root:
            directory = pathlib.Path(root)
            target = directory / 'usr/lib/lua/luci/apprpc/qsetup.lua'
            target.parent.mkdir(parents=True)
            target.write_bytes(b'\x00luci.main.wizard\x00qsetup.apply\x00wireless.wlan00\x00sysauth\x00')
            evidence = module.inspect_rootfs(directory)
            self.assertEqual(evidence['file_count'], 1)
            self.assertIn('wizard', evidence['matches'][0]['categories'])
            self.assertIn('wifi', evidence['matches'][0]['categories'])
            self.assertIn('auth', evidence['matches'][0]['categories'])
            self.assertNotIn('admin-password', str(evidence))

    def test_stock_contract_hints_exclude_arbitrary_private_values(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            file = root / 'usr/lib/lua/luci/apprpc/qsetup.lua'
            file.parent.mkdir(parents=True)
            file.write_bytes(b'\x1bLua' + b'\x00qsetup\x00wireless.wlan00\x00password-one-time-SECRET\x00')
            details = module.inspect_stock_contracts(root)
            record = details['usr/lib/lua/luci/apprpc/qsetup.lua']
            self.assertTrue(record['lua_bytecode'])
            self.assertIn('qsetup', record['candidate_identifiers'])
            self.assertIn('wireless.wlan00', record['candidate_identifiers'])
            self.assertNotIn('password-one-time-SECRET', str(details))

    def test_write_contract_is_explicitly_disabled_and_revision_bound(self):
        path = SCRIPT.with_name('stock-contract.json')
        contract = json.loads(path.read_text(encoding='utf8'))
        self.assertEqual(contract['device_id'], 'cudy-wr3000-v1-r31-2.4.19')
        self.assertFalse(contract['development_guards']['allow_stock_write_requests'])
        self.assertEqual(
            contract['quick_setup']['qsetup.set_conf']['observed_first_argument_fields'],
            ['workmode', 'timezone', 'zonename', 'cellular', 'iptv', 'wan', 'wifi']
        )
        self.assertTrue(all(not operation['executable'] for operation in contract['quick_setup'].values()))

    def test_wizard_template_evidence_drops_untrusted_content(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'usr/lib/lua/luci/view/wizard.htm'
            path.parent.mkdir(parents=True)
            path.write_text(
                '<script src="/luci-static/bootstrap/js/cbi.js"></script>'
                '<script>var qsetup = {set_conf: "some-value",'
                'password: "private-admin-secret", apply: true};'
                'var url="/cgi-bin/luci/rpc/app";</script>'
                '<form method="POST"><input name="password" value="secret"></form>',
                encoding='utf8')
            evidence = module.inspect_stock_wizard_template(pathlib.Path(folder))
            self.assertEqual(evidence['status'], 'parsed_html_structural_only')
            self.assertEqual(evidence['call_site_occurrences']['set_conf'], 1)
            self.assertEqual(evidence['safe_static_routes'], ['/cgi-bin/luci/rpc/app'])
            self.assertIn('qsetup', evidence['candidate_identifiers'])
            self.assertNotIn('private-admin-secret', str(evidence))
            self.assertNotIn('value=', str(evidence))

    def test_sysauth_fields_are_reported_without_values(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'usr/lib/lua/luci/view/themes/bootstrap/sysauth.htm'
            path.parent.mkdir(parents=True)
            path.write_text(
                '<form action="/cgi-bin/luci/admin/wizard" method="POST">'
                '<input name="luci_password" value="SECRET-NEVER-LOG">'
                '<input name="salt" value="SALT-DO-NOT-LOG">'
                '<input name="_csrf" value="CSRF-NEVER-LOG">'
                '</form>', encoding='utf8'
            )
            report = module.inspect_stock_auth_templates(pathlib.Path(folder))
            item = report['usr/lib/lua/luci/view/themes/bootstrap/sysauth.htm']
            self.assertEqual(item['input_names'], ['_csrf', 'luci_password', 'salt'])
            self.assertIn('/cgi-bin/luci/admin/wizard', item['known_paths'])
            self.assertNotIn('SECRET-NEVER-LOG', str(report))
            self.assertNotIn('SALT-DO-NOT-LOG', str(report))
            self.assertNotIn('CSRF-NEVER-LOG', str(report))

    def test_crypto_login_fingerprint_is_secret_free(self):
        with tempfile.TemporaryDirectory() as folder:
            script = pathlib.Path(folder) / 'www/luci-static/bootstrap/js/sysauth.js'
            script.parent.mkdir(parents=True)
            script.write_text(
                'var x = sha256($("luci_password").val() + $("salt").val());'
                'var y = sha256($("luci_password").val() + $("token").val());'
                'var password = "MY-SENSITIVE-PASSPHRASE";', encoding='utf8'
            )
            templates = module.inspect_stock_auth_templates(pathlib.Path(folder))
            entry = templates['www/luci-static/bootstrap/js/sysauth.js']
            self.assertEqual(len(entry['crypto_expression_shapes']), 2)
            self.assertTrue(any('SELECTOR_salt' in x for x in entry['crypto_expression_shapes']))
            self.assertTrue(any('SELECTOR_token' in x for x in entry['crypto_expression_shapes']))
            self.assertNotIn('MY-SENSITIVE-PASSPHRASE', str(entry))

    def test_ios_factory_detection_is_read_only_and_uses_captured_paths(self):
        mobile = SCRIPT.parents[4] / 'mobile/WR3000Probe/Sources'
        swift = (mobile / 'WR3000Probe.swift').read_text(encoding='utf8')
        ui = (mobile / 'WR3000ProbeApp.swift').read_text(encoding='utf8')
        self.assertIn('names.contains("luci_password2")', swift)
        self.assertNotIn('html.contains("cbi-commit-btn")', swift)
        self.assertIn('factory_input_luci_password2_detected;stock_POST_not_captured;write_blocked', swift)
        self.assertNotIn('factory_password_write', swift)
        self.assertNotIn('physicalV1Confirmed', ui)
        self.assertIn('"/cgi-bin/luci/admin/system/status", phase: "identity"', swift)
        self.assertIn('"/cgi-bin/luci/admin/network/lan/status"', swift)
        self.assertIn('"method": "wifi.getstatus"', swift)
        self.assertNotIn('"method": "qsetup.set_conf"', swift)
        self.assertNotIn('"method": "wifi.set_iface"', swift)

    def test_ios_entry_flow_and_redacted_diagnostics(self):
        mobile = SCRIPT.parents[4] / 'mobile/WR3000Probe/Sources'
        swift = (mobile / 'WR3000Probe.swift').read_text(encoding='utf8')
        ui = (mobile / 'WR3000ProbeApp.swift').read_text(encoding='utf8')
        for marker in ('case idle, checking, createPassword, signIn, connected, unknown, unreachable',
                       'func discover(host: String) async',
                       'func signIn(host: String, username: String, password: String) async',
                       'func prepareFactoryPassword(',
                       'validated_offline_write_blocked',
                       'input_names=', 'responseMimeType', 'redirectCategory',
                       'existing_admin_login_form_detected'):
            self.assertIn(marker, swift, marker)
        self.assertIn('case .createPassword:', ui)
        self.assertIn('case .signIn:', ui)
        self.assertIn('case .unreachable:', ui)
        self.assertIn('await probe.discover(host: host)', ui)
        self.assertIn('Подготовить JSON для экспорта', ui)
        self.assertNotIn('await probe.run(', ui)
        self.assertNotIn('func submitFactoryPassword(', swift)

    def test_captured_physical_wizard_fields_and_write_gates(self):
        physical = json.loads(SCRIPT.with_name('physical-wizard-observed.json').read_text())
        self.assertFalse(physical['source']['hardware_revision_verified'])
        self.assertFalse(physical['initial_setup']['initial_password_post_captured'])
        self.assertTrue(physical['implementation_decision']['prioritize_observed_CBI_wizard'])
        self.assertFalse(physical['implementation_decision']['factory_password_write_enabled'])
        self.assertFalse(physical['implementation_decision']['wan_wifi_apply_writes_enabled'])
        steps = {e['kind']: e for e in physical['observed_wizard_steps']}
        self.assertIn('cbid.wireless.wlan00.ssid', steps['wifi']['fields'])
        self.assertIn('cbid.wireless.wlan10.key', steps['wifi']['fields'])

    def test_official_target_is_revision_scoped(self):
        self.assertIn('WR3000-R31-', module.FIRMWARE_NAME)
        self.assertNotIn('WR3000V2', module.FIRMWARE_NAME)
        self.assertTrue(module.SOURCE_URL.startswith('https://www.cudy.com/'))

if __name__ == '__main__':
    unittest.main()
