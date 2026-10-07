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
  echo "## Candidate identity"
  for candidate in /bin/crypt /usr/bin/crypt /sbin/crypt /usr/sbin/crypt; do
    if [[ -e "$ROOTFS$candidate" || -L "$ROOTFS$candidate" ]]; then
      echo "--- $candidate ---"
      ls -l "$ROOTFS$candidate" 2>&1 || true
      file -L "$ROOTFS$candidate" 2>&1 || true
      strings -a "$ROOTFS$candidate" 2>/dev/null | grep -E -m 40 'Usage|encrypt|decrypt|AES|base64|crypt' || true
    fi
  done
  echo
  echo "## Fixed-input round trip"
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

cat "$REPORT/auth-crypto-probe.txt"
