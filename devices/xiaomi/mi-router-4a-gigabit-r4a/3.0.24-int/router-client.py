#!/usr/bin/env python3
"""RouterLab client for the Xiaomi R4A stock management plane.

This is a development client, not a production subscriber-router controller.

Safety boundary:
- inspect is read-only;
- configure is allowed only against loopback hosts;
- router state comes from the exact stock Xiaomi API;
- no live WAN/link facts are invented when the emulator has no PHY/netifd state.
"""

from __future__ import annotations

import argparse
import hashlib
import http.cookiejar
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


PWDKEY = "a2ffa5c9be07488bbb04a3a47d3c5f6a"
PWD_IV = "64175472480004614961023454661220"
FACTORY_ADMIN = "admin"
HEAVY_FIRST_RUN_TIMEOUT_SECONDS = 35.0


class RouterClientError(RuntimeError):
    pass


def _sha1_text(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


def _stock_password_hash(password: str) -> str:
    return _sha1_text(password + PWDKEY)


def _nonce_password(nonce: str, account_hash: str) -> str:
    return _sha1_text(nonce + account_hash)


def _encrypt_new_password(new_hash: str, account_hash: str) -> str:
    openssl = shutil.which("openssl")
    if not openssl:
        raise RouterClientError(
            "first-run requires openssl inside WSL; run through Run-RouterScenario.ps1"
        )
    proc = subprocess.run(
        [
            openssl,
            "enc",
            "-aes-128-cbc",
            "-K",
            account_hash[:32],
            "-iv",
            PWD_IV,
            "-base64",
            "-A",
        ],
        input=new_hash.encode("ascii"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        raise RouterClientError("openssl failed while preparing stock Xiaomi password")
    return proc.stdout.decode("ascii").strip()


@dataclass(frozen=True)
class RouterIdentity:
    hardware: str
    romversion: str
    inited: int
    routername: str
    language: str

    @classmethod
    def from_init_info(cls, data: dict[str, Any]) -> "RouterIdentity":
        return cls(
            hardware=str(data.get("hardware", "")),
            romversion=str(data.get("romversion", "")),
            inited=int(data.get("inited", 0)),
            routername=str(data.get("routername", "")),
            language=str(data.get("language", "")),
        )


class XiaomiR4AClient:
    def __init__(self, base_url: str, timeout: float = 15.0) -> None:
        parsed = urllib.parse.urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise RouterClientError(f"invalid base URL: {base_url}")
        self.base_url = base_url.rstrip("/")
        self.parsed = parsed
        self.timeout = timeout
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )

    def _request_json(
        self,
        path: str,
        *,
        data: dict[str, str] | None = None,
        query: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        if data is not None and query is not None:
            raise RouterClientError("request cannot contain both POST data and GET query")
        body = None
        headers = {"Host": self.parsed.netloc}
        request_path = path
        if query is not None:
            sep = "&" if "?" in request_path else "?"
            request_path += sep + urllib.parse.urlencode(query)
        if data is not None:
            body = urllib.parse.urlencode(data).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(
            self.base_url + request_path,
            data=body,
            headers=headers,
            method="POST" if body is not None else "GET",
        )
        try:
            with self.opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read()
                status = resp.status
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            raise RouterClientError(
                f"HTTP {exc.code} for {path}: {raw[:300].decode('utf-8', 'replace')}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RouterClientError(f"request failed for {path}: {exc}") from exc

        if status != 200:
            raise RouterClientError(f"HTTP {status} for {path}")
        try:
            value = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise RouterClientError(
                f"non-JSON response for {path}: {raw[:300]!r}"
            ) from exc
        if not isinstance(value, dict):
            raise RouterClientError(f"unexpected JSON shape for {path}")
        return value

    def init_info(self) -> dict[str, Any]:
        return self._request_json("/cgi-bin/luci/api/xqsystem/init_info")

    def identity(self) -> RouterIdentity:
        data = self.init_info()
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"init_info failed: {data}")
        return RouterIdentity.from_init_info(data)

    def factory_login(self) -> tuple[str, str, str]:
        account_hash = _stock_password_hash(FACTORY_ADMIN)
        nonce = f"0_routerlab_{int(time.time())}_1001"
        data = self._request_json(
            "/cgi-bin/luci/api/xqsystem/login",
            query={
                "username": "admin",
                "logtype": "2",
                "password": _nonce_password(nonce, account_hash),
                "nonce": nonce,
                "init": "1",
            },
        )
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(
                f"factory login rejected: code={data.get('code')}"
            )
        token = str(data.get("token", ""))
        guide_url = str(data.get("url", ""))
        if len(token) != 32:
            raise RouterClientError(
                "stock factory login did not return a 32-character stok"
            )
        if "/web/init/guide" not in guide_url:
            raise RouterClientError(
                f"stock factory login returned unexpected guide URL: {guide_url}"
            )
        return token, guide_url, account_hash

    def login(self, password: str) -> str:
        data = self._request_json(
            "/cgi-bin/luci/api/xqsystem/login",
            data={"username": "admin", "password": password, "logtype": "2"},
        )
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"login rejected: code={data.get('code')}")
        token = str(data.get("token", ""))
        if len(token) != 32:
            raise RouterClientError("stock login did not return a 32-character stok")
        return token

    @staticmethod
    def _stok_path(token: str, route: str) -> str:
        if not route.startswith("/api/"):
            raise RouterClientError(f"invalid stock API route: {route}")
        return f"/cgi-bin/luci/;stok={urllib.parse.quote(token, safe='')}{route}"

    def stock_get(self, token: str, route: str) -> dict[str, Any]:
        return self._request_json(self._stok_path(token, route))

    def stock_post(
        self, token: str, route: str, data: dict[str, str]
    ) -> dict[str, Any]:
        return self._request_json(self._stok_path(token, route), data=data)

    def wifi_detail_all(self, token: str) -> dict[str, Any]:
        data = self.stock_get(token, "/api/xqnetwork/wifi_detail_all")
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"wifi_detail_all failed: {data}")
        return data

    def set_wan_dhcp(self, token: str) -> dict[str, Any]:
        data = self.stock_post(
            token,
            "/api/xqnetwork/set_wan",
            {"wanType": "dhcp", "client": "web"},
        )
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"set_wan DHCP failed: {data}")
        return data

    def set_wan_pppoe(
        self,
        token: str,
        *,
        username: str,
        password: str,
    ) -> dict[str, Any]:
        if not username or not password:
            raise RouterClientError("PPPoE username and password are required")
        data = self.stock_post(
            token,
            "/api/xqnetwork/set_wan",
            {
                "wanType": "pppoe",
                "pppoeName": username,
                "pppoePwd": password,
                "client": "web",
            },
        )
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"set_wan PPPoE failed: code={data.get('code')}")
        return data

    def set_router_normal(
        self,
        token: str,
        *,
        router_name: str,
        ssid: str,
        wifi_password: str,
        admin_password: str,
    ) -> dict[str, Any]:
        if not router_name or not ssid or not wifi_password or not admin_password:
            raise RouterClientError(
                "router name, SSID, Wi-Fi password and admin password are required"
            )

        account_hash = _stock_password_hash(FACTORY_ADMIN)
        nonce = f"0_routerlab_{int(time.time()) + 1}_1002"
        new_hash = _stock_password_hash(admin_password)
        new_pwd = _encrypt_new_password(new_hash, account_hash)

        original_timeout = self.timeout
        self.timeout = max(self.timeout, HEAVY_FIRST_RUN_TIMEOUT_SECONDS)
        try:
            data = self.stock_post(
                token,
                "/api/misystem/set_router_normal",
                {
                    "name": router_name,
                    "locale": "Home",
                    "ssid": ssid,
                    "password": wifi_password,
                    "encryption": "mixed-psk",
                    "nonce": nonce,
                    "newPwd": new_pwd,
                    "oldPwd": _nonce_password(nonce, account_hash),
                    "txpwr": "0",
                },
            )
        finally:
            self.timeout = original_timeout
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(
                f"set_router_normal failed: code={data.get('code')}"
            )
        return data

    def set_wifi(
        self,
        token: str,
        *,
        index: int,
        ssid: str,
        password: str,
    ) -> dict[str, Any]:
        if index not in {1, 2}:
            raise RouterClientError("wifi index must be 1 or 2")
        data = self.stock_post(
            token,
            "/api/xqnetwork/set_wifi",
            {
                "wifiIndex": str(index),
                "on": "1",
                "ssid": ssid,
                "pwd": password,
                "encryption": "psk2",
                "channel": "0",
                "bandwidth": "0",
                "hidden": "0",
                "txpwr": "max",
            },
        )
        if int(data.get("code", -1)) != 0:
            raise RouterClientError(f"set_wifi index={index} failed: {data}")
        return data


def _is_loopback_host(hostname: str | None) -> bool:
    if hostname is None:
        return False
    return hostname.lower() in {"localhost", "127.0.0.1", "::1"}


def _wifi_summary(data: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for item in data.get("info", []):
        if not isinstance(item, dict):
            continue
        result.append(
            {
                "ifname": item.get("ifname"),
                "device": item.get("device"),
                "ssid": item.get("ssid"),
                "status": item.get("status"),
                "encryption": item.get("encryption"),
                "hidden": item.get("hidden"),
            }
        )
    return result


def _expected_wifi_map(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in data.get("info", []):
        if not isinstance(item, dict):
            continue
        ifname = str(item.get("ifname", ""))
        if ifname:
            result[ifname] = item
    return result


def _is_ambiguous_transport_error(exc: RouterClientError) -> bool:
    text = str(exc).lower()
    return (
        "http 502" in text
        or "timed out" in text
        or "transport error" in text
        or "request failed" in text
    )


def _verify_first_run_state(
    client: XiaomiR4AClient,
    args: argparse.Namespace,
    *,
    attempts: int = 5,
    delay_seconds: float = 1.5,
) -> tuple[RouterIdentity, dict[str, Any]]:
    last_error: RouterClientError | None = None
    for attempt in range(attempts):
        try:
            identity = client.identity()
            if identity.inited != 1:
                raise RouterClientError(
                    f"first-run state not ready yet: inited={identity.inited}"
                )
            if identity.routername != args.router_name:
                raise RouterClientError(
                    "stock first-run router name read-back does not match"
                )

            token = client.login(args.admin_password)
            wifi = client.wifi_detail_all(token)
            radios = _expected_wifi_map(wifi)
            wl1 = radios.get("wl1", {})
            wl0 = radios.get("wl0", {})
            if not (
                wl1.get("ssid") == args.ssid
                and wl0.get("ssid") == args.ssid + "_5G"
                and wl1.get("password") == args.wifi_password
                and wl0.get("password") == args.wifi_password
            ):
                raise RouterClientError(
                    "stock first-run Wi-Fi read-back does not match requested state"
                )
            return identity, wifi
        except RouterClientError as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(delay_seconds)

    assert last_error is not None
    raise last_error


def command_first_run(args: argparse.Namespace) -> dict[str, Any]:
    client = XiaomiR4AClient(args.base_url, args.timeout)
    if not _is_loopback_host(client.parsed.hostname):
        raise RouterClientError(
            "first-run is intentionally restricted to localhost in RouterLab v1"
        )

    before = client.identity()
    if before.hardware != "R4A":
        raise RouterClientError(
            f"unsupported hardware for this adapter: {before.hardware or 'unknown'}"
        )
    if before.inited == 1:
        try:
            after, wifi = _verify_first_run_state(
                client,
                args,
                attempts=1,
                delay_seconds=0,
            )
        except RouterClientError as exc:
            raise RouterClientError(
                "first-run found an initialized router, but its verified state does "
                "not match the requested RouterLab setup; reset the virtual router "
                "before attempting first-run again"
            ) from exc

        return {
            "operation": "first-run",
            "before": {
                "hardware": before.hardware,
                "romversion": before.romversion,
                "inited": before.inited,
            },
            "factory_login": {
                "status": "not_attempted",
                "reason": "already_initialized_matching_requested_state",
            },
            "actions": {
                "wan_dhcp": {
                    "status": "not_attempted",
                    "reason": "already_initialized_matching_requested_state",
                    "live_link_state": "unknown_not_emulated",
                },
                "set_router_normal": {
                    "transport_ack": "not_attempted",
                    "state_verification": "confirmed",
                    "outcome": "already_completed_verified",
                },
            },
            "after": {
                "inited": after.inited,
                "routername": after.routername,
                "admin_login": "confirmed",
                "wifi_readback": "confirmed",
                "wifi": _wifi_summary(wifi),
            },
        }

    if before.inited != 0:
        raise RouterClientError(
            f"first-run cannot handle unexpected initialized state: {before.inited}"
        )

    token, guide_url, _account_hash = client.factory_login()

    wan_ack = client.set_wan_dhcp(token)

    setup_ack: dict[str, Any] | None = None
    setup_transport_error: RouterClientError | None = None
    try:
        setup_ack = client.set_router_normal(
            token,
            router_name=args.router_name,
            ssid=args.ssid,
            wifi_password=args.wifi_password,
            admin_password=args.admin_password,
        )
    except RouterClientError as exc:
        if not _is_ambiguous_transport_error(exc):
            raise
        setup_transport_error = exc

    try:
        after, wifi = _verify_first_run_state(client, args)
    except RouterClientError:
        if setup_transport_error is not None:
            raise setup_transport_error
        raise

    return {
        "operation": "first-run",
        "before": {
            "hardware": before.hardware,
            "romversion": before.romversion,
            "inited": before.inited,
        },
        "factory_login": {
            "status": "confirmed",
            "stok_length": len(token),
            "guide_url": guide_url,
        },
        "actions": {
            "wan_dhcp": {
                "acknowledged": int(wan_ack.get("code", -1)) == 0,
                "live_link_state": "unknown_not_emulated",
            },
            "set_router_normal": {
                "transport_ack": (
                    "confirmed"
                    if setup_ack is not None and int(setup_ack.get("code", -1)) == 0
                    else "unknown_transport_error"
                ),
                "state_verification": "confirmed",
                "outcome": (
                    "confirmed_by_ack_and_readback"
                    if setup_transport_error is None
                    else "confirmed_by_readback_after_transport_error"
                ),
            },
        },
        "after": {
            "inited": after.inited,
            "routername": after.routername,
            "admin_login": "confirmed",
            "wifi_readback": "confirmed",
            "wifi": _wifi_summary(wifi),
        },
    }


def command_inspect(args: argparse.Namespace) -> dict[str, Any]:
    client = XiaomiR4AClient(args.base_url, args.timeout)
    identity = client.identity()
    result: dict[str, Any] = {
        "operation": "inspect",
        "identity": {
            "hardware": identity.hardware,
            "romversion": identity.romversion,
            "inited": identity.inited,
            "routername": identity.routername,
            "language": identity.language,
        },
    }

    if args.admin_password:
        if identity.inited != 1:
            result["authenticated_read"] = {
                "status": "not_attempted",
                "reason": "router is not initialized",
            }
        else:
            token = client.login(args.admin_password)
            wifi = client.wifi_detail_all(token)
            result["authenticated_read"] = {
                "status": "confirmed",
                "stok_length": len(token),
                "wifi": _wifi_summary(wifi),
            }
    return result


def command_configure(args: argparse.Namespace) -> dict[str, Any]:
    client = XiaomiR4AClient(args.base_url, args.timeout)
    if not _is_loopback_host(client.parsed.hostname):
        raise RouterClientError(
            "configure is intentionally restricted to localhost in RouterLab v1"
        )

    identity = client.identity()
    if identity.hardware != "R4A":
        raise RouterClientError(
            f"unsupported hardware for this adapter: {identity.hardware or 'unknown'}"
        )
    if identity.inited != 1:
        raise RouterClientError(
            "configure v1 expects an initialized router; use the stock factory wizard first"
        )

    token = client.login(args.admin_password)
    before = client.wifi_detail_all(token)

    if args.wan_type == "dhcp":
        wan_ack = client.set_wan_dhcp(token)
        wan_action = "wan_dhcp"
    else:
        if not args.pppoe_username or not args.pppoe_password:
            raise RouterClientError(
                "configure --wan-type pppoe requires --pppoe-username and --pppoe-password"
            )
        wan_ack = client.set_wan_pppoe(
            token,
            username=args.pppoe_username,
            password=args.pppoe_password,
        )
        wan_action = "wan_pppoe"

    wifi24_ack = client.set_wifi(
        token,
        index=1,
        ssid=args.ssid_24,
        password=args.wifi_password,
    )
    wifi5_ack = client.set_wifi(
        token,
        index=2,
        ssid=args.ssid_5,
        password=args.wifi_password,
    )
    after = client.wifi_detail_all(token)

    radios = _expected_wifi_map(after)
    wl1 = radios.get("wl1", {})
    wl0 = radios.get("wl0", {})
    wifi_verified = (
        wl1.get("ssid") == args.ssid_24
        and wl1.get("password") == args.wifi_password
        and wl0.get("ssid") == args.ssid_5
        and wl0.get("password") == args.wifi_password
    )
    if not wifi_verified:
        raise RouterClientError("stock Wi-Fi read-back does not match requested state")

    return {
        "operation": "service" if args.command == "service" else "configure",
        "identity": {
            "hardware": identity.hardware,
            "romversion": identity.romversion,
            "inited": identity.inited,
        },
        "login": {"status": "confirmed", "stok_length": len(token)},
        "before_wifi": _wifi_summary(before),
        "actions": {
            wan_action: {
                "acknowledged": int(wan_ack.get("code", -1)) == 0,
                "configured_type": args.wan_type,
                "credentials_supplied": args.wan_type == "pppoe",
                "live_link_state": "unknown_not_emulated",
            },
            "wifi_24": {"acknowledged": int(wifi24_ack.get("code", -1)) == 0},
            "wifi_5": {"acknowledged": int(wifi5_ack.get("code", -1)) == 0},
        },
        "verification": {
            "wifi_readback": "confirmed",
            "wifi": _wifi_summary(after),
            "wan_live_readback": "not_claimed",
        },
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="RouterLab client for Xiaomi R4A stock firmware"
    )
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:18090",
        help="virtual router URL",
    )
    parser.add_argument("--timeout", type=float, default=15.0)

    sub = parser.add_subparsers(dest="command", required=True)

    first_run_p = sub.add_parser(
        "first-run",
        help="complete the local factory-state Xiaomi wizard through exact stock API",
    )
    first_run_p.add_argument("--router-name", default="RouterLab")
    first_run_p.add_argument("--ssid", required=True)
    first_run_p.add_argument("--wifi-password", required=True)
    first_run_p.add_argument("--admin-password", required=True)
    first_run_p.set_defaults(handler=command_first_run)

    inspect_p = sub.add_parser("inspect", help="read stock identity/state")
    inspect_p.add_argument(
        "--admin-password",
        default=None,
        help="optional lab password for authenticated Wi-Fi read-back",
    )
    inspect_p.set_defaults(handler=command_inspect)

    def add_service_args(target: argparse.ArgumentParser) -> None:
        target.add_argument("--admin-password", required=True)
        target.add_argument(
            "--wan-type",
            choices=("dhcp", "pppoe"),
            default="dhcp",
            help="stock WAN mode to configure",
        )
        target.add_argument("--pppoe-username")
        target.add_argument("--pppoe-password")
        target.add_argument("--ssid-24", required=True)
        target.add_argument("--ssid-5", required=True)
        target.add_argument("--wifi-password", required=True)
        target.set_defaults(handler=command_configure)

    configure_p = sub.add_parser(
        "configure",
        help="legacy name for configured-router service flow",
    )
    add_service_args(configure_p)

    service_p = sub.add_parser(
        "service",
        help="login to an initialized router, apply DHCP/Wi-Fi and verify read-back",
    )
    add_service_args(service_p)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        result = args.handler(args)
    except RouterClientError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
