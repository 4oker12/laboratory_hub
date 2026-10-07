#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: disassemble-stock-lua.sh ROOTFS REPORT_DIR}"
REPORT="${2:?usage: disassemble-stock-lua.sh ROOTFS REPORT_DIR}"
mkdir -p "$REPORT"

{
  echo "# Stock LuCI bytecode disassembly"
  echo
  for rel in \
    usr/lib/lua/luci/dispatcher.lua \
    usr/lib/lua/luci/controller/index.lua \
    usr/lib/lua/luci/controller/network.lua \
    usr/lib/lua/luci/controller/wireless.lua \
    usr/lib/lua/luci/controller/system.lua \
    usr/lib/lua/luci/controller/ppp.lua \
    usr/lib/lua/luci/gui.lua \
    usr/lib/lua/luci/apprpc/qsetup.lua \
    usr/lib/lua/luci/apprpc/system.lua \
    usr/lib/lua/luci/model/cbi/wan/wan.lua \
    usr/lib/lua/luci/model/cbi/wan/config.lua \
    usr/lib/lua/luci/model/cbi/wan/config_detail.lua \
    usr/lib/lua/luci/model/cbi/wireless/config_general.lua \
    usr/lib/lua/luci/model/cbi/wireless/config_combine.lua
  do
    f="$ROOTFS/$rel"
    [[ -f "$f" ]] || continue
    echo "===== /$rel ====="
    file "$f" || true
    set +e
    luac5.1 -l -l "$f" 2>&1
    rc=$?
    set -e
    echo "luac_exit=$rc"
    echo
  done
} > "$REPORT/lua-bytecode-disassembly.txt"

{
  echo "# Plain-text browser contract"
  echo
  for rel in \
    usr/lib/lua/luci/view/themes/bootstrap/sysauth.htm \
    usr/lib/lua/luci/view/wizard.htm \
    www/luci-static/bootstrap/js/sysauth.js \
    usr/lib/lua/luci/view/wan/config.htm \
    usr/lib/lua/luci/view/wan/config_detail.htm
  do
    f="$ROOTFS/$rel"
    [[ -f "$f" ]] || continue
    echo "===== /$rel ====="
    file "$f" || true
    sed -n '1,1600p' "$f"
    echo
  done
} > "$REPORT/browser-contract.txt"

echo "Stock Lua control-flow evidence written to $REPORT"
