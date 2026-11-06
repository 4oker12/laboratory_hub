#!/usr/bin/env bash
# Synthetic fixture: validates archive extraction with special vendor-style brackets only.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
python3 - "$WORK" <<'PY'
import sys,zipfile,pathlib
p=pathlib.Path(sys.argv[1])/'synthetic.zip'
with zipfile.ZipFile(p,'w') as z:
 z.writestr('AX23v1[20250905-rel39233].bin',b'NOT-A-TP-LINK-FIRMWARE')
PY
bash "$ROOT/devices/tplink/archer-ax23-v1-eu/audit-local.sh" "$WORK/synthetic.zip" "$WORK/result" >/dev/null
grep -q 'No AX23 configuration SET/GET' "$WORK/result/audit.txt"
grep -q 'AX23v1\[20250905-rel39233\].bin' "$WORK/result/audit.txt"
echo 'PASS: synthetic archive parsing only, no real AX23 capabilities tested'
