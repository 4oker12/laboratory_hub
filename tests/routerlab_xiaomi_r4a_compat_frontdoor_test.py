import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "devices" / "xiaomi" / "mi-router-4a-gigabit-r4a" / "3.0.24-int" / "compat-frontdoor.py"

spec = importlib.util.spec_from_file_location("routerlab_compat_frontdoor", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)


class CompatFrontdoorContractTest(unittest.TestCase):
    def test_cgi_response_parser_preserves_status_headers_and_body(self):
        status, headers, body = mod.parse_cgi_response(
            b"Status: 201 Created\r\nContent-Type: application/json\r\nX-Test: yes\r\n\r\n{\"code\":0}"
        )
        self.assertEqual(status, 201)
        self.assertIn(("Content-Type", "application/json"), headers)
        self.assertIn(("X-Test", "yes"), headers)
        self.assertEqual(body, b'{"code":0}')

    def test_cgi_response_parser_does_not_invent_success_without_headers(self):
        status, headers, body = mod.parse_cgi_response(b"raw-no-cgi-headers")
        self.assertEqual(status, 502)
        self.assertEqual(body, b"raw-no-cgi-headers")



    def test_heavy_first_run_route_gets_bounded_extended_fcgi_timeout(self):
        self.assertEqual(
            mod._fcgi_timeout_for_path(
                "/cgi-bin/luci/;stok=abc/api/misystem/set_router_normal",
                8.0,
            ),
            30.0,
        )
        self.assertEqual(
            mod._fcgi_timeout_for_path(
                "/cgi-bin/luci/;stok=abc/api/xqnetwork/wifi_detail_all",
                8.0,
            ),
            8.0,
        )

    def test_ui_guard_marks_only_confirmed_unsupported_qos_routes(self):
        self.assertTrue(
            mod._is_unsupported_ui_path(
                "/cgi-bin/luci/;stok=abc/web/setting/qos"
            )
        )
        self.assertTrue(
            mod._is_unsupported_ui_path(
                "/cgi-bin/luci/;stok=abc/web/prosetting/qos"
            )
        )
        self.assertFalse(
            mod._is_unsupported_ui_path(
                "/cgi-bin/luci/;stok=abc/web/setting/wifi"
            )
        )
        self.assertFalse(
            mod._is_unsupported_ui_path(
                "/cgi-bin/luci/;stok=abc/web/setting/wan"
            )
        )

    def test_ui_guard_injection_is_idempotent_and_keeps_stock_html(self):
        stock = b"<html><head><title>Xiaomi</title></head><body>stock</body></html>"
        guarded = mod._inject_ui_guard(stock)
        self.assertIn(b"stock", guarded)
        self.assertIn(b"/__routerlab/ui-guard.js", guarded)
        self.assertEqual(guarded, mod._inject_ui_guard(guarded))


    def test_wizard_trace_redacts_stok_and_never_logs_request_values(self):
        self.assertEqual(
            mod._redact_route(
                "/cgi-bin/luci/;stok=secret123/api/xqsystem/set_language"
            ),
            "/cgi-bin/luci/;stok=<redacted>/api/xqsystem/set_language",
        )
        fields = mod._request_field_names(
            b"language=english&password=supersecret",
            "application/x-www-form-urlencoded",
            "location=EU",
        )
        self.assertEqual(fields, ["language", "location", "password"])

    def test_wizard_trace_json_summary_keeps_status_fields_but_drops_tokens(self):
        summary = mod._response_summary(
            b'{"code":1511,"msg":"This language isn\'t supported yet.","token":"secret","password":"secret"}',
            "application/json",
        )
        self.assertIn('"code":1511', summary)
        self.assertIn("supported yet", summary)
        self.assertNotIn("token", summary)
        self.assertNotIn("password", summary)
        self.assertNotIn("secret", summary)

    def test_wizard_trace_parses_json_even_when_stock_content_type_is_not_json(self):
        summary = mod._response_summary(
            b'{"code":0,"language":"en","token":"secret"}',
            "text/plain",
        )
        self.assertIn('"code":0', summary)
        self.assertIn('"language":"en"', summary)
        self.assertNotIn("token", summary)
        self.assertNotIn("secret", summary)

    def test_wizard_trace_covers_country_language_login_and_wan(self):
        for path in (
            "/cgi-bin/luci/api/misystem/set_location",
            "/cgi-bin/luci/api/xqsystem/set_language",
            "/cgi-bin/luci/api/xqsystem/login",
            "/cgi-bin/luci/;stok=x/web/init/guide",
            "/cgi-bin/luci/;stok=x/web/setting/wan",
        ):
            self.assertTrue(mod._is_wizard_trace_path(path))

    def test_preinit_stok_allowlist_is_narrow_and_rejects_existing_stok(self):
        allowed = (
            "/cgi-bin/luci/api/xqsystem/get_languages",
            "/cgi-bin/luci/api/xqsystem/get_main_language",
            "/cgi-bin/luci/api/xqsystem/set_language",
            "/cgi-bin/luci/api/xqsystem/set_languages",
            "/cgi-bin/luci/api/misystem/set_location",
            "/cgi-bin/luci/api/xqsystem/set_country_code",
        )
        for path in allowed:
            self.assertIsNotNone(mod._preinit_api_route(path))

        self.assertIsNone(
            mod._preinit_api_route(
                "/cgi-bin/luci/api/xqnetwork/set_wan"
            )
        )
        self.assertIsNone(
            mod._preinit_api_route(
                "/cgi-bin/luci/;stok=abc/api/xqsystem/set_language"
            )
        )

    def test_preinit_stok_path_rewrite_keeps_exact_api_route(self):
        self.assertEqual(
            mod._inject_stok_path(
                "/cgi-bin/luci/api/xqsystem/set_language",
                "0123456789abcdef0123456789abcdef",
            ),
            "/cgi-bin/luci/;stok=0123456789abcdef0123456789abcdef/api/xqsystem/set_language",
        )

    def test_preinit_cookie_helpers_keep_only_cookie_pairs_and_internal_wins(self):
        cookie = mod._cookie_header_from_headers(
            [
                ("Content-Type", "application/json"),
                ("Set-Cookie", "sysauth=abc; Path=/; HttpOnly"),
                ("Set-Cookie", "psp=def; Path=/"),
            ]
        )
        self.assertEqual(cookie, "sysauth=abc; psp=def")
        merged = mod._merge_cookie_headers(
            "foo=1; sysauth=browser",
            "sysauth=internal; psp=def",
        )
        self.assertEqual(merged, "foo=1; sysauth=internal; psp=def")

    def test_factory_nonce_password_matches_router_client_contract(self):
        nonce = "0_routerlab_frontdoor_1700000000_9001"
        account_hash = mod._factory_account_hash()
        self.assertEqual(len(account_hash), 40)
        self.assertEqual(
            mod._sha1_text(nonce + account_hash),
            mod._sha1_text(nonce + mod._sha1_text("admin" + mod.FACTORY_PWDKEY)),
        )

    def test_stock_init_gate_is_symmetric_around_initialized_state(self):
        for path in (
            "/",
            "/cgi-bin/luci",
            "/cgi-bin/luci/",
            "/cgi-bin/luci/web",
            "/cgi-bin/luci/web/",
        ):
            self.assertEqual(mod._stock_init_redirect(path, False), "/init.html")

        self.assertEqual(mod._stock_init_redirect("/init.html", True), "/")
        self.assertIsNone(mod._stock_init_redirect("/init.html", False))
        self.assertIsNone(mod._stock_init_redirect("/", True))
        self.assertIsNone(mod._stock_init_redirect("/init.html", None))

    def test_source_is_transport_only_and_local_by_default(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn('parser.add_argument("--bind", default="127.0.0.1")', source)
        self.assertIn('"/cgi-bin/luci"', source)
        self.assertIn('"--stock-init-gate"', source)
        self.assertIn('"--ui-guard"', source)
        self.assertIn("UNSUPPORTED_UI_SUFFIXES", source)
        self.assertIn('/api/xqsystem/init_info', source)
        self.assertIn("STOCK_ROOT_ENTRY_PATHS", source)
        self.assertIn("_stock_init_redirect", source)
        self.assertNotIn("set_wan_new", source)
        self.assertNotIn("set_wifi", source)
        self.assertNotIn("pppoe_username", source)
        self.assertNotIn("nvram set", source)


if __name__ == "__main__":
    unittest.main()
