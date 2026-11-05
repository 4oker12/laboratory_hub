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
  if [[ "$label" == stock-chroot* ]]; then
    timeout 13 sudo chroot "$LAB" /__host/qemu-mipsel \
      /usr/sbin/uhttpd -f -h /www -p "127.0.0.1:$port" -x /cgi-bin \
      > "$OUT/uhttpd-$label.log" 2>&1 &
  else
    timeout 13 "$PROOT" -0 -q "$QEMU" -R "$LAB" -w / \
      /usr/sbin/uhttpd -f -h /www -p "127.0.0.1:$port" -x /cgi-bin \
      > "$OUT/uhttpd-$label.log" 2>&1 &
  fi
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
echo '--- chroot / stock MIPS QEMU fallback (ephemeral runner only) ---' | tee -a "$report"
# QEMU is a host-side compatibility executable, never a replacement AX23 API.
# Copy its x86_64 dynamic dependencies into the disposable rootfs clone only.
mkdir -p "$LAB/__host"
cp "$QEMU" "$LAB/__host/qemu-mipsel"
while IFS= read -r lib; do
  [[ -f "$lib" ]] || continue
  mkdir -p "$LAB$(dirname "$lib")"
  cp -L "$lib" "$LAB$lib"
done < <(ldd "$QEMU" | awk '{for (i=1; i<=NF; i++) if (substr($i,1,1)=="/") print $i}' | sort -u)
mkdir -p "$LAB/dev" "$LAB/var/run"
for entry in 'null 1 3' 'urandom 1 9'; do
  read -r name major minor <<< "$entry"
  test -e "$LAB/dev/$name" || sudo mknod -m 666 "$LAB/dev/$name" c "$major" "$minor"
done
if timeout 8 sudo chroot "$LAB" /__host/qemu-mipsel /bin/busybox echo STOCK_AX23_CHROOT_BUSYBOX_OK > "$OUT/chroot-smoke.log" 2>&1; then
  echo 'CHROOT_STOCK_BUSYBOX=OK' | tee -a "$report"
else
  echo 'CHROOT_STOCK_BUSYBOX=BLOCKED' | tee -a "$report"
fi
tail -n 8 "$OUT/chroot-smoke.log" | tee -a "$report"
if grep -q 'CHROOT_STOCK_BUSYBOX=OK' "$report"; then
  http_trial "stock-chroot"
  if grep -q 'stock-chroot=NO_HTTP_RESPONSE' "$report" && [ -f "$LAB/sbin/ubusd" ]; then
    echo 'CHROOT_STOCK_UBUSD_TRIAL=START' | tee -a "$report"
    timeout 16 sudo chroot "$LAB" /__host/qemu-mipsel /sbin/ubusd -s /var/run/ubus.sock > "$OUT/ubusd-chroot.log" 2>&1 &
    cpid=$!
    sleep 1
    http_trial "stock-chroot-with-stock-ubusd"
    kill "$cpid" 2>/dev/null || true
    wait "$cpid" 2>/dev/null || true
    tail -n 10 "$OUT/ubusd-chroot.log" | tee -a "$report"
  fi
fi
echo 'EVIDENCE_LIMIT=No CGI SET, no login success, no credential use, no config write.' | tee -a "$report"
