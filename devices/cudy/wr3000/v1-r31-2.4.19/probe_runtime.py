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

LUA_DRYRUN = r'''
local ok, q = pcall(require, "luci.apprpc.qsetup")
if not ok or type(q) ~= "table" or type(q.set_conf) ~= "function" then
    io.write("DRYRUN_NO_QSETUP\n")
    os.exit(3)
end

-- Never execute shell commands in the synthetic guest action.
os.execute = function() error("blocked") end
io.popen = function() error("blocked") end

-- WR3000 qsetup captures a local/upvalue 'uci' cursor. In this simulation,
-- swap that dependency for a purely in-memory interface. Never run stock UCI writes.
local fakeUCI = {}
function fakeUCI:get(...) return nil end
function fakeUCI:get_all(...) return {} end
function fakeUCI:set(...) return true end
function fakeUCI:delete(...) return true end
function fakeUCI:save(...) return true end
function fakeUCI:commit(...) return true end
function fakeUCI:revert(...) return true end
function fakeUCI:foreach(...) return nil end
function fakeUCI:cursor(...) return fakeUCI end
_G.uci = fakeUCI
for _,fn in pairs(q) do
    if type(fn) == "function" then
        for i = 1, 32 do
            local name, val = debug.getupvalue(fn, i)
            if not name then break end
            if name == "uci" then
                debug.setupvalue(fn, i, fakeUCI)
                io.write("UCI_UPVALUE_STUBBED\n")
            end
        end
    end
end

local names = {
    "set_workmode", "set_timezone", "set_zonename", "set_autoupgrade",
    "set_cellular", "set_wan", "wifi_set_iface", "wifi_join", "apply"
}
local calls = {}
for _,name in ipairs(names) do
    local n = name
    _G[n] = function(a, b)
        table.insert(calls, n)
        if n == "set_wan" and type(a) == "table" and a.proto == "dhcp" then
            io.write("WAN_DHCP_TABLE\n")
        end
        if n == "wifi_set_iface" and type(a) == "string"
                and type(b) == "table"
                and type(b.ssid) == "string"
                and type(b.key) == "string" then
            if a == "wlan00" then io.write("WIFI_2G_TABLE\n") end
            if a == "wlan10" then io.write("WIFI_5G_TABLE\n") end
        end
        if n == "apply" then io.write("APPLY_INTERCEPTED\n") end
        return true
    end
end

local synthetic = {
    workmode = "router",
    wan = {proto = "dhcp"},
    wifi = {
        wlan00 = {ssid = "RouterLab-2G", key = "SyntheticPass123", encryption = "psk2"},
        wlan10 = {ssid = "RouterLab-5G", key = "SyntheticPass123", encryption = "psk2"},
    },
}
local success, result = pcall(q.set_conf, synthetic)
io.write(success and "DRYRUN_CALL_RETURNED\n" or "DRYRUN_CALL_ERROR\n")
if not success then
    local err = tostring(result)
    if err:find("attempt to index") then
        io.write("DRYRUN_ERR_INDEX\n")
    elseif err:find("attempt to call") then
        io.write("DRYRUN_ERR_CALL\n")
    elseif err:find("module") then
        io.write("DRYRUN_ERR_MODULE\n")
    elseif err:find("blocked") then
        io.write("DRYRUN_ERR_BLOCKED\n")
    else
        io.write("DRYRUN_ERR_OTHER\n")
    end
    for _, name in ipairs({"uci", "luci", "network", "wireless", "wan", "wifi",
                           "sys", "config", "cursor", "model", "os", "require"}) do
        if err:find("'" .. name .. "'", 1, true) then
            io.write("DRYRUN_NIL_"..name.."\n")
        end
    end
    local line = err:match("qsetup%.lua:(%d+)")
    if line and tonumber(line) and tonumber(line) < 50000 then
        io.write("DRYRUN_QSETUP_LINE_"..line.."\n")
    end
end
for _,n in ipairs(calls) do io.write("CALL_"..n.."\n") end
'''

def safe_run(rootfs: Path, qemu: str, name: str, script: str) -> dict:
    # No shell, no WAN, no user device. Expensive guest execution is bounded.
    cmd = ["proot", "-0", "-r", str(rootfs),
           "-b", "/proc", "-b", "/dev",
           "-w", "/", "-q", shutil.which(qemu), "/usr/bin/lua", "-e", script]
    allowed = {"RUNTIME_HELLO", "MODULE_LOAD_OK", "MODULE_LOAD_FAIL"}
    allowed.update({"DRYRUN_NO_QSETUP", "DRYRUN_CALL_RETURNED", "DRYRUN_CALL_ERROR",
                    "WAN_DHCP_TABLE", "WIFI_2G_TABLE", "WIFI_5G_TABLE",
                    "APPLY_INTERCEPTED", "UCI_UPVALUE_STUBBED", "DRYRUN_ERR_INDEX", "DRYRUN_ERR_CALL",
                    "DRYRUN_ERR_MODULE", "DRYRUN_ERR_BLOCKED", "DRYRUN_ERR_OTHER"})
    allowed.update({"EXPORT_" + x for x in
                   ("set_conf", "set_wan", "wifi_set_iface", "apply", "wifi_join")})
    allowed.update({"GLOBAL_" + x for x in
                   ("set_conf", "set_wan", "wifi_set_iface", "apply", "wifi_join")})
    allowed.update({"DRYRUN_NIL_" + name for name in
                    ("uci","luci","network","wireless","wan","wifi",
                     "sys","config","cursor","model","os","require")})
    allowed.update({"CALL_" + x for x in
                   ("set_workmode", "set_timezone", "set_zonename", "set_autoupgrade",
                    "set_cellular", "set_wan", "wifi_set_iface", "wifi_join", "apply")})
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
        markers = [x.strip() for x in p.stdout.splitlines()
                   if x.strip() in allowed or
                   (x.startswith("DRYRUN_QSETUP_LINE_") and
                    x[len("DRYRUN_QSETUP_LINE_"):].isdigit())][:20]
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
              safe_run(rootfs, qemu, "load_qsetup", LUA_REQUIRE),
              safe_run(rootfs, qemu, "qsetup_synthetic_dryrun", LUA_DRYRUN)]
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
