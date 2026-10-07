import importlib.util
import json
import pathlib
import sys
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
CLIENT_PATH = ROOT / "devices" / "xiaomi" / "mi-router-4a-gigabit-r4a" / "3.0.24-int" / "router-client.py"

spec = importlib.util.spec_from_file_location("router_client", CLIENT_PATH)
module = importlib.util.module_from_spec(spec)
sys.modules["router_client"] = module
assert spec.loader is not None
spec.loader.exec_module(module)


class RouterClientTests(unittest.TestCase):
    def test_loopback_write_guard(self):
        self.assertTrue(module._is_loopback_host("127.0.0.1"))
        self.assertTrue(module._is_loopback_host("localhost"))
        self.assertTrue(module._is_loopback_host("::1"))
        self.assertFalse(module._is_loopback_host("192.168.31.1"))
        self.assertFalse(module._is_loopback_host("router.miwifi.com"))

    def test_identity_is_evidence_only(self):
        identity = module.RouterIdentity.from_init_info(
            {
                "hardware": "R4A",
                "romversion": "3.0.24",
                "inited": 1,
                "routername": "Lab",
                "language": "en",
            }
        )
        self.assertEqual(identity.hardware, "R4A")
        self.assertEqual(identity.romversion, "3.0.24")
        self.assertEqual(identity.inited, 1)

    def test_wifi_summary_drops_passwords(self):
        summary = module._wifi_summary(
            {
                "info": [
                    {
                        "ifname": "wl1",
                        "device": "mt7603e.network1",
                        "ssid": "RouterLab24",
                        "password": "secret",
                        "status": "1",
                        "encryption": "psk2",
                        "hidden": "0",
                    }
                ]
            }
        )
        encoded = json.dumps(summary)
        self.assertIn("RouterLab24", encoded)
        self.assertNotIn("secret", encoded)
        self.assertNotIn("password", encoded)



    def test_stock_factory_password_hash_matches_firmware_account(self):
        self.assertEqual(
            module._stock_password_hash("admin"),
            "b3a4190199d9ee7fe73ef9a4942a69fece39a771",
        )

    def test_nonce_password_matches_stock_formula(self):
        nonce = "0_routerlab_1234567890_1001"
        account_hash = module._stock_password_hash("admin")
        expected = module._sha1_text(nonce + account_hash)
        self.assertEqual(module._nonce_password(nonce, account_hash), expected)

    def test_first_run_is_loopback_only(self):
        parser = module.build_parser()
        args = parser.parse_args(
            [
                "--base-url",
                "http://192.168.31.1",
                "first-run",
                "--ssid",
                "Lab",
                "--wifi-password",
                "Password88",
                "--admin-password",
                "AdminPassword88",
            ]
        )
        with self.assertRaises(module.RouterClientError):
            module.command_first_run(args)



    def test_first_run_rerun_recovers_verified_completed_state_without_writes(self):
        class FakeClient:
            parsed = type("Parsed", (), {"hostname": "127.0.0.1"})()

            def identity(self):
                return module.RouterIdentity(
                    "R4A", "3.0.24", 1, "RouterLab", "en"
                )

            def login(self, password):
                self.login_password = password
                return "fedcba9876543210fedcba9876543210"

            def wifi_detail_all(self, token):
                return {
                    "code": 0,
                    "info": [
                        {
                            "ifname": "wl1",
                            "ssid": "RouterLab",
                            "password": "RouterLabWifi88",
                        },
                        {
                            "ifname": "wl0",
                            "ssid": "RouterLab_5G",
                            "password": "RouterLabWifi88",
                        },
                    ],
                }

            def factory_login(self):
                raise AssertionError("rerun recovery must not perform factory login")

            def set_wan_dhcp(self, token):
                raise AssertionError("rerun recovery must not write WAN state")

            def set_router_normal(self, token, **kwargs):
                raise AssertionError("rerun recovery must not write router state")

        parser = module.build_parser()
        args = parser.parse_args(
            [
                "--base-url",
                "http://127.0.0.1:18090",
                "first-run",
                "--router-name",
                "RouterLab",
                "--ssid",
                "RouterLab",
                "--wifi-password",
                "RouterLabWifi88",
                "--admin-password",
                "RouterLabAdmin88",
            ]
        )
        fake = FakeClient()
        with mock.patch.object(module, "XiaomiR4AClient", return_value=fake):
            result = module.command_first_run(args)

        self.assertEqual(result["before"]["inited"], 1)
        self.assertEqual(result["factory_login"]["status"], "not_attempted")
        self.assertEqual(
            result["actions"]["set_router_normal"]["outcome"],
            "already_completed_verified",
        )
        self.assertEqual(
            result["actions"]["set_router_normal"]["state_verification"],
            "confirmed",
        )
        self.assertEqual(result["after"]["inited"], 1)
        self.assertEqual(fake.login_password, "RouterLabAdmin88")

    def test_first_run_rerun_refuses_initialized_mismatching_state_without_writes(self):
        class FakeClient:
            parsed = type("Parsed", (), {"hostname": "127.0.0.1"})()

            def identity(self):
                return module.RouterIdentity(
                    "R4A", "3.0.24", 1, "DifferentRouter", "en"
                )

            def factory_login(self):
                raise AssertionError("mismatch recovery must remain read-only")

            def set_wan_dhcp(self, token):
                raise AssertionError("mismatch recovery must remain read-only")

            def set_router_normal(self, token, **kwargs):
                raise AssertionError("mismatch recovery must remain read-only")

        parser = module.build_parser()
        args = parser.parse_args(
            [
                "--base-url",
                "http://127.0.0.1:18090",
                "first-run",
                "--router-name",
                "RouterLab",
                "--ssid",
                "RouterLab",
                "--wifi-password",
                "RouterLabWifi88",
                "--admin-password",
                "RouterLabAdmin88",
            ]
        )
        with mock.patch.object(module, "XiaomiR4AClient", return_value=FakeClient()):
            with self.assertRaisesRegex(
                module.RouterClientError,
                "does not match the requested RouterLab setup",
            ):
                module.command_first_run(args)

    def test_first_run_recovers_from_ambiguous_transport_error_by_readback(self):
        class FakeClient:
            parsed = type("Parsed", (), {"hostname": "127.0.0.1"})()

            def __init__(self):
                self.identity_calls = 0

            def identity(self):
                self.identity_calls += 1
                if self.identity_calls == 1:
                    return module.RouterIdentity("R4A", "3.0.24", 0, "", "en")
                return module.RouterIdentity(
                    "R4A", "3.0.24", 1, "RouterLab", "en"
                )

            def factory_login(self):
                return (
                    "0123456789abcdef0123456789abcdef",
                    "/cgi-bin/luci/;stok=x/web/init/guide",
                    module._stock_password_hash("admin"),
                )

            def set_wan_dhcp(self, token):
                return {"code": 0}

            def set_router_normal(self, token, **kwargs):
                raise module.RouterClientError(
                    "HTTP 502 for set_router_normal: FastCGI transport error: timed out"
                )

            def login(self, password):
                self.login_password = password
                return "fedcba9876543210fedcba9876543210"

            def wifi_detail_all(self, token):
                return {
                    "code": 0,
                    "info": [
                        {
                            "ifname": "wl1",
                            "ssid": "RouterLab",
                            "password": "RouterLabWifi88",
                        },
                        {
                            "ifname": "wl0",
                            "ssid": "RouterLab_5G",
                            "password": "RouterLabWifi88",
                        },
                    ],
                }

        parser = module.build_parser()
        args = parser.parse_args(
            [
                "--base-url",
                "http://127.0.0.1:18090",
                "first-run",
                "--router-name",
                "RouterLab",
                "--ssid",
                "RouterLab",
                "--wifi-password",
                "RouterLabWifi88",
                "--admin-password",
                "RouterLabAdmin88",
            ]
        )
        fake = FakeClient()
        with mock.patch.object(module, "XiaomiR4AClient", return_value=fake):
            with mock.patch.object(module.time, "sleep"):
                result = module.command_first_run(args)

        action = result["actions"]["set_router_normal"]
        self.assertEqual(action["transport_ack"], "unknown_transport_error")
        self.assertEqual(action["state_verification"], "confirmed")
        self.assertEqual(
            action["outcome"],
            "confirmed_by_readback_after_transport_error",
        )
        self.assertEqual(result["after"]["inited"], 1)
        self.assertEqual(fake.login_password, "RouterLabAdmin88")

    def test_clear_first_run_error_is_not_masked_by_readback(self):
        self.assertTrue(
            module._is_ambiguous_transport_error(
                module.RouterClientError("HTTP 502: FastCGI transport error: timed out")
            )
        )
        self.assertFalse(
            module._is_ambiguous_transport_error(
                module.RouterClientError("set_router_normal failed: code=1529")
            )
        )

    def test_set_router_normal_temporarily_extends_timeout_and_restores_it(self):
        seen = []

        class Probe(module.XiaomiR4AClient):
            def stock_post(self, token, route, data):
                seen.append(self.timeout)
                return {"code": 0}

        client = Probe("http://127.0.0.1:18090", timeout=15.0)
        with mock.patch.object(module, "_encrypt_new_password", return_value="encrypted"):
            result = client.set_router_normal(
                "0123456789abcdef0123456789abcdef",
                router_name="RouterLab",
                ssid="RouterLab",
                wifi_password="RouterLabWifi88",
                admin_password="RouterLabAdmin88",
            )

        self.assertEqual(result["code"], 0)
        self.assertEqual(seen, [module.HEAVY_FIRST_RUN_TIMEOUT_SECONDS])
        self.assertEqual(client.timeout, 15.0)

    def test_pppoe_payload_matches_stock_contract_without_logging_secret(self):
        calls = []

        class Probe(module.XiaomiR4AClient):
            def _request_json(self, path, *, data=None):
                calls.append((path, dict(data or {})))
                return {"code": 0}

        client = Probe("http://127.0.0.1:18090")
        result = client.set_wan_pppoe(
            "0123456789abcdef0123456789abcdef",
            username="lab-user",
            password="lab-secret",
        )
        self.assertEqual(result["code"], 0)
        self.assertEqual(len(calls), 1)
        path, payload = calls[0]
        self.assertIn("/api/xqnetwork/set_wan", path)
        self.assertEqual(payload["wanType"], "pppoe")
        self.assertEqual(payload["pppoeName"], "lab-user")
        self.assertEqual(payload["pppoePwd"], "lab-secret")
        self.assertEqual(payload["client"], "web")

    def test_pppoe_requires_both_credentials(self):
        client = module.XiaomiR4AClient("http://127.0.0.1:18090")
        with self.assertRaises(module.RouterClientError):
            client.set_wan_pppoe(
                "0123456789abcdef0123456789abcdef",
                username="",
                password="x",
            )

    def test_stok_route_is_constrained_to_stock_api(self):
        path = module.XiaomiR4AClient._stok_path(
            "0123456789abcdef0123456789abcdef",
            "/api/xqnetwork/wifi_detail_all",
        )
        self.assertTrue(path.startswith("/cgi-bin/luci/;stok="))
        with self.assertRaises(module.RouterClientError):
            module.XiaomiR4AClient._stok_path("abc", "/etc/passwd")


if __name__ == "__main__":
    unittest.main()
