#!/usr/bin/env python3
"""Read-only evidence of system-service launch candidates in stock AX23 rootfs.

Inventory does not execute any vendor startup script. All output is limited to
fixed system paths / safe allowlisted service basenames, and file existence.
It cannot establish that a service registers a given ubus object at runtime.
"""
import argparse
import json
from pathlib import Path

SERVICES = (
    "ubusd", "uhttpd", "ubus", "netifd", "procd", "rpcd",
    "hostapd", "wpa_supplicant", "dnsmasq", "odhcpd",
    "iwinfo", "sysmode", "wifi", "wireless", "network",
)
EXEC_DIRS = ("/bin", "/sbin", "/usr/bin", "/usr/sbin")
SCRIPT_DIRS = ("/etc/init.d",)
STATIC_CONFIGS = (
    "/etc/config/network", "/etc/config/wireless",
    "/etc/config/dhcp", "/etc/config/iptv",
    "/etc/config/system", "/etc/config/sysmode",
)


def locate(root):
    result = {}
    for service in SERVICES:
        found = []
        for folder in (*EXEC_DIRS, *SCRIPT_DIRS):
            path = root / folder.lstrip("/") / service
            if path.is_file() or path.is_symlink():
                found.append(folder + "/" + service)
        result[service] = found
    return {
        "method": "read_only_verified_stock_rootfs_path_presence",
        "service_candidates": result,
        "static_config_exists": {
            k: (root / k.lstrip("/")).is_file() for k in STATIC_CONFIGS
        },
        "service_processes_started_by_this_scan": 0,
        "service_registration_proven": False,
        "firmware_content_exported": False,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("original_rootfs", type=Path)
    p.add_argument("output_json", type=Path)
    args = p.parse_args()
    result = locate(args.original_rootfs)
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n")
    for name, paths in sorted(result["service_candidates"].items()):
        print("AX23_STOCK_SERVICE_CANDIDATE=" + name +
              " PATHS=" + (",".join(paths) or "NOT_FOUND_AT_STANDARD_PATHS"))
    for name, value in sorted(result["static_config_exists"].items()):
        print("AX23_STOCK_CONFIG_FILE=" + name + " EXISTS=" + str(value).lower())
    print("AX23_STOCK_SERVICE_INVENTORY=READ_ONLY_NO_DAEMONS_STARTED")


if __name__ == "__main__":
    main()
