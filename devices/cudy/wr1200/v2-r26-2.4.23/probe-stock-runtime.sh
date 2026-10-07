#!/usr/bin/env bash
set -Eeuo pipefail

ROOTFS="${1:?usage: probe-stock-runtime.sh ROOTFS REPORT_DIR}"
REPORT="${2:?usage: probe-stock-runtime.sh ROOTFS REPORT_DIR}"
mkdir -p "$REPORT"

QEMU="${QEMU_MIPSEL:-qemu-mipsel-static}"

run_stock() {
  proot -0 -r "$ROOTFS" -w / -q "$QEMU" "$@"
}

{
  echo "# Stock userspace runtime probe"
  echo
  echo "## ELF identities"
  file "$ROOTFS/usr/bin/lua" "$ROOTFS/sbin/uci" "$ROOTFS/usr/sbin/uhttpd" || true

  echo
  echo "## Stock Lua"
  set +e
  run_stock /usr/bin/lua -e 'print(_VERSION)' 2>&1
  echo "exit=$?"
  set -e

  echo
  echo "## Stock UCI reads immutable LuCI config"
  set +e
  run_stock /sbin/uci -c /etc/config show luci 2>&1
  echo "exit=$?"
  set -e

  echo
  echo "## Require luci.version"
  set +e
  run_stock /usr/bin/lua -e 'local ok,m=pcall(require,"luci.version"); print("ok="..tostring(ok)); if ok then print("dist="..tostring(m.distname)); print("version="..tostring(m.distversion)) else print(m) end' 2>&1
  echo "exit=$?"
  set -e

  echo
  echo "## Require luci.dispatcher without executing HTTP dispatch"
  set +e
  run_stock /usr/bin/lua -e 'local ok,m=pcall(require,"luci.dispatcher"); print("ok="..tostring(ok)); print(ok and type(m) or m)' 2>&1
  echo "exit=$?"
  set -e

  echo
  echo "## Stock uhttpd help/smoke"
  set +e
  run_stock /usr/sbin/uhttpd -h 2>&1 | head -n 120
  echo "exit=${PIPESTATUS[0]}"
  set -e

  echo
  echo "## bdinfo candidates"
  find "$ROOTFS" -type f -name 'bdinfo' -print | sed "s#^$ROOTFS##"
} > "$REPORT/stock-runtime-probe.txt"

BDINFO="$(find "$ROOTFS" -type f -name 'bdinfo' -print -quit)"
if [[ -n "$BDINFO" ]]; then
  REL="${BDINFO#$ROOTFS}"
  {
    echo "# Stock bdinfo hardware-boundary probe"
    echo "path=$REL"
    file "$BDINFO" || true
    for key in model factory check checkuuid mac pin country fuuid hmac dbg; do
      echo
      echo "## bdinfo $key"
      set +e
      out="$(run_stock "$REL" "$key" 2>&1)"
      rc=$?
      set -e
      printf '%s\n' "$out"
      echo "exit=$rc"
    done
  } > "$REPORT/bdinfo-probe.txt"
else
  echo "bdinfo executable not found in rootfs" > "$REPORT/bdinfo-probe.txt"
fi

cat "$REPORT/stock-runtime-probe.txt"
echo
cat "$REPORT/bdinfo-probe.txt"
