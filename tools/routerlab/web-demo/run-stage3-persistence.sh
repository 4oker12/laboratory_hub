#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${ROUTERLAB_CUDY_WEB_WORK:-$HOME/cudy-wr1200-browser-lab}"
RUNTIME="${ROUTERLAB_CUDY_RUNTIME:-$WORK/runtime}"
PORT="${ROUTERLAB_CUDY_PORT:-18093}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
REPORT="${ROUTERLAB_CUDY_REPORT:-$WORK/prehardware-stage3}"
PREPARE="${ROUTERLAB_CUDY_PREPARE:-1}"

mkdir -p "$REPORT"
export ROUTERLAB_CUDY_WEB_WORK="$WORK"
export ROUTERLAB_CUDY_RUNTIME="$RUNTIME"
export ROUTERLAB_CUDY_PORT="$PORT"
export QEMU_MIPSEL="$QEMU"

config_hashes() {
  local out="$1"
  (
    cd "$RUNTIME"
    for rel in etc/config/luci etc/config/network etc/config/wireless etc/config/system; do
      [[ -f "$rel" ]] && sha256sum "$rel"
    done
  ) > "$out"
}

if [[ "$PREPARE" == "1" ]]; then
  echo "===== PREPARE CONFIGURED STATE ====="
  bash "$SCRIPT_DIR/cudy-factory-runtime.sh" reset | tee "$REPORT/reset.log"
  bash "$SCRIPT_DIR/cudy-quick-setup.sh" | tee "$REPORT/quick-setup.log"
fi

echo "===== VERIFY BEFORE RESTART ====="
bash "$SCRIPT_DIR/cudy-verify-configured-state.sh" | tee "$REPORT/before.log"
config_hashes "$REPORT/config-before.sha256"

echo "===== COLD PROCESS STOP ====="
bash "$SCRIPT_DIR/cudy-factory-runtime.sh" stop | tee "$REPORT/stop.log"
if curl -sS --max-time 1 -o /dev/null "http://127.0.0.1:$PORT/cgi-bin/luci" 2>/dev/null; then
  echo "ERROR management_http_survived_stop"
  exit 50
fi
echo "PASS management_http_down_after_stop"

echo "===== RESTART SAME WRITABLE RUNTIME ====="
bash "$SCRIPT_DIR/cudy-factory-runtime.sh" start | tee "$REPORT/start.log"

echo "===== VERIFY AFTER RESTART ====="
bash "$SCRIPT_DIR/cudy-verify-configured-state.sh" | tee "$REPORT/after.log"
config_hashes "$REPORT/config-after.sha256"

if ! diff -u "$REPORT/config-before.sha256" "$REPORT/config-after.sha256" > "$REPORT/config-hash.diff"; then
  echo "ERROR persisted_config_hash_changed"
  cat "$REPORT/config-hash.diff"
  exit 51
fi
echo "PASS persisted_config_files_byte_identical"

code="$(curl -sS --max-time 8 -D "$REPORT/configured.headers" -o "$REPORT/configured.body" -w "%{http_code}" "http://127.0.0.1:$PORT/cgi-bin/luci" || true)"
echo "configured_http=$code"
case "$code" in 200|302|401|403) ;; *) echo "ERROR configured_luci_unreachable"; exit 52 ;; esac

if grep -q 'name="_csrf"' "$REPORT/configured.body" 2>/dev/null && grep -q 'name="salt"' "$REPORT/configured.body" 2>/dev/null && grep -qi 'Create an administrator password' "$REPORT/configured.body" 2>/dev/null; then
  echo "ERROR factory_form_returned_after_restart"
  exit 53
fi
echo "PASS factory_form_not_returned"

echo "STAGE3_PERSISTENCE=PASS"
