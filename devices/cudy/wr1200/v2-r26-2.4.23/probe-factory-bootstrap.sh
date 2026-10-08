#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: probe-factory-bootstrap.sh ROOTFS WORK_DIR REPORT_DIR}"
WORK="${2:?usage: probe-factory-bootstrap.sh ROOTFS WORK_DIR REPORT_DIR}"
REPORT="${3:?usage: probe-factory-bootstrap.sh ROOTFS WORK_DIR REPORT_DIR}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="$WORK/factory-runtime"

rm -rf "$RUNTIME"
mkdir -p "$RUNTIME" "$REPORT"
tar -C "$ROOTFS" --exclude='./dev' -cf - . | tar -C "$RUNTIME" -xf -
mkdir -p "$RUNTIME/dev" "$RUNTIME/proc" "$RUNTIME/sys" "$RUNTIME/tmp/sysinfo" "$RUNTIME/tmp/run" "$RUNTIME/tmp/lock"
chmod 1777 "$RUNTIME/tmp"

BDINFO_SHIM="$SCRIPT_DIR/runtime-shims/bdinfo"
[[ -f "$BDINFO_SHIM" ]] || { echo "bdinfo shim missing: $BDINFO_SHIM" >&2; exit 20; }
cp "$RUNTIME/usr/bin/bdinfo" "$REPORT/stock-bdinfo" 2>/dev/null || true
cp "$BDINFO_SHIM" "$RUNTIME/usr/bin/bdinfo"
chmod +x "$RUNTIME/usr/bin/bdinfo"
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

snapshot() {
  local tag="$1"
  {
    echo "===== $tag ====="
    for pkg in system network wireless luci firewall dhcp cmagent; do
      echo "--- uci $pkg ---"
      run_guest /sbin/uci -c /etc/config show "$pkg" 2>&1 || true
    done
    echo "--- board.json ---"
    run_guest /bin/cat /etc/board.json 2>&1 || true
    echo
  } >> "$REPORT/factory-bootstrap-probe.txt"
}

{
  echo "# Cudy WR1200 stock factory-bootstrap probe"
  echo
  echo "runtime=$RUNTIME"
  echo "board_name=R26"
  echo
  echo "## Hardware boundary"
  for key in board model factory check checkuuid mac pin country fuuid hmac dbg; do
    echo "--- bdinfo $key ---"
    set +e
    run_guest /usr/bin/bdinfo "$key" 2>&1
    echo "exit=$?"
    set -e
  done
  echo
  echo "## Stock bootstrap candidates"
  find "$RUNTIME" -maxdepth 4 -type f \( -name 'config_generate' -o -name 'board_detect' -o -name 'board_name' \) -print 2>/dev/null | sed "s#^$RUNTIME##" || true
  echo "--- exact stock /etc/init.d/boot ---"
  sed -n '1,180p' "$RUNTIME/etc/init.d/boot" 2>/dev/null || true
  echo "--- /etc/init.d/boot references ---"
  grep -nE 'board|config_generate|uci-defaults|jshn|board.d|wifi' "$RUNTIME/etc/init.d/boot" 2>/dev/null || true
  echo "--- wireless bootstrap files ---"
  find "$RUNTIME/lib/wifi" "$RUNTIME/etc/wireless" -maxdepth 3 -type f -print 2>/dev/null | sed "s#^$RUNTIME##" | sort || true
  echo "--- /sbin/wifi detect before config_generate ---"
  set +e
  run_guest /sbin/wifi detect 2>&1
  echo "exit=$?"
  set -e
  echo
} > "$REPORT/factory-bootstrap-probe.txt"

snapshot "initial immutable-rootfs state"

# Run exact stock board scripts first. They build /etc/board.json from the
# synthetic hardware identity boundary while preserving vendor logic.
for script in /etc/board.d/01_leds /etc/board.d/02_network /etc/board.d/99-default_network; do
  [[ -f "$RUNTIME$script" ]] || continue
  {
    echo "## RUN $script"
    set +e
    run_guest /bin/sh -c "CFG=/etc/board.json /bin/sh \"$script\"" 2>&1
    rc=$?
    set -e
    echo "exit=$rc"
    echo
  } >> "$REPORT/factory-bootstrap-probe.txt"
done

snapshot "after stock board.d"

# LEDE normally materializes base network/system state through config_generate
# before vendor uci-defaults. Discover and run the exact stock helper when it
# exists. Never replace it with a Lab implementation.
config_generate=""
for candidate in /bin/config_generate /sbin/config_generate /usr/bin/config_generate /usr/sbin/config_generate; do
  if [[ -f "$RUNTIME$candidate" ]]; then
    config_generate="$candidate"
    break
  fi
done

if [[ -n "$config_generate" ]]; then
  {
    echo "## RUN $config_generate"
    set +e
    run_guest "$config_generate" 2>&1
    rc=$?
    set -e
    echo "exit=$rc"
    echo
  } >> "$REPORT/factory-bootstrap-probe.txt"
else
  echo "## config_generate not found" >> "$REPORT/factory-bootstrap-probe.txt"
fi

snapshot "after stock config_generate"

{
  echo "## Stock wireless detection after config_generate"
  echo "--- /sbin/wifi detect ---"
  set +e
  run_guest /sbin/wifi detect > "$REPORT/wifi-detect-after-config-generate.txt" 2>&1
  wifi_detect_rc=$?
  set -e
  cat "$REPORT/wifi-detect-after-config-generate.txt"
  echo "exit=$wifi_detect_rc"
  echo "--- detect output bytes ---"
  wc -c "$REPORT/wifi-detect-after-config-generate.txt" || true
  echo "--- /lib/wifi drivers / detect hooks ---"
  for wf in "$RUNTIME"/lib/wifi/*.sh; do
    [[ -f "$wf" ]] || continue
    echo "===== ${wf#$RUNTIME} ====="
    sed -n '1,260p' "$wf" 2>/dev/null || true
  done
  echo
} >> "$REPORT/factory-bootstrap-probe.txt"

# Run the smallest known vendor dependency chain, in stock order where known.
# Failures are evidence and are intentionally captured rather than hidden.
for script in \
  /etc/uci-defaults/98-board \
  /etc/uci-defaults/01_network \
  /etc/uci-defaults/30_wlan \
  /etc/uci-defaults/99_fixwan
do
  [[ -f "$RUNTIME$script" ]] || continue
  {
    echo "## RUN $script"
    set +e
    run_guest /bin/sh "$script" 2>&1
    rc=$?
    set -e
    echo "exit=$rc"
    echo
  } >> "$REPORT/factory-bootstrap-probe.txt"
  snapshot "after $script"
done

cat "$REPORT/factory-bootstrap-probe.txt"
