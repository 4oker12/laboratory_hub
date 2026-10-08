#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


CRITICAL_FILES = [
    "usr/lib/lua/luci/apprpc/qsetup.lua",
    "usr/lib/lua/luci/controller/index.lua",
    "usr/lib/lua/luci/dispatcher.lua",
    "usr/lib/lua/luci/view/wizard.htm",
    "usr/lib/lua/luci/model/cbi/wan/wan.lua",
    "usr/lib/lua/luci/model/cbi/wan/config.lua",
    "usr/lib/lua/luci/model/cbi/wan/config_detail.lua",
    "usr/lib/lua/luci/model/cbi/wireless/config_general.lua",
    "usr/lib/lua/luci/model/cbi/wireless/config_combine.lua",
    "etc/config/luci",
    "etc/config/network",
    "etc/config/wireless",
    "etc/init.d/boot",
]

STRING_KEYWORDS = re.compile(
    r"(wizard|defpasswd|qsetup|fork_apply|fork_exec|commit|revert|"
    r"luci_username|luci_password|csrf|token|salt|workmode|"
    r"wireless|wlan00|wlan10|wan|dhcp|pppoe|summary|guide)",
    re.I,
)

OPTION_RE = re.compile(r"^\s*option\s+([A-Za-z0-9_]+)\s+['\"]?([^'\"\s]+)")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def file_entry(root: Path, rel: str) -> dict:
    p = root / rel
    if not p.is_file():
        return {"present": False}
    return {
        "present": True,
        "size": p.stat().st_size,
        "sha256": sha256(p),
    }


def filtered_strings(path: Path) -> list[str]:
    if not path.is_file():
        return []
    try:
        p = subprocess.run(
            ["strings", "-a", str(path)],
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )
    except Exception:
        return []
    out = []
    seen = set()
    for line in p.stdout.splitlines():
        line = line.strip()
        if not line or not STRING_KEYWORDS.search(line):
            continue
        if len(line) > 240:
            line = line[:240]
        if line not in seen:
            seen.add(line)
            out.append(line)
    return out[:500]


def parse_uci_options(path: Path) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    if not path.is_file():
        return out
    for line in path.read_text(errors="replace").splitlines():
        m = OPTION_RE.match(line)
        if m:
            out.setdefault(m.group(1), []).append(m.group(2))
    return out


def tree_hashes(root: Path, rel_root: str, include_re: re.Pattern[str] | None = None) -> dict:
    base = root / rel_root
    out = {}
    if not base.is_dir():
        return out
    for p in sorted(base.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if include_re and not include_re.search(rel):
            continue
        out[rel] = {"size": p.stat().st_size, "sha256": sha256(p)}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("rootfs")
    ap.add_argument("output")
    ap.add_argument("--label", required=True)
    args = ap.parse_args()

    root = Path(args.rootfs)
    if not root.is_dir():
        raise SystemExit(f"rootfs not found: {root}")

    openwrt_release = root / "etc/openwrt_release"
    openwrt_version = root / "etc/openwrt_version"

    critical = {rel: file_entry(root, rel) for rel in CRITICAL_FILES}

    qsetup = root / "usr/lib/lua/luci/apprpc/qsetup.lua"
    index = root / "usr/lib/lua/luci/controller/index.lua"
    dispatcher = root / "usr/lib/lua/luci/dispatcher.lua"

    snapshot = {
        "label": args.label,
        "rootfs": {
            "files": sum(1 for p in root.rglob("*") if p.is_file()),
            "dirs": sum(1 for p in root.rglob("*") if p.is_dir()),
        },
        "release": {
            "openwrt_release": openwrt_release.read_text(errors="replace") if openwrt_release.is_file() else None,
            "openwrt_version": openwrt_version.read_text(errors="replace").strip() if openwrt_version.is_file() else None,
        },
        "luci_options": parse_uci_options(root / "etc/config/luci"),
        "system_options": parse_uci_options(root / "etc/config/system"),
        "critical_files": critical,
        "qsetup_strings": filtered_strings(qsetup),
        "index_strings": filtered_strings(index),
        "dispatcher_strings": filtered_strings(dispatcher),
        "uci_defaults": tree_hashes(root, "etc/uci-defaults"),
        "luci_contract_tree": tree_hashes(
            root,
            "usr/lib/lua/luci",
            re.compile(r"/(controller|apprpc|model/cbi|view)/"),
        ),
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, indent=2, sort_keys=True))
    print(f"snapshot={out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
