#!/usr/bin/env bash
# Runs genuine MIPS binaries only inside disposable vendor-rootfs clone.
# Never configures a physical router or changes the runner's network interfaces.
set -Eeuo pipefail
SRC="${1:?pass extracted stock rootfs}"; OUT="${2:?pass output dir}"
SRC="$(realpath "$SRC")"; OUT="$(realpath -m "$OUT")"
mkdir -p "$OUT"
LAB="$OUT/runtime-rootfs"
cp -a --reflink=auto "$SRC" "$LAB"
# Stock /var may be an absolute link to /tmp. Never traverse it from the host.
mkdir -p "$LAB/tmp"
VAR_LINK="$(readlink "$LAB/var" 2>/dev/null || true)"
if [[ "$VAR_LINK" == "/tmp" ]]; then
  mkdir -p "$LAB/tmp/run" "$LAB/tmp/lock"
else
  mkdir -p "$LAB/var/run" "$LAB/var/lock"
fi
printf 'STOCK_VAR_SYMLINK=%s\n' "$VAR_LINK" > "$OUT/path-layout.txt"
ls -ld "$LAB/tmp" "$LAB/tmp/run" "$LAB/var" >> "$OUT/path-layout.txt" 2>&1 || true
QEMU="$(command -v qemu-mipsel-static || command -v qemu-mipsel)"
port=18023
report="$OUT/runtime-report.txt"
printf 'AX23 stock runtime-only proof. No mock HTTP backend.\n' > "$report"
http_trial() {
  local label="$1" pid code result
  result='NO_HTTP_RESPONSE'
  timeout --kill-after=1s 9s sudo chroot "$LAB" /__host/qemu-mipsel \
    /usr/sbin/uhttpd -f -h /www -p "127.0.0.1:$port" -x /cgi-bin \
    > "$OUT/uhttpd-$label.log" 2>&1 &
  pid=$!
  for attempt in $(seq 1 16); do
    code="$(curl --noproxy '*' -sS --max-time 1 -o "$OUT/stock-$label.html" \
      -w '%{http_code}' "http://127.0.0.1:$port/webpages/index.html" 2>/dev/null || true)"
    if [[ "$code" == '200' ]]; then
      if cmp -s "$SRC/www/webpages/index.html" "$OUT/stock-$label.html"; then
        result='STOCK_UHTTPD_STATIC_BYTE_IDENTICAL'
      else
        result='STOCK_UHTTPD_HTTP_200_DIFFERENT_CONTENT'
      fi
      break
    fi
    sleep .3
  done
  echo "$label=$result" | tee -a "$report"
  if kill -0 "$pid" 2>/dev/null; then
    echo "$label-PROCESS=RUNNING" | tee -a "$report"
  else
    echo "$label-PROCESS=EXITED" | tee -a "$report"
  fi
  if [[ "$result" == 'STOCK_UHTTPD_STATIC_BYTE_IDENTICAL' ]]; then
    code="$(curl --noproxy '*' -sS --max-time 2 -o "$OUT/cgi-$label.response" \
      -w '%{http_code}' "http://127.0.0.1:$port/cgi-bin/luci" 2>/dev/null || true)"
    echo "$label-CGI_GET_HTTP_STATUS=${code:-NOT_REACHABLE}" | tee -a "$report"
    echo "$label-CGI_GET_BYTES=$(wc -c < "$OUT/cgi-$label.response")" | tee -a "$report"
    for route in 'slash|/cgi-bin/luci/' 'check_factory_default|/cgi-bin/luci/login?form=check_factory_default' 'keys|/cgi-bin/luci/login?form=keys' 'invalid_form|/cgi-bin/luci/login?form=unrecognized_read_only_probe'; do
      name="${route%%|*}"
      rel="${route#*|}"
      c="$(curl --path-as-is --noproxy '*' -sS --max-time 2 -D "$OUT/cgi-$name.headers" -o "$OUT/cgi-$name.body" -w '%{http_code}' "http://127.0.0.1:$port$rel" 2>/dev/null || true)"
      bytes="$(wc -c < "$OUT/cgi-$name.body" 2>/dev/null || echo 0)"
      sha="$(sha256sum "$OUT/cgi-$name.body" 2>/dev/null | awk '{print $1}')"
      echo "$label-CGI_ADDITIONAL_GET=$rel HTTP_STATUS=$c BODY_BYTES=$bytes SHA256=$sha" | tee -a "$report"
      grep -iE '^Content-Type:' "$OUT/cgi-$name.headers" 2>/dev/null | tr -d '\r' | head -n 1 | tee -a "$report" || true
    done
    python3 - "$OUT/cgi-check_factory_default.body" "$OUT/cgi-keys.body" "$OUT/cgi-invalid_form.body" <<'PY' | tee -a "$report"
import json, pathlib, sys
for filename in sys.argv[1:]:
    p=pathlib.Path(filename)
    if not p.is_file():
        print('CGI_PAYLOAD_CLASS',p.name,'MISSING'); continue
    raw=p.read_bytes()
    if not raw:
        print('CGI_PAYLOAD_CLASS',p.name,'EMPTY'); continue
    try:
        d=json.loads(raw)
    except (ValueError,UnicodeDecodeError):
        typ='HTML' if b'<html' in raw[:256].lower() or b'<!doctype' in raw[:256].lower() else 'OTHER_NONJSON'
        print('CGI_PAYLOAD_CLASS',p.name,typ); continue
    keys=sorted(map(str,d.keys()))[:30] if isinstance(d,dict) else []
    print('CGI_PAYLOAD_CLASS',p.name,'JSON',type(d).__name__,'TOP_LEVEL_KEYS',','.join(keys))
    if isinstance(d,dict) and isinstance(d.get('data'),dict):
        print('CGI_DATA_KEYS',p.name,','.join(sorted(map(str,d['data'].keys()))[:30]))
    if isinstance(d,dict):
        success=d.get('success')
        if isinstance(success,bool):
            print('CGI_SUCCESS_FIELD',p.name,success)
        error=d.get('errorcode')
        if isinstance(error,(int,float)) and not isinstance(error,bool):
            print('CGI_ERRORCODE',p.name,error)
        elif isinstance(error,str) and error.lstrip('+-').isdigit() and len(error)<12:
            print('CGI_ERRORCODE',p.name,error)
        elif isinstance(error,str) and len(error)<34 and __import__('re').fullmatch(r'[A-Za-z][A-Za-z_\- ]{0,32}',error):
            print('CGI_ERRORCODE',p.name,error)
        else:
            print('CGI_ERRORCODE',p.name,'NONNUMERIC_OR_ABSENT',type(error).__name__)

# Raw responses may contain tokens. Never print their values, copy them to GitHub or commit them.
PY
  fi
  echo "$label-STDERR_BYTES=$(wc -c < "$OUT/uhttpd-$label.log")" | tee -a "$report"
  kill "$pid" 2>/dev/null || true
  # Previous wait on the QEMU child caused an eight-minute CI hang; do not wait here.
  tail -n 12 "$OUT/uhttpd-$label.log" | tee -a "$report"
}
# Previous PRoot on Ubuntu 26.04 failed even on guest BusyBox, so omit it from
# subsequent default CI probes.  No PRoot result is evidence of stock uhttpd.
echo 'PROOT_PREVIOUSLY_BLOCKED=YES; use tested QEMU chroot mode' | tee -a "$report"
echo '--- original stock LuCI/CGI metadata ---' | tee -a "$report"
ls -ld "$SRC/www/cgi-bin" "$SRC/www/cgi-bin/luci" | tee -a "$report" || true
file "$SRC/www/cgi-bin/luci" | tee -a "$report" || true
echo "STOCK_CGI_SHEBANG=$(head -n 1 "$SRC/www/cgi-bin/luci" | head -c 90)" | tee -a "$report"
readlink "$SRC/www/cgi-bin/luci" | tee -a "$report" || true
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
mkdir -p "$LAB/dev"
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
    timeout --kill-after=1s 12s sudo chroot "$LAB" /__host/qemu-mipsel /sbin/ubusd -s /var/run/ubus.sock > "$OUT/ubusd-chroot.log" 2>&1 &
    cpid=$!
    sleep 1
    http_trial "stock-chroot-with-stock-ubusd"
    echo '--- stock ubus registry (read-only, no objects invented) ---' | tee -a "$report"
    for ubus_exe in /bin/ubus /sbin/ubus /usr/bin/ubus; do
      if [ -f "$LAB$ubus_exe" ]; then
        if timeout --kill-after=1s 3s sudo chroot "$LAB" /__host/qemu-mipsel "$ubus_exe" -s /var/run/ubus.sock list >"$OUT/stock-ubus-objects.txt" 2>"$OUT/stock-ubus-error.txt"; then
          echo "STOCK_UBUS_OBJECT_COUNT=$(wc -l < "$OUT/stock-ubus-objects.txt")" | tee -a "$report"
          head -n 25 "$OUT/stock-ubus-objects.txt" | tee -a "$report"
        else
          echo 'STOCK_UBUS_LIST=BLOCKED' | tee -a "$report"
          head -n 3 "$OUT/stock-ubus-error.txt" | tee -a "$report"
        fi
        break
      fi
    done
    kill "$cpid" 2>/dev/null || true
    # No wait on emulated daemon here either.
    tail -n 10 "$OUT/ubusd-chroot.log" | tee -a "$report"
  fi
fi
echo '--- stock runtime-path and sysmode source candidates ---' | tee -a "$report"
cat "$OUT/path-layout.txt" | tee -a "$report"
echo 'STOCK_SYSMODE_PATHS:' | tee -a "$report"
timeout 7 grep -rIl 'sysmode' "$SRC/etc/init.d" "$SRC/etc/config" "$SRC/usr/lib/lua/luci" 2>/dev/null \
  | sed "s#^$SRC##" | sed -n '1,35p' | tee -a "$report" || true
echo 'STOCK_UBUS_SOCKET_PRESENT='$(test -S "$LAB/tmp/run/ubus.sock" && echo yes || echo no) | tee -a "$report"
echo "STOCK_SYSMODE_CONFIG_PRESENT=$(test -f "$SRC/etc/config/sysmode" && echo yes || echo no)" | tee -a "$report"
find "$SRC" -maxdepth 5 -name '*sysmode*' -print 2>/dev/null | sed "s#^$SRC##" | head -n 25 | tee -a "$report" || true
echo 'EVIDENCE_LIMIT=No CGI SET, no login success, no credential use, no config write.' | tee -a "$report"
