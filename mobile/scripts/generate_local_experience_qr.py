#!/usr/bin/env python3
"""Generate a QR code for a *local development* App Clip experience.

The QR code is only an invocation URL. It does not install an App Clip,
configure Apple signing, or register an experience on the iPhone.
Requires: python3 -m pip install "qrcode[pil]"
"""
from __future__ import annotations

import argparse
import ipaddress
from pathlib import Path
from urllib.parse import urlsplit


LOCAL_EXAMPLE = "https://example.com/connect"


def validate_invocation_url(value: str) -> str:
    parts = urlsplit(value)
    if (parts.scheme != "https" or not parts.hostname or
            parts.username is not None or parts.password is not None or
            parts.port is not None or parts.path != "/connect" or
            parts.query or parts.fragment or not parts.netloc or
            parts.hostname.endswith(".local")):
        raise ValueError("Use an HTTPS URL ending in /connect without query, userinfo, port or fragment")
    try:
        ipaddress.ip_address(parts.hostname)
    except ValueError:
        pass
    else:
        raise ValueError('Use a provider DNS hostname, not a router IP')
    if parts.hostname != parts.hostname.lower():
        raise ValueError("Use a lowercase DNS hostname")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=LOCAL_EXAMPLE,
                        help="Registered HTTPS App Clip local experience URL prefix")
    parser.add_argument("--out", default="routerlab-appclip-local-qr.png")
    args = parser.parse_args()
    try:
        url = validate_invocation_url(args.url)
    except ValueError as exc:
        parser.error(str(exc))
    try:
        import qrcode
    except ImportError as exc:
        raise SystemExit('Install QR dependency: python3 -m pip install "qrcode[pil]"') from exc
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,
                       box_size=12, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    qr.make_image(fill_color="black", back_color="white").save(output)
    print("Local experience URL:", url)
    print("QR image:", output)
    print("Bundle ID: dev.routerlab.mobile.Clip")
    print("Requires a *signed and cached* App Clip on the target iPhone.")


if __name__ == "__main__":
    main()
