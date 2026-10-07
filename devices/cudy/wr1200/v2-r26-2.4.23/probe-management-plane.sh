#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: probe-management-plane.sh ROOTFS WORK_DIR REPORT_DIR}"
WORK="${2:?usage: probe-management-plane.sh ROOTFS WORK_DIR REPORT_DIR}"
REPORT="${3:?usage: probe-management-plane.sh ROOTFS WORK_DIR REPORT_DIR}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
PORT="${CUDY_PROBE_PORT:-18091}"
RUNTIME="$WORK/runtime"
mkdir -p "$WORK" "$REPORT"
rm -rf "$RUNTIME"
mkdir -p "$RUNTIME"

# Build a writable runtime copy without recreating stock device nodes.
tar -C "$ROOTFS" --exclude='./dev' -cf - . | tar -C "$RUNTIME" -xf -
mkdir -p "$RUNTIME/dev" "$RUNTIME/proc" "$RUNTIME/sys" "$RUNTIME/tmp" "$RUNTIME/var/run" "$RUNTIME/var/lock"
chmod 1777 "$RUNTIME/tmp"

proot_cmd=(
  proot -0 -r "$RUNTIME"
  -b /proc
  -b /dev
  -w /
  -q "$QEMU"
)

pids=()
cleanup() {
  set +e
  for ((i=${#pids[@]}-1; i>=0; i--)); do
    kill "${pids[$i]}" 2>/dev/null || true
  done
  sleep 0.3
  for ((i=${#pids[@]}-1; i>=0; i--)); do
    kill -9 "${pids[$i]}" 2>/dev/null || true
  done
}
trap cleanup EXIT

start_bg() {
  local name="$1"; shift
  "${proot_cmd[@]}" "$@" >"$REPORT/$name.log" 2>&1 &
  local pid=$!
  pids+=("$pid")
  echo "$pid"
}

{
  echo "# Stock Cudy management-plane probe"
  echo
  echo "runtime=$RUNTIME"
  echo "port=$PORT"
  echo
  echo "## Initial stock UCI state"
  "${proot_cmd[@]}" /sbin/uci -c /etc/config show luci 2>&1 || true
  "${proot_cmd[@]}" /sbin/uci -c /etc/config show system 2>&1 || true
  echo
} > "$REPORT/management-plane-probe.txt"

ubus_pid="$(start_bg ubusd /sbin/ubusd)"
sleep 0.7
rpcd_pid="$(start_bg rpcd /sbin/rpcd -s /var/run/ubus.sock)"
sleep 0.7
uhttpd_pid="$(start_bg uhttpd /usr/sbin/uhttpd -f   -p "127.0.0.1:$PORT"   -h /www   -x /cgi-bin   -l /cgi-bin/luci   -L /usr/lib/lua/luci/sgi/uhttpd.lua)"
sleep 1.2

{
  echo "## Process launch"
  echo "ubusd_pid=$ubus_pid"
  echo "rpcd_pid=$rpcd_pid"
  echo "uhttpd_pid=$uhttpd_pid"
  echo
  for name in ubusd rpcd uhttpd; do
    echo "### $name log"
    sed -n '1,160p' "$REPORT/$name.log" 2>/dev/null || true
    echo
  done

  for url in "/" "/cgi-bin/luci" "/cgi-bin/luci/"; do
    safe="$(printf '%s' "$url" | tr '/;' '__')"
    echo "## HTTP $url"
    set +e
    curl -sS --max-time 5 -D "$REPORT/http-$safe.headers"       "http://127.0.0.1:$PORT$url"       -o "$REPORT/http-$safe.body"
    rc=$?
    set -e
    echo "curl_exit=$rc"
    echo "--- headers ---"
    sed -n '1,80p' "$REPORT/http-$safe.headers" 2>/dev/null || true
    echo "--- body (first 160 lines) ---"
    sed -n '1,160p' "$REPORT/http-$safe.body" 2>/dev/null || true
    echo
  done
} >> "$REPORT/management-plane-probe.txt"

cat "$REPORT/management-plane-probe.txt"
