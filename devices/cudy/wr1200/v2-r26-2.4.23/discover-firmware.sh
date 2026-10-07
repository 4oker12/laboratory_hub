#!/usr/bin/env bash
set -Eeuo pipefail

URL="${CUDY_FIRMWARE_URL:-https://www.cudy.com/cdn/shop/files/WR1200V2-R26-2.4.23-20251224-145945-flash.zip?v=10287497656812635253}"
NAME="WR1200V2-R26-2.4.23-20251224-145945-flash.zip"
WORK="${1:-$PWD/.cudy-wr1200-discovery}"
REPORT="$WORK/report"
mkdir -p "$WORK" "$REPORT"
rm -rf "$WORK/unpacked"
mkdir -p "$WORK/unpacked"

curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 180   "$URL" -o "$WORK/$NAME"

sha256sum "$WORK/$NAME" | tee "$REPORT/firmware-archive.sha256"
unzip -l "$WORK/$NAME" | tee "$REPORT/archive-list.txt"
unzip -q "$WORK/$NAME" -d "$WORK/unpacked"

{
  echo "# Cudy WR1200 V2/R26 2.4.23 discovery"
  echo
  echo "## Archive"
  echo "```"
  sha256sum "$WORK/$NAME"
  echo "```"
  echo
  echo "## Files"
  find "$WORK/unpacked" -type f -printf '%P\n' | sort
  echo
  echo "## file(1)"
  find "$WORK/unpacked" -type f -print0 | while IFS= read -r -d '' f; do
    rel="${f#$WORK/unpacked/}"
    printf '%s: ' "$rel"
    file -b "$f"
  done
} > "$REPORT/DISCOVERY.md"

find "$WORK/unpacked" -type f -size +128k -print0 | while IFS= read -r -d '' f; do
  rel="${f#$WORK/unpacked/}"
  safe="${rel//\//_}"
  {
    echo "===== $rel ====="
    file "$f"
    stat -c 'size=%s bytes' "$f"
    echo
    echo "--- binwalk ---"
    binwalk "$f" || true
    echo
    echo "--- strings hints ---"
    strings -a "$f" | grep -Eai -m 120       'OpenWrt|BusyBox|Linux version|uhttpd|lighttpd|nginx|boa|LuCI|cgi-bin|ubus|uci|dropbear|WR1200|R26|Cudy|MediaTek|MT76|ramips|mips' || true
  } > "$REPORT/$safe.analysis.txt"
done

python3 - "$WORK/unpacked" "$REPORT/magic-offsets.txt" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
out = Path(sys.argv[2])
magics = {
    b"hsqs": "squashfs-le",
    b"sqsh": "squashfs-be/legacy",
    bytes.fromhex("27051956"): "uImage",
    bytes.fromhex("d00dfeed"): "FDT/FIT",
    bytes.fromhex("8519"): "jffs2-le",
    bytes.fromhex("1985"): "jffs2-be",
    b"UBI#": "UBI",
}
rows = []
for path in sorted(p for p in root.rglob("*") if p.is_file() and p.stat().st_size > 128 * 1024):
    data = path.read_bytes()
    for magic, label in magics.items():
        start = 0
        while True:
            pos = data.find(magic, start)
            if pos < 0:
                break
            rows.append(f"{path.relative_to(root)}\t0x{pos:x}\t{pos}\t{label}")
            start = pos + 1
out.write_text("\n".join(rows) + ("\n" if rows else ""), encoding="utf-8")
PY

cat "$REPORT/magic-offsets.txt" >> "$REPORT/DISCOVERY.md"
echo "Discovery report: $REPORT"
