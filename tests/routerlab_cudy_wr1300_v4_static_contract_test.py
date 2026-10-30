#!/usr/bin/env python3
"""Offline evidence-classification regression tests; no network or router."""
import importlib.util
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "tools/routerlab/cudy-wr1300-v4/compare-static.py"
spec = importlib.util.spec_from_file_location("wr1300_compare", MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class StaticContractTest(unittest.TestCase):
    def test_identical_hash_no_runtime_claim(self):
        a = {"present": True, "sha256": "a"}
        self.assertEqual(mod.classification(a, a), "byte-identical")
        report = mod.render(
            {"critical_files": {"a": a}}, {"critical_files": {"a": a}}
        )
        self.assertIn("STATIC_ONLY", report)
        self.assertIn("No physical/router-session support inferred", report)

    def test_changed_absent_new(self):
        a = {"present": True, "sha256": "a"}
        b = {"present": True, "sha256": "b"}
        self.assertEqual(mod.classification(a, b), "byte-different")
        self.assertEqual(mod.classification(a, {}), "absent-on-WR1300")
        self.assertEqual(mod.classification({}, b), "new-on-WR1300")
        self.assertEqual(mod.classification({}, {}), "absent-both")

    def test_snapshot_tree(self):
        ref = {"critical_files": {"qsetup": {"present": True, "sha256": "a"}},
               "luci_contract_tree": {"x": {"sha256": "z"}},
               "qsetup_strings": ["wifi", "dhcp"],
               "release": {"version": "2.4.23"}}
        target = {"critical_files": {"qsetup": {"present": True, "sha256": "b"}},
                  "luci_contract_tree": {"x": {"sha256": "z"},
                                         "y": {"sha256": "k"}},
                  "qsetup_strings": ["wifi", "pppoe"],
                  "release": {"version": "2.5.41"}}
        report = mod.render(ref, target)
        self.assertIn("Identical bytes among shared LuCI paths: 1", report)
        self.assertIn("qsetup added string hints: 1", report)
        self.assertIn("qsetup removed string hints: 1", report)
        self.assertIn("2.5.41", report)

if __name__ == "__main__":
    unittest.main()
