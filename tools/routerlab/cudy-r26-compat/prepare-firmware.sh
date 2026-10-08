#!/usr/bin/env bash
set -Eeuo pipefail

LABEL="${1:?usage: prepare-firmware.sh LABEL URL ARCHIVE_NAME WORK_DIR [EXPECTED_ARCHIVE_SHA256] [EXPECTED_BIN_SHA256]}"
URL="${2:?missing firmware URL}"
ARCHIVE_NAME="${3:?missing archive name}"
WORK="${4:?missing work dir}"
EXPECTED_ARCHIVE_SHA256="${5:-}"
EXPECTED_BIN_SHA256="${6:-}"

REPORT="$WORK/report"
UNPACKED="$WORK/unpacked"
ROOTFS="$WORK/rootfs"

for cmd in curl unzip sha256sum python3 unsquashfs file; do
  command -v "$cmd" >/dev/null || { echo "ERROR: missing command: $cmd" >&2; exit 20; }
done

rm -rf "$WORK"
mkdir -p "$REPORT" "$UNPACKED"

echo "[$LABEL] download: $ARCHIVE_NAME"
curl -fL --retry 4 --retry-delay 2 --connect-timeout 20 --max-time 240   "$URL" -o "$WORK/$ARCHIVE_NAME"

archive_sha="$(sha256sum "$WORK/$ARCHIVE_NAME" | awk '{print $1}')"
archive_size="$(stat -c '%s' "$WORK/$ARCHIVE_NAME")"
printf '%s  %s\n' "$archive_sha" "$ARCHIVE_NAME" > "$REPORT/archive.sha256"

if [[ -n "$EXPECTED_ARCHIVE_SHA256" && "$archive_sha" != "$EXPECTED_ARCHIVE_SHA256" ]]; then
  echo "ERROR: $LABEL archive SHA-256 mismatch" >&2
  echo "expected=$EXPECTED_ARCHIVE_SHA256" >&2
  echo "actual=$archive_sha" >&2
  exit 21
fi

unzip -l "$WORK/$ARCHIVE_NAME" > "$REPORT/archive-list.txt"
unzip -q "$WORK/$ARCHIVE_NAME" -d "$UNPACKED"

firmware_bin="$(find "$UNPACKED" -type f -name '*-flash.bin' -print -quit)"
[[ -n "$firmware_bin" ]] || { echo "ERROR: $LABEL flash .bin not found" >&2; exit 22; }

bin_sha="$(sha256sum "$firmware_bin" | awk '{print $1}')"
bin_size="$(stat -c '%s' "$firmware_bin")"

if [[ -n "$EXPECTED_BIN_SHA256" && "$bin_sha" != "$EXPECTED_BIN_SHA256" ]]; then
  echo "ERROR: $LABEL BIN SHA-256 mismatch" >&2
  echo "expected=$EXPECTED_BIN_SHA256" >&2
  echo "actual=$bin_sha" >&2
  exit 23
fi

python3 - "$firmware_bin" "$REPORT/squashfs-candidates.txt" <<'PY'
import sys
from pathlib import Path
src=Path(sys.argv[1]).read_bytes()
out=Path(sys.argv[2])
needle=b"hsqs"
offs=[]
start=0
while True:
    pos=src.find(needle,start)
    if pos < 0:
        break
    offs.append(pos)
    start=pos+1
out.write_text("\n".join(str(x) for x in offs)+("\n" if offs else ""))
PY

squash_offset=""
while IFS= read -r off; do
  [[ -n "$off" ]] || continue
  if unsquashfs -s -o "$off" "$firmware_bin" > "$REPORT/unsquashfs-superblock-$off.txt" 2>&1; then
    squash_offset="$off"
    break
  fi
done < "$REPORT/squashfs-candidates.txt"

[[ -n "$squash_offset" ]] || {
  echo "ERROR: $LABEL valid SquashFS offset not found" >&2
  exit 24
}

if command -v sudo >/dev/null 2>&1; then
  sudo unsquashfs -o "$squash_offset" -d "$ROOTFS" "$firmware_bin" > "$REPORT/unsquashfs.txt" 2>&1
  sudo chown -R "$(id -u):$(id -g)" "$ROOTFS"
else
  unsquashfs -o "$squash_offset" -d "$ROOTFS" "$firmware_bin" > "$REPORT/unsquashfs.txt" 2>&1
fi

{
  echo "label=$LABEL"
  echo "archive_name=$ARCHIVE_NAME"
  echo "archive_sha256=$archive_sha"
  echo "archive_size=$archive_size"
  echo "firmware_bin=$(basename "$firmware_bin")"
  echo "firmware_bin_sha256=$bin_sha"
  echo "firmware_bin_size=$bin_size"
  echo "squashfs_offset=$squash_offset"
  printf 'squashfs_offset_hex=0x%X\n' "$squash_offset"
  echo "rootfs_files=$(find "$ROOTFS" -type f | wc -l)"
  echo "rootfs_dirs=$(find "$ROOTFS" -type d | wc -l)"
} | tee "$REPORT/summary.env"

echo "[$LABEL] prepared rootfs=$ROOTFS"
