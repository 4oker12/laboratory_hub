#!/usr/bin/env bash
set -Eeuo pipefail

ACTION="${1:-start}"
ROOTFS="${ROUTERLAB_CUDY_ROOTFS:-$HOME/cudy-wr1200-discovery/rootfs}"
WORK="${ROUTERLAB_CUDY_WEB_WORK:-$HOME/cudy-wr1200-browser-lab}"
RUNTIME="$WORK/runtime"
LOG="$WORK/logs"
STATE="$WORK/state"
PORT="${ROUTERLAB_CUDY_PORT:-18093}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DEVICE_DIR="$REPO_ROOT/devices/cudy/wr1200/v2-r26-2.4.23"

mkdir -p "$WORK" "$LOG" "$STATE"

die() { echo "ERROR: $*" >&2; exit 1; }

proot_cmd=(
  proot -0 -r "$RUNTIME"
  -b /proc
  -b /dev
  -b "$RUNTIME/tmp:/var"
  -w /
  -q "$QEMU"
)

stop_services() {
  set +e

  # New launches run in their own session/process group. Kill the complete
  # group, not only the PRoot wrapper, otherwise qemu children can survive and
  # keep the HTTP port bound across resets.
  for name in uhttpd rpcd ubusd; do
    if [[ -f "$STATE/$name.pid" ]]; then
      pid="$(cat "$STATE/$name.pid" 2>/dev/null)"
      if [[ -n "$pid" ]]; then
        kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      fi
    fi
  done
  sleep 0.5
  for name in uhttpd rpcd ubusd; do
    if [[ -f "$STATE/$name.pid" ]]; then
      pid="$(cat "$STATE/$name.pid" 2>/dev/null)"
      if [[ -n "$pid" ]]; then
        kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
      fi
      rm -f "$STATE/$name.pid"
    fi
  done

  # One-time cleanup for processes left by older launcher revisions which did
  # not use process groups. Kill PRoot wrappers rooted at this disposable lab
  # runtime plus any qemu/uhttpd still holding this lab's dedicated HTTP port.
  for pid in $(pgrep -f "^proot -0 -r $RUNTIME " 2>/dev/null); do
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 0.2
  for pid in $(pgrep -f "qemu-mipsel-static.*127\.0\.0\.1:$PORT" 2>/dev/null); do
    kill -TERM "$pid" 2>/dev/null || true
  done

  set -e
}

prepare_factory() {
  [[ -d "$ROOTFS" ]] || die "rootfs not found: $ROOTFS"
  [[ -x "$QEMU" ]] || die "qemu not found: $QEMU"
  command -v proot >/dev/null || die "proot is not installed"

  stop_services
  rm -rf "$RUNTIME"
  mkdir -p "$RUNTIME"

  tar -C "$ROOTFS" --exclude='./dev' -cf - . | tar -C "$RUNTIME" -xf -
  mkdir -p "$RUNTIME/dev" "$RUNTIME/proc" "$RUNTIME/sys/class/net/ra0" "$RUNTIME/sys/class/net/rai0" "$RUNTIME/tmp"
  chmod 1777 "$RUNTIME/tmp"

  cp "$DEVICE_DIR/runtime-shims/ubus.lua" "$RUNTIME/usr/lib/lua/ubus.lua"
  cp "$DEVICE_DIR/runtime-shims/bdinfo" "$RUNTIME/usr/bin/bdinfo"
  cp "$DEVICE_DIR/runtime-shims/crypt" "$RUNTIME/usr/bin/crypt"
  rm -f "$RUNTIME/sbin/ifconfig"
  cp "$DEVICE_DIR/runtime-shims/ifconfig" "$RUNTIME/sbin/ifconfig"
  chmod +x "$RUNTIME/usr/bin/bdinfo" "$RUNTIME/usr/bin/crypt" "$RUNTIME/sbin/ifconfig"

  mkdir -p "$RUNTIME/tmp/sysinfo"
  printf '%s\n' 'R26' > "$RUNTIME/tmp/sysinfo/board_name"
  printf '%s\n' 'Cudy WR1200 RouterLab R26' > "$RUNTIME/tmp/sysinfo/model"

  export ROUTERLAB_CUDY_FACTORY=1
  "${proot_cmd[@]}" /bin/mkdir -p /tmp/run /tmp/lock /tmp/luci-sessions /tmp/sysinfo

  set +e
  "${proot_cmd[@]}" /sbin/wifi detect > "$RUNTIME/tmp/wireless.tmp" 2>"$LOG/wifi-detect.log"
  set -e
  if [[ -s "$RUNTIME/tmp/wireless.tmp" ]]; then
    cat "$RUNTIME/tmp/wireless.tmp" >> "$RUNTIME/etc/config/wireless"
  fi
  rm -f "$RUNTIME/tmp/wireless.tmp"

  "${proot_cmd[@]}" /bin/config_generate >"$LOG/config-generate.log" 2>&1 || true

  mapfile -t defaults < <(find "$RUNTIME/etc/uci-defaults" -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort)
  : > "$LOG/uci-defaults.log"
  for name in "${defaults[@]}"; do
    echo "===== $name =====" >> "$LOG/uci-defaults.log"
    set +e
    "${proot_cmd[@]}" /bin/sh -c "cd /etc/uci-defaults && . './$name'" >>"$LOG/uci-defaults.log" 2>&1
    rc=$?
    set -e
    echo "exit=$rc" >> "$LOG/uci-defaults.log"
    [[ "$rc" -eq 0 ]] && rm -f "$RUNTIME/etc/uci-defaults/$name"
  done

  "${proot_cmd[@]}" /sbin/uci commit
  "${proot_cmd[@]}" /sbin/reload_config >"$LOG/reload-config.log" 2>&1 || true

  wizard="$("${proot_cmd[@]}" /sbin/uci -q get luci.main.wizard 2>/dev/null || true)"
  defpasswd="$("${proot_cmd[@]}" /sbin/uci -q get luci.sauth.defpasswd 2>/dev/null || true)"
  [[ "$wizard" == "1" ]] || die "factory invariant failed: wizard=$wizard"
  [[ "$defpasswd" == "1" ]] || die "factory invariant failed: defpasswd=$defpasswd"
}

start_services() {
  [[ -d "$RUNTIME" ]] || die "runtime missing; run reset first"

  stop_services
  rm -f "$RUNTIME/tmp/run/ubus.sock" "$RUNTIME/tmp/ubus-selftest.sock" 2>/dev/null || true
  "${proot_cmd[@]}" /bin/mkdir -p /tmp/run /tmp/lock /tmp/luci-sessions

  export LD_LIBRARY_PATH=/lib:/usr/lib
  export UBUS_SOCKET=/tmp/run/ubus.sock

  setsid "${proot_cmd[@]}" /sbin/ubusd -s /var/run/ubus.sock >"$LOG/ubusd.log" 2>&1 &
  echo $! > "$STATE/ubusd.pid"
  sleep 0.5

  setsid "${proot_cmd[@]}" /sbin/rpcd -s /tmp/run/ubus.sock >"$LOG/rpcd.log" 2>&1 &
  echo $! > "$STATE/rpcd.pid"
  sleep 0.5

  setsid "${proot_cmd[@]}" /usr/sbin/uhttpd -f -p "127.0.0.1:$PORT" -h /www -x /cgi-bin >"$LOG/uhttpd.log" 2>&1 &
  uhttpd_pid=$!
  echo "$uhttpd_pid" > "$STATE/uhttpd.pid"
  sleep 0.3

  if ! kill -0 "$uhttpd_pid" 2>/dev/null; then
    echo "---- uhttpd.log ----" >&2
    sed -n '1,120p' "$LOG/uhttpd.log" >&2 || true
    die "uhttpd exited immediately"
  fi

  stock_luci_ready() {
    local code wizard_now body
    body="$RUNTIME/tmp/routerlab-readiness.body"
    wizard_now="$("${proot_cmd[@]}" /sbin/uci -q get luci.main.wizard 2>/dev/null || true)"

    # Never inspect a body from a previous attempt. curl may time out before it
    # opens/truncates -o, which previously allowed a stale factory form to make
    # readiness pass even when the current HTTP request returned 000.
    rm -f "$body"
    code="$(curl -sS --max-time 8       -o "$body"       -w '%{http_code}'       "http://127.0.0.1:$PORT/cgi-bin/luci" 2>/dev/null || true)"

    if [[ "$wizard_now" == "1" ]]; then
      # A factory runtime is ready only when THIS request returned a real stock
      # create-password page. Redirect-only or timeout states are not healthy.
      case "$code" in
        200|401|403) ;;
        *) return 1 ;;
      esac
      [[ -s "$body" ]] || return 1
      grep -q 'name="_csrf"' "$body" 2>/dev/null         && grep -q 'name="salt"' "$body" 2>/dev/null
      return $?
    fi

    case "$code" in
      200|302|401|403) return 0 ;;
      *) return 1 ;;
    esac
  }

  ready=0
  for _ in {1..12}; do
    if stock_luci_ready; then
      ready=1
      break
    fi
    sleep 0.5
  done

  if [[ "$ready" != "1" ]]; then
    echo "---- uhttpd.log ----" >&2
    sed -n '1,160p' "$LOG/uhttpd.log" >&2 || true
    echo "---- readiness headers ----" >&2
    curl -sS --max-time 3 -D - -o /dev/null "http://127.0.0.1:$PORT/cgi-bin/luci" >&2 || true
    die "stock factory LuCI form did not become reachable"
  fi
}

show_status() {
  echo "runtime=$RUNTIME"
  echo "router_url=http://127.0.0.1:$PORT"
  if [[ -d "$RUNTIME" ]]; then
    printf 'wizard='
    "${proot_cmd[@]}" /sbin/uci -q get luci.main.wizard 2>/dev/null || echo "<unset>"
    printf 'defpasswd='
    "${proot_cmd[@]}" /sbin/uci -q get luci.sauth.defpasswd 2>/dev/null || echo "<unset>"
    printf 'wan_proto='
    "${proot_cmd[@]}" /sbin/uci -q get network.wan.proto 2>/dev/null || echo "<unset>"
    printf 'ssid_2g='
    "${proot_cmd[@]}" /sbin/uci -q get wireless.wlan00.ssid 2>/dev/null || echo "<unset>"
    printf 'ssid_5g='
    "${proot_cmd[@]}" /sbin/uci -q get wireless.wlan10.ssid 2>/dev/null || echo "<unset>"
  fi
  set +e
  curl -sS -o /dev/null -w 'luci_http=%{http_code}\n' --max-time 8 "http://127.0.0.1:$PORT/cgi-bin/luci"
  set -e
}

case "$ACTION" in
  reset)
    prepare_factory
    start_services
    show_status
    ;;
  start)
    if [[ ! -d "$RUNTIME" ]]; then
      prepare_factory
    fi
    start_services
    show_status
    ;;
  stop)
    stop_services
    echo "stopped"
    ;;
  status)
    show_status
    ;;
  *)
    die "usage: $0 {reset|start|stop|status}"
    ;;
esac
