#!/usr/bin/env bash
# Runs genuine MIPS binaries only inside disposable vendor-rootfs clone.
# Never configures a physical router or changes the runner's network interfaces.
set -Eeuo pipefail
SRC="${1:?pass extracted stock rootfs}"; OUT="${2:?pass output dir}"
SRC="$(realpath "$SRC")"; OUT="$(realpath -m "$OUT")"
mkdir -p "$OUT"
LAB="$OUT/runtime-rootfs"
cp -a --reflink=auto "$SRC" "$LAB"
mkdir -p "$LAB/tmp" "$LAB/var/run" "$LAB/var/lock"
QEMU="$(command -v qemu-mipsel-static || command -v qemu-mipsel)"
PROOT="$(command -v proot)"
port=18023
report="$OUT/runtime-report.txt"
printf 'AX23 stock runtime-only proof. No mock HTTP backend.\n' > "$report"
guest() {
  "$PROOT" -0 -q "$QEMU" -R "$LAB" -w / "$@"
}
if timeout 8 "$PROOT" -0 -q "$QEMU" -R "$LAB" -w / /bin/busybox echo 'STOCK_PROOT_GUEST_OK' > "$OUT/guest-smoke.log" 2>&1; then
  echo 'ROOTFS_GUEST_BUSYBOX=OK' | tee -a "$report"
  tail -n 5 "$OUT/guest-smoke.log" | tee -a "$report"
else
  echo 'ROOTFS_GUEST_BUSYBOX=BLOCKED' | tee -a "$report"
  tail -n 12 "$OUT/guest-smoke.log" | tee -a "$report"
fi
http_trial() {
  local label="$1" pid code result
  result='NO_HTTP_RESPONSE'
  # -f keeps stock daemon in foreground, -h uses true /www, and -p is loopback only.
  timeout 13 "$PROOT" -0 -q "$QEMU" -R "$LAB" -w / \
    /usr/sbin/uhttpd -f -h /www -p "127.0.0.1:$port" -x /cgi-bin \
    > "$OUT/uhttpd-$label.log" 2>&1 &
  pid=$!
  for attempt in $(seq 1 16); do
    code="$(curl --noproxy '*' -sS --max-time 1 -o "$OUT/stock-$label.html" \
         -w '%{http_code}' "http://127.0.0.1:$port/webpages/index.html" 2>/dev/null || true)"
    if [ "$code" = 200 ]; then
      if cmp -s "$SRC/www/webpages/index.html" "$OUT/stock-$label.html"; then
        result='STOCK_UHTTPD_STATIC_BYTE_IDENTICAL'
      else
        result='STOCK_UHTTPD_HTTP_200_CONTENT_DIFFERENT'
      fi
      break
    fi
    sleep .30
  done
  echo "$label=$result" | tee -a "$report"
  if kill -0 "$pid" 2>/dev/null; then
    echo "$label-PROCESS=STILL_RUNNING" | tee -a "$report"
  else
    echo "$label-PROCESS=EXITED" | tee -a "$report"
  fi
  echo "$label-STDERR_BYTES=$(wc -c < "$OUT/uhttpd-$label.log")" | tee -a "$report"
  ss -lnt 2>/dev/null | grep ":$port " | tee -a "$report" || true
  if [ "$result" = STOCK_UHTTPD_STATIC_BYTE_IDENTICAL ]; then
    code="$(curl --noproxy '*' -sS --max-time 2 -o "$OUT/cgi-$label.bin" \
         -w '%{http_code}' "http://127.0.0.1:$port/cgi-bin/luci" 2>/dev/null || true)"
    echo "$label-CGI_STATUS=${code:-NO_RESPONSE}" | tee -a "$report"
    # A reachable CGI endpoint alone is not proof of auth, config or persistence.
  fi
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  tail -n 15 "$OUT/uhttpd-$label.log" | sed 's/[[:cntrl:]]//g' | tee -a "$report"
}
http_trial "stock-proot"
if grep -q '^stock-proot=NO_HTTP_RESPONSE$' "$report"; then
  U=""
  for candidate in /sbin/ubusd /usr/sbin/ubusd; do
    if [ -f "$LAB$candidate" ]; then U="$candidate"; break; fi
  done
  if [ -n "$U" ]; then
    echo "UBUSD_ORIGINAL_BINARY_FOUND=$U" | tee -a "$report"
    timeout 17 "$PROOT" -0 -q "$QEMU" -R "$LAB" -w / "$U" -s /var/run/ubus.sock \
      > "$OUT/ubusd.log" 2>&1 &
    ubusp=$!
    sleep 1
    http_trial "stock-proot-with-stock-ubusd"
    kill "$ubusp" 2>/dev/null || true
    wait "$ubusp" 2>/dev/null || true
    tail -n 12 "$OUT/ubusd.log" | tee -a "$report"
  else
    echo 'UBUSD_ORIGINAL_BINARY_NOT_PRESENT' | tee -a "$report"
  fi
fi
echo 'EVIDENCE_LIMIT=No CGI SET, no login success, no credential use, no config write.' | tee -a "$report"
