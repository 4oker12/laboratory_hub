#!/usr/bin/env bash
set -Eeuo pipefail

URL="${CUDY_FIRMWARE_URL:-https://www.cudy.com/cdn/shop/files/WR1200V2-R26-2.4.23-20251224-145945-flash.zip?v=10287497656812635253}"
NAME="WR1200V2-R26-2.4.23-20251224-145945-flash.zip"
EXPECTED_ARCHIVE_SHA256="def1d4b8472b5fef4d0f13d337d6c2f11127d14ef6bd7100780dbac0115aa35c"
WORK="${1:-$PWD/.cudy-wr1200-discovery}"
REPORT="$WORK/report"
UNPACKED="$WORK/unpacked"
ROOTFS="$WORK/rootfs"
mkdir -p "$WORK"
rm -rf "$REPORT" "$UNPACKED" "$ROOTFS"
mkdir -p "$REPORT" "$UNPACKED"

curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 180   "$URL" -o "$WORK/$NAME"

archive_sha="$(sha256sum "$WORK/$NAME" | awk '{print $1}')"
printf '%s  %s\n' "$archive_sha" "$NAME" | tee "$REPORT/firmware-archive.sha256"
if [[ "$archive_sha" != "$EXPECTED_ARCHIVE_SHA256" ]]; then
  echo "archive SHA-256 mismatch: expected $EXPECTED_ARCHIVE_SHA256 got $archive_sha" >&2
  exit 10
fi

unzip -l "$WORK/$NAME" | tee "$REPORT/archive-list.txt"
unzip -q "$WORK/$NAME" -d "$UNPACKED"

find "$UNPACKED" -type f -print0 | sort -z | xargs -0 sha256sum > "$REPORT/extracted-files.sha256"
find "$UNPACKED" -type f -print0 | sort -z | while IFS= read -r -d '' f; do
  rel="${f#$UNPACKED/}"
  printf '%s: ' "$rel"
  file -b "$f"
done > "$REPORT/file-types.txt"

firmware_bin="$(find "$UNPACKED" -maxdepth 1 -type f -name '*-flash.bin' -print -quit)"
[[ -n "$firmware_bin" ]] || { echo "flash .bin not found" >&2; exit 11; }

binwalk "$firmware_bin" > "$REPORT/binwalk.txt"
strings -a "$firmware_bin" | grep -Eai -m 160   'OpenWrt|LEDE|BusyBox|Linux version|uhttpd|lighttpd|nginx|boa|LuCI|cgi-bin|ubus|uci|dropbear|WR1200|R26|Cudy|MediaTek|MT76|ramips|mips'   > "$REPORT/strings-hints.txt" || true

squash_offset="$(
  awk '/Squashfs filesystem/ {print $1; exit}' "$REPORT/binwalk.txt"
)"
[[ "$squash_offset" =~ ^[0-9]+$ ]] || {
  echo "could not determine SquashFS offset" >&2
  cat "$REPORT/binwalk.txt" >&2
  exit 12
}

if ! sudo unsquashfs -o "$squash_offset" -d "$ROOTFS" "$firmware_bin" > "$REPORT/unsquashfs.txt" 2>&1; then
  echo "unsquashfs failed at offset $squash_offset" >&2
  cat "$REPORT/unsquashfs.txt" >&2 || true
  exit 13
fi
sudo chown -R "$(id -u):$(id -g)" "$ROOTFS"

{
  echo "archive_sha256=$archive_sha"
  echo "firmware_bin=$(basename "$firmware_bin")"
  echo "firmware_bin_sha256=$(sha256sum "$firmware_bin" | awk '{print $1}')"
  echo "firmware_bin_size=$(stat -c '%s' "$firmware_bin")"
  echo "squashfs_offset=$squash_offset"
  echo "rootfs_files=$(find "$ROOTFS" -type f | wc -l)"
  echo "rootfs_dirs=$(find "$ROOTFS" -type d | wc -l)"
} > "$REPORT/summary.env"

{
  for f in     "$ROOTFS/etc/openwrt_release"     "$ROOTFS/etc/openwrt_version"     "$ROOTFS/etc/banner"     "$ROOTFS/etc/os-release"; do
    [[ -f "$f" ]] || continue
    echo "===== ${f#$ROOTFS} ====="
    sed -n '1,120p' "$f"
    echo
  done

  echo "===== web/runtime binaries ====="
  find "$ROOTFS" -type f \(     -name 'uhttpd' -o -name 'nginx' -o -name 'lighttpd' -o -name 'boa' -o     -name 'rpcd' -o -name 'ubusd' -o -name 'uci' -o -name 'opkg' -o     -name 'dropbear' -o -name 'lua' -o -name 'luci'   \) -printf '%p\n' | sed "s#^$ROOTFS##" | sort

  echo
  echo "===== important trees ====="
  for d in etc/config etc/init.d etc/uci-defaults usr/lib/lua/luci www; do
    if [[ -d "$ROOTFS/$d" ]]; then
      printf '%s\n' "/$d"
      find "$ROOTFS/$d" -maxdepth 2 -type f -printf '  %P\n' | head -n 240
    fi
  done

  echo
  echo "===== LuCI route/controller hints ====="
  if [[ -d "$ROOTFS/usr/lib/lua/luci" ]]; then
    grep -RInaE -m 250       'entry\(|first.?run|wizard|login|password|wireless|wifi|pppoe|dhcp|wan'       "$ROOTFS/usr/lib/lua/luci/controller"       "$ROOTFS/usr/lib/lua/luci/model" 2>/dev/null       | sed "s#^$ROOTFS##" || true
  fi
} > "$REPORT/rootfs-inventory.txt"

{
  echo "# Cudy WR1200 V2/R26 2.4.23 discovery"
  echo
  echo "## Exact archive"
  echo
  printf -- '- SHA-256: `%s`\n' "$archive_sha"
  printf -- '- file: `%s`\n' "$NAME"
  echo
  echo "## Firmware structure"
  echo
  sed -n '1,100p' "$REPORT/binwalk.txt"
  echo
  echo "## Rootfs summary"
  echo
  sed -n '1,80p' "$REPORT/summary.env"
  echo
  echo "## Runtime / management-plane inventory"
  echo
  sed -n '1,260p' "$REPORT/rootfs-inventory.txt"
} > "$REPORT/DISCOVERY.md"

echo "Discovery report: $REPORT"
