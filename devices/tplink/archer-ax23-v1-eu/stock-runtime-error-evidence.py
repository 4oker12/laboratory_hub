#!/usr/bin/env python3
"""Classify authentic AX23 stock LuCI exceptions and ubus registry without secrets.

Read ONLY native stderr and original 'ubus list' output. This script does not
modify stock firmware, set up services, or fabricate successful API responses.
Output is allowlisted route names, error classes and object-family presence.
No request/response bodies, token, address or source code is exported.
"""
import argparse
import collections
import json
from pathlib import Path
import re

KNOWN_ROUTES = (
    "/login", "/admin/quick_setup", "/admin/firmware",
    "/admin/network", "/admin/wireless", "/admin/status",
    "/admin/iptv", "/admin/access_control", "/admin/smart_network",
)
OBJECT_CATEGORIES = ("uhttpd", "network", "wireless", "system", "service",
                     "hostapd", "iwinfo", "dnsmasq", "rpcd", "session")


def error_class(fragment):
    text = fragment.lower()
    if "attempt to get length of upvalue" in text and "nil value" in text:
        return "NIL_UPVALUE_LENGTH"
    if "bad argument #1 to 'sub'" in text and "got nil" in text:
        return "STRING_SUB_NIL"
    if "failed to connect to ubus" in text:
        return "UBUS_CONNECT_FAILURE"
    if "sysmode: entry not found" in text:
        return "SYSMODE_ENTRY_NOT_FOUND"
    if "module" in text and "not found" in text:
        return "LUA_MODULE_NOT_FOUND"
    if "attempt to" in text or "exception" in text:
        return "OTHER_LUA_EXCEPTION"
    return "UNCLASSIFIED"


def classify(stderr_text, ubus_list_text):
    lines = stderr_text.splitlines()[:200000]
    routes = collections.Counter()
    errors = collections.Counter()
    route_errors = collections.Counter()
    for i, line in enumerate(lines):
        route_match = re.search(
            r"Failed to execute call dispatcher target for entry '([^']{1,100})'",
            line,
        )
        if route_match:
            route = route_match.group(1)
            if route not in KNOWN_ROUTES:
                route = "OTHER_VENDOR_ROUTE"
            routes[route] += 1
            # Error is usually repeated immediately after 'The called action
            # terminated with an exception:'; do not correlate a distant line.
            near = "\n".join(lines[i+1:i+6])
            kind = error_class(near)
            route_errors[(route, kind)] += 1
    # Standalone errors are useful when no dispatcher route is reported.
    for line in lines:
        kind = error_class(line)
        if kind not in ("UNCLASSIFIED", "OTHER_LUA_EXCEPTION"):
            errors[kind] += 1
    raw_objects = [s.strip() for s in ubus_list_text.splitlines() if s.strip()]
    # Native ubus clients print one object name per line. Do not persist
    # object names or unbounded unknown input in report.
    valid_objects = [s for s in raw_objects if re.fullmatch(r"[a-zA-Z][a-zA-Z0-9._-]{0,80}", s)]
    present = {
        name: any(x == name or x.startswith(name + ".") for x in valid_objects)
        for name in OBJECT_CATEGORIES
    }
    result = {
        "source": "original_stock_uhttpd_stderr_and_ubus_list",
        "ubus_registry_readable": bool(valid_objects),
        "ubus_total_objects": len(valid_objects),
        "ubus_family_present": present,
        "dispatcher_errors": [
            {"route": route, "error_class": kind, "count": count}
            for (route, kind), count in sorted(route_errors.items())
        ],
        "exception_line_counts": dict(sorted(errors.items())),
        "raw_errors_or_tokens_exported": False,
    }
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("stderr_log", type=Path)
    p.add_argument("ubus_registry_file", type=Path)
    p.add_argument("metadata_json", type=Path)
    a = p.parse_args()
    err = a.stderr_log.read_text(errors="replace") if a.stderr_log.is_file() else ""
    reg = a.ubus_registry_file.read_text(errors="replace") if a.ubus_registry_file.is_file() else ""
    output = classify(err, reg)
    a.metadata_json.parent.mkdir(parents=True, exist_ok=True)
    a.metadata_json.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print("AX23_RUNTIME_UBUS_REGISTRY_COUNT=" + str(output["ubus_total_objects"]))
    print("AX23_RUNTIME_UBUS_FAMILIES=" + ",".join(
        f"{k}:{int(v)}" for k, v in sorted(output["ubus_family_present"].items())
    ))
    for x in output["dispatcher_errors"]:
        print(f"AX23_STOCK_CGI_EXCEPTION={x['route']} CLASS={x['error_class']} COUNT={x['count']}")
    print("AX23_STOCK_ERROR_CLASS_COUNTS=" + json.dumps(output["exception_line_counts"], sort_keys=True))
    print("AX23_RUNTIME_ERROR_EVIDENCE=CLASSIFIED_WITHOUT_SECRET_VALUES")


if __name__ == "__main__":
    main()
