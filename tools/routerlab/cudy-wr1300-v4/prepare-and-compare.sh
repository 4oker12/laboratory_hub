#!/usr/bin/env bash
set -Eeuo pipefail

# Static stock-image inspection only. Never contacts or configures a router.
if [[ $# -ne 1 ]]; then echo "usage: prepare-and-compare.sh WORK_DIR" >&2; exit 2; fi
WORK="$(realpath -m "$1")"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
PREP="$REPO/tools/routerlab/cudy-r26-compat/prepare-firmware.sh"
SNAP="$REPO/tools/routerlab/cudy-r26-compat/contract-snapshot.py"
COMPARE="$REPO/tools/routerlab/cudy-wr1300-v4/compare-static.py"
TARGET="WR1300V4-R98-2.5.41-20261014-101624-flash.zip"
TARGET_URL="https://www.cudy.com/cdn/shop/files/$TARGET?v=1073746789692126678"
REF="WR1200V2-R26-2.4.23-20251224-145945-flash.zip"
REF_URL="https://www.cudy.com/cdn/shop/files/$REF?v=10287497656812635253"
REF_ZIP_SHA="def1d4b8472b5fef4d0f13d337d6c2f11127d14ef6bd7100780dbac0115aa35c"
REF_BIN_SHA="b9842ca6d6b54d4d2b8bb4d13457ee674ba2d13540443af1cf1ce82708ea02cd"

if [[ "$WORK" == "/" || "$WORK" == "$HOME" ]]; then
  echo "ERROR: work directory cannot be / or HOME" >&2
  exit 2
fi
for cmd in realpath curl unzip sha256sum unsquashfs strings python3; do
  command -v "$cmd" >/dev/null || { echo "Missing tool: $cmd" >&2; exit 3; }
done

if [[ -n "$(printenv CUDY_WR1300_ZIP || true)" ]]; then
  LOCAL_ZIP="$(realpath "$CUDY_WR1300_ZIP")"
  [[ -f "$LOCAL_ZIP" && "$(basename "$LOCAL_ZIP")" == "$TARGET" ]] || {
    echo "ERROR: CUDY_WR1300_ZIP must point to the official V4 filename" >&2
    exit 4
  }
  TARGET_URL="file://$LOCAL_ZIP"
fi

mkdir -p "$WORK"
bash "$PREP" wr1300-v4 "$TARGET_URL" "$TARGET" "$WORK/target"
python3 "$SNAP" "$WORK/target/rootfs" "$WORK/wr1300-contract.json" --label "WR1300 V4 2.5.41"

# Read-only static rootfs analyzers reused as tools, not as WR1200 assumptions.
bash "$REPO/devices/cudy/wr1200/v2-r26-2.4.23/analyze-stock-contract.sh" \
  "$WORK/target/rootfs" "$WORK/target/report"
bash "$REPO/devices/cudy/wr1200/v2-r26-2.4.23/disassemble-stock-lua.sh" \
  "$WORK/target/rootfs" "$WORK/target/report"

if [[ "$(printenv WR1300_TARGET_ONLY || true)" != "1" ]]; then
  bash "$PREP" wr1200-r26 "$REF_URL" "$REF" "$WORK/reference" "$REF_ZIP_SHA" "$REF_BIN_SHA"
  python3 "$SNAP" "$WORK/reference/rootfs" "$WORK/wr1200-contract.json" --label "WR1200 V2 R26 2.4.23"
  python3 "$COMPARE" "$WORK/wr1200-contract.json" "$WORK/wr1300-contract.json" "$WORK/STATIC_COMPARISON.md"
else
  printf 'Target-only mode: cross-model comparison UNVERIFIED.\n' > "$WORK/STATIC_COMPARISON.md"
fi

{
  echo "# WR1300 V4 static discovery"
  echo
  echo "No real hardware API calls or mutations were performed."
  echo
  echo "## Exact image hashes and SquashFS offset"
  echo
  cat "$WORK/target/report/summary.env"
  echo
  echo "## Archive contents"
  echo
  head -n 50 "$WORK/target/report/archive-list.txt"
  echo
  echo "## Stock release and first-boot hints"
  echo
  for f in etc/openwrt_release etc/openwrt_version etc/config/luci; do
    if [[ -f "$WORK/target/rootfs/$f" ]]; then
      echo "=== $f ==="
      head -n 90 "$WORK/target/rootfs/$f"
    fi
  done
} > "$WORK/TARGET_DISCOVERY.md"
echo "SUCCESS: $WORK"
