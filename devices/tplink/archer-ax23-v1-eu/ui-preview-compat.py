#!/usr/bin/env python3
"""Scoped UI-only fallback for the isolated AX23 localhost viewer.

The original stock main.js routes back to login if firmwareProxy fails. In an
unbooted extracted rootfs, /admin/firmware?form=upgrade yields HTTP 500 because
hardware/runtime metadata is absent, even after a successful stock login.

For local UI exploration only, allow the stock client to load its *own* index
module after this one bootstrap read fails. This NEVER fakes an API response,
modifies vendor CGI, bypasses authentication, or claims hardware functionality.

The original stock file is read from the verified unmodified extracted image;
only the disposable guest's single JS file is replaced. 'stock' mode restores
the original file. Refuse unknown vendor JS rather than doing a loose patch.
"""
import pathlib
import sys

OLD = b'fail:function(){a.loadBasicModule("login")},error:function(){a.loadBasicModule("login")}'
NEW = b'fail:function(){a.loadBasicModule("index")},error:function(){a.loadBasicModule("index")}'


def configure(mode: str, original: pathlib.Path, guest: pathlib.Path) -> None:
    if mode not in {"preview", "stock"}:
        raise ValueError("mode must be preview or stock")
    if not original.is_file() or not guest.is_file():
        raise RuntimeError("stock/guest main.js missing")
    if original.resolve() == guest.resolve() or guest.is_symlink():
        raise RuntimeError("refuse to overwrite original or symlink")
    stock = original.read_bytes()
    if stock.count(OLD) != 1:
        raise RuntimeError("unsupported firmware JS contract: exact fallback absent")
    guest.write_bytes(stock.replace(OLD, NEW, 1) if mode == "preview" else stock)
    print(
        "AX23_UI_COMPAT_FIRMWARE_500_FALLBACK="
        + ("PREVIEW_ONLY_STOCK_INDEX_NOT_STOCK_JS" if mode == "preview" else "OFF_ORIGINAL_JS")
    )


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("usage: ui-preview-compat.py preview|stock STOCK_MAIN_JS GUEST_MAIN_JS")
    try:
        configure(sys.argv[1], pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]))
    except (OSError, RuntimeError, ValueError) as exc:
        raise SystemExit("AX23_UI_PREVIEW_PATCH_REFUSED: " + str(exc))
