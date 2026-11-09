#!/usr/bin/env python3
"""Choose original AX23 MIPS ELF targets for bounded headless Ghidra triage.

No firmware, strings containing credentials, CGI bodies or pseudocode are
emitted. JSON contains only paths under the verified unpacked rootfs, sizes,
SHA256 of selected ELF files, MIPS ELF attributes, and keyword *categories*.
The unmodified firmware stays outside the GitHub repository and artifacts.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

CATEGORIES = ("ubus", "uci", "sysmode", "quick_setup", "network",
              "wireless", "wlan", "wan", "config", "interface")
# Fixed allow-list of native program/library basenames, not arbitrary inputs.
ALLOWED = (
    "uhttpd", "lua", "ubusd", "libuci.so", "libubus.so",
    "libubox.so", "liblua.so", "libjson-c.so", "libuhttpd.so",
)


def category_hits(data):
    printable = re.findall(rb"[\x20-\x7e]{4,128}", data)
    text = " ".join(x.decode("ascii", "ignore").lower() for x in printable)
    return [w for w in CATEGORIES if w in text]


def scan(root, output, target_dir):
    root = root.resolve(strict=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    target_dir.mkdir(parents=True, exist_ok=True)
    candidates = []
    for p in root.rglob("*"):
        if p.is_symlink() or not p.is_file():
            continue
        try:
            if p.stat().st_size > 7_000_000 or p.stat().st_size < 52:
                continue
            with p.open("rb") as stream:
                elf = stream.read(52)
            if elf[:4] != b"\x7fELF" or elf[4] != 1 or elf[5] != 1:
                continue
            emachine = int.from_bytes(elf[18:20], "little")
            if emachine != 8:  # EM_MIPS
                continue
            basename = p.name
            if not any(basename == a or (a.startswith("lib") and basename.startswith(a + ".")) for a in ALLOWED):
                continue
            priority = next((i for i, a in enumerate(ALLOWED)
                             if basename == a or (a.startswith("lib") and basename.startswith(a + "."))), 99)
            candidates.append((priority, p.relative_to(root).as_posix(), p))
        except (OSError, ValueError):
            continue
    candidates.sort(key=lambda t: (t[0], t[1]))
    selected = []
    seen_prefix = set()
    for priority, rel, src in candidates:
        prefix = ALLOWED[priority]
        if prefix in seen_prefix or len(selected) >= 6:
            continue
        seen_prefix.add(prefix)
        data = src.read_bytes()
        name = prefix.replace(".", "_") + ".elf"
        dst = target_dir / name
        shutil.copyfile(src, dst)
        selected.append({
            "original_path": "/" + rel,
            "analysis_copy_name": name,
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "architecture": "MIPS32_LE",
            "keyword_categories": category_hits(data),
        })
    controllers = []
    for rel in ("usr/lib/lua/luci/controller/admin/quick_setup.lua",
                "usr/lib/lua/luci/controller/admin/network.lua",
                "usr/lib/lua/luci/controller/admin/wireless.lua",
                "usr/lib/lua/luci/controller/login.lua"):
        p = root / rel
        if not p.is_file() or p.is_symlink():
            continue
        data = p.read_bytes()
        controllers.append({
            "path": "/" + rel,
            "bytes": len(data),
            "lua_bytecode_magic": data[:4] == b"\x1bLua",
            "lua_version_byte": data[4] if len(data) > 4 else None,
            "keyword_categories": category_hits(data),
        })
    report = {
        "provenance": "original verified AX23(EU) V1 stock rootfs",
        "method": "MIPS ELF headers and fixed allowlisted keyword categories",
        "selected_native_binaries": selected,
        "lua_controller_surfaces": controllers,
        "source_or_disassembly_exported": False,
    }
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print("AX23_NATIVE_ELF_SELECTED=" + str(len(selected)))
    for item in selected:
        print("AX23_NATIVE_ELF_PATH=" + item["original_path"] +
              " KEYWORDS=" + ",".join(item["keyword_categories"]))
    for item in controllers:
        print("AX23_LUA_CONTROLLER=" + item["path"] +
              " BYTECODE=" + str(item["lua_bytecode_magic"]).lower() +
              " KEYWORDS=" + ",".join(item["keyword_categories"]))
    if not selected:
        raise SystemExit("AX23_GHIDRA=NO_MIPS_ELF_TARGETS")


def main():
    a = argparse.ArgumentParser()
    a.add_argument("rootfs", type=Path)
    a.add_argument("output_json", type=Path)
    a.add_argument("target_dir", type=Path)
    args = a.parse_args()
    scan(args.rootfs, args.output_json, args.target_dir)


if __name__ == "__main__":
    main()
