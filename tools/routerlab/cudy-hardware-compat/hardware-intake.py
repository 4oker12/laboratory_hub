#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


KEY_FILES = [
    "bin/busybox",
    "www/cgi-bin/luci",
    "usr/lib/lua/luci/dispatcher.lua",
    "usr/lib/lua/luci/controller/index.lua",
    "usr/lib/lua/luci/model/cbi/network/summary.lua",
    "usr/lib/lua/luci/model/cbi/system/wizard.lua",
    "usr/lib/lua/luci/apprpc/qsetup.lua",
    "etc/config/luci",
    "etc/config/network",
    "etc/config/wireless",
    "etc/config/system",
    "etc/board.json",
]

MARKERS = {
    "factory_csrf": re.compile(r'name=["\']?_csrf', re.I),
    "factory_salt": re.compile(r'name=["\']?salt', re.I),
    "wizard": re.compile(r"wizard", re.I),
    "defpasswd": re.compile(r"defpasswd", re.I),
    "summary": re.compile(r"network/summary|summary", re.I),
    "servicectl": re.compile(r"servicectl/restart|servicectl", re.I),
    "qsetup": re.compile(r"qsetup", re.I),
    "fork_apply": re.compile(r"fork_apply", re.I),
    "fork_exec": re.compile(r"fork_exec", re.I),
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run_text(cmd: list[str], timeout: int = 20) -> str:
    try:
        p = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout, check=False)
    except Exception as e:
        return f"<error:{type(e).__name__}:{e}>"
    return (p.stdout + p.stderr).strip()


def printable(path: Path, limit: int = 100000) -> str:
    if not path.is_file():
        return ""
    out = run_text(["strings", "-a", str(path)], timeout=30)
    return out[:limit]


def parse_uci(path: Path) -> dict:
    if not path.is_file():
        return {}
    sections: list[dict] = []
    current = None
    for raw in path.read_text(errors="replace").splitlines():
        line = raw.strip()
        m = re.match(r"config\s+([^\s]+)(?:\s+['\"]?([^'\"\s]+))?", line)
        if m:
            current = {"type": m.group(1), "name": m.group(2), "options": {}}
            sections.append(current)
            continue
        m = re.match(r"option\s+([^\s]+)\s+['\"]?(.*?)['\"]?$", line)
        if m and current is not None:
            current["options"][m.group(1)] = m.group(2)
    return {"sections": sections}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("rootfs")
    ap.add_argument("output")
    ap.add_argument("--label", required=True)
    ap.add_argument("--hardware", required=True)
    ap.add_argument("--firmware", required=True)
    args = ap.parse_args()

    root = Path(args.rootfs)
    if not root.is_dir():
        raise SystemExit(f"rootfs not found: {root}")

    key_files = {}
    marker_text = []
    for rel in KEY_FILES:
        p = root / rel
        if p.is_file():
            entry = {
                "present": True,
                "size": p.stat().st_size,
                "sha256": sha256(p),
                "file": run_text(["file", "-b", str(p)]),
            }
            key_files[rel] = entry
            if rel.endswith(".lua") or rel == "www/cgi-bin/luci":
                marker_text.append(printable(p))
        else:
            key_files[rel] = {"present": False}

    # Pull in a bounded set of LuCI scripts/templates that can expose routes/forms.
    luci_root = root / "usr/lib/lua/luci"
    luci_files = []
    if luci_root.is_dir():
        for p in sorted(luci_root.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(root).as_posix()
            if any(x in rel for x in ("/controller/", "/model/cbi/", "/view/")):
                luci_files.append(rel)
                if len(marker_text) < 600:
                    marker_text.append(printable(p, limit=20000))

    text = "\n".join(marker_text)
    markers = {name: bool(rx.search(text)) for name, rx in MARKERS.items()}

    busybox = root / "bin/busybox"
    busybox_file = run_text(["file", "-b", str(busybox)]) if busybox.is_file() else ""
    if "MIPS" in busybox_file:
        arch_family = "mips"
    elif "ARM" in busybox_file or "aarch64" in busybox_file.lower():
        arch_family = "arm"
    elif "x86-64" in busybox_file or "Intel 80386" in busybox_file:
        arch_family = "x86"
    else:
        arch_family = "unknown"

    wireless = parse_uci(root / "etc/config/wireless")
    network = parse_uci(root / "etc/config/network")
    luci = parse_uci(root / "etc/config/luci")
    system = parse_uci(root / "etc/config/system")

    wifi_sections = []
    for sec in wireless.get("sections", []):
        opts = sec.get("options", {})
        wifi_sections.append({
            "type": sec.get("type"),
            "name": sec.get("name"),
            "ssid": opts.get("ssid"),
            "device": opts.get("device"),
            "ifname": opts.get("ifname"),
            "encryption": opts.get("encryption"),
            "mode": opts.get("mode"),
        })

    board_json = root / "etc/board.json"
    board = None
    if board_json.is_file():
        try:
            board = json.loads(board_json.read_text(errors="replace"))
        except Exception as e:
            board = {"parse_error": f"{type(e).__name__}: {e}"}

    compatibility_hints = {
        "has_luci_cgi": (root / "www/cgi-bin/luci").is_file(),
        "has_uci": (root / "sbin/uci").is_file(),
        "has_uhttpd": (root / "usr/sbin/uhttpd").is_file(),
        "has_rpcd": (root / "sbin/rpcd").is_file(),
        "has_ubusd": (root / "sbin/ubusd").is_file(),
        "has_summary_cbi": (root / "usr/lib/lua/luci/model/cbi/network/summary.lua").is_file(),
        "has_qsetup": (root / "usr/lib/lua/luci/apprpc/qsetup.lua").is_file(),
        "factory_contract_markers": markers["wizard"] and markers["defpasswd"],
        "apply_contract_markers": markers["summary"] or markers["qsetup"],
        "r26_runtime_arch_candidate": arch_family == "mips",
    }

    result = {
        "label": args.label,
        "hardware": args.hardware,
        "firmware": args.firmware,
        "rootfs": {
            "files": sum(1 for p in root.rglob("*") if p.is_file()),
            "dirs": sum(1 for p in root.rglob("*") if p.is_dir()),
        },
        "busybox_file": busybox_file,
        "arch_family": arch_family,
        "release": {
            "openwrt_release": (root / "etc/openwrt_release").read_text(errors="replace")
                if (root / "etc/openwrt_release").is_file() else None,
            "openwrt_version": (root / "etc/openwrt_version").read_text(errors="replace").strip()
                if (root / "etc/openwrt_version").is_file() else None,
        },
        "board_json": board,
        "key_files": key_files,
        "markers": markers,
        "compatibility_hints": compatibility_hints,
        "wireless": wireless,
        "wireless_summary": wifi_sections,
        "network": network,
        "luci": luci,
        "system": system,
        "luci_contract_file_count": len(luci_files),
        "luci_contract_files": luci_files,
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, sort_keys=True))
    print(json.dumps({
        "label": result["label"],
        "hardware": result["hardware"],
        "firmware": result["firmware"],
        "arch_family": result["arch_family"],
        "busybox_file": result["busybox_file"],
        "markers": result["markers"],
        "compatibility_hints": result["compatibility_hints"],
        "wireless_summary": result["wireless_summary"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
