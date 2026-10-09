#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${ROUTERLAB_CUDY_WEB_WORK:-$HOME/cudy-wr1200-browser-lab}"
RUNTIME="${ROUTERLAB_CUDY_RUNTIME:-$WORK/runtime}"
PORT="${ROUTERLAB_CUDY_PORT:-18093}"
REPORT="${ROUTERLAB_CUDY_REPORT:-$WORK/prehardware-closeout}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
ADMIN_PASSWORD="${ROUTERLAB_CUDY_ADMIN_PASSWORD:-RouterLabAdmin88}"
WIFI_PASSWORD="${ROUTERLAB_CUDY_WIFI_PASSWORD:-RouterLabWifi88}"

mkdir -p "$REPORT"
export ROUTERLAB_CUDY_WEB_WORK="$WORK"
export ROUTERLAB_CUDY_RUNTIME="$RUNTIME"
export ROUTERLAB_CUDY_PORT="$PORT"
export QEMU_MIPSEL="$QEMU"

proot_cmd=(proot -0 -r "$RUNTIME" -b /proc -b /dev -b "$RUNTIME/tmp:/var" -w / -q "$QEMU")
uci_get() { "${proot_cmd[@]}" /sbin/uci -q get "$1" 2>/dev/null || true; }

config_hashes() {
  local out="$1"
  (cd "$RUNTIME"; for rel in etc/config/luci etc/config/network etc/config/wireless etc/config/system; do [[ -f "$rel" ]] && sha256sum "$rel"; done) > "$out"
}

echo "===== 1. FACTORY RESET ====="
bash "$SCRIPT_DIR/cudy-factory-runtime.sh" reset | tee "$REPORT/01-factory-reset.log"
[[ "$(uci_get luci.main.wizard)" == "1" ]] || { echo "ERROR factory_wizard_not_1"; exit 60; }
[[ "$(uci_get luci.sauth.defpasswd)" == "1" ]] || { echo "ERROR factory_defpasswd_not_1"; exit 61; }
echo "PASS factory_state"

echo "===== 2. FULL STOCK BOOTSTRAP ====="
bash "$SCRIPT_DIR/cudy-quick-setup.sh" | tee "$REPORT/02-quick-setup.log"
bash "$SCRIPT_DIR/cudy-verify-configured-state.sh" | tee "$REPORT/02-verify.log"

echo "===== 3. STOCK RESTART PATH CONTRACT ====="
restart_path="$(sed -n 's/^INFO summary_restart_path=//p' "$REPORT/02-quick-setup.log" | tail -n1)"
if [[ -n "$restart_path" && "$restart_path" != "not-rendered" ]]; then
  if [[ "$restart_path" =~ ^/cgi-bin/luci/admin/servicectl/restart/[A-Za-z0-9_,.-]+$ ]]; then
    echo "PASS restart_path_allowlisted=$restart_path"
  else
    echo "ERROR unsafe_restart_path=$restart_path"
    exit 62
  fi
else
  echo "INFO restart_path_not_rendered"
fi

echo "===== 4. IDEMPOTENT RE-RUN ====="
config_hashes "$REPORT/config-before-rerun.sha256"
bash "$SCRIPT_DIR/cudy-quick-setup.sh" | tee "$REPORT/04-rerun.log"
grep -q "^STEP already_configured ok$" "$REPORT/04-rerun.log" || { echo "ERROR configured_rerun_mutated_flow"; exit 63; }
config_hashes "$REPORT/config-after-rerun.sha256"
diff -u "$REPORT/config-before-rerun.sha256" "$REPORT/config-after-rerun.sha256" > "$REPORT/rerun-hash.diff" || { cat "$REPORT/rerun-hash.diff"; echo "ERROR rerun_changed_config"; exit 64; }
echo "PASS configured_rerun_noop"

echo "===== 5. COLD RESTART PERSISTENCE ====="
ROUTERLAB_CUDY_PREPARE=0 ROUTERLAB_CUDY_REPORT="$REPORT/stage3" bash "$SCRIPT_DIR/run-stage3-persistence.sh" | tee "$REPORT/05-persistence.log"

echo "===== 6. FACTORY RESET ROUND TRIP ====="
bash "$SCRIPT_DIR/cudy-factory-runtime.sh" reset | tee "$REPORT/06-factory-reset.log"
[[ "$(uci_get luci.main.wizard)" == "1" ]] || { echo "ERROR reset_roundtrip_wizard"; exit 65; }
[[ "$(uci_get luci.sauth.defpasswd)" == "1" ]] || { echo "ERROR reset_roundtrip_defpasswd"; exit 66; }
factory_body="$REPORT/06-factory.body"
factory_code="$(curl -sS --max-time 8 -o "$factory_body" -w "%{http_code}" "http://127.0.0.1:$PORT/cgi-bin/luci" || true)"
case "$factory_code" in 200|401|403) ;; *) echo "ERROR factory_form_http=$factory_code"; exit 67 ;; esac
grep -q 'name="_csrf"' "$factory_body" || { echo "ERROR factory_csrf_missing"; exit 68; }
grep -q 'name="salt"' "$factory_body" || { echo "ERROR factory_salt_missing"; exit 69; }
echo "PASS factory_reset_roundtrip"

echo "===== 7. SECOND BOOTSTRAP AFTER RESET ====="
bash "$SCRIPT_DIR/cudy-quick-setup.sh" | tee "$REPORT/07-second-bootstrap.log"
bash "$SCRIPT_DIR/cudy-verify-configured-state.sh" | tee "$REPORT/07-second-verify.log"
echo "PASS second_bootstrap"

echo "===== 8. SECRET HYGIENE ====="
if grep -RFn --exclude="*.body" --exclude="*.headers" -- "$ADMIN_PASSWORD" "$REPORT" >/dev/null 2>&1; then
  echo "ERROR admin_password_leaked_to_logs"; exit 70
fi
if grep -RFn --exclude="*.body" --exclude="*.headers" -- "$WIFI_PASSWORD" "$REPORT" >/dev/null 2>&1; then
  echo "ERROR wifi_password_leaked_to_logs"; exit 71
fi
if grep -RIE "Set-Cookie:[[:space:]]*sysauth=[^;<[:space:]]+" "$REPORT" >/dev/null 2>&1; then
  echo "ERROR session_cookie_leaked_to_logs"; exit 72
fi
echo "PASS secret_hygiene"

echo "PREHARDWARE_CLOSEOUT=PASS"
