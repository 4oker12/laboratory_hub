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
mkdir -p "$RUNTIME/dev" "$RUNTIME/proc" "$RUNTIME/sys" "$RUNTIME/tmp"
chmod 1777 "$RUNTIME/tmp"

proot_cmd=(
  proot -0 -r "$RUNTIME"
  -b /proc
  -b /dev
  -w /
  -q "$QEMU"
)

# OpenWrt/Cudy uses absolute symlinks such as /var -> /tmp. Create writable
# runtime directories from inside PRoot so those symlinks resolve inside the
# emulated root instead of against the CI host.
"${proot_cmd[@]}" /bin/mkdir -p /tmp/run /tmp/lock /tmp/luci-sessions

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
  echo "## Runtime preflight"
  echo "--- /var and /tmp ---"
  ls -ld "$RUNTIME/var" "$RUNTIME/tmp" 2>&1 || true
  echo "--- uhttpd plugins ---"
  find "$RUNTIME/lib" "$RUNTIME/usr/lib" -maxdepth 3 -type f -name 'uhttpd*.so' -print 2>/dev/null | sed "s#^$RUNTIME##" || true
  echo "--- dynamic loader path files ---"
  find "$RUNTIME/etc" -maxdepth 1 -type f -name 'ld-musl*' -print -exec sed -n '1,80p' {} \; 2>/dev/null | sed "s#^$RUNTIME##" || true
  echo "--- CGI entry ---"
  ls -l "$RUNTIME/www/cgi-bin/luci" 2>&1 || true
  file "$RUNTIME/www/cgi-bin/luci" 2>&1 || true
  sed -n '1,60p' "$RUNTIME/www/cgi-bin/luci" 2>/dev/null || true
  echo "--- ubusd usage ---"
  set +e
  "${proot_cmd[@]}" /sbin/ubusd -h 2>&1
  echo "exit=$?"
  echo "--- rpcd usage ---"
  "${proot_cmd[@]}" /sbin/rpcd -h 2>&1
  echo "exit=$?"
  set -e
  echo

  echo "## Initial stock UCI state"
  "${proot_cmd[@]}" /sbin/uci -c /etc/config show luci 2>&1 || true
  "${proot_cmd[@]}" /sbin/uci -c /etc/config show system 2>&1 || true
  echo
} > "$REPORT/management-plane-probe.txt"

ubus_pid="$(start_bg ubusd /sbin/ubusd -s /var/run/ubus.sock)"
sleep 0.7

{
  echo "## ubus socket after ubusd"
  find "$RUNTIME/tmp" -type s -ls 2>/dev/null || true
  echo "## stock ubus client"
  set +e
  "${proot_cmd[@]}" /bin/sh -c 'command -v ubus; ubus -s /var/run/ubus.sock list' 2>&1
  echo "exit=$?"
  set -e
  echo
} >> "$REPORT/management-plane-probe.txt"

rpcd_pid="$(start_bg rpcd /sbin/rpcd -s /var/run/ubus.sock)"
sleep 0.7

{
  echo "## stock ubus client after rpcd"
  set +e
  "${proot_cmd[@]}" /bin/sh -c 'ubus -s /var/run/ubus.sock list' 2>&1
  echo "exit=$?"
  set -e
  echo
} >> "$REPORT/management-plane-probe.txt"

# This exact image ships /www/cgi-bin/luci as a Lua CGI entry and does not
# ship uhttpd_lua.so. Run LuCI through the stock CGI path.
export LD_LIBRARY_PATH=/lib:/usr/lib
uhttpd_pid="$(start_bg uhttpd /usr/sbin/uhttpd -f -p "127.0.0.1:$PORT" -h /www -x /cgi-bin)"
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
