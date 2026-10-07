#!/usr/bin/env python3
"""Laboratory Hub device dispatcher.

The root CLI owns target selection only. Device behavior stays inside each
versioned device directory so assumptions for one router do not leak into another.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DEVICES_ROOT = ROOT / "devices"


def load_devices() -> dict[str, tuple[dict[str, Any], Path]]:
    devices: dict[str, tuple[dict[str, Any], Path]] = {}
    for manifest_path in sorted(DEVICES_ROOT.glob("*/*/*/device.json")):
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        device_id = str(data["id"])
        if device_id in devices:
            raise SystemExit(f"duplicate device id: {device_id}")
        devices[device_id] = (data, manifest_path.parent)
    return devices


def resolve_device(device_id: str | None) -> tuple[dict[str, Any], Path]:
    devices = load_devices()
    if not devices:
        raise SystemExit("no device manifests found")
    if device_id is None:
        if len(devices) == 1:
            return next(iter(devices.values()))
        raise SystemExit("--device is required when more than one target exists")
    try:
        return devices[device_id]
    except KeyError:
        raise SystemExit(
            f"unknown device {device_id!r}; available: {', '.join(sorted(devices))}"
        )


def run_lifecycle(args: argparse.Namespace) -> int:
    manifest, base = resolve_device(args.device)
    launcher = base / manifest["runtime"]["launcher"]
    cmd = ["bash", str(launcher), args.command]
    if args.rootfs:
        cmd += ["--rootfs", args.rootfs]
    if args.base:
        cmd += ["--base", args.base]
    if args.port is not None:
        cmd += ["--port", str(args.port)]
    if args.profile:
        cmd += ["--profile", args.profile]
    if args.install_deps:
        cmd += ["--install-deps"]
    return subprocess.call(cmd)


def run_client(args: argparse.Namespace) -> int:
    manifest, base = resolve_device(args.device)
    client = base / manifest["runtime"]["client"]
    extra = list(args.client_args)
    if extra and extra[0] == "--":
        extra = extra[1:]
    cmd = [sys.executable, str(client), "--base-url", args.base_url, args.command, *extra]
    return subprocess.call(cmd)


def main() -> int:
    devices = load_devices()
    parser = argparse.ArgumentParser(
        prog="routerlab",
        description="Run one versioned router target from Laboratory Hub.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="list registered router targets")
    info = sub.add_parser("info", help="show one device manifest")
    info.add_argument("--device")

    for name in ("start", "stop", "restart", "status", "reset"):
        p = sub.add_parser(name)
        p.add_argument("--device")
        p.add_argument("--rootfs")
        p.add_argument("--base")
        p.add_argument("--port", type=int)
        p.add_argument("--profile", choices=("factory", "configured"), default="factory")
        p.add_argument("--install-deps", action="store_true")

    for name in ("inspect", "first-run", "service", "configure"):
        p = sub.add_parser(name)
        p.add_argument("--device")
        p.add_argument("--base-url", default="http://127.0.0.1:18090")
        p.add_argument("client_args", nargs=argparse.REMAINDER)

    args = parser.parse_args()

    if args.command == "list":
        for device_id, (manifest, _) in devices.items():
            fw = manifest["firmware"]
            print(
                f"{device_id}\t{manifest['vendor']} {manifest['model']}\t"
                f"{fw['version']} {fw['variant']}"
            )
        return 0

    if args.command == "info":
        manifest, _ = resolve_device(args.device)
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
        return 0

    if args.command in {"start", "stop", "restart", "status", "reset"}:
        return run_lifecycle(args)

    return run_client(args)


if __name__ == "__main__":
    raise SystemExit(main())
