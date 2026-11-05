#!/usr/bin/env bash
# Read-only official AX23 image audit; starts no processes from firmware.
set -Eeuo pipefail
if (( $# < 1 || $# > 2 )); then echo "Usage: audit-local.sh OFFICIAL.zip [OUT_DIR]" >&2; exit 2; fi
ZIP="$(realpath "$1")"
OUT="$(realpath -m "${2:-./ax23-audit}")"
test -f "$ZIP" || { echo "file missing: $ZIP" >&2; exit 2; }
for tool in unzip sha256sum file python3; do command -v "$tool" >/dev/null || exit 3; done
mkdir -p "$OUT"; cd "$OUT"
echo "Structural audit ONLY; not management-plane evidence" | tee audit.txt
echo "ZIP: $ZIP" | tee -a audit.txt
sha256sum "$ZIP" | tee -a audit.txt
wc -c "$ZIP" | tee -a audit.txt
unzip -Z1 "$ZIP" | tee -a audit.txt
COUNT="$(unzip -Z1 "$ZIP" | grep -icE '\.bin$' || true)"
[[ "$COUNT" == 1 ]] || { echo "Expected one BIN: $COUNT" >&2; exit 4; }
NAME="$(unzip -Z1 "$ZIP" | grep -iE '\.bin$')"
# Use a literal star zip selector: embedded '[' in vendor filename is a wildcard metacharacter.
unzip -p "$ZIP" '*.bin' > firmware.bin
echo "Stock BIN: $NAME" | tee -a audit.txt
sha256sum firmware.bin | tee -a audit.txt
wc -c firmware.bin | tee -a audit.txt
file -k firmware.bin | tee -a audit.txt
if command -v binwalk >/dev/null; then binwalk firmware.bin | tee binwalk.txt; fi
python3 - <<'PY' | tee -a audit.txt
from pathlib import Path
b=Path('firmware.bin').read_bytes()
for k,v in [('squashfs',b'hsqs'),('uimage',b'\x27\x05\x19\x56'),('elf',b'\x7fELF')]:
 p=0; found=[]
 for _ in range(8):
  p=b.find(v,p)
  if p<0: break
  found.append(p); p+=1
 print(k,found)
PY
if command -v unsquashfs >/dev/null; then
 python3 - <<'PY' > offsets.txt
from pathlib import Path
b=Path('firmware.bin').read_bytes()
p=0
for _ in range(8):
 p=b.find(b'hsqs',p)
 if p<0: break
 print(p); p+=1
PY
 while read -r offset; do
  if timeout 75 unsquashfs -no-xattrs -d "rootfs-$offset" -o "$offset" firmware.bin > "unsquashfs-$offset.log" 2>&1; then
   echo "EXTRACTED_ROOTFS_OFFSET=$offset" | tee -a audit.txt
   find "rootfs-$offset" -type f | sort | sed -n '1,120p' | tee -a audit.txt
   break
  fi
 done < offsets.txt
fi
echo "No AX23 configuration SET/GET has been exercised." | tee -a audit.txt
