#!/usr/bin/env python3
"""Temporarily instrument genuine AX23 LuCI entrypoint in disposable sandbox.

Only injects a read-only diagnostic dofile into the clone of a shebang Lua
CGI script. The original stock entrypoint must be byte-identical before
patching; the extraction root is never modified, and original backend Lua
controllers are never rewritten. Cannot patch a shell script, ELF or symlink.
"""
from pathlib import Path
import argparse
import hashlib

INSTRUMENT = b'dofile("/tmp/ax23-lua-init.lua")\n'


def patch(original: Path, guest: Path):
    if original.is_symlink() or guest.is_symlink():
        raise ValueError("SYMLINK_ORIGINAL_OR_GUEST_REFUSED")
    if not original.is_file() or not guest.is_file():
        raise ValueError("ENTRYPOINT_MISSING")
    if original.resolve() == guest.resolve():
        raise ValueError("ORIGINAL_AND_GUEST_SAME_FILE")
    stock = original.read_bytes()
    if guest.read_bytes() != stock:
        raise ValueError("GUEST_ENTRYPOINT_NOT_IDENTICAL_TO_STOCK")
    first, sep, rest = stock.partition(b"\n")
    if sep != b"\n" or not first.startswith(b"#!"):
        raise ValueError("NOT_A_SHEBANG_SCRIPT")
    shebang = first.lower()
    if b"lua" not in shebang or b"sh" in shebang:
        raise ValueError("NOT_A_DIRECT_LUA_SCRIPT")
    if len(first) > 128 or b"\r" in first:
        raise ValueError("UNEXPECTED_SHEBANG")
    guest.write_bytes(first + sep + INSTRUMENT + rest)
    check = guest.read_bytes()
    if check != first + sep + INSTRUMENT + rest:
        raise ValueError("GUEST_WRITE_VERIFY_FAILED")
    if original.read_bytes() != stock:
        raise ValueError("ORIGINAL_MODIFIED")
    print("AX23_LUA_CGI_ENTRYPOINT_INSTRUMENT=DISPOSABLE_CLONE_ONLY")
    print("AX23_LUA_CGI_ORIGINAL_SHA256=" + hashlib.sha256(stock).hexdigest())
    print("AX23_LUA_CGI_PATCHED_BYTES=" + str(len(check)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("original", type=Path)
    p.add_argument("guest", type=Path)
    args = p.parse_args()
    try:
        patch(args.original, args.guest)
    except (OSError, ValueError) as exc:
        raise SystemExit("AX23_LUA_CGI_ENTRYPOINT_INSTRUMENT=REFUSED_" + str(exc))


if __name__ == "__main__":
    main()
