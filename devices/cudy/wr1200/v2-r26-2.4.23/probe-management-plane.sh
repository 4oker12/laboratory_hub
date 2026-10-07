#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: probe-management-plane.sh ROOTFS WORK_DIR REPORT_DIR}"
WORK="${2:?usage: probe-management-plane.sh ROOTFS WORK_DIR REPORT_DIR}"
REPORT="${3:?usage: probe-management-plane.sh ROOTFS WORK_DIR REPORT_DIR}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
PORT="${CUDY_PROBE_PORT:-18091}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="$WORK/runtime"
mkdir -p "$WORK" "$REPORT"
rm -rf "$RUNTIME"
mkdir -p "$RUNTIME"

# Build a writable runtime copy without recreating stock device nodes.
tar -C "$ROOTFS" --exclude='./dev' -cf - . | tar -C "$RUNTIME" -xf -
mkdir -p "$RUNTIME/dev" "$RUNTIME/proc" "$RUNTIME/sys/class/net/ra0" "$RUNTIME/sys/class/net/rai0" "$RUNTIME/tmp"
chmod 1777 "$RUNTIME/tmp"

# qemu-user cannot carry this firmware's AF_UNIX ubus transport. Shadow only
# the Lua ubus transport module in the disposable runtime so original LuCI can
# expose the next dependency. The immutable extracted rootfs stays untouched.
UBUS_SHIM="$SCRIPT_DIR/runtime-shims/ubus.lua"
[[ -f "$UBUS_SHIM" ]] || { echo "ubus discovery shim missing: $UBUS_SHIM" >&2; exit 20; }
cp "$RUNTIME/usr/lib/lua/ubus.so" "$REPORT/stock-ubus-so" 2>/dev/null || true
cp "$UBUS_SHIM" "$RUNTIME/usr/lib/lua/ubus.lua"

# Factory/login and first-boot state depend on hardware-backed bdinfo plus the
# two radio interfaces normally created by the MT7628/MT7663E drivers. Preserve
# vendor logic and replace only those missing hardware boundaries.
BDINFO_SHIM="$SCRIPT_DIR/runtime-shims/bdinfo"
IFCONFIG_SHIM="$SCRIPT_DIR/runtime-shims/ifconfig"
for shim in "$BDINFO_SHIM" "$IFCONFIG_SHIM"; do
  [[ -f "$shim" ]] || { echo "management-plane boundary shim missing: $shim" >&2; exit 21; }
done
cp "$RUNTIME/usr/bin/bdinfo" "$REPORT/stock-bdinfo" 2>/dev/null || true
cp "$BDINFO_SHIM" "$RUNTIME/usr/bin/bdinfo"
chmod +x "$RUNTIME/usr/bin/bdinfo"
if [[ -e "$RUNTIME/sbin/ifconfig" || -L "$RUNTIME/sbin/ifconfig" ]]; then
  rm -f "$RUNTIME/sbin/ifconfig"
fi
cp "$IFCONFIG_SHIM" "$RUNTIME/sbin/ifconfig"
chmod +x "$RUNTIME/sbin/ifconfig"
mkdir -p "$RUNTIME/tmp/sysinfo"
printf '%s\n' 'R26' > "$RUNTIME/tmp/sysinfo/board_name"
printf '%s\n' 'Cudy WR1200 RouterLab R26' > "$RUNTIME/tmp/sysinfo/model"

# A reset retail unit reports the factory hardware state. Keep this
# overrideable so later acceptance can compare fresh/configured paths.
export ROUTERLAB_CUDY_FACTORY="${ROUTERLAB_CUDY_FACTORY:-1}"

proot_cmd=(
  proot -0 -r "$RUNTIME"
  -b /proc
  -b /dev
  # /var is an absolute symlink to /tmp in stock OpenWrt. Binding the same
  # runtime tmp directory at /var avoids host-side absolute-symlink leakage
  # between separately launched PRoot processes (ubusd/rpcd/LuCI).
  -b "$RUNTIME/tmp:/var"
  -w /
  -q "$QEMU"
)

# OpenWrt/Cudy uses absolute symlinks such as /var -> /tmp. Create writable
# runtime directories from inside PRoot so those symlinks resolve inside the
# emulated root instead of against the CI host.
"${proot_cmd[@]}" /bin/mkdir -p /tmp/run /tmp/lock /tmp/luci-sessions /tmp/sysinfo

# Materialize the exact stock first-boot configuration before probing LuCI.
# This mirrors /etc/init.d/boot: wifi detect -> config_generate ->
# uci_apply_defaults -> commit -> reload_config.
{
  echo "# Cudy WR1200 management-plane first-boot materialization"
  echo "factory=$ROUTERLAB_CUDY_FACTORY"
  echo
  echo "## wifi detect"
  set +e
  "${proot_cmd[@]}" /sbin/wifi detect > "$RUNTIME/tmp/wireless.tmp" 2>&1
  rc=$?
  set -e
  cat "$RUNTIME/tmp/wireless.tmp" 2>/dev/null || true
  echo "exit=$rc"
  if [[ -s "$RUNTIME/tmp/wireless.tmp" ]]; then
    cat "$RUNTIME/tmp/wireless.tmp" >> "$RUNTIME/etc/config/wireless"
  fi
  rm -f "$RUNTIME/tmp/wireless.tmp"

  echo
  echo "## config_generate"
  set +e
  "${proot_cmd[@]}" /bin/config_generate 2>&1
  rc=$?
  set -e
  echo "exit=$rc"

  echo
  echo "## uci-defaults"
  mapfile -t defaults < <(find "$RUNTIME/etc/uci-defaults" -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort)
  for name in "${defaults[@]}"; do
    printf '%s: ' "$name"
    set +e
    "${proot_cmd[@]}" /bin/sh -c "cd /etc/uci-defaults && . './$name'" > "$RUNTIME/tmp/routerlab-cudy-default.out" 2>&1
    rc=$?
    set -e
    echo "exit=$rc"
    cat "$RUNTIME/tmp/routerlab-cudy-default.out" 2>/dev/null || true
    rm -f "$RUNTIME/tmp/routerlab-cudy-default.out"
    if [[ "$rc" -eq 0 ]]; then
      rm -f "$RUNTIME/etc/uci-defaults/$name"
    fi
  done

  echo
  echo "## commit/reload"
  set +e
  "${proot_cmd[@]}" /sbin/uci commit 2>&1
  echo "uci_commit_exit=$?"
  "${proot_cmd[@]}" /sbin/reload_config 2>&1
  echo "reload_config_exit=$?"
  set -e

  echo
  echo "## invariants"
  for expr in system.board.type network.lan.ipaddr network.wan.proto wireless.wlan00.ssid wireless.wlan10.ssid luci.main.sysauth luci.main.wizard luci.sauth.defpasswd; do
    printf '%s=' "$expr"
    "${proot_cmd[@]}" /sbin/uci -q get "$expr" 2>&1 || true
  done
} > "$REPORT/management-plane-firstboot.txt" 2>&1

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

# Prove whether stock MIPS ubus client/server can communicate when they are
# launched beneath one PRoot invocation. If this fails while the Unix socket
# exists, the remaining boundary is qemu-user/AF_UNIX rather than LuCI.
set +e
"${proot_cmd[@]}" /bin/sh -c '
  rm -f /tmp/ubus-selftest.sock
  /sbin/ubusd -s /tmp/ubus-selftest.sock >/tmp/ubusd-selftest.log 2>&1 &
  p=$!
  sleep 1
  echo "socket:"
  ls -l /tmp/ubus-selftest.sock
  echo "client:"
  /bin/ubus -s /tmp/ubus-selftest.sock list
  rc=$?
  kill "$p" 2>/dev/null || true
  wait "$p" 2>/dev/null || true
  echo "ubusd-log:"
  cat /tmp/ubusd-selftest.log 2>/dev/null || true
  exit "$rc"
' > "$REPORT/ubus-single-proot.txt" 2>&1
single_proot_ubus_rc=$?
set -e

{
  echo "# Stock Cudy management-plane probe"
  echo
  echo "runtime=$RUNTIME"
  echo "port=$PORT"
  echo "single_proot_ubus_rc=$single_proot_ubus_rc"
  echo
  echo "## Single-PRoot stock ubus self-test"
  sed -n '1,180p' "$REPORT/ubus-single-proot.txt" 2>/dev/null || true
  echo
  echo "## Runtime preflight"
  echo "--- /var and /tmp ---"
  ls -ld "$RUNTIME/var" "$RUNTIME/tmp" 2>&1 || true
  echo "--- uhttpd plugins ---"
  find "$RUNTIME/lib" "$RUNTIME/usr/lib" -maxdepth 3 -type f -name 'uhttpd*.so' -print 2>/dev/null | sed "s#^$RUNTIME##" || true
  echo "--- ubus libraries/path constants ---"
  find "$RUNTIME/lib" "$RUNTIME/usr/lib" -maxdepth 4 \( -name 'libubus*.so*' -o -name 'ubus.so' \) -print 2>/dev/null | sed "s#^$RUNTIME##" || true
  find "$RUNTIME/lib" "$RUNTIME/usr/lib" -maxdepth 4 \( -name 'libubus*.so*' -o -name 'ubus.so' \) -type f -print0 2>/dev/null | while IFS= read -r -d '' f; do
    echo "### ${f#$RUNTIME}"
    strings -a "$f" | grep -E '/(var|tmp)/run/ubus|ubus\.sock|UBUS_SOCKET' || true
  done
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

  echo "## Stock first-boot materialization"
  sed -n '1,360p' "$REPORT/management-plane-firstboot.txt" 2>/dev/null || true
  echo
  echo "## Initial stock UCI state"
  for pkg in luci system network wireless; do
    echo "--- $pkg ---"
    "${proot_cmd[@]}" /sbin/uci -c /etc/config show "$pkg" 2>&1 || true
  done
  echo
} > "$REPORT/management-plane-probe.txt"

ubus_pid="$(start_bg ubusd /sbin/ubusd -s /var/run/ubus.sock)"
sleep 0.7

{
  echo "## ubus socket after ubusd"
  find "$RUNTIME/tmp" -type s -ls 2>/dev/null || true
  echo "## guest socket visibility"
  "${proot_cmd[@]}" /bin/ls -l /var/run/ubus.sock /tmp/run/ubus.sock 2>&1 || true
  echo "## stock ubus client via /var/run"
  set +e
  "${proot_cmd[@]}" /bin/sh -c 'command -v ubus; ubus -s /var/run/ubus.sock list' 2>&1
  echo "exit=$?"
  echo "## stock ubus client via /tmp/run"
  "${proot_cmd[@]}" /bin/sh -c 'ubus -s /tmp/run/ubus.sock list' 2>&1
  echo "exit=$?"
  set -e
  echo
} >> "$REPORT/management-plane-probe.txt"

rpcd_pid="$(start_bg rpcd /sbin/rpcd -s /tmp/run/ubus.sock)"
sleep 0.7

{
  echo "## stock ubus client after rpcd"
  set +e
  "${proot_cmd[@]}" /bin/sh -c 'ubus -s /tmp/run/ubus.sock list' 2>&1
  echo "exit=$?"
  set -e
  echo
} >> "$REPORT/management-plane-probe.txt"

# This exact image ships /www/cgi-bin/luci as a Lua CGI entry and does not
# ship uhttpd_lua.so. Run LuCI through the stock CGI path.
export LD_LIBRARY_PATH=/lib:/usr/lib
export UBUS_SOCKET=/tmp/run/ubus.sock
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

  echo "## ubus compatibility boundary"
  echo "shim=$UBUS_SHIM"
  echo "stock_module=/usr/lib/lua/ubus.so"
  echo

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
  echo "## Factory administrator-password POST probe"
  login_body="$REPORT/http-_cgi-bin_luci.body"
  if [[ -f "$login_body" ]]; then
    csrf="$(sed -n 's/.*name="_csrf"[^>]*value="\([^"]*\)".*/\1/p' "$login_body" | head -n1)"
    salt="$(sed -n 's/.*name="salt"[^>]*value="\([^"]*\)".*/\1/p' "$login_body" | head -n1)"
    if [[ -n "$salt" ]]; then
      test_password="${CUDY_TEST_ADMIN_PASSWORD:-RouterLabAdmin88}"
      password_hash="$(printf '%s%s' "$test_password" "$salt" | sha256sum | awk '{print $1}')"
      set +e
      curl -sS --max-time 8 -D "$REPORT/factory-admin-post.headers" \
        -X POST "http://127.0.0.1:$PORT/cgi-bin/luci/admin/wizard" \
        --data-urlencode "_csrf=$csrf" \
        --data-urlencode "salt=$salt" \
        --data-urlencode "zonename=UTC" \
        --data-urlencode "timeclock=$(date +%s)" \
        --data-urlencode "luci_username=admin" \
        --data-urlencode "luci_password=$password_hash" \
        -o "$REPORT/factory-admin-post.body"
      post_rc=$?
      set -e
      echo "curl_exit=$post_rc"
      echo "--- response headers ---"
      sed -n '1,80p' "$REPORT/factory-admin-post.headers" 2>/dev/null || true
      echo "--- response markers ---"
      grep -E 'wizard|WAN|Wireless|Create an administrator password|Invalid password|Forbidden|Error' "$REPORT/factory-admin-post.body" 2>/dev/null | head -n 80 || true
      echo "--- stock UCI auth read-back ---"
      printf 'defpasswd='
      "${proot_cmd[@]}" /sbin/uci -q get luci.sauth.defpasswd 2>&1 || true
      admin_credential="$("${proot_cmd[@]}" /sbin/uci -q get luci.sauth.admin 2>/dev/null || true)"
      if [[ -n "$admin_credential" ]]; then
        echo "admin_credential_present=yes"
        echo "admin_credential_length=${#admin_credential}"
      else
        echo "admin_credential_present=no"
      fi
      unset test_password password_hash admin_credential
    else
      echo "factory_post_skipped=no_salt"
    fi
  else
    echo "factory_post_skipped=no_login_body"
  fi
  echo

  echo "## Browser state markers"
  for body in "$REPORT"/http-*.body; do
    [[ -f "$body" ]] || continue
    echo "--- ${body##*/} ---"
    grep -E 'Create an administrator password|Invalid board info|This AP is being managed by controller|/cgi-bin/luci/admin/wizard|Invalid password|Login' "$body" 2>/dev/null || true
  done
  echo
  echo "## LuCI ubus calls observed through compatibility transport"
  sed -n '1,320p' "$RUNTIME/tmp/routerlab-ubus-calls.log" 2>/dev/null || true
  echo
} >> "$REPORT/management-plane-probe.txt"

cat "$REPORT/management-plane-probe.txt"
