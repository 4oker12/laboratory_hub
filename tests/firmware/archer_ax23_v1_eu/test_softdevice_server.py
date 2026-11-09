#!/usr/bin/env python3
"""Real loopback HTTP tests for RouterLab's AX23 software-config backend."""
import importlib.util
import json
import pathlib
import tempfile
import threading
import urllib.error
import urllib.request
import unittest
from http.server import ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[3]
SRC = ROOT / "devices/tplink/archer-ax23-v1-eu/softdevice-server.py"
spec = importlib.util.spec_from_file_location("routerlab_softdevice", SRC)
svc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(svc)
ORIGIN = "http://127.0.0.1:18023"
KEY = "DEMO_TEST_KEY_" + "1234567890" * 5


class SoftwareDeviceHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.tmp.name) / "device.json"
        self.store = svc.ConfigStore(self.path)
        self.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), svc.handler_factory(self.store, ORIGIN, KEY)
        )
        self.port = self.server.server_address[1]
        self.worker = threading.Thread(target=self.server.serve_forever,
                                       daemon=True)
        self.worker.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=4)
        self.tmp.cleanup()

    def send(self, obj, key=KEY, origin=ORIGIN):
        body = json.dumps(obj).encode()
        req = urllib.request.Request(
            "http://127.0.0.1:%d/v1/form" % self.port,
            data=body, headers={
                "Content-Type": "application/json",
                "Origin": origin,
                "X-RouterLab-Key": key,
            }, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=3) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read())

    def test_native_wizard_software_read_write_persistent(self):
        route = {"group": "quick_setup", "form": "quick_setup"}
        code, before = self.send({**route, "operation": "read"})
        self.assertEqual(code, 200)
        self.assertEqual(before["data"]["network_conntype"], "dhcp")
        patch = {"network_conntype": "pppoe",
                 "wireless_2g_ssid": "RouterLab-QS-Test",
                 "wireless_2g_psk_key": "TEST_ONLY_PASS_123",
                 "auto_upgrade_enable": "off",
                 "time_timezone": "Europe/Kyiv"}
        code, written = self.send({**route, "operation": "write", "data": patch})
        self.assertEqual(code, 200)
        self.assertFalse(written["routerlab"]["hardware_applied"])
        self.assertEqual(self.store.read()["wireless_2g_ssid"], "RouterLab-QS-Test")
        # The persisted software configuration survives a new Store object.
        again = svc.ConfigStore(self.path)
        self.assertEqual(again.read()["network_conntype"], "pppoe")
        code, loaded = self.send({**route, "operation": "read"})
        self.assertEqual(loaded["data"]["wireless_2g_psk_key"], "TEST_ONLY_PASS_123")
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_no_real_wan_link_is_fabricated(self):
        code, status = self.send({
            "group": "network", "form": "wan_ipv4_status", "operation": "read"
        })
        self.assertEqual(code, 200)
        self.assertEqual(status["data"]["link_status"], "down")
        self.assertEqual(status["data"]["ipaddr"], "0.0.0.0")

    def test_denies_unauthenticated_and_cross_origin_writes(self):
        write = {"group": "quick_setup", "form": "quick_setup",
                 "operation": "write", "data": {"network_conntype": "pppoe"}}
        self.assertEqual(self.send(write, key="NOT_VALID")[0], 403)
        self.assertEqual(self.send(write, origin="https://attacker.invalid")[0], 403)
        self.assertFalse(self.path.exists())

    def test_invalid_keys_dont_reach_filesystem(self):
        route = {"group": "quick_setup", "form": "quick_setup", "operation": "write"}
        self.assertEqual(self.send({**route,
            "data": {"../../../etc/passwd": "BAD"}})[0], 400)
        self.assertFalse(self.path.exists())
        self.assertEqual(self.send({**route,
            "data": {"wireless_2g_ssid": "x" * 2000}})[0], 400)

    def test_unknown_form_doesnt_return_success(self):
        code, reply = self.send({"group": "admin", "form": "hidden",
                                 "operation": "read"})
        self.assertEqual(code, 404)
        self.assertFalse(reply["success"])


if __name__ == "__main__":
    unittest.main()
