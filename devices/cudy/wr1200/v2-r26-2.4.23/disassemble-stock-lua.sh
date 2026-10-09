#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: disassemble-stock-lua.sh ROOTFS REPORT_DIR}"
REPORT="${2:?usage: disassemble-stock-lua.sh ROOTFS REPORT_DIR}"
mkdir -p "$REPORT"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DUMPER="$SCRIPT_DIR/tools/lua51-bytecode-dump.py"
[[ -f "$DUMPER" ]] || { echo "bytecode dumper missing: $DUMPER" >&2; exit 20; }


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
    usr/lib/lua/luci/controller/servicectl.lua \
    usr/lib/lua/luci/gui.lua \
    usr/lib/lua/luci/apprpc/qsetup.lua \
    usr/lib/lua/luci/apprpc/system.lua \
    usr/lib/lua/luci/model/cbi/wan/wan.lua \
    usr/lib/lua/luci/model/cbi/wan/config.lua \
    usr/lib/lua/luci/model/cbi/wan/config_detail.lua \
    usr/lib/lua/luci/model/cbi/network/summary.lua \
    usr/lib/lua/luci/model/cbi/system/wizard.lua \
    usr/lib/lua/luci/model/cbi/wireless/config_general.lua \
    usr/lib/lua/luci/model/cbi/wireless/config_combine.lua
  do
    f="$ROOTFS/$rel"
    [[ -f "$f" ]] || continue
    echo "===== /$rel ====="
    file "$f" || true
    echo "--- first 32 bytes ---"
    od -An -tx1 -N32 "$f" || true
    echo "--- target-aware parser ---"
    set +e
    python3 "$DUMPER" "$f" 2>&1
    parser_rc=$?
    set -e
    echo "parser_exit=$parser_rc"
    echo "--- host luac ABI check ---"
    set +e
    luac5.1 -l -l "$f" 2>&1
    host_rc=$?
    set -e
    echo "host_luac_exit=$host_rc"
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
    usr/lib/lua/luci/view/wan/config_detail.htm \
    usr/lib/lua/luci/view/cbi/statuspage.htm \
    usr/lib/lua/luci/view/cbi/apply_xhr.htm \
    usr/lib/lua/luci/view/cbi/applyreboot.htm
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
