#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: probe-auth-crypto.sh ROOTFS REPORT_DIR}"
REPORT="${2:?usage: probe-auth-crypto.sh ROOTFS REPORT_DIR}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
WORK="${CUDY_AUTH_WORK:-${REPORT%/*}/auth-crypto-runtime}"
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

# Deliberately public fixed data. This probe tests the vendor crypto transport
# used by LuCI's password storage without exposing any real or generated router
# credential.
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
  echo "## Candidate identity and printable constants"
  for candidate in /bin/crypt /usr/bin/crypt /sbin/crypt /usr/sbin/crypt; do
    if [[ -e "$ROOTFS$candidate" || -L "$ROOTFS$candidate" ]]; then
      echo "--- $candidate ---"
      ls -l "$ROOTFS$candidate" 2>&1 || true
      file -L "$ROOTFS$candidate" 2>&1 || true
      strings -a "$ROOTFS$candidate" 2>/dev/null | sed -n '1,500p' || true
    fi
  done
  echo
  echo "## Firmware references to crypt"
  grep -R -a -n -E 'crypt[[:space:]]+-[edag]|/usr/bin/crypt|init key' \
    "$ROOTFS/etc" "$ROOTFS/lib" "$ROOTFS/usr/lib/lua" "$ROOTFS/usr/bin" "$ROOTFS/usr/sbin" \
    2>/dev/null | head -n 300 || true
  echo
  echo "## Fixed-input round trip before key bootstrap"
  set +e
  encrypted="$(printf '%s' "$plain" | "${proot_cmd[@]}" /bin/sh -c 'crypt -ea' 2>"$REPORT/crypt-encrypt.stderr")"
  enc_rc=$?
  set -e
  echo "encrypt_exit=$enc_rc"
  echo "encrypted_present=$([[ -n "$encrypted" ]] && echo yes || echo no)"
  echo "encrypted_length=${#encrypted}"
  echo "encrypted_sha256=$(printf '%s' "$encrypted" | sha256sum | awk '{print $1}')"
  echo "--- encrypt stderr ---"
  cat "$REPORT/crypt-encrypt.stderr" 2>/dev/null || true
  echo
  echo "## qemu syscall trace around failing key initialization"
  set +e
  printf '%s' "$plain" | QEMU_STRACE=1 "${proot_cmd[@]}" /usr/bin/crypt -ea \
    >"$REPORT/crypt-strace.stdout" 2>"$REPORT/crypt-strace.stderr"
  trace_rc=$?
  set -e
  echo "trace_exit=$trace_rc"
  grep -E 'open|openat|access|stat|readlink|ioctl|mtd|key|random|urandom|bdinfo' \
    "$REPORT/crypt-strace.stderr" 2>/dev/null | sed -n '1,300p' || true

  if [[ "$enc_rc" -eq 0 && -n "$encrypted" ]]; then
    set +e
    decrypted="$(printf '%s' "$encrypted" | "${proot_cmd[@]}" /bin/sh -c 'crypt -da' 2>"$REPORT/crypt-decrypt.stderr")"
    dec_rc=$?
    set -e
    echo "decrypt_exit=$dec_rc"
    echo "roundtrip_match=$([[ "$decrypted" == "$plain" ]] && echo yes || echo no)"
    echo "decrypted_length=${#decrypted}"
    echo "--- decrypt stderr ---"
    cat "$REPORT/crypt-decrypt.stderr" 2>/dev/null || true
  fi
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
    else
      print("user_table=no")
    end
  ' 2>&1
  echo "exit=$?"
  set -e
} > "$REPORT/auth-crypto-probe.txt"

# -g is a vendor key-bootstrap mode according to the binary's own usage text.
# Exercise it only in a disposable copy and diff the filesystem. Never mutate
# the immutable extracted stock rootfs.
rm -rf "$WORK"
mkdir -p "$WORK"
tar -C "$ROOTFS" --exclude='./dev' -cf - . | tar -C "$WORK" -xf -
mkdir -p "$WORK/dev" "$WORK/proc" "$WORK/tmp"
chmod 1777 "$WORK/tmp"

runtime_proot=(
  proot -0 -r "$WORK"
  -b /proc
  -b /dev
  -w /
  -q "$QEMU"
)

snapshot_hashes() {
  local out="$1"
  (
    cd "$WORK"
    find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum
  ) > "$out"
}

snapshot_hashes "$REPORT/crypt-keygen-before.sha256"
{
  echo
  echo "## Disposable crypt -g key bootstrap"
  set +e
  QEMU_STRACE=1 "${runtime_proot[@]}" /usr/bin/crypt -g \
    >"$REPORT/crypt-keygen.stdout" 2>"$REPORT/crypt-keygen.stderr"
  keygen_rc=$?
  set -e
  echo "keygen_exit=$keygen_rc"
  echo "--- keygen stdout ---"
  sed -n '1,120p' "$REPORT/crypt-keygen.stdout" 2>/dev/null || true
  echo "--- keygen stderr / syscall clues ---"
  grep -E 'open|openat|access|stat|readlink|ioctl|mtd|key|random|urandom|bdinfo|error' \
    "$REPORT/crypt-keygen.stderr" 2>/dev/null | sed -n '1,300p' || true

  snapshot_hashes "$REPORT/crypt-keygen-after.sha256"
  echo "--- changed regular files ---"
  diff -u "$REPORT/crypt-keygen-before.sha256" "$REPORT/crypt-keygen-after.sha256" 2>/dev/null | \
    grep -E '^[+-][0-9a-f]{64} ' | sed -n '1,160p' || true

  echo
  echo "## Fixed-input round trip after crypt -g"
  set +e
  encrypted2="$(printf '%s' "$plain" | "${runtime_proot[@]}" /bin/sh -c 'crypt -ea' 2>"$REPORT/crypt-after-keygen.stderr")"
  enc2_rc=$?
  set -e
  echo "encrypt_exit=$enc2_rc"
  echo "encrypted_present=$([[ -n "$encrypted2" ]] && echo yes || echo no)"
  echo "encrypted_length=${#encrypted2}"
  echo "encrypted_sha256=$(printf '%s' "$encrypted2" | sha256sum | awk '{print $1}')"
  echo "--- encrypt stderr ---"
  cat "$REPORT/crypt-after-keygen.stderr" 2>/dev/null || true
  if [[ "$enc2_rc" -eq 0 && -n "$encrypted2" ]]; then
    set +e
    decrypted2="$(printf '%s' "$encrypted2" | "${runtime_proot[@]}" /bin/sh -c 'crypt -da' 2>"$REPORT/crypt-after-keygen-decrypt.stderr")"
    dec2_rc=$?
    set -e
    echo "decrypt_exit=$dec2_rc"
    echo "roundtrip_match=$([[ "$decrypted2" == "$plain" ]] && echo yes || echo no)"
    echo "decrypted_length=${#decrypted2}"
    cat "$REPORT/crypt-after-keygen-decrypt.stderr" 2>/dev/null || true
  fi
} >> "$REPORT/auth-crypto-probe.txt"

rm -rf "$WORK"
cat "$REPORT/auth-crypto-probe.txt"
