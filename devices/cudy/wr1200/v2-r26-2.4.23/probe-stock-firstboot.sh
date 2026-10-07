#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: probe-stock-firstboot.sh ROOTFS WORK_DIR REPORT_DIR}"
WORK="${2:?usage: probe-stock-firstboot.sh ROOTFS WORK_DIR REPORT_DIR}"
REPORT="${3:?usage: probe-stock-firstboot.sh ROOTFS WORK_DIR REPORT_DIR}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="$WORK/stock-firstboot-runtime"

rm -rf "$RUNTIME"
mkdir -p "$RUNTIME" "$REPORT"
tar -C "$ROOTFS" --exclude='./dev' -cf - . | tar -C "$RUNTIME" -xf -
mkdir -p \
  "$RUNTIME/dev" \
  "$RUNTIME/proc" \
  "$RUNTIME/sys/class/net/ra0" \
  "$RUNTIME/sys/class/net/rai0" \
  "$RUNTIME/tmp/sysinfo" \
  "$RUNTIME/tmp/run" \
  "$RUNTIME/tmp/lock" \
  "$RUNTIME/tmp/log" \
  "$RUNTIME/tmp/state" \
  "$RUNTIME/tmp/etc" \
  "$RUNTIME/tmp/.uci"
chmod 1777 "$RUNTIME/tmp"

BDINFO_SHIM="$SCRIPT_DIR/runtime-shims/bdinfo"
IFCONFIG_SHIM="$SCRIPT_DIR/runtime-shims/ifconfig"
for shim in "$BDINFO_SHIM" "$IFCONFIG_SHIM"; do
  [[ -f "$shim" ]] || { echo "missing runtime shim: $shim" >&2; exit 20; }
done

cp "$RUNTIME/usr/bin/bdinfo" "$REPORT/stock-bdinfo" 2>/dev/null || true
cp "$BDINFO_SHIM" "$RUNTIME/usr/bin/bdinfo"
chmod +x "$RUNTIME/usr/bin/bdinfo"

# /sbin/ifconfig is normally a BusyBox symlink. Replace only in the disposable
# runtime so stock detect scripts see the two hardware-created radio interfaces.
if [[ -e "$RUNTIME/sbin/ifconfig" || -L "$RUNTIME/sbin/ifconfig" ]]; then
  readlink "$RUNTIME/sbin/ifconfig" > "$REPORT/stock-ifconfig-link.txt" 2>/dev/null || true
  rm -f "$RUNTIME/sbin/ifconfig"
fi
cp "$IFCONFIG_SHIM" "$RUNTIME/sbin/ifconfig"
chmod +x "$RUNTIME/sbin/ifconfig"

printf '%s\n' 'R26' > "$RUNTIME/tmp/sysinfo/board_name"
printf '%s\n' 'Cudy WR1200 RouterLab R26' > "$RUNTIME/tmp/sysinfo/model"

proot_cmd=(
  proot -0 -r "$RUNTIME"
  -b /proc
  -b /dev
  -b "$RUNTIME/tmp:/var"
  -w /
  -q "$QEMU"
)

run_guest() {
  "${proot_cmd[@]}" "$@"
}

{
  echo "# Cudy WR1200 exact stock first-boot materialization"
  echo
  echo "The sequence below mirrors the relevant stock /etc/init.d/boot order:"
  echo "wifi detect -> append wireless -> config_generate -> all uci-defaults -> reload_config."
  echo
  echo "## Hardware-boundary preflight"
  for key in board model factory check checkuuid mac pin country fuuid hmac; do
    printf 'bdinfo %s=' "$key"
    run_guest /usr/bin/bdinfo "$key" 2>&1 || true
  done
  echo
  echo "ifconfig ra0:"
  run_guest /sbin/ifconfig ra0 2>&1 || true
  echo "ifconfig rai0:"
  run_guest /sbin/ifconfig rai0 2>&1 || true
  echo
  echo "## Stock uci-default inventory before boot"
  run_guest /bin/sh -c 'cd /etc/uci-defaults && ls -1' 2>&1 || true
  echo
} > "$REPORT/stock-firstboot.txt"

# Exact relevant stock boot sequence from /etc/init.d/boot.
{
  echo "## STEP 1: /sbin/wifi detect"
  set +e
  run_guest /sbin/wifi detect > "$RUNTIME/tmp/wireless.tmp" 2> "$REPORT/wifi-detect.stderr"
  detect_rc=$?
  set -e
  echo "exit=$detect_rc"
  echo "--- stderr ---"
  cat "$REPORT/wifi-detect.stderr" 2>/dev/null || true
  echo "--- generated wireless ---"
  cat "$RUNTIME/tmp/wireless.tmp" 2>/dev/null || true
  echo "--- bytes ---"
  wc -c "$RUNTIME/tmp/wireless.tmp" 2>/dev/null || true
  echo
} >> "$REPORT/stock-firstboot.txt"

if [[ -s "$RUNTIME/tmp/wireless.tmp" ]]; then
  cat "$RUNTIME/tmp/wireless.tmp" >> "$RUNTIME/etc/config/wireless"
fi
rm -f "$RUNTIME/tmp/wireless.tmp"

{
  echo "## STEP 2: /bin/config_generate"
  set +e
  run_guest /bin/config_generate 2>&1
  config_rc=$?
  set -e
  echo "exit=$config_rc"
  echo
} >> "$REPORT/stock-firstboot.txt"

{
  echo "## UCI after wifi detect + config_generate"
  for pkg in system network wireless luci; do
    echo "--- $pkg ---"
    run_guest /sbin/uci -c /etc/config show "$pkg" 2>&1 || true
  done
  echo
} >> "$REPORT/stock-firstboot.txt"

# Match stock uci_apply_defaults(): lexical ls order, source each script in its
# own shell, remove only scripts that return success, then commit all packages.
mapfile -t defaults < <(find "$RUNTIME/etc/uci-defaults" -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort)

for name in "${defaults[@]}"; do
  {
    echo "## DEFAULT $name"
    set +e
    run_guest /bin/sh -c "cd /etc/uci-defaults && . './$name'"
    rc=$?
    set -e
    echo "exit=$rc"
    if [[ "$rc" -eq 0 ]]; then
      rm -f "$RUNTIME/etc/uci-defaults/$name"
      echo "stock_semantics=would_remove_after_success"
    else
      echo "stock_semantics=would_keep_after_failure"
    fi
    echo
  } >> "$REPORT/stock-firstboot.txt" 2>&1
done

{
  echo "## STEP 4: stock uci commit"
  set +e
  run_guest /sbin/uci commit 2>&1
  commit_rc=$?
  set -e
  echo "exit=$commit_rc"
  echo
  echo "## Remaining uci-defaults after stock semantics"
  run_guest /bin/sh -c 'cd /etc/uci-defaults && ls -1' 2>&1 || true
  echo
  echo "## Final stock-materialized UCI"
  for pkg in system network wireless luci firewall dhcp cmagent; do
    echo "--- $pkg ---"
    run_guest /sbin/uci -c /etc/config show "$pkg" 2>&1 || true
  done
  echo
  echo "## STEP 5: /sbin/reload_config"
  set +e
  run_guest /sbin/reload_config 2>&1
  reload_rc=$?
  set -e
  echo "exit=$reload_rc"
  echo
  echo "## First-run invariants"
  printf 'wizard='
  run_guest /sbin/uci -q get luci.main.wizard 2>&1 || true
  printf 'board_type='
  run_guest /sbin/uci -q get system.board.type 2>&1 || true
  printf 'lan_ip='
  run_guest /sbin/uci -q get network.lan.ipaddr 2>&1 || true
  printf 'wan_proto='
  run_guest /sbin/uci -q get network.wan.proto 2>&1 || true
  printf 'radio0_type='
  run_guest /sbin/uci -q get wireless.radio0.type 2>&1 || true
  printf 'radio1_type='
  run_guest /sbin/uci -q get wireless.radio1.type 2>&1 || true
  printf 'ssid_2g='
  run_guest /sbin/uci -q get wireless.wlan00.ssid 2>&1 || true
  printf 'ssid_5g='
  run_guest /sbin/uci -q get wireless.wlan10.ssid 2>&1 || true
  printf 'enc_2g='
  run_guest /sbin/uci -q get wireless.wlan00.encryption 2>&1 || true
  printf 'enc_5g='
  run_guest /sbin/uci -q get wireless.wlan10.encryption 2>&1 || true
} >> "$REPORT/stock-firstboot.txt"

cat "$REPORT/stock-firstboot.txt"
