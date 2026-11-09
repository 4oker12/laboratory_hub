#!/usr/bin/env python3
"""RouterLab AX23 LOCAL software profile backend, without physical hardware.

Independent of vendor authentication and NOT a replacement for real LuCI.
The original browser still performs its genuine stock authentication.
Only chosen hardware-independent model forms are handled here, using durable
software configuration and explicit non-hardware status values.
Never bind beyond loopback, never issue OS network/hardware commands.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import urllib.parse

MAX_REQUEST = 32768
KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,95}$")
FORM_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
PREFIXES = ("wireless_", "network_", "isp_special_", "auto_upgrade_",
            "time_", "smart_connect_", "region_", "internet_", "wifi_",
            "wire_type", "is_set_each_band_separately")
READ_ROUTES = {
    ("quick_setup", "quick_setup"),
    ("network", "wan_ipv4_status"),
    ("network", "wan_ipv4_dynamic"),
    ("wireless", "wireless_2g"),
    ("wireless", "wireless_5g"),
    ("wireless", "region"),
    ("firmware", "upgrade"),
    ("status", "internet"),
    ("status", "all"),
    ("system", "sysmode"),
    ("time", "settings"),
    ("cloud_account", "check_upgrade"),
}
WRITES = {("quick_setup", "quick_setup"),
          ("network", "wan_ipv4_dynamic"),
          ("wireless", "wireless_2g"),
          ("wireless", "wireless_5g"),
          ("time", "settings")}
DEFAULT = {
    "time_timezone": "Europe/Kyiv",
    "time_quicksetup": "on",
    "network_conntype": "dhcp",
    "network_dhcp_conntype": "dhcp",
    "network_dhcp_link_status": "down",
    "network_dhcp_conn_status": "disconnected",
    "network_dhcp_ipaddr": "0.0.0.0",
    "network_dhcp_gateway": "0.0.0.0",
    "network_dhcp_netmask": "0.0.0.0",
    "network_dhcp_pri_dns": "0.0.0.0",
    "network_dhcp_snd_dns": "0.0.0.0",
    "network_dhcp_dns_mode": "dynamic",
    "network_static_conntype": "static",
    "network_pppoe_conntype": "pppoe",
    "wireless_2g_ssid": "RouterLab-AX23-2G",
    "wireless_2g_psk_key": "RouterLabDemo88",
    "wireless_2g_enable": "on",
    "wireless_2g_disabled": "off",
    "wireless_5g_ssid": "RouterLab-AX23-5G",
    "wireless_5g_psk_key": "RouterLabDemo88",
    "wireless_5g_enable": "on",
    "wireless_5g_disabled": "off",
    "smart_connect_smart_enable": "off",
    "auto_upgrade_enable": "off",
    "auto_upgrade_time": 3,
    "isp_special_enable": "off",
    "isp_special_iptv_enable": "off",
    "isp_special_igmp_enable": "off",
    "region_country": "Ukraine",
    "region_support_smart_connect": "on",
    "wire_type": "router",
}


def _valid_value(value):
    if isinstance(value, bool) or value is None:
        return True
    if isinstance(value, str):
        return len(value.encode("utf-8")) <= 512
    if isinstance(value, (float, int)):
        return abs(value) <= 10**10
    if isinstance(value, (dict, list)):
        return len(json.dumps(value)) <= 4096
    return False


class ConfigStore:
    def __init__(self, path):
        self.path = Path(path)
        self._lock = threading.Lock()

    def read(self):
        if not self.path.is_file():
            return dict(DEFAULT)
        with self.path.open(encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict) or raw.get("schema") != 1:
            raise ValueError("UNSUPPORTED_CONFIG_SCHEMA")
        data = raw.get("data")
        if not isinstance(data, dict):
            raise ValueError("INVALID_CONFIG_PAYLOAD")
        return {**DEFAULT, **data}

    def apply(self, patch):
        if not isinstance(patch, dict) or len(patch) > 240:
            raise ValueError("INVALID_MODEL")
        clean = {}
        for key, val in patch.items():
            if (not isinstance(key, str) or
                not KEY_PATTERN.fullmatch(key) or
                not key.startswith(PREFIXES) or
                not _valid_value(val)):
                raise ValueError("INVALID_MODEL_FIELD")
            clean[key] = val
        with self._lock:
            current = self.read()
            current.update(clean)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            payload = {"schema": 1, "data": current}
            raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            if len(raw.encode("utf-8")) > 65536:
                raise ValueError("PROFILE_TOO_LARGE")
            handle = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8",
                                                  dir=self.path.parent, prefix=".softdevice-",
                                                  delete=False)
            try:
                os.chmod(handle.name, 0o600)
                with handle as out:
                    out.write(raw)
                    out.flush()
                    os.fsync(out.fileno())
                os.replace(handle.name, self.path)
            finally:
                if os.path.exists(handle.name):
                    os.unlink(handle.name)
            return current


def response_for(group, form, state):
    if (group, form) == ("quick_setup", "quick_setup"):
        return state
    if (group, form) in {("network", "wan_ipv4_dynamic"),
                         ("wireless", "wireless_2g"),
                         ("wireless", "wireless_5g"),
                         ("time", "settings")}:
        return state
    if group == "network" and form == "wan_ipv4_status":
        return {"conntype": state["network_conntype"],
                "link_status": "down", "conn_status": "disconnected",
                "ipaddr": "0.0.0.0", "gateway": "0.0.0.0",
                "netmask": "0.0.0.0", "pri_dns": "0.0.0.0",
                "snd_dns": "0.0.0.0", "inet_status": "disconnected"}
    if group == "firmware":
        return {"auto_upgrade_enable": state["auto_upgrade_enable"],
                "new_firmware": False, "upgrade_status": "idle"}
    if group == "status":
        return {"internet_status": "disconnected", "wan_status": "down",
                "connection_status": "disconnected", "hardware_present": False}
    if group == "system":
        return {"mode": "router", "sysmode": "router"}
    if group == "wireless" and form == "region":
        return {"country": state.get("region_country", "Ukraine")}
    if group == "cloud_account":
        return {"has_new_version": False}
    return {}


def handler_factory(store, allowed_origin, key):
    class Handler(BaseHTTPRequestHandler):
        server_version = "RouterLab-AX23-SoftDevice/1"
        sys_version = ""

        def log_message(self, fmt, *args):
            # No payloads, URLs, cookies, secrets or config data in logs.
            return

        def _origin_ok(self):
            return self.headers.get("Origin") == allowed_origin

        def _auth_ok(self):
            return (self._origin_ok() and
                    self.headers.get("X-RouterLab-Key") == key and
                    self.headers.get("Content-Type", "").startswith("application/json"))

        def _respond(self, status, body, cors=True):
            blob = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if cors and self._origin_ok():
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Length", str(len(blob)))
            self.end_headers()
            self.wfile.write(blob)

        def do_OPTIONS(self):
            if self.path != "/v1/form" or not self._origin_ok():
                return self._respond(403, {"success": False, "error": "FORBIDDEN"}, cors=False)
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Access-Control-Allow-Methods", "POST")
            self.send_header("Access-Control-Allow-Headers",
                             "content-type, x-routerlab-key")
            self.send_header("Access-Control-Max-Age", "300")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            if self.path == "/health":
                return self._respond(200, {
                    "status": "running", "mode": "software_only",
                    "hardware": False, "real_luci_auth": "separate_vendor_process",
                }, cors=False)
            return self._respond(404, {"success": False, "error": "NOT_FOUND"}, cors=False)

        def do_POST(self):
            if self.path != "/v1/form" or not self._auth_ok():
                return self._respond(403, {"success": False, "error": "FORBIDDEN"}, cors=False)
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 1 <= size <= MAX_REQUEST:
                    raise ValueError("REQUEST_SIZE")
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError("JSON_OBJECT_REQUIRED")
                group, form, operation = (body.get("group"),
                                          body.get("form"),
                                          body.get("operation", "read"))
                if not all(isinstance(x, str) and FORM_PATTERN.fullmatch(x)
                           for x in (group, form, operation)):
                    raise ValueError("INVALID_ROUTE")
                route = (group, form)
                if route not in READ_ROUTES:
                    return self._respond(404, {"success": False, "error": "UNSUPPORTED_FORM"})
                if operation == "write":
                    if route not in WRITES:
                        raise ValueError("READ_ONLY_FORM")
                    state = store.apply(body.get("data"))
                elif operation == "read":
                    state = store.read()
                else:
                    raise ValueError("INVALID_OPERATION")
                self._respond(200, {"success": True,
                                    "data": response_for(group, form, state),
                                    "routerlab": {"mode": "software_only",
                                                  "hardware_applied": False}})
            except (ValueError, json.JSONDecodeError, TypeError):
                self._respond(400, {"success": False, "error": "INVALID_MODEL"})
            except (OSError, UnicodeError):
                self._respond(503, {"success": False, "error": "STORE_UNAVAILABLE"})
    return Handler


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--origin", type=str, required=True)
    p.add_argument("--key-file", type=Path, required=True)
    p.add_argument("--profile", type=Path, required=True)
    args = p.parse_args()
    if not (1024 <= args.port <= 65535):
        raise SystemExit("SOFTDEVICE_UNSAFE_PORT")
    if not re.fullmatch(r"http://127[.]0[.]0[.]1:\d{4,5}", args.origin):
        raise SystemExit("SOFTDEVICE_UNSAFE_ORIGIN")
    secret = args.key_file.read_text().strip()
    if len(secret) < 32:
        raise SystemExit("SOFTDEVICE_KEY_TOO_SHORT")
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer(("127.0.0.1", args.port),
                                 handler_factory(ConfigStore(args.profile),
                                                 args.origin, secret))
    print("AX23_SOFTDEVICE=LISTENING_LOCALHOST_ONLY", flush=True)
    server.serve_forever(poll_interval=0.25)


if __name__ == "__main__":
    main()
