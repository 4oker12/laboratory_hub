#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: probe-auth-crypto.sh ROOTFS REPORT_DIR}"
REPORT="${2:?usage: probe-auth-crypto.sh ROOTFS REPORT_DIR}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
mkdir -p "$REPORT"

proot_cmd=(
  proot -0 -r "$ROOTFS"
  -b /proc
  -b /dev
  -w /
  -q "$QEMU"
)

run_guest() {
  "${proot_cmd[@]}" "$@"
}

# Public deterministic fixture only. Never use or print a router credential.
plain='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

{
  echo "# Cudy WR1200 stock auth crypto probe"
  echo
  echo "## Binary discovery"
  set +e
  run_guest /bin/sh -c 'command -v crypt; type crypt 2>/dev/null || true'
  echo "exit=$?"
  set -e
  echo

  echo "## Candidate identity"
  for candidate in /bin/crypt /usr/bin/crypt /sbin/crypt /usr/sbin/crypt; do
    if [[ -e "$ROOTFS$candidate" || -L "$ROOTFS$candidate" ]]; then
      echo "--- $candidate ---"
      ls -l "$ROOTFS$candidate" 2>&1 || true
      file -L "$ROOTFS$candidate" 2>&1 || true
      strings -a "$ROOTFS$candidate" 2>/dev/null | grep -E -m 120 'Usage|encrypt|decrypt|AES|base64|crypt|mtd|factory|key|uuid|hmac|bdinfo|/dev/' || true
    fi
  done

  echo
  echo "## Exact stock libbdinfo evidence"
  lib="$ROOTFS/usr/lib/libbdinfo.so"
  if [[ -f "$lib" ]]; then
    echo "--- identity ---"
    file "$lib" 2>&1 || true
    sha256sum "$lib" 2>&1 || true
    echo "--- dynamic symbols ---"
    readelf -Ws "$lib" 2>/dev/null | grep -E 'bdinfo|DES_|EVP_|AES_|mtd|crypt|key' | head -n 240 || true
    echo "--- printable dependency constants ---"
    strings -a "$lib" 2>/dev/null | grep -E 'bdinfo|/proc/mtd|/dev/mtd|mtd[0-9%]|DES|CBC|AES|88T3|factory|fuuid|hmac|secret|pin|country|mac|key' | head -n 320 || true
  else
    echo "libbdinfo_missing=yes"
  fi
  echo

  echo "## Exact stock firmware MTD/layout clues"
  grep -R -a -n -E 'bdinfo|mtdparts|partition.*bdinfo|0x7f0000|7f0000|firmware@|factory@' \
    "$ROOTFS/etc" "$ROOTFS/lib" "$ROOTFS/usr" 2>/dev/null | head -n 320 || true
  echo

  echo "## Proper file-mode invocation"
  run_guest /bin/sh -c 'rm -f /tmp/routerlab-crypt-in /tmp/routerlab-crypt-out /tmp/routerlab-crypt-roundtrip; : > /tmp/routerlab-crypt-in'
  printf '%s' "$plain" | run_guest /bin/sh -c 'cat > /tmp/routerlab-crypt-in'
  set +e
  run_guest /usr/bin/crypt -e -a -i /tmp/routerlab-crypt-in -o /tmp/routerlab-crypt-out     >"$REPORT/crypt-file-encrypt.stdout" 2>"$REPORT/crypt-file-encrypt.stderr"
  enc_rc=$?
  set -e
  echo "encrypt_exit=$enc_rc"
  echo "encrypted_present=$(run_guest /bin/sh -c '[ -s /tmp/routerlab-crypt-out ] && echo yes || echo no')"
  echo "encrypted_size=$(run_guest /bin/sh -c 'wc -c < /tmp/routerlab-crypt-out 2>/dev/null || echo 0')"
  echo "--- encrypt stdout ---"
  cat "$REPORT/crypt-file-encrypt.stdout" 2>/dev/null || true
  echo "--- encrypt stderr ---"
  cat "$REPORT/crypt-file-encrypt.stderr" 2>/dev/null || true

  if [[ "$enc_rc" -eq 0 ]]; then
    set +e
    run_guest /usr/bin/crypt -d -a -i /tmp/routerlab-crypt-out -o /tmp/routerlab-crypt-roundtrip       >"$REPORT/crypt-file-decrypt.stdout" 2>"$REPORT/crypt-file-decrypt.stderr"
    dec_rc=$?
    set -e
    echo "decrypt_exit=$dec_rc"
    roundtrip="$(run_guest /bin/sh -c 'cat /tmp/routerlab-crypt-roundtrip 2>/dev/null' || true)"
    echo "roundtrip_match=$([[ "$roundtrip" == "$plain" ]] && echo yes || echo no)"
    echo "--- decrypt stderr ---"
    cat "$REPORT/crypt-file-decrypt.stderr" 2>/dev/null || true
  fi

  echo
  echo "## qemu syscall trace around crypt key initialization"
  # QEMU_STRACE exposes guest syscalls without adding a tracer inside stock rootfs.
  # Filter the report so we retain dependency paths/ioctls but never fixture payload bytes.
  set +e
  QEMU_STRACE=1 run_guest /usr/bin/crypt -e -a -i /tmp/routerlab-crypt-in -o /tmp/routerlab-crypt-out     >/dev/null 2>"$REPORT/crypt-qemu-strace.raw"
  trace_rc=$?
  set -e
  echo "trace_exit=$trace_rc"
  grep -E 'open|openat|access|stat|ioctl|readlink|/dev/|/proc/|/sys/|mtd|factory|key|random|urandom'     "$REPORT/crypt-qemu-strace.raw" | head -n 240 || true

  echo
  echo "## Stock luci.sys.user API presence"
  set +e
  run_guest /usr/bin/lua -e '
    local ok,m=pcall(require,"luci.sys")
    print("require_luci_sys="..tostring(ok))
    if ok and m and m.user then
      print("user_table=yes")
      print("getpasswd="..tostring(type(m.user.getpasswd)))
      print("checkpasswd="..tostring(type(m.user.checkpasswd)))
      print("setpasswd="..tostring(type(m.user.setpasswd)))
    else
      print("user_table=no")
    end
  ' 2>&1
  echo "exit=$?"
  set -e
} > "$REPORT/auth-crypto-probe.txt"

cat "$REPORT/auth-crypto-probe.txt"
