#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${ROUTERLAB_CUDY_WEB_WORK:-$HOME/cudy-wr1200-browser-lab}"
RUNTIME="${ROUTERLAB_CUDY_RUNTIME:-$WORK/runtime}"
PORT="${ROUTERLAB_CUDY_PORT:-18093}"
ROOTFS="${ROUTERLAB_CUDY_ROOTFS:?ROUTERLAB_CUDY_ROOTFS is required}"
BOARD="${ROUTERLAB_CUDY_BOARD_NAME:-R26}"
MODEL="${ROUTERLAB_CUDY_MODEL_NAME:-Cudy WR1200 RouterLab}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
REPORT="${ROUTERLAB_CUDY_REPORT:-$WORK/prehardware}"
ADMIN_PASSWORD="${ROUTERLAB_CUDY_ADMIN_PASSWORD:-RouterLabAdmin88}"
LEGACY_PASSWORD="${ROUTERLAB_CUDY_LEGACY_PASSWORD:-admin}"
WIFI_PASSWORD="${ROUTERLAB_CUDY_WIFI_PASSWORD:-RouterLabWifi88}"

mkdir -p "$REPORT"

export ROUTERLAB_CUDY_WEB_WORK="$WORK"
export ROUTERLAB_CUDY_RUNTIME="$RUNTIME"
export ROUTERLAB_CUDY_PORT="$PORT"
export ROUTERLAB_CUDY_ROOTFS="$ROOTFS"
export ROUTERLAB_CUDY_BOARD_NAME="$BOARD"
export ROUTERLAB_CUDY_MODEL_NAME="$MODEL"
export QEMU_MIPSEL="$QEMU"

proot_cmd=(
  proot -0 -r "$RUNTIME"
  -b /proc
  -b /dev
  -b "$RUNTIME/tmp:/var"
  -w /
  -q "$QEMU"
)

uci_get() {
  "${proot_cmd[@]}" /sbin/uci -q get "$1" 2>/dev/null || true
}

config_hashes() {
  local out="$1"
  (
    cd "$RUNTIME"
    for rel in etc/config/luci etc/config/network etc/config/wireless etc/config/system etc/config/rpcd; do
      [[ -f "$rel" ]] && sha256sum "$rel"
    done
  ) > "$out"
}

sanitized_state() {
  echo "board=$BOARD"
  echo "wizard=$(uci_get luci.main.wizard)"
  echo "defpasswd=$(uci_get luci.sauth.defpasswd)"
  echo "sysauth=$(uci_get luci.main.sysauth)"
  echo "workmode=$(uci_get system.board.workmode)"
  echo "wan_proto=$(uci_get network.wan.proto)"
  echo "ssid_2g=$(uci_get wireless.wlan00.ssid)"
  echo "ssid_5g=$(uci_get wireless.wlan10.ssid)"
}

on_exit() {
  local rc=$?
  if [[ "$rc" -ne 0 ]]; then
    {
      echo "PREHARDWARE=FAIL rc=$rc"
      sanitized_state || true
      echo "--- runtime logs ---"
      for f in "$WORK"/logs/*.log; do
        [[ -f "$f" ]] || continue
        echo "### ${f##*/}"
        tail -n 80 "$f" || true
      done
    } > "$REPORT/failure-diagnostic.txt" 2>&1
    cat "$REPORT/failure-diagnostic.txt" || true
  fi
}
trap on_exit EXIT

login_password() {
  local d
  d="$(uci_get luci.sauth.defpasswd)"
  if [[ "$d" == "0" ]]; then
    printf "%s" "$ADMIN_PASSWORD"
  elif [[ -z "$d" ]]; then
    printf "%s" "$LEGACY_PASSWORD"
  else
    return 1
  fi
}

fresh_auth() {
  local label="$1" pw cookie authwork
  pw="$(login_password)" || { echo "ERROR cannot_select_login_contract"; return 1; }
  cookie="$REPORT/$label.cookies"
  authwork="$REPORT/$label-auth"
  ROUTERLAB_CUDY_LOGIN_PASSWORD="$pw" \
  ROUTERLAB_CUDY_COOKIE="$cookie" \
  ROUTERLAB_CUDY_AUTH_WORK="$authwork" \
  ROUTERLAB_CUDY_BASE="http://127.0.0.1:$PORT" \
    bash "$SCRIPT_DIR/cudy-fresh-auth.sh" | tee "$REPORT/$label-auth.log"
  rm -f "$cookie"
}

assert_factory_state() {
  local w d s
  w="$(uci_get luci.main.wizard)"
  d="$(uci_get luci.sauth.defpasswd)"
  s="$(uci_get luci.main.sysauth)"
  [[ "$w" == "1" ]] || { echo "ERROR reset_wizard=$w"; return 1; }
  if [[ "$d" == "1" ]]; then
    echo "PASS factory_auth=create_password"
  elif [[ -z "$d" && " $s " == *" admin "* ]]; then
    echo "PASS factory_auth=legacy_login"
  else
    echo "ERROR unknown_factory_auth_after_reset defpasswd=$d sysauth=$s"
    return 1
  fi
  [[ "$(uci_get network.wan.proto)" == "dhcp" ]] || { echo "ERROR reset_wan_not_dhcp"; return 1; }
  echo "PASS factory_state"
}

echo "===== PRE-HARDWARE / FACTORY ====="
bash "$SCRIPT_DIR/cudy-factory-runtime.sh" reset | tee "$REPORT/01-reset.log"
assert_factory_state | tee "$REPORT/02-factory-state.log"

echo "===== PRE-HARDWARE / NORMAL CONFIGURE ====="
bash "$SCRIPT_DIR/cudy-resilient-setup.sh" | tee "$REPORT/03-setup.log"
bash "$SCRIPT_DIR/cudy-verify-configured-state.sh" | tee "$REPORT/04-configured.log"
fresh_auth configured
config_hashes "$REPORT/configured.sha256"

echo "===== PRE-HARDWARE / ALREADY CONFIGURED IDEMPOTENCY ====="
cp "$REPORT/configured.sha256" "$REPORT/idempotency-before.sha256"
bash "$SCRIPT_DIR/cudy-quick-setup.sh" | tee "$REPORT/05-idempotent.log"
grep -q "^STEP already_configured ok" "$REPORT/05-idempotent.log" || { echo "ERROR already_configured_guard_missing"; exit 80; }
config_hashes "$REPORT/idempotency-after.sha256"
diff -u "$REPORT/idempotency-before.sha256" "$REPORT/idempotency-after.sha256" > "$REPORT/idempotency.diff" || { cat "$REPORT/idempotency.diff"; exit 81; }
echo "PASS already_configured_no_mutation"

echo "===== PRE-HARDWARE / COLD PROCESS RESTART ====="
bash "$SCRIPT_DIR/cudy-factory-runtime.sh" stop | tee "$REPORT/06-stop.log"
if curl -sS --max-time 1 -o /dev/null "http://127.0.0.1:$PORT/cgi-bin/luci" 2>/dev/null; then
  echo "ERROR management_http_survived_stop"
  exit 82
fi
echo "PASS management_http_down"
bash "$SCRIPT_DIR/cudy-factory-runtime.sh" start | tee "$REPORT/07-start.log"
bash "$SCRIPT_DIR/cudy-verify-configured-state.sh" | tee "$REPORT/08-after-restart.log"
config_hashes "$REPORT/restarted.sha256"
diff -u "$REPORT/configured.sha256" "$REPORT/restarted.sha256" > "$REPORT/restart-config.diff" || { cat "$REPORT/restart-config.diff"; exit 83; }
echo "PASS cold_restart_persistence"
fresh_auth restarted

echo "===== PRE-HARDWARE / INTERRUPTED-SETUP RECOVERY ====="
for stage in admin_auth workmode wan_dhcp wireless summary; do
  echo "--- fault after $stage ---"
  bash "$SCRIPT_DIR/cudy-factory-runtime.sh" reset > "$REPORT/fault-$stage-reset.log" 2>&1
  ROUTERLAB_FAULT_AFTER_STAGE="$stage" \
    bash "$SCRIPT_DIR/cudy-resilient-setup.sh" | tee "$REPORT/fault-$stage-recovery.log"
  grep -q "FAULT injected_after=$stage" "$REPORT/fault-$stage-recovery.log" || { echo "ERROR fault_not_exercised stage=$stage"; exit 84; }
  grep -q "RESILIENT_SETUP=PASS" "$REPORT/fault-$stage-recovery.log" || { echo "ERROR recovery_failed stage=$stage"; exit 85; }
  bash "$SCRIPT_DIR/cudy-verify-configured-state.sh" > "$REPORT/fault-$stage-verify.log" 2>&1
  echo "PASS recovery_after=$stage"
done

echo "===== PRE-HARDWARE / FACTORY RESET ROUND TRIP ====="
bash "$SCRIPT_DIR/cudy-factory-runtime.sh" reset | tee "$REPORT/09-final-reset.log"
assert_factory_state | tee "$REPORT/10-final-factory-state.log"
if [[ "$(uci_get wireless.wlan00.key)" == "$WIFI_PASSWORD" || "$(uci_get wireless.wlan10.key)" == "$WIFI_PASSWORD" ]]; then
  echo "ERROR configured_wifi_key_survived_factory_reset"
  exit 86
fi
echo "PASS configured_wifi_key_removed_by_reset"

echo "===== PRE-HARDWARE / SECRET HYGIENE ====="
if grep -RIlF -- "$ADMIN_PASSWORD" "$REPORT" 2>/dev/null | grep -v "\.cookies$" | grep -q .; then
  echo "ERROR admin_password_leaked_to_report"
  exit 87
fi
if grep -RIlF -- "$WIFI_PASSWORD" "$REPORT" 2>/dev/null | grep -q .; then
  echo "ERROR wifi_password_leaked_to_report"
  exit 88
fi
echo "PASS report_secret_hygiene"

bash "$SCRIPT_DIR/cudy-factory-runtime.sh" stop > "$REPORT/11-stop.log" 2>&1 || true
echo "PREHARDWARE=PASS board=$BOARD" | tee "$REPORT/RESULT.txt"
