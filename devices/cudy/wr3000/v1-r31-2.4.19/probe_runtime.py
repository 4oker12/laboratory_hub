#!/usr/bin/env python3
"""Read-only original stock Lua runtime check using QEMU user-mode and PRoot.

Do not run configuration methods. All actions are on a temporary extracted
vendor rootfs and never contact a physical router. Raw firmware is not exported.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("wr3000_firmware_reader", HERE / "probe_firmware.py")
firmware = importlib.util.module_from_spec(spec)
spec.loader.exec_module(firmware)

QEMU = {
    (183, True): "qemu-aarch64-static",
    (40, True): "qemu-arm-static",
    (8, True): "qemu-mipsel-static",
    (8, False): "qemu-mips-static",
}

def target_arch(path: Path) -> dict:
    header = path.read_bytes()[:24]
    if len(header) < 20 or header[:4] != b"\x7fELF":
        return {"status": "not_ELF"}
    little = header[5] == 1
    machine = int.from_bytes(header[18:20], "little" if little else "big")
    qemu = QEMU.get((machine, little))
    return {"status": "identified" if qemu else "unsupported_elf",
            "machine": machine, "little_endian": little,
            "qemu_program": qemu}

LUA_REQUIRE = r'''
local ok, mod = pcall(require, "luci.apprpc.qsetup")
if not ok then
    io.write("MODULE_LOAD_FAIL\n")
    os.exit(3)
end
io.write("MODULE_LOAD_OK\n")
if type(mod) == "table" then
    for k,v in pairs(mod) do
        if type(v) == "function" and (
            k == "set_conf" or k == "set_wan" or
            k == "wifi_set_iface" or k == "apply" or k == "wifi_join"
        ) then io.write("EXPORT_"..k.."\n") end
    end
end
for _,k in ipairs({"set_conf","set_wan","wifi_set_iface","apply","wifi_join"}) do
    if type(_G[k]) == "function" then io.write("GLOBAL_"..k.."\n") end
end
'''

def safe_run(rootfs: Path, qemu: str, name: str, script: str) -> dict:
    # No shell, no WAN, no user device. Expensive guest execution is bounded.
    cmd = ["proot", "-0", "-r", str(rootfs),
           "-b", "/proc", "-b", "/dev",
           "-w", "/", "-q", shutil.which(qemu), "/usr/bin/lua", "-e", script]
    allowed = {"RUNTIME_HELLO", "MODULE_LOAD_OK", "MODULE_LOAD_FAIL"}
    allowed.update({"EXPORT_" + x for x in
                   ("set_conf", "set_wan", "wifi_set_iface", "apply", "wifi_join")})
    allowed.update({"GLOBAL_" + x for x in
                   ("set_conf", "set_wan", "wifi_set_iface", "apply", "wifi_join")})
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
        markers = [x.strip() for x in p.stdout.splitlines()
                   if x.strip() in allowed][:20]
        error = p.stderr.lower()
        error_kind = ("missing_guest_library" if "no such file" in error
                      or "not found" in error
                      else "qemu_or_proot" if "proot" in error or "qemu" in error
                      else "other" if p.returncode != 0 else None)
        return {"name": name, "exit_code": p.returncode,
                "safe_markers": markers, "error_class": error_kind}
    except (subprocess.TimeoutExpired, OSError):
        return {"name": name, "status": "timeout_or_spawn_failed"}

def inspect_runtime(rootfs: Path) -> dict:
    candidates = [rootfs / p for p in ("usr/bin/lua", "usr/bin/lua5.1")]
    lua = next((p for p in candidates if p.is_file()), None)
    if lua is None:
        return {"status": "stock_lua_not_found"}
    architecture = target_arch(lua)
    if architecture.get("status") != "identified":
        return {"status": "unsupported_arch", "architecture": architecture}
    qemu = architecture["qemu_program"]
    if not shutil.which("proot") or not shutil.which(qemu):
        return {"status": "runner_dependencies_missing", "architecture": architecture}
    if lua.name != "lua":
        (rootfs / "usr/bin/lua").symlink_to(lua.name)
    checks = [safe_run(rootfs, qemu, "hello", 'print("RUNTIME_HELLO")'),
              safe_run(rootfs, qemu, "load_qsetup", LUA_REQUIRE)]
    return {"status": "checks_executed", "architecture": architecture,
            "checks": checks,
            "network_or_configuration_writes_enabled": False}

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="wr3000-qemu-lab-") as tempdir:
        tmp = Path(tempdir)
        archive = tmp / firmware.FIRMWARE_NAME
        with urllib.request.urlopen(firmware.SOURCE_URL, timeout=90) as response:
            with archive.open("wb") as output:
                shutil.copyfileobj(response, output)
        with zipfile.ZipFile(archive) as z:
            filenames = [p for p in z.namelist() if p.lower().endswith((".bin", ".img"))]
            if not filenames:
                result = {"status": "firmware_binary_missing"}
            else:
                binfile = tmp / "stock.bin"
                with z.open(filenames[0]) as source, binfile.open("wb") as target:
                    shutil.copyfileobj(source, target)
                rootfs = tmp / "rootfs"
                extraction = firmware.extract_firmware(binfile, rootfs)
                if extraction["status"] != "extracted":
                    result = {"status": "rootfs_extraction_failed"}
                else:
                    result = inspect_runtime(rootfs)
    (args.out / "runtime.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf8"
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
