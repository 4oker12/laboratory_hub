#!/usr/bin/env python3
"""Install software-device JS only into disposable original AX23 guest frontend.

Original SquashFS and stock frame.js remain byte-for-byte untouched.
The vendor framework is preserved as a prefix, followed by an injected
local-only configuration and RouterLab bridge. No vendor logic is rewritten.
"""
import argparse
import hashlib
import json
from pathlib import Path

MARKER = b"ROUTERLAB_AX23_SOFTDEVICE__"


def install(original, guest, bridge, port, secret_file, enable):
    original = Path(original)
    guest = Path(guest)
    if original.resolve() == guest.resolve() or original.is_symlink() or guest.is_symlink():
        raise ValueError("SOURCE_GUEST_NOT_SEPARATE")
    source = original.read_bytes()
    if b"$.su" not in source and b"su.Connection" not in source:
        raise ValueError("UNEXPECTED_VENDOR_FRAMEWORK")
    if MARKER in source:
        raise ValueError("VENDOR_SOURCE_ALREADY_PATCHED")
    if enable:
        key = Path(secret_file).read_text().strip()
        if len(key) < 32 or len(key) > 256:
            raise ValueError("INVALID_LOCAL_KEY")
        if not 1024 <= int(port) <= 65535:
            raise ValueError("INVALID_LOCAL_PORT")
        config = b"\n;window.__ROUTERLAB_AX23_SOFTDEVICE__=" + json.dumps(
            {"port": int(port), "key": key}, separators=(",", ":")
        ).encode() + b";\n"
        code = Path(bridge).read_bytes()
        result = source + config + code
    else:
        result = source
    guest.parent.mkdir(parents=True, exist_ok=True)
    guest.write_bytes(result)
    guest.chmod(0o644)
    if not guest.read_bytes().startswith(source):
        raise ValueError("VENDOR_PREFIX_MODIFIED")
    if original.read_bytes() != source:
        raise ValueError("STOCK_SOURCE_MODIFIED")
    print("AX23_VENDOR_FRAMEWORK_SHA256=" + hashlib.sha256(source).hexdigest())
    print("AX23_STOCK_SOFTDEVICE=" + ("ENABLED" if enable else "DISABLED"))
    print("AX23_STOCK_ORIGINAL_FRAME_PREFIX=PASS")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--vendor-frame", required=True)
    p.add_argument("--guest-frame", required=True)
    p.add_argument("--bridge", required=True)
    p.add_argument("--port", required=True, type=int)
    p.add_argument("--secret-file", required=True)
    p.add_argument("--mode", choices=("software", "stock"), required=True)
    args = p.parse_args()
    install(args.vendor_frame, args.guest_frame, args.bridge,
            args.port, args.secret_file, args.mode == "software")


if __name__ == "__main__":
    main()
