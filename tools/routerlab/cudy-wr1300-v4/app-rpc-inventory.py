#!/usr/bin/env python3
"""Read-only WR1300 stock AppRPC inventory. Never label API behavior validated."""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

TARGET_FILES = [
    "usr/lib/lua/luci/apprpc/qsetup.lua",
    "usr/lib/lua/luci/apprpc/wifi.lua",
    "usr/lib/lua/luci/apprpc/network.lua",
    "usr/lib/lua/luci/apprpc/system.lua",
    "usr/lib/lua/luci/controller/index.lua",
    "usr/lib/lua/luci/dispatcher.lua",
    "usr/lib/lua/luci/model/cbi/wan/wan.lua",
    "usr/lib/lua/luci/model/cbi/wireless/config_combine.lua",
]
HINT = re.compile(
    r"(getstatus|get_aplist|aplist|setstatus|set.*ssid|wifi|wireless|wan|"
    r"pppoe|dhcpv6?|wizard|factory|salt|token|csrf|sysauth|login|"
    r"qsetup|apply|revert|commit|selectwan|wan_port|wlan00|wlan10)",
    re.I,
)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: app-rpc-inventory.py ROOTFS OUTPUT_DIR")
    root, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    if not (root / "usr/lib/lua/luci").is_dir():
        raise SystemExit("not an extracted LuCI stock rootfs")
    out.mkdir(parents=True, exist_ok=True)
    appdir = root / "usr/lib/lua/luci/apprpc"
    app_files = sorted(p.relative_to(root).as_posix()
                       for p in appdir.rglob("*") if p.is_file()) if appdir.is_dir() else []
    result = {"evidence_level": "stock_static_only",
              "warning": "String/constants are not authorization or physical test evidence",
              "apprpc_files": app_files,
              "files": {}}
    for rel in TARGET_FILES:
        p = root / rel
        if not p.is_file():
            result["files"][rel] = {"present": False}
            continue
        binary = p.read_bytes()[:4]
        x = subprocess.run(["strings", "-a", "-n", "4", str(p)],
                           capture_output=True, text=True, check=False, timeout=25)
        hints = []
        for line in x.stdout.splitlines():
            line = line.strip()
            if HINT.search(line) and len(line) <= 140 and line not in hints:
                hints.append(line)
        result["files"][rel] = {
            "present": True,
            "sha256": digest(p),
            "bytes": p.stat().st_size,
            "compiled_lua_51_magic": binary == b"\x1bLua",
            "candidate_constants": hints[:140],
        }
    (out / "APP_RPC_STATIC.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    lines = ["# WR1300 V4 AppRPC/LuCI stock inventory", "",
             "Status: STATIC_ONLY. No API or device behavior validated.", "",
             "## AppRPC files", ""]
    lines.extend("- " + f for f in app_files)
    lines.extend(["", "## Route/method clues", ""])
    for path, data in result["files"].items():
        lines.append("### " + path)
        if not data["present"]:
            lines.append("Not present")
            continue
        lines.append("bytes=%s lua_bytecode=%s" %
                     (data["bytes"], data["compiled_lua_51_magic"]))
        lines.extend("- " + hint.replace("|", "/") for hint in data["candidate_constants"][:65])
        lines.append("")
    lines += ["", "## Next required checks",
              "Capture genuine factory and configured WR1300 HAR:",
              "request method, exact path, parameter names, cookies by name,",
              "response status, and read-after-write. Redact all secrets."]
    (out / "APP_RPC_STATIC.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("V4 AppRPC inventory:", out / "APP_RPC_STATIC.md")
    print("found AppRPC files:", len(app_files))

if __name__ == "__main__":
    main()
