#!/usr/bin/env bash
set -Eeuo pipefail

RUNTIME="${ROUTERLAB_CUDY_RUNTIME:-$HOME/cudy-wr1200-browser-lab/runtime}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
EXPECTED_ADMIN_PASSWORD="${ROUTERLAB_CUDY_ADMIN_PASSWORD:-RouterLabAdmin88}"
EXPECTED_WIFI_PASSWORD="${ROUTERLAB_CUDY_WIFI_PASSWORD:-RouterLabWifi88}"

[[ -d "$RUNTIME" ]] || { echo "ERROR runtime_missing"; exit 20; }
[[ -x "$QEMU" ]] || { echo "ERROR qemu_missing"; exit 21; }
command -v proot >/dev/null || { echo "ERROR proot_missing"; exit 22; }

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

wizard="$(uci_get luci.main.wizard)"
defpasswd="$(uci_get luci.sauth.defpasswd)"
wan_proto="$(uci_get network.wan.proto)"
workmode="$(uci_get system.board.workmode)"
ssid_2g="$(uci_get wireless.wlan00.ssid)"
ssid_5g="$(uci_get wireless.wlan10.ssid)"
enc_2g="$(uci_get wireless.wlan00.encryption)"
enc_5g="$(uci_get wireless.wlan10.encryption)"
key_2g="$(uci_get wireless.wlan00.key)"
key_5g="$(uci_get wireless.wlan10.key)"
admin_credential="$(uci_get luci.sauth.admin)"

fail=0
check_eq() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS $label=$actual"
  else
    echo "FAIL $label actual=$actual expected=$expected"
    fail=1
  fi
}

check_nonempty() {
  local label="$1" actual="$2"
  if [[ -n "$actual" ]]; then
    echo "PASS $label=present"
  else
    echo "FAIL $label=missing"
    fail=1
  fi
}

check_eq wizard "$wizard" 0
check_eq defpasswd "$defpasswd" 0
check_eq wan_proto "$wan_proto" dhcp
check_eq workmode "$workmode" router
check_nonempty ssid_2g "$ssid_2g"
check_nonempty ssid_5g "$ssid_5g"
check_nonempty encryption_2g "$enc_2g"
check_nonempty encryption_5g "$enc_5g"
check_eq wifi_key_2g "$key_2g" "$EXPECTED_WIFI_PASSWORD"
check_eq wifi_key_5g "$key_5g" "$EXPECTED_WIFI_PASSWORD"
check_nonempty admin_credential "$admin_credential"

# Never print credential material or configured Wi-Fi keys.
echo "RESULT wizard=$wizard"
echo "RESULT defpasswd=$defpasswd"
echo "RESULT wan_proto=$wan_proto"
echo "RESULT workmode=$workmode"
echo "RESULT ssid_2g=$ssid_2g"
echo "RESULT ssid_5g=$ssid_5g"
echo "RESULT admin_credential_present=$([[ -n "$admin_credential" ]] && echo yes || echo no)"

if [[ "$fail" != "0" ]]; then
  echo "ERROR configured_state_mismatch"
  exit 40
fi

echo "configured_state=PASS"
