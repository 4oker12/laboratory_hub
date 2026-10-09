#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: probe-legacy-finalizer.sh ROOTFS REPORT_DIR}"
REPORT="${2:?usage: probe-legacy-finalizer.sh ROOTFS REPORT_DIR}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DUMPER="$SCRIPT_DIR/tools/lua51-bytecode-dump.py"

mkdir -p "$REPORT"
[[ -f "$DUMPER" ]] || { echo "missing dumper: $DUMPER" >&2; exit 20; }

dump_one() {
  local rel="$1"
  local f="$ROOTFS/$rel"
  echo "===== /$rel ====="
  if [[ ! -f "$f" ]]; then
    echo "MISSING"
    echo
    return 0
  fi
  file "$f" || true
  echo "--- strings ---"
  strings -a "$f" | grep -E -i     'wizard|guide|show|apply|commit|revert|fork|exec|service|restart|network|wireless|luci|cbi|nextbtn|statuspage|redirect|changes'     | sed -n '1,240p' || true
  echo "--- disassembly ---"
  python3 "$DUMPER" "$f" 2>&1 || true
  echo
}

{
  echo "# Legacy Cudy finalizer evidence"
  echo
  for rel in     usr/lib/lua/luci/model/cbi/network/summary.lua     usr/lib/lua/luci/model/cbi/system/wizard.lua     usr/lib/lua/luci/controller/index.lua     usr/lib/lua/luci/controller/servicectl.lua     usr/lib/lua/luci/dispatcher.lua     usr/lib/lua/luci/cbi.lua
  do
    dump_one "$rel"
  done
} > "$REPORT/legacy-finalizer-bytecode.txt"

{
  echo "# Legacy Cudy finalizer browser templates"
  echo
  for rel in     usr/lib/lua/luci/view/wizard.htm     usr/lib/lua/luci/view/cbi/statuspage.htm     usr/lib/lua/luci/view/cbi/apply_xhr.htm     usr/lib/lua/luci/view/cbi/applyreboot.htm     usr/lib/lua/luci/view/cbi/footer.htm
  do
    f="$ROOTFS/$rel"
    echo "===== /$rel ====="
    if [[ -f "$f" ]]; then
      sed -n '1,2200p' "$f"
    else
      echo "MISSING"
    fi
    echo
  done
} > "$REPORT/legacy-finalizer-templates.txt"

{
  echo "# Rootfs-wide finalizer markers"
  echo
  grep -RInaE     'wizard.{0,80}0|show=0|cbi\.apply|servicectl|fork_apply|fork_exec|apply_needed|statuspage'     "$ROOTFS/usr/lib/lua/luci" "$ROOTFS/www" 2>/dev/null     | sed -n '1,1200p' || true
} > "$REPORT/legacy-finalizer-grep.txt"

echo "legacy_finalizer_probe=$REPORT"
