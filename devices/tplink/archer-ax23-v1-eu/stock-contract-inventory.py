#!/usr/bin/env python3
"""Inspect vendor frontend file names, constants and Lua binary string markers.
No simulated backend, no invented endpoint semantics.
"""
from pathlib import Path
import json
import re
import sys

root = Path(sys.argv[1])
out = Path(sys.argv[2])
web = root / "www/webpages"
js_files = [
    "modules/login/initLogin/models.js",
    "modules/login/localLogin/models.js",
    "modules/login/tpLogin/models.js",
    "modules/login/models.js",
    "modules/qs/script.js",
    "modules/advanced/network/internetAdv/script.js",
    "modules/advanced/network/iptvAdv/script.js",
    "modules/advanced/wireless/wirelessSettings/wirelessRouter/script.js",
    "js/libs/tpEncrypt.js",
]
data = {
    "source": "exact extracted official AX23 EU V1 rootfs; static only",
    "httpd": (root / "usr/sbin/uhttpd").is_file(),
    "stock_cgi": (root / "www/cgi-bin/luci").exists(),
    "files": [],
}
for file in js_files:
    p = web / file
    if not p.is_file():
        data["files"].append({"path": file, "exists": False})
        continue
    src = p.read_text(encoding="utf-8", errors="replace")
    # Only literal, non-secret declarative endpoint names or public operation names.
    operations = sorted(set(re.findall(r"\boperation\s*:\s*['\"]([a-zA-Z_][a-zA-Z0-9_\-]{0,45})['\"]", src)))[:35]
    routes = sorted(set(re.findall(r"['\"](/cgi-bin/[a-zA-Z0-9_./?=&-]{1,130})['\"]", src)))[:35]
    proxy = len(re.findall(r"\bProxy\s*\(", src))
    signals = {k: bool(re.search(r"\b" + re.escape(k) + r"\b", src, re.I))
               for k in ["RSA", "AES", "MD5", "encrypt", "session", "stok", "token"]}
    data["files"].append({"path": file, "bytes": p.stat().st_size,
                          "proxy_constructors": proxy, "operation_constants": operations,
                          "literal_cgi_routes": routes, "keyword_presence": signals})
# Bytecode filenames are stock evidence; do not assume a bytecode controller is executable.
for file in [
    "usr/lib/lua/luci/controller/login.lua",
    "usr/lib/lua/luci/controller/admin/quick_setup.lua",
    "usr/lib/lua/luci/controller/admin/network.lua",
    "usr/lib/lua/luci/controller/admin/wireless.lua",
    "usr/lib/lua/luci/controller/admin/iptv.lua",
]:
    p = root / file
    data["files"].append({"path": "/" + file, "exists": p.is_file(),
                          "bytes": p.stat().st_size if p.is_file() else None,
                          "lua_bytecode_magic": p.open("rb").read(4).hex()
                          if p.is_file() else None})
out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
print("STATIC_STOCK_FILE_METADATA_WRITTEN")
print("No client-side crypto algorithm or backend behavior claimed without code-level proof.")
