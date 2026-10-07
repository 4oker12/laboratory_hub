#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: probe-qsetup-contract.sh ROOTFS REPORT_DIR}"
REPORT="${2:?usage: probe-qsetup-contract.sh ROOTFS REPORT_DIR}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
mkdir -p "$REPORT"

proot_cmd=(
  proot -0 -r "$ROOTFS"
  -b /proc
  -b /dev
  -w /
  -q "$QEMU"
)

run_guest() {
  "${proot_cmd[@]}" "$@"
}

{
  echo "# Cudy WR1200 stock qsetup / first-run contract probe"
  echo

  echo "## Module exports: luci.apprpc.qsetup"
  set +e
  run_guest /usr/bin/lua -e '
    local ok,m=pcall(require,"luci.apprpc.qsetup")
    print("require="..tostring(ok))
    if not ok then print(m); os.exit(1) end
    local keys={}
    for k,v in pairs(m) do keys[#keys+1]=k..":"..type(v) end
    table.sort(keys)
    for _,v in ipairs(keys) do print(v) end
  ' 2>&1
  echo "exit=$?"
  set -e
  echo

  echo "## Module exports: luci.gui"
  set +e
  run_guest /usr/bin/lua -e '
    local ok,m=pcall(require,"luci.gui")
    print("require="..tostring(ok))
    if not ok then print(m); os.exit(1) end
    local keys={}
    for k,v in pairs(m) do keys[#keys+1]=k..":"..type(v) end
    table.sort(keys)
    for _,v in ipairs(keys) do print(v) end
  ' 2>&1
  echo "exit=$?"
  set -e
  echo

  echo "## Initial first-run UCI flags"
  for expr in     'luci.main.wizard'     'luci.main.factory'     'system.board.def_type'     'system.board.def_ssid'     'system.board.def_key'     'network.wan.proto'     'network.wan.mode'
  do
    printf '%s=' "$expr"
    set +e
    run_guest /sbin/uci -q get "$expr" 2>/dev/null
    rc=$?
    set -e
    [[ "$rc" -eq 0 ]] || echo "<unset>"
  done
  echo

  echo "## Static qsetup transition evidence"
  strings -a "$ROOTFS/usr/lib/lua/luci/apprpc/qsetup.lua" 2>/dev/null     | grep -E 'wizard|setpasswd|network|wireless|wlan00|wlan10|wan|pppoe|dhcp|commit|fork_apply|revert|mode|dynssid|smart_connect|ssid_isolation'     | head -n 260 || true
  echo

  echo "## Wizard template RPC/submit evidence"
  grep -nE 'wizard_|xhr|url\(|action|method|submit|qsetup|Save & Apply|Next'     "$ROOTFS/usr/lib/lua/luci/view/wizard.htm" 2>/dev/null | head -n 320 || true
  echo

  echo "## qsetup-related browser/static references"
  grep -RInaE 'apprpc/qsetup|qsetup|action_guide|show_wizard|luci\.main\.wizard|wizard.?=.?0'     "$ROOTFS/usr/lib/lua/luci" "$ROOTFS/www" 2>/dev/null | head -n 420 || true
} > "$REPORT/qsetup-contract-probe.txt"

cat "$REPORT/qsetup-contract-probe.txt"
