#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DEVICE="$REPO_ROOT/devices/cudy/wr1200/v2-r26-2.4.23"
WEB="$REPO_ROOT/tools/routerlab/web-demo"
TABLE="$SCRIPT_DIR/firmwares.tsv"
WORK="${1:-$HOME/cudy-r26-compat}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"

mkdir -p "$WORK" "$WORK/reports" "$WORK/probe-rc"

for cmd in curl unzip file unsquashfs python3 proot "$QEMU" timeout; do
  if [[ "$cmd" == /* ]]; then
    [[ -x "$cmd" ]] || { echo "ERROR: missing executable $cmd" >&2; exit 20; }
  else
    command -v "$cmd" >/dev/null || { echo "ERROR: missing command $cmd" >&2; exit 20; }
  fi
done

declare -a VERSIONS=()
declare -A ROLE ARCHIVE URL ZIP_SHA BIN_SHA

while IFS=$'\t' read -r role version archive url zip_sha bin_sha; do
  [[ "$role" == "role" || -z "$role" ]] && continue
  VERSIONS+=("$version")
  ROLE["$version"]="$role"
  ARCHIVE["$version"]="$archive"
  URL["$version"]="$url"
  ZIP_SHA["$version"]="$zip_sha"
  BIN_SHA["$version"]="$bin_sha"
done < "$TABLE"

REFERENCE=""
for version in "${VERSIONS[@]}"; do
  if [[ "${ROLE[$version]}" == "reference" ]]; then
    REFERENCE="$version"
    break
  fi
done
[[ -n "$REFERENCE" ]] || { echo "ERROR: no reference firmware in $TABLE" >&2; exit 21; }

echo "===== PREPARE FIRMWARES ====="
for version in "${VERSIONS[@]}"; do
  echo
  echo "### $version"
  bash "$SCRIPT_DIR/prepare-firmware.sh" \
    "$version" \
    "${URL[$version]}" \
    "${ARCHIVE[$version]}" \
    "$WORK/$version" \
    "${ZIP_SHA[$version]}" \
    "${BIN_SHA[$version]}"

  python3 "$SCRIPT_DIR/contract-snapshot.py" \
    "$WORK/$version/rootfs" \
    "$WORK/$version/report/contract.json" \
    --label "WR1200 V2/R26 $version"
done

run_probe_suite() {
  local version="$1"
  local root="$WORK/$version/rootfs"
  local work="$WORK/$version/probes"
  local report="$WORK/$version/report"
  mkdir -p "$work" "$report"

  run_probe() {
    local name="$1"
    local seconds="$2"
    shift 2
    echo "===== $version / $name ====="
    set +e
    timeout --signal=TERM --kill-after=10s "$seconds" \
      "$@" >"$report/runner-$name.log" 2>&1
    local rc=$?
    set -e
    echo "$rc" > "$WORK/probe-rc/$version-$name.rc"
    echo "$version/$name rc=$rc"
    tail -n 16 "$report/runner-$name.log" || true
  }

  run_probe stock-contract 60s \
    bash "$DEVICE/analyze-stock-contract.sh" "$root" "$report"

  run_probe disassembly 60s \
    bash "$DEVICE/disassemble-stock-lua.sh" "$root" "$report"

  run_probe firstboot 120s \
    env QEMU_MIPSEL="$QEMU" \
    bash "$DEVICE/probe-stock-firstboot.sh" "$root" "$work/firstboot" "$report"

  run_probe factory-bootstrap 120s \
    env QEMU_MIPSEL="$QEMU" \
    bash "$DEVICE/probe-factory-bootstrap.sh" "$root" "$work/factory" "$report"

  run_probe stock-runtime 90s \
    env QEMU_MIPSEL="$QEMU" \
    bash "$DEVICE/probe-stock-runtime.sh" "$root" "$report"

  run_probe auth-crypto 90s \
    env QEMU_MIPSEL="$QEMU" \
    bash "$DEVICE/probe-auth-crypto.sh" "$root" "$report"

  run_probe qsetup 90s \
    env QEMU_MIPSEL="$QEMU" \
    bash "$DEVICE/probe-qsetup-contract.sh" "$root" "$report"

  run_probe management-plane 180s \
    env QEMU_MIPSEL="$QEMU" \
    bash "$DEVICE/probe-management-plane.sh" "$root" "$work/management" "$report"
}

echo
echo "===== RESEARCH PROBE MATRIX ====="
for version in "${VERSIONS[@]}"; do
  run_probe_suite "$version"
done

run_acceptance() {
  local version="$1"
  local root="$WORK/$version/rootfs"
  local lab="$WORK/$version/web-lab"
  local out="$WORK/$version/acceptance"
  local port="$2"
  mkdir -p "$out"

  set +e
  ROUTERLAB_CUDY_ROOTFS="$root" \
  ROUTERLAB_CUDY_WEB_WORK="$lab" \
  ROUTERLAB_CUDY_PORT="$port" \
  QEMU_MIPSEL="$QEMU" \
    timeout --signal=TERM --kill-after=10s 150s \
    bash "$WEB/cudy-factory-runtime.sh" reset \
    >"$out/reset.log" 2>&1
  local reset_rc=$?
  echo "$reset_rc" > "$out/reset.rc"

  local quick_rc=99
  if [[ "$reset_rc" -eq 0 ]]; then
    ROUTERLAB_CUDY_RUNTIME="$lab/runtime" \
    ROUTERLAB_CUDY_PORT="$port" \
    QEMU_MIPSEL="$QEMU" \
      timeout --signal=TERM --kill-after=10s 120s \
      bash "$WEB/cudy-quick-setup.sh" \
      >"$out/quick-setup.log" 2>&1
    quick_rc=$?
  else
    echo "quick setup skipped: factory runtime reset failed" > "$out/quick-setup.log"
  fi
  echo "$quick_rc" > "$out/quick-setup.rc"

  ROUTERLAB_CUDY_ROOTFS="$root" \
  ROUTERLAB_CUDY_WEB_WORK="$lab" \
  ROUTERLAB_CUDY_PORT="$port" \
  QEMU_MIPSEL="$QEMU" \
    bash "$WEB/cudy-factory-runtime.sh" stop \
    >>"$out/reset.log" 2>&1 || true
  set -e

  echo "===== $version acceptance: reset=$reset_rc quick=$quick_rc ====="
  tail -n 30 "$out/quick-setup.log" || true
}

echo
echo "===== FULL STAGE 2 ADAPTER ACCEPTANCE ====="
port=18123
for version in "${VERSIONS[@]}"; do
  run_acceptance "$version" "$port"
  port=$((port + 1))
done

echo
echo "===== PAIRWISE REPORTS ====="
for version in "${VERSIONS[@]}"; do
  [[ "$version" == "$REFERENCE" ]] && continue

  python3 "$SCRIPT_DIR/compare-contracts.py" \
    --reference "$WORK/$REFERENCE/report/contract.json" \
    --candidate "$WORK/$version/report/contract.json" \
    --reference-reset-log "$WORK/$REFERENCE/acceptance/reset.log" \
    --candidate-reset-log "$WORK/$version/acceptance/reset.log" \
    --reference-quick-log "$WORK/$REFERENCE/acceptance/quick-setup.log" \
    --candidate-quick-log "$WORK/$version/acceptance/quick-setup.log" \
    --reference-reset-rc "$WORK/$REFERENCE/acceptance/reset.rc" \
    --candidate-reset-rc "$WORK/$version/acceptance/reset.rc" \
    --reference-quick-rc "$WORK/$REFERENCE/acceptance/quick-setup.rc" \
    --candidate-quick-rc "$WORK/$version/acceptance/quick-setup.rc" \
    --output "$WORK/reports/$REFERENCE-vs-$version.md"
done

{
  echo "# Cudy WR1200 V2/R26 compatibility sweep"
  echo
  echo "Reference: **$REFERENCE**"
  echo
  echo "| Firmware | ZIP SHA-256 | BIN SHA-256 | Reset | Quick setup | Verdict | First divergence |"
  echo "|---|---|---|---:|---:|---|---|"

  for version in "${VERSIONS[@]}"; do
    summary="$WORK/$version/report/summary.env"
    zip="$(sed -n 's/^archive_sha256=//p' "$summary")"
    bin="$(sed -n 's/^firmware_bin_sha256=//p' "$summary")"
    reset="$(cat "$WORK/$version/acceptance/reset.rc" 2>/dev/null || echo 99)"
    quick="$(cat "$WORK/$version/acceptance/quick-setup.rc" 2>/dev/null || echo 99)"

    if [[ "$version" == "$REFERENCE" ]]; then
      verdict="REFERENCE"
      first="-"
    else
      report="$WORK/reports/$REFERENCE-vs-$version.md"
      verdict="$(sed -n 's/^- Verdict: \*\*\(.*\)\*\*/\1/p' "$report" | head -n1)"
      first="$(sed -n 's/^- First runtime divergence: \*\*\(.*\)\*\*/\1/p' "$report" | head -n1)"
    fi

    echo "| $version | \`$zip\` | \`$bin\` | $reset | $quick | $verdict | $first |"
  done
} > "$WORK/reports/INDEX.md"

cat "$WORK/reports/INDEX.md"

ref_reset="$(cat "$WORK/$REFERENCE/acceptance/reset.rc" 2>/dev/null || echo 99)"
ref_quick="$(cat "$WORK/$REFERENCE/acceptance/quick-setup.rc" 2>/dev/null || echo 99)"
if [[ "$ref_reset" != "0" || "$ref_quick" != "0" ]]; then
  echo "ERROR: reference control failed reset=$ref_reset quick=$ref_quick" >&2
  exit 30
fi

echo "matrix_complete=1"
