#!/usr/bin/env python3
"""Isolated unit tests for redacted AX23 LuCI error correlation."""
import importlib.util
import json
from pathlib import Path
import unittest

SCRIPT = (Path(__file__).resolve().parents[3] /
          "devices/tplink/archer-ax23-v1-eu/stock-runtime-error-evidence.py")
spec = importlib.util.spec_from_file_location("ax23error", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RuntimeEvidenceTests(unittest.TestCase):
    def test_routes_and_errors_are_separately_correlated(self):
        raw = """
?:0: attempt to get length of upvalue '?' (a nil value)
Failed to execute call dispatcher target for entry '/admin/quick_setup'.
The called action terminated with an exception:
?:0: attempt to get length of upvalue '?' (a nil value)
stack traceback:
 [C]: in function 'assert'
Failed to execute call dispatcher target for entry '/admin/firmware'.
The called action terminated with an exception:
bad argument #1 to 'sub' (string expected, got nil)
"""
        result = module.classify(raw, "uhttpd\n")
        self.assertEqual(result["ubus_total_objects"], 1)
        self.assertTrue(result["ubus_family_present"]["uhttpd"])
        self.assertFalse(result["ubus_family_present"]["network"])
        self.assertIn({"route": "/admin/quick_setup",
                       "error_class": "NIL_UPVALUE_LENGTH", "count": 1},
                      result["dispatcher_errors"])
        self.assertIn({"route": "/admin/firmware",
                       "error_class": "STRING_SUB_NIL", "count": 1},
                      result["dispatcher_errors"])

    def test_secrets_and_unknown_objects_are_not_emitted(self):
        raw = ("Failed to execute call dispatcher target for entry "
               "'/secret?stok=PRIVATE_TOKEN'.\n"
               "The called action terminated with an exception:\n"
               "attempt to do action with PRIVATE_PASSWORD")
        result = module.classify(raw, "uhttpd\nother-PRIVATE_ROUTER_NAME\n")
        packed = json.dumps(result)
        for secret in ("PRIVATE_TOKEN", "PRIVATE_PASSWORD", "PRIVATE_ROUTER_NAME"):
            self.assertNotIn(secret, packed)
        self.assertEqual(result["dispatcher_errors"][0]["route"], "OTHER_VENDOR_ROUTE")

    def test_empty_registry_does_not_imply_no_services(self):
        result = module.classify("", "")
        self.assertFalse(result["ubus_registry_readable"])
        self.assertEqual(result["ubus_total_objects"], 0)


if __name__ == "__main__":
    unittest.main()
