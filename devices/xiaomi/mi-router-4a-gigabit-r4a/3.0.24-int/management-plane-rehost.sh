#!/usr/bin/env bash
set -Eeuo pipefail

# Xiaomi Mi Router 4A Gigabit (R4A) Global 3.0.24 management-plane rehost.
# Runs the ORIGINAL MIPS stock web stack under qemu-user + PRoot.
# It does not boot a firmware kernel and does not emulate RF/PHY/ASIC hardware.

ROOTFS="${HOME}/routerlab-xiaomi-r4a/audit/squashfs-root"
WORK_BASE="${HOME}/routerlab-xiaomi-r4a/rehost-work"
HTTP_PORT=18080
PROBE_SECONDS=75
FRESH=0
INSTALL_DEPS=0

usage() {
  cat <<'EOF'
Usage: management-plane-rehost.sh [options]
  --rootfs PATH        Exact extracted stock rootfs
  --http-port PORT     Rehost HTTP port (default 18080)
  --probe-seconds SEC  Bounded probe window (default 75; max 300)
  --fresh              Recreate disposable rootfs clone
  --install-deps       Install qemu-user-static + proot if missing
  -h, --help
EOF
}

while (($#)); do
  case "$1" in
    --rootfs) ROOTFS="$2"; shift 2 ;;
    --http-port) HTTP_PORT="$2"; shift 2 ;;
    --probe-seconds) PROBE_SECONDS="$2"; shift 2 ;;
    --fresh) FRESH=1; shift ;;
    --install-deps) INSTALL_DEPS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$HTTP_PORT" =~ ^[0-9]+$ ]] || { echo "http port must be numeric" >&2; exit 2; }
[[ "$PROBE_SECONDS" =~ ^[0-9]+$ ]] || { echo "probe seconds must be numeric" >&2; exit 2; }
(( HTTP_PORT >= 1024 && HTTP_PORT <= 64000 )) || { echo "http port must be 1024..64000" >&2; exit 2; }
(( PROBE_SECONDS >= 15 && PROBE_SECONDS <= 300 )) || { echo "probe seconds must be 15..300" >&2; exit 2; }
HTTPS_PORT=$((HTTP_PORT + 1))

missing=()
for c in proot qemu-mipsel-static curl nc ss; do
  command -v "$c" >/dev/null 2>&1 || missing+=("$c")
done
if ((${#missing[@]})); then
  if (( INSTALL_DEPS == 0 )); then
    echo "[rehost] missing host dependencies: ${missing[*]}" >&2
    echo "[rehost] rerun with --install-deps" >&2
    exit 3
  fi
  echo "[rehost] installing host-only dependencies: qemu-user-static proot curl netcat-openbsd iproute2"
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    qemu-user-static proot curl netcat-openbsd iproute2
fi

ROOTFS="$(readlink -f "$ROOTFS")"
[[ -d "$ROOTFS" ]] || { echo "[rehost] rootfs not found: $ROOTFS" >&2; exit 1; }

required=(
  etc/sysapihttpd/sysapihttpd.conf
  etc/sysapihttpd/fastcgi-proxy-tcp.conf
  usr/sbin/sysapihttpd
  usr/bin/spawn-fcgi
  usr/bin/fcgi-cgi
  www/cgi-bin/luci
)
for f in "${required[@]}"; do
  [[ -e "$ROOTFS/$f" ]] || { echo "[rehost] stock authority missing: /$f" >&2; exit 1; }
done

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="${WORK_BASE}/current"
LAB="${WORK}/rootfs"
ART="${WORK_BASE}/runs/${RUN_ID}"
PIDS="${WORK}/pids"
mkdir -p "$WORK" "$ART"

stop_previous() {
  [[ -f "$PIDS" ]] || return 0
  while read -r p; do
    [[ "$p" =~ ^[0-9]+$ ]] || continue
    kill -TERM "$p" 2>/dev/null || true
  done < "$PIDS"
  sleep 1
  while read -r p; do
    [[ "$p" =~ ^[0-9]+$ ]] || continue
    kill -KILL "$p" 2>/dev/null || true
  done < "$PIDS"
  rm -f "$PIDS"
}
stop_previous

if [[ ! -d "$LAB" || "$FRESH" == 1 ]]; then
  echo "[rehost] cloning exact stock rootfs; source remains untouched"
  rm -rf "$LAB"
  mkdir -p "$LAB"
  cp -a --reflink=auto "$ROOTFS/." "$LAB/"
fi

sha256sum \
  "$ROOTFS/etc/sysapihttpd/sysapihttpd.conf" \
  "$ROOTFS/usr/sbin/sysapihttpd" \
  "$ROOTFS/www/cgi-bin/luci" \
  > "$ART/source-authority.sha256"

QEMU="$(command -v qemu-mipsel-static)"
PROOT="$(command -v proot)"

guest() {
  "$PROOT" -0 -q "$QEMU" -R "$LAB" -w / /bin/sh -c "$1"
}

if ! guest '/bin/busybox echo QEMU_USER_MIPS_OK' >"$ART/qemu-user-smoke.log" 2>&1; then
  cat "$ART/qemu-user-smoke.log" >&2
  echo "[rehost] qemu-user smoke failed" >&2
  exit 4
fi

# Reproduce ngxld's runtime-config preparation without its real-kernel mount --bind.
# Stock sysapihttpd, FCGI, LuCI and API controllers remain unchanged.
guest '
set -e
rm -rf /tmp/sysapihttpdconf /tmp/sysapihttpd /tmp/uploadfiles
mkdir -p /tmp/sysapihttpdconf /tmp/uploadfiles /tmp/rr /var/run

# Exact ngxld runtime directory shape. Stock /var is a symlink to /tmp, and the
# sysapihttpd binary was compiled with /var/sysapihttpd/{lock,body,proxy,fastcgi}.
mkdir -p /tmp/sysapihttpd/temp /tmp/sysapihttpd/cache /tmp/sysapihttpd/log
mkdir -p /tmp/sysapihttpd/body /tmp/sysapihttpd/proxy /tmp/sysapihttpd/fastcgi
mkdir -p /tmp/sysapihttpd/run /tmp/sysapihttpd/lock

# ngxld bind-mounts /tmp/sysapihttpd over /userdisk/sysapihttpd when no standalone
# userdisk filesystem exists. PRoot cannot perform that kernel mount, so the disposable
# clone uses an equivalent symlink. The source rootfs is untouched.
rm -rf /userdisk/sysapihttpd
ln -s /tmp/sysapihttpd /userdisk/sysapihttpd

for oneroot in preload inforoot luaroot; do
  mkdir -p "/tmp/sysapihttpd/$oneroot"
  : > "/tmp/sysapihttpd/$oneroot/favicon.ico"
  printf "<h1>sysapihttpd %s server</h1>\n" "$oneroot" > "/tmp/sysapihttpd/$oneroot/index.html"
  printf "<h1>sysapihttpd %s server, file no found or internal error</h1>\n" "$oneroot" > "/tmp/sysapihttpd/$oneroot/50x.html"
done
chmod -R 777 /tmp/sysapihttpd

cp -a /etc/sysapihttpd/. /tmp/sysapihttpdconf/
rrd="$(matool --method rr_data 2>/dev/null || true)"
did="$(matool --method deviceID 2>/dev/null || true)"
api="$(uci get /etc/config/miwifi.server.API 2>/dev/null || true)"
[ -n "$rrd" ] || rrd="routerlab-rr"
[ -n "$did" ] || did="routerlab-device"
[ -n "$api" ] || api="eu.api.miwifi.com"
conf=/tmp/sysapihttpdconf/sysapihttpd.conf
sed -i \
  -e "s/\"RR_D_STUB\"/\"$rrd\"/g" \
  -e "s/\"DEV_ID_STUB\"/\"$did\"/g" \
  -e "s/API_SERVER/$api/g" \
  -e "s#\"DE_PATH_STUB\"#\"/tmp/de_zone_data\"#g" \
  -e "s#\"RR_PATH_STUB\"#\"/tmp/rr/xqsystmp\"#g" \
  -e "s#NGINX_SSL_CRT#/etc/sysapihttpd/nginx-ssl.crt#g" \
  -e "s#NGINX_SSL_KEY#/etc/sysapihttpd/nginx-ssl.key#g" \
  "$conf"
' >"$ART/runtime-prep.log" 2>&1

# Transport-only adaptation in the disposable clone:
# - privileged 80/443 -> deterministic high ports
# - daemon off -> bounded host supervision
guest "sed -i \
  -e 's/^daemon on;/daemon off;/' \
  -e 's/listen 80;/listen ${HTTP_PORT};/' \
  -e 's/listen 443;/listen ${HTTPS_PORT};/' \
  /tmp/sysapihttpdconf/sysapihttpd.conf"

# PRoot -R may expose guest /tmp via its runtime namespace instead of $LAB/tmp.
# Export the generated config through the guest view; do not assume its host backing path.
guest 'cat /tmp/sysapihttpdconf/sysapihttpd.conf' > "$ART/runtime-sysapihttpd.conf"

set +e
guest '/usr/sbin/sysapihttpd -c /tmp/sysapihttpdconf/sysapihttpd.conf -t' \
  >"$ART/sysapi-config-test.log" 2>&1
CONFIG_RC=$?
set -e

write_report_and_exit() {
  local state="$1" decision="$2"
  {
    echo "# Xiaomi R4A management-plane rehost"
    echo
    echo "- exact source rootfs modified: **no**"
    echo "- execution: qemu-mipsel user-mode + PRoot"
    echo "- stock sysapihttpd: **yes**"
    echo "- stock FCGI/LuCI: **yes**"
    echo "- hardware/SoC emulation: **no**"
    echo
    echo "## Classification"
    echo
    echo "**${state}**"
    echo
    echo "## Decision"
    echo
    echo "$decision"
  } > "$ART/REPORT.md"
  cat "$ART/REPORT.md"
  echo "[rehost] artifacts: $ART"
}

if (( CONFIG_RC != 0 )); then
  echo
  echo "=== STOCK SYSAPI CONFIG TEST ERROR ==="
  cat "$ART/sysapi-config-test.log" || true
  echo "=== END CONFIG TEST ERROR ==="
  echo
  write_report_and_exit \
    "STOCK_SYSAPI_CONFIG_BLOCKED_IN_USERMODE" \
    "The exact stock server reached config validation and failed there. The precise error is printed above and saved in sysapi-config-test.log. Shim only that evidenced userspace dependency; do not return to FirmAE."
  exit 0
fi

# Start exact stock FCGI/LuCI. Keep all activity bounded and local.
set +e
"$PROOT" -0 -q "$QEMU" -R "$LAB" -w / \
  /usr/bin/spawn-fcgi -a 127.0.0.1 -p 8920 -u root -U nobody -F 1 -- \
  /usr/bin/fcgi-cgi -c 4 >"$ART/fcgi.log" 2>&1 &
FCGI_PID=$!
echo "$FCGI_PID" >> "$PIDS"
sleep 2
if ! kill -0 "$FCGI_PID" 2>/dev/null && ! nc -z 127.0.0.1 8920 2>/dev/null; then
  "$PROOT" -0 -q "$QEMU" -R "$LAB" -w / \
    /usr/bin/spawn-fcgi -a 127.0.0.1 -p 8920 -F 1 -- \
    /usr/bin/fcgi-cgi -c 4 >>"$ART/fcgi.log" 2>&1 &
  FCGI_PID=$!
  echo "$FCGI_PID" >> "$PIDS"
fi
set -e

"$PROOT" -0 -q "$QEMU" -R "$LAB" -w / \
  /usr/sbin/sysapihttpd -c /tmp/sysapihttpdconf/sysapihttpd.conf \
  >"$ART/sysapihttpd.log" 2>&1 &
HTTPD_PID=$!
echo "$HTTPD_PID" >> "$PIDS"

# Observe stock runtime for a short bounded grace period before HTTP probing.
# Important: spawn-fcgi is only a launcher. The stock Xiaomi init script supervises
# /usr/bin/fcgi-cgi itself (PROCFLAG), so launcher PID exit is not a failure signal.
HTTPD_ALIVE=0
HTTPD_LISTEN=0
FCGI_LISTEN=0
FCGI_CHILD=0
for _ in {1..12}; do
  kill -0 "$HTTPD_PID" 2>/dev/null && HTTPD_ALIVE=1 || HTTPD_ALIVE=0
  nc -z -w1 127.0.0.1 "$HTTP_PORT" 2>/dev/null && HTTPD_LISTEN=1 || HTTPD_LISTEN=0
  nc -z -w1 127.0.0.1 8920 2>/dev/null && FCGI_LISTEN=1 || FCGI_LISTEN=0
  if ps -ef | grep -E '[f]cgi-cgi([[:space:]]|$)' >/dev/null 2>&1; then
    FCGI_CHILD=1
  else
    FCGI_CHILD=0
  fi
  (( HTTPD_LISTEN == 1 && FCGI_LISTEN == 1 )) && break
  (( HTTPD_ALIVE == 0 )) && break
  sleep 1
done

{
  echo "=== startup status ==="
  echo "spawn_fcgi_launcher_pid=$FCGI_PID (launcher exit is allowed)"
  echo "fcgi_child=$FCGI_CHILD listen_8920=$FCGI_LISTEN"
  echo "sysapi_pid=$HTTPD_PID alive=$HTTPD_ALIVE listen_$HTTP_PORT=$HTTPD_LISTEN"
  echo "=== listeners ==="
  ss -lntp 2>/dev/null | grep -E ":(${HTTP_PORT}|${HTTPS_PORT}|8920)\\b" || true
  echo "=== processes ==="
  ps -ef | grep -E 'qemu-mipsel|sysapihttpd|fcgi-cgi|spawn-fcgi' | grep -v grep || true
} > "$ART/startup-evidence.txt"

printf 'timestamp\tpath\thttp_code\tcontent_type\n' > "$ART/probes.tsv"
best_root=000
best_init=000
best_api=000

probe() {
  local path="$1" tag="$2" n="$3"
  local body="$ART/${tag}-${n}.body"
  local hdr="$ART/${tag}-${n}.headers"
  local code ct
  code="$(curl -sS --max-time 3 -o "$body" -D "$hdr" -w '%{http_code}' \
    -H 'Host: 127.0.0.1' "http://127.0.0.1:${HTTP_PORT}${path}" 2>/dev/null || true)"
  [[ "$code" =~ ^[0-9]{3}$ ]] || code=000
  ct="$(awk 'BEGIN{IGNORECASE=1} /^Content-Type:/{gsub("\r",""); sub(/^[^:]+:[[:space:]]*/,""); print; exit}' "$hdr" 2>/dev/null || true)"
  printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$path" "$code" "$ct" >> "$ART/probes.tsv"
  printf '%s' "$code"
}

start="$(date +%s)"
n=0
while true; do
  elapsed=$(( $(date +%s) - start ))
  (( elapsed >= PROBE_SECONDS )) && break
  n=$((n+1))
  c1="$(probe / root "$n")"
  c2="$(probe /init.html init "$n")"
  c3="$(probe /cgi-bin/luci/api/xqsystem/init_info api "$n")"
  [[ "$c1" != 000 ]] && best_root="$c1"
  [[ "$c2" != 000 ]] && best_init="$c2"
  [[ "$c3" != 000 ]] && best_api="$c3"
  [[ "$best_api" =~ ^2[0-9][0-9]$ ]] && break
  if grep -qF 'cannot est session for 0.0.0.1:65535' "$ART/sysapihttpd.log" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$HTTPD_PID" 2>/dev/null; then
    break
  fi
  sleep 2
done

{
  echo "=== listeners ==="
  ss -lntp 2>/dev/null | grep -E ":(${HTTP_PORT}|${HTTPS_PORT}|8920)\\b" || true
  echo "=== processes ==="
  ps -ef | grep -E 'qemu-mipsel|sysapihttpd|fcgi-cgi|spawn-fcgi' | grep -v grep || true
} > "$ART/runtime-evidence.txt"

classification="QEMU_USER_REHOST_BLOCKED"
decision="Use the printed runtime evidence and shim only the first evidenced userspace dependency."
if [[ "$best_api" =~ ^2[0-9][0-9]$ ]]; then
  classification="STOCK_LUCI_API_ALIVE"
  decision="Proceed to stock login/read-only endpoint matrix, then isolated WAN/Wi-Fi state and reboot persistence acceptance."
elif [[ "$best_root" =~ ^[123][0-9][0-9]$ || "$best_init" =~ ^[123][0-9][0-9]$ ]]; then
  classification="STOCK_WEB_FRONTEND_ALIVE_LUCI_BLOCKED"
  decision="Keep stock sysapihttpd/frontend. Diagnose only FCGI/LuCI from the printed logs."
elif (( HTTPD_ALIVE == 0 )); then
  classification="STOCK_SYSAPI_PROCESS_EXITED"
  decision="sysapihttpd accepted the exact config but exited at runtime. Its printed log is the first authoritative blocker."
elif (( HTTPD_LISTEN == 0 )); then
  classification="STOCK_SYSAPI_ALIVE_NO_HTTP_LISTENER"
  decision="sysapihttpd stayed alive but did not expose the rehost HTTP listener. Diagnose only listener/runtime binding."
elif (( FCGI_LISTEN == 0 )); then
  classification="STOCK_FCGI_NO_LISTENER"
  decision="The spawn-fcgi launcher lifecycle is ignored. No stock FCGI listener appeared on 127.0.0.1:8920; use fcgi.log and fcgi-cgi process evidence as authority."
elif (( FCGI_CHILD == 0 )); then
  classification="STOCK_FCGI_LISTENER_WITHOUT_TRACKED_CHILD"
  decision="Port 8920 is reachable but the expected fcgi-cgi process was not visible in the host process view. Treat the listener as stronger evidence and continue with HTTP request diagnostics."
elif grep -qF 'cannot est session for 0.0.0.1:65535' "$ART/sysapihttpd.log" 2>/dev/null; then
  classification="STOCK_SYSAPI_TRANSPORT_INCOMPATIBLE_QEMU_USER"
  decision="Stock sysapihttpd reaches its Xiaomi original-destination/session layer, receives sentinel 0.0.0.1:65535 under qemu-user and aborts the worker. Retire stock HTTP transport only; preserve stock /www + FCGI/LuCI/API behind the compatibility front door."
else
  classification="STOCK_SYSAPI_CONFIG_VALID_RUNTIME_BLOCKED"
  decision="Both stock listeners survived startup but HTTP did not complete. Diagnose request handling only; full-system emulation stays retired."
fi

if [[ "$classification" != "STOCK_LUCI_API_ALIVE" ]]; then
  echo
  echo "=== STOCK RUNTIME DIAGNOSTIC ==="
  echo "--- startup-evidence.txt ---"
  cat "$ART/startup-evidence.txt" 2>/dev/null || true
  echo "--- runtime-evidence.txt ---"
  cat "$ART/runtime-evidence.txt" 2>/dev/null || true
  echo "--- sysapihttpd.log ---"
  sed -n '1,260p' "$ART/sysapihttpd.log" 2>/dev/null || true
  echo "--- fcgi.log ---"
  sed -n '1,260p' "$ART/fcgi.log" 2>/dev/null || true
  echo "=== END STOCK RUNTIME DIAGNOSTIC ==="
  echo
fi

{
  echo "# Xiaomi R4A management-plane rehost"
  echo
  echo "- exact source rootfs modified: **no**"
  echo "- execution: qemu-mipsel user-mode + PRoot"
  echo "- stock sysapihttpd: **yes**"
  echo "- stock FCGI/LuCI: **yes**"
  echo "- hardware/SoC emulation: **no**"
  echo "- HTTP front door: http://127.0.0.1:${HTTP_PORT}"
  echo
  echo "## Classification"
  echo
  echo "**${classification}**"
  echo
  echo "## Best observed HTTP"
  echo
  echo "- /: ${best_root}"
  echo "- /init.html: ${best_init}"
  echo "- /cgi-bin/luci/api/xqsystem/init_info: ${best_api}"
  echo
  echo "## Decision"
  echo
  echo "${decision}"
} > "$ART/REPORT.md"

cat "$ART/REPORT.md"
echo "[rehost] artifacts: $ART"
stop_previous
