#!/usr/bin/env python3
"""Correlate original AX23 Lua controller exports to vendor bytecode structure.

All data is read-only: exact official SquashFS bytecode and sanitized runtime
trace from original CGI inside isolated QEMU. Outputs ONLY counts, source line
intervals, and coarse classifications; no Lua text, credentials, tokens, keys,
cookies, request/response bodies or original firmware data are retained.
"""
from pathlib import Path
import argparse
import collections
import importlib.util
import json
import re

HERE = Path(__file__).resolve().parent
PARSER_FILE = HERE / "lua51-controller-structure.py"

STATIC = re.compile(r"AX23_LUA_CONTROLLER_EXPORT_SHAPE=LINE_(\d+)_LAST_(\d+)_NUPS_(\d+)_SOURCE_([A-Z_]+)")
COUNT = re.compile(r"AX23_LUA_CONTROLLER_EXPORTED_CALL_EVENTS=(\d+)")
ERR = re.compile(r"AX23_STOCK_CGI_EXCEPTION=/admin/quick_setup CLASS=([A-Z_]+) COUNT=(\d+)")


def inspect(bytecode: bytes, log: str) -> dict:
    spec = importlib.util.spec_from_file_location("ax23_lua51_structure", PARSER_FILE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    static = module.Parser(bytecode, opaque_vendor_tag9_four_bytes=True).report()
    if not static["complete_parse"] or static["opaque_vendor_tag9_four_byte_probes"] < 1:
        raise ValueError("BYTECODE_STRUCTURE_NOT_VERIFIED")
    protos = {
        (p["line_defined"], p["last_line_defined"]): p["proto_index"]
        for p in static["quick_setup_proto_line_map"]
    }
    matches = STATIC.findall(log)
    exports = {(int(a), int(b)) for a, b, _, _ in matches}
    if not exports:
        raise ValueError("RUNTIME_CONTROLLER_EXPORTS_MISSING")
    valid = sorted((protos[p], p[0], p[1]) for p in exports if p in protos)
    unknown = sorted(p for p in exports if p not in protos)
    not_exported = sorted(
        (idx, start, end) for (start, end), idx in protos.items()
        if (start, end) not in exports
    )
    calls = [int(x) for x in COUNT.findall(log)]
    error_counts = [(c, int(n)) for c, n in ERR.findall(log)]
    result = {
        "source": "verified original AX23 Lua51 bytecode and isolated real LuCI CGI",
        "static_prototypes": len(static["quick_setup_proto_line_map"]),
        "runtime_export_intervals": len(exports),
        "matched_export_intervals": len(valid),
        "matched_export_prototypes": [x[0] for x in valid],
        "nonexported_prototypes": [x[0] for x in not_exported],
        "unknown_runtime_intervals": len(unknown),
        "exported_call_events_reported": calls[-1] if calls else None,
        "quicksetup_error_class_observed": any(
            c == "NIL_UPVALUE_LENGTH" and n > 0 for c, n in error_counts
        ),
        "controller_callsite_identified": False,
        "root_cause_proven": False,
    }
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("original_quick_setup_bytecode", type=Path)
    p.add_argument("sanitized_runtime_report", type=Path)
    p.add_argument("output_json", type=Path)
    a = p.parse_args()
    data = a.original_quick_setup_bytecode.read_bytes()
    runtime = a.sanitized_runtime_report.read_text(errors="replace")
    report = inspect(data, runtime)
    a.output_json.parent.mkdir(parents=True, exist_ok=True)
    a.output_json.write_text(json.dumps(report, sort_keys=True, indent=2) + "\n")
    print("AX23_QS_STATIC_PROTOTYPES=" + str(report["static_prototypes"]))
    print("AX23_QS_RUNTIME_EXPORTED_FUNCTIONS=" + str(report["runtime_export_intervals"]))
    print("AX23_QS_MATCHED_PROTOTYPES=" +
          ",".join(map(str, report["matched_export_prototypes"])))
    print("AX23_QS_NONEXPORTED_PROTOTYPES=" +
          ",".join(map(str, report["nonexported_prototypes"])))
    print("AX23_QS_RUNTIME_EXPORTED_FUNCTION_CALL_EVENTS=" +
          str(report["exported_call_events_reported"]))
    if report["matched_export_intervals"] != report["runtime_export_intervals"] or (
        report["unknown_runtime_intervals"] > 0
    ):
        raise SystemExit("AX23_QS_EXPORTED_TO_STOCK_BYTECODE=UNMATCHED")
    print("AX23_QS_EXPORTED_TO_STOCK_BYTECODE=PASS")
    if not report["quicksetup_error_class_observed"]:
        print("AX23_QS_NIL_UPVALUE_RUNTIME_ERROR=NOT_OBSERVED")
    else:
        print("AX23_QS_NIL_UPVALUE_RUNTIME_ERROR=REPRODUCED")


if __name__ == "__main__":
    main()
