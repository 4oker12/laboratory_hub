#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: analyze-stock-contract.sh ROOTFS REPORT_DIR}"
REPORT="${2:?usage: analyze-stock-contract.sh ROOTFS REPORT_DIR}"
mkdir -p "$REPORT"

emit_file() {
  local rel="$1"
  local f="$ROOTFS/$rel"
  if [[ -f "$f" ]]; then
    echo "===== /$rel ====="
    sed -n '1,1200p' "$f"
    echo
  else
    echo "===== /$rel (missing in immutable rootfs) ====="
    echo
  fi
}

{
  echo "# Stock contract evidence"
  echo
  echo "This file is generated from the exact extracted Cudy stock rootfs."
  echo

  for rel in     etc/config/uhttpd     etc/config/luci     etc/config/rpcd     etc/uci-defaults/01_network     etc/uci-defaults/30_wlan     etc/uci-defaults/99_fixwan     etc/uci-defaults/99_oem     etc/uci-defaults/98-board     etc/uci-defaults/11_fix_passwd     etc/uci-defaults/40_luci-wireless     etc/uci-defaults/40_luci-business     usr/lib/lua/luci/controller/index.lua     usr/lib/lua/luci/controller/network.lua     usr/lib/lua/luci/controller/wireless.lua     usr/lib/lua/luci/controller/system.lua     usr/lib/lua/luci/controller/ppp.lua     usr/lib/lua/luci/controller/services.lua     usr/lib/lua/luci/controller/servicectl.lua     usr/lib/lua/luci/dispatcher.lua
  do
    emit_file "$rel"
  done
} > "$REPORT/stock-contract-files.txt"

{
  echo "# LuCI route and state-machine candidates"
  echo
  find "$ROOTFS/usr/lib/lua/luci" "$ROOTFS/www" -type f \(       -name '*.lua' -o -name '*.htm' -o -name '*.html' -o -name '*.js'     \) -print0 2>/dev/null     | xargs -0 grep -InaE       'entry\(|call\(|template\(|cbi\(|formvalue\(|auth|login|password|passwd|wizard|quick.?setup|first.?run|initial|setup|wan|pppoe|dhcp|wifi|wireless|ssid|factory|reset|reboot'       2>/dev/null     | sed "s#^$ROOTFS##"     | head -n 4000 || true
} > "$REPORT/stock-contract-grep.txt"

{
  echo "# UCI/bootstrap mutation candidates"
  echo
  grep -RInaE     'uci( |-|\.)|uci:|network\.|wireless\.|system\.|admin|password|passwd|wan|pppoe|dhcp|wifi|ssid|first|init|factory|reset'     "$ROOTFS/etc/uci-defaults" "$ROOTFS/etc/init.d" 2>/dev/null     | sed "s#^$ROOTFS##"     | head -n 4000 || true
} > "$REPORT/bootstrap-grep.txt"

{
  echo "# Executable/runtime dependencies referenced by key controllers"
  echo
  for rel in     usr/lib/lua/luci/controller/index.lua     usr/lib/lua/luci/controller/network.lua     usr/lib/lua/luci/controller/wireless.lua     usr/lib/lua/luci/controller/system.lua     usr/lib/lua/luci/controller/ppp.lua
  do
    f="$ROOTFS/$rel"
    [[ -f "$f" ]] || continue
    echo "===== /$rel ====="
    grep -nE       'sys\.call|sys\.exec|io\.popen|os\.execute|nixio|ubus|uci|/sbin/|/usr/sbin/|/bin/|/usr/bin/'       "$f" || true
    echo
  done
} > "$REPORT/runtime-dependencies.txt"

echo "Stock contract evidence written to $REPORT"
