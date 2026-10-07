#!/usr/bin/env bash
set -Eeuo pipefail

# RouterLab — Xiaomi Mi Router 4A Gigabit stock-management-plane probe.
#
# Goal: separate "guest firmware/web stack works" from "WSL TAP transport works".
# The script NEVER touches the original FirmAE image. It clones scratch/<iid>/image.raw,
# injects a bounded diagnostic hook into the clone, boots it with QEMU SLIRP/user networking,
# forwards selected stock-management ports to localhost, captures evidence, and classifies
# the result.

usage() {
  cat <<'USAGE'
Usage: management-plane-agent.sh [options]

Options:
  --firmae-dir PATH   FirmAE root. Default: ~/routerlab-xiaomi-r4a/FirmAE
  --iid N             FirmAE image id. Default: 1
  --boot-wait SEC     Probe window before stopping early on success. Default: 120
  --run-seconds SEC   Hard upper bound for QEMU runtime. Default: 180
  --fresh             Re-clone the FirmAE image before the run
  -h, --help          Show this help

The script self-elevates with sudo when needed. All retries and waits are bounded.
USAGE
}

CALLER_HOME="${HOME:-}"
FIRMAE_DIR=""
IID=1
BOOT_WAIT=120
RUN_SECONDS=180
FRESH=0

while (($#)); do
  case "$1" in
    --firmae-dir) FIRMAE_DIR="$2"; shift 2 ;;
    --iid) IID="$2"; shift 2 ;;
    --boot-wait) BOOT_WAIT="$2"; shift 2 ;;
    --run-seconds) RUN_SECONDS="$2"; shift 2 ;;
    --fresh) FRESH=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$IID" =~ ^[0-9]+$ ]] || { echo "IID must be numeric" >&2; exit 2; }
[[ "$BOOT_WAIT" =~ ^[0-9]+$ ]] || { echo "BOOT_WAIT must be numeric" >&2; exit 2; }
[[ "$RUN_SECONDS" =~ ^[0-9]+$ ]] || { echo "RUN_SECONDS must be numeric" >&2; exit 2; }
(( BOOT_WAIT >= 20 && BOOT_WAIT <= 600 )) || { echo "BOOT_WAIT must be 20..600" >&2; exit 2; }
(( RUN_SECONDS >= BOOT_WAIT && RUN_SECONDS <= 900 )) || { echo "RUN_SECONDS must be >= BOOT_WAIT and <= 900" >&2; exit 2; }

if [[ -z "$FIRMAE_DIR" ]]; then
  FIRMAE_DIR="${CALLER_HOME}/routerlab-xiaomi-r4a/FirmAE"
fi

# Elevate only after paths/limits are resolved, so sudo cannot change HOME semantics.
if (( EUID != 0 )); then
  elevate_args=(--firmae-dir "$FIRMAE_DIR" --iid "$IID" --boot-wait "$BOOT_WAIT" --run-seconds "$RUN_SECONDS")
  (( FRESH == 1 )) && elevate_args+=(--fresh)
  exec sudo env ROUTERLAB_CALLER_HOME="$CALLER_HOME" FIRMAE_DIR="$FIRMAE_DIR" bash "$0" "${elevate_args[@]}"
fi

CALLER_HOME="${ROUTERLAB_CALLER_HOME:-$CALLER_HOME}"
FIRMAE_DIR="$(readlink -f "$FIRMAE_DIR")"
SOURCE_WORK="${FIRMAE_DIR}/scratch/${IID}"
SOURCE_IMAGE="${SOURCE_WORK}/image.raw"
ARCH_FILE="${SOURCE_WORK}/architecture"
WORK_ROOT="${FIRMAE_DIR}/routerlab-work/iid-${IID}"
LAB_IMAGE="${WORK_ROOT}/image.raw"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
ART="${WORK_ROOT}/runs/${RUN_ID}"
MOUNT_DIR="${ART}/mnt"
PROBE_TSV="${ART}/probe.tsv"
REPORT="${ART}/REPORT.md"

mkdir -p "$ART" "$MOUNT_DIR"

fail() {
  echo "[routerlab] ERROR: $*" >&2
  exit 1
}

for cmd in qemu-system-mipsel losetup mount umount e2fsck curl nc grep awk sed cp sha256sum; do
  command -v "$cmd" >/dev/null 2>&1 || fail "missing command: $cmd"
done

[[ -d "$FIRMAE_DIR" ]] || fail "FirmAE dir not found: $FIRMAE_DIR"
[[ -f "$FIRMAE_DIR/firmae.config" ]] || fail "firmae.config not found"
[[ -f "$SOURCE_IMAGE" ]] || fail "FirmAE image not found: $SOURCE_IMAGE"
[[ -f "$ARCH_FILE" ]] || fail "architecture file not found: $ARCH_FILE"

ARCH="$(tr -d '[:space:]' < "$ARCH_FILE")"
[[ "$ARCH" == "mipsel" ]] || fail "this probe is intentionally scoped to R4A/mipsel; got: $ARCH"

cd "$FIRMAE_DIR"
# shellcheck disable=SC1091
source ./firmae.config

KERNEL="$(get_kernel "$ARCH")"
QEMU="$(get_qemu "$ARCH")"
MACHINE="$(get_qemu_machine "$ARCH")"
ROOT_DEV="$(get_qemu_disk "$ARCH")"
[[ -f "$KERNEL" ]] || fail "FirmAE kernel missing: $KERNEL"

# Do not mutate or race a live FirmAE run. Kill only processes that reference this IID image.
mapfile -t stale_pids < <(pgrep -f "qemu-system-mipsel.*${SOURCE_WORK}/image.raw" || true)
if ((${#stale_pids[@]})); then
  echo "[routerlab] stopping stale QEMU for IID ${IID}: ${stale_pids[*]}"
  kill -INT "${stale_pids[@]}" 2>/dev/null || true
  for _ in {1..20}; do
    sleep 0.25
    alive=0
    for p in "${stale_pids[@]}"; do kill -0 "$p" 2>/dev/null && alive=1; done
    (( alive == 0 )) && break
  done
  for p in "${stale_pids[@]}"; do kill -9 "$p" 2>/dev/null || true; done
fi

mapfile -t infer_pids < <(pgrep -f "makeNetwork.py.*-i[[:space:]]+${IID}([[:space:]]|$)" || true)
if ((${#infer_pids[@]})); then
  echo "[routerlab] stopping stale makeNetwork.py for IID ${IID}: ${infer_pids[*]}"
  kill -INT "${infer_pids[@]}" 2>/dev/null || true
  sleep 1
  for p in "${infer_pids[@]}"; do kill -9 "$p" 2>/dev/null || true; done
fi

mkdir -p "$WORK_ROOT"
if [[ ! -f "$LAB_IMAGE" || "$FRESH" == 1 ]]; then
  echo "[routerlab] cloning canonical FirmAE image (original remains untouched)"
  rm -f "$LAB_IMAGE"
  cp --sparse=always "$SOURCE_IMAGE" "$LAB_IMAGE"
fi

sha256sum "$SOURCE_IMAGE" > "${ART}/source-image.sha256"
sha256sum "$LAB_IMAGE" > "${ART}/lab-image.before.sha256"

LOOP_DEV=""
PART_DEV=""
QEMU_PID=""
mounted=0

loop_attach() {
  LOOP_DEV="$(losetup --find --show -Pf "$LAB_IMAGE")"
  for _ in {1..40}; do
    if [[ -b "${LOOP_DEV}p1" ]]; then
      PART_DEV="${LOOP_DEV}p1"
      return 0
    fi
    sleep 0.25
  done
  fail "partition device did not appear for $LOOP_DEV"
}

loop_detach() {
  if (( mounted )); then
    umount "$MOUNT_DIR" 2>/dev/null || true
    mounted=0
  fi
  if [[ -n "$LOOP_DEV" ]]; then
    losetup -d "$LOOP_DEV" 2>/dev/null || true
    LOOP_DEV=""
    PART_DEV=""
  fi
}

cleanup() {
  set +e
  if [[ -n "$QEMU_PID" ]] && kill -0 "$QEMU_PID" 2>/dev/null; then
    kill -INT "$QEMU_PID" 2>/dev/null
    for _ in {1..20}; do
      kill -0 "$QEMU_PID" 2>/dev/null || break
      sleep 0.25
    done
    kill -9 "$QEMU_PID" 2>/dev/null || true
    wait "$QEMU_PID" 2>/dev/null || true
  fi
  loop_detach
}
trap cleanup EXIT INT TERM

loop_attach
# Repair only the disposable clone. Exit 1 means corrected errors and is acceptable.
set +e
e2fsck -p "$PART_DEV" >"${ART}/e2fsck.log" 2>&1
e2rc=$?
set -e
if (( e2rc > 1 )); then
  cat "${ART}/e2fsck.log" >&2
  fail "e2fsck failed on lab clone with rc=$e2rc"
fi

mount "$PART_DEV" "$MOUNT_DIR"
mounted=1

[[ -d "$MOUNT_DIR/firmadyne" ]] || fail "FirmAE instrumentation missing inside image"
mkdir -p "$MOUNT_DIR/firmadyne/routerlab"

# Static evidence from the exact emulated image.
{
  echo "# sysapihttpd static management map"
  for f in \
    "$MOUNT_DIR/etc/sysapihttpd/sysapihttpd.conf" \
    "$MOUNT_DIR/etc/sysapihttpd/miwifi-webinitrd.conf" \
    "$MOUNT_DIR/etc/sysapihttpd/miwifi-webinitrd-https.conf"; do
    [[ -f "$f" ]] || continue
    echo
    echo "## ${f#$MOUNT_DIR}"
    grep -nE 'listen[[:space:]]|include[[:space:]]|fastcgi_pass|proxy_pass|/cgi-bin|/api/' "$f" || true
  done
} > "${ART}/static-web-map.txt"

{
  grep -RhoE '/api/[A-Za-z0-9_.;?=:/-]+' \
    "$MOUNT_DIR/www" \
    "$MOUNT_DIR/etc/sysapihttpd/htdocs" \
    "$MOUNT_DIR/usr/lib/lua" 2>/dev/null || true
} | sed -E 's/["<>].*$//' | sort -u > "${ART}/api-endpoints.txt"

if [[ -f "$MOUNT_DIR/etc/config/misc" ]]; then
  grep -nE 'uhttpd|httpd' "$MOUNT_DIR/etc/config/misc" > "${ART}/misc-httpd.txt" || true
fi

# Replace only the disposable clone's FirmAE debug hook. It writes evidence back to
# /firmadyne/routerlab so it survives QEMU shutdown and can be collected host-side.
cat > "$MOUNT_DIR/firmadyne/debug.sh" <<'GUEST'
#!/firmadyne/sh
OUT=/firmadyne/routerlab/guest-diag.log
RUNTIME=/firmadyne/routerlab/runtime-sysapihttpd.conf
NGINXCHK=/firmadyne/routerlab/nginx-check.log
ERRLOG=/firmadyne/routerlab/sysapihttpd-error.log

# Keep one bounded remote shell for optional manual inspection. The host agent does
# not depend on it; this is evidence/escape hatch only.
/firmadyne/busybox nc -lp 31337 -e /firmadyne/sh >/dev/null 2>&1 &
/firmadyne/busybox telnetd -p 31338 -l /firmadyne/sh >/dev/null 2>&1 &

(
  /firmadyne/busybox sleep 60
  exec >>"$OUT" 2>&1
  echo "=== ROUTERLAB GUEST DIAG ==="
  date
  echo "=== PROCESSES ==="
  ps w
  echo "=== LISTENERS ==="
  netstat -lntp 2>/dev/null || netstat -lnt 2>/dev/null || true
  echo "=== ADDRESSES ==="
  ifconfig -a 2>/dev/null || ip addr 2>/dev/null || true
  echo "=== ROUTES ==="
  route -n 2>/dev/null || ip route 2>/dev/null || true
  echo "=== SYSAPI STATUS ==="
  /firmadyne/busybox timeout 10 /etc/init.d/sysapihttpd status 2>&1 || true
  echo "=== FCGI/SYSAPI PROCESS FILTER ==="
  ps w | grep -E 'sysapihttpd|fcgi|luci|supervisord' | grep -v grep || true
  echo "=== NGINX CHECK LOG ==="
  cat /tmp/nginx_check.log 2>/dev/null || true
  cp /tmp/nginx_check.log "$NGINXCHK" 2>/dev/null || true
  echo "=== RUNTIME CONFIG TEST ==="
  if [ -f /tmp/sysapihttpdconf/sysapihttpd.conf ]; then
    cp /tmp/sysapihttpdconf/sysapihttpd.conf "$RUNTIME" 2>/dev/null || true
    grep -nE 'listen[[:space:]]|include[[:space:]]|fastcgi_pass|proxy_pass|/cgi-bin|/api/' /tmp/sysapihttpdconf/sysapihttpd.conf 2>/dev/null || true
    /firmadyne/busybox timeout 15 /usr/sbin/sysapihttpd -c /tmp/sysapihttpdconf/sysapihttpd.conf -t 2>&1 || true
  else
    echo "runtime config missing"
  fi
  echo "=== SYSAPI ERROR LOG ==="
  cat /userdisk/sysapihttpd/log/error.log 2>/dev/null || true
  cp /userdisk/sysapihttpd/log/error.log "$ERRLOG" 2>/dev/null || true
  echo "=== KEY CONFIG ==="
  uci get misc.httpd.uhttpd 2>/dev/null || true
  uci get miwifi.server.API 2>/dev/null || true
  matool --method deviceID 2>/dev/null || true
  echo "=== DONE ==="
) &
exit 0
GUEST
chmod 0755 "$MOUNT_DIR/firmadyne/debug.sh"
sync
loop_detach

# QEMU user-mode network bypasses WSL TAP entirely. All four emulated NICs receive
# separate SLIRP networks; each gets distinct host forwards so we can discover which
# guest interface Xiaomi actually uses without assuming eth0/eth1 ordering.
netdev_for() {
  local id="$1" http="$2" https="$3" api="$4" share="$5" devshare="$6" fcgi="$7" dbg="$8"
  printf 'user,id=net%s,hostfwd=tcp:127.0.0.1:%s-:80,hostfwd=tcp:127.0.0.1:%s-:443,hostfwd=tcp:127.0.0.1:%s-:8190,hostfwd=tcp:127.0.0.1:%s-:8999,hostfwd=tcp:127.0.0.1:%s-:8899,hostfwd=tcp:127.0.0.1:%s-:8920,hostfwd=tcp:127.0.0.1:%s-:31337' \
    "$id" "$http" "$https" "$api" "$share" "$devshare" "$fcgi" "$dbg"
}

NET0="$(netdev_for 0 10080 10443 18190 18999 18899 18920 13137)"
NET1="$(netdev_for 1 20080 20443 28190 28999 28899 28920 23137)"
NET2="$(netdev_for 2 30080 30443 38190 38999 38899 38920 33137)"
NET3="$(netdev_for 3 40080 40443 48190 48999 48899 48920 43137)"

APPEND="root=${ROOT_DEV} console=ttyS0 nandsim.parts=64,64,64,64,64,64,64,64,64,64 rdinit=/firmadyne/preInit.sh rw debug ignore_loglevel print-fatal-signals=1 FIRMAE_NET=true FIRMAE_NVRAM=true FIRMAE_KERNEL=true FIRMAE_ETC=true user_debug=31 firmadyne.syscall=1"

printf 'timestamp\tnic\tguest_port\thost_port\ttcp\thttp_code\tpath\n' > "$PROBE_TSV"

probe_one() {
  local nic="$1" guest="$2" host="$3" path="$4" scheme="${5:-http}"
  local tcp=closed code=- marker=""

  if [[ "$scheme" == raw ]]; then
    marker="$(printf 'echo ROUTERLAB_DEBUG_OK\nexit\n' | nc -w 3 127.0.0.1 "$host" 2>/dev/null || true)"
    if grep -q 'ROUTERLAB_DEBUG_OK' <<<"$marker"; then
      tcp=open
      code=debug-ok
    fi
  elif [[ "$scheme" == https ]]; then
    code="$(curl -k -sS -o "${ART}/body-n${nic}-g${guest}.txt" -D "${ART}/headers-n${nic}-g${guest}.txt" --max-time 3 -w '%{http_code}' "https://127.0.0.1:${host}${path}" 2>/dev/null || true)"
    if [[ "$code" =~ ^[1-5][0-9][0-9]$ ]]; then tcp=open; else code=-; fi
  else
    code="$(curl -sS -o "${ART}/body-n${nic}-g${guest}.txt" -D "${ART}/headers-n${nic}-g${guest}.txt" --max-time 3 -w '%{http_code}' "http://127.0.0.1:${host}${path}" 2>/dev/null || true)"
    if [[ "$code" =~ ^[1-5][0-9][0-9]$ ]]; then tcp=open; else code=-; fi
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$nic" "$guest" "$host" "$tcp" "$code" "$path" >> "$PROBE_TSV"
}

probe_round() {
  probe_one 0 80 10080 /cgi-bin/luci/ http
  probe_one 1 80 20080 /cgi-bin/luci/ http
  probe_one 2 80 30080 /cgi-bin/luci/ http
  probe_one 3 80 40080 /cgi-bin/luci/ http
  probe_one 0 443 10443 /cgi-bin/luci/ https
  probe_one 1 443 20443 /cgi-bin/luci/ https
  probe_one 2 443 30443 /cgi-bin/luci/ https
  probe_one 3 443 40443 /cgi-bin/luci/ https
  probe_one 0 8190 18190 / http
  probe_one 1 8190 28190 / http
  probe_one 2 8190 38190 / http
  probe_one 3 8190 48190 / http
  probe_one 0 8999 18999 / http
  probe_one 1 8999 28999 / http
  probe_one 2 8999 38999 / http
  probe_one 3 8999 48999 / http
  probe_one 0 31337 13137 / raw
  probe_one 1 31337 23137 / raw
  probe_one 2 31337 33137 / raw
  probe_one 3 31337 43137 / raw
}

frontdoor_open() {
  awk -F '\t' 'NR>1 && ($3==80 || $3==443) && $5=="open" && $6 ~ /^[1-5][0-9][0-9]$/ { found=1 } END{ exit(found?0:1) }' "$PROBE_TSV"
}

internal_open() {
  awk -F '\t' 'NR>1 && ($3==8190 || $3==8999) && $5=="open" && $6 ~ /^[1-5][0-9][0-9]$/ { found=1 } END{ exit(found?0:1) }' "$PROBE_TSV"
}

echo "[routerlab] starting isolated SLIRP boot; hard limit ${RUN_SECONDS}s"
"$QEMU" \
  -m 1024 -M "$MACHINE" -kernel "$KERNEL" \
  -drive "if=ide,format=raw,file=${LAB_IMAGE}" \
  -append "$APPEND" \
  -serial "file:${ART}/qemu.serial.log" \
  -monitor none -display none \
  -device e1000,netdev=net0 -netdev "$NET0" \
  -device e1000,netdev=net1 -netdev "$NET1" \
  -device e1000,netdev=net2 -netdev "$NET2" \
  -device e1000,netdev=net3 -netdev "$NET3" \
  >"${ART}/qemu.stdout.log" 2>&1 &
QEMU_PID=$!

start_epoch="$(date +%s)"
next_probe=10
while kill -0 "$QEMU_PID" 2>/dev/null; do
  now="$(date +%s)"
  elapsed=$(( now - start_epoch ))
  (( elapsed >= RUN_SECONDS )) && break
  if (( elapsed >= next_probe )); then
    echo "[routerlab] probe at ${elapsed}s"
    probe_round
    next_probe=$(( next_probe + 10 ))
  fi
  # Once the stock front door is reachable and the guest diagnostic hook had time
  # to persist evidence, no reason to burn the full window.
  if (( elapsed >= 75 )) && frontdoor_open; then
    echo "[routerlab] stock front door reachable; enough evidence collected"
    break
  fi
  if (( elapsed >= BOOT_WAIT )) && internal_open; then
    echo "[routerlab] internal stock management HTTP reachable but front door still absent after ${BOOT_WAIT}s"
    break
  fi
  sleep 1
done

if kill -0 "$QEMU_PID" 2>/dev/null; then
  kill -INT "$QEMU_PID" 2>/dev/null || true
  for _ in {1..20}; do
    kill -0 "$QEMU_PID" 2>/dev/null || break
    sleep 0.25
  done
  kill -9 "$QEMU_PID" 2>/dev/null || true
fi
wait "$QEMU_PID" 2>/dev/null || true
QEMU_PID=""

# One final host-side probe is not useful after QEMU stopped; collect persistent guest evidence.
loop_attach
mount "$PART_DEV" "$MOUNT_DIR"
mounted=1
for f in guest-diag.log runtime-sysapihttpd.conf nginx-check.log sysapihttpd-error.log; do
  [[ -f "$MOUNT_DIR/firmadyne/routerlab/$f" ]] && cp "$MOUNT_DIR/firmadyne/routerlab/$f" "$ART/$f"
done
sync
loop_detach
sha256sum "$LAB_IMAGE" > "${ART}/lab-image.after.sha256"

front=0
internal=0
debug=0
config_ok=0
fcgi_seen=0
sysapi_seen=0
frontdoor_open && front=1 || true
internal_open && internal=1 || true
awk -F '\t' 'NR>1 && $3==31337 && $6=="debug-ok" { found=1 } END{ exit(found?0:1) }' "$PROBE_TSV" && debug=1 || true
[[ -f "$ART/guest-diag.log" ]] && grep -Eq 'sysapihttpd' "$ART/guest-diag.log" && sysapi_seen=1 || true
[[ -f "$ART/guest-diag.log" ]] && grep -Eq 'fcgi-cgi|spawn-fcgi' "$ART/guest-diag.log" && fcgi_seen=1 || true
if [[ -f "$ART/guest-diag.log" ]] && grep -Eqi 'syntax is ok|test is successful|configuration file .* test is successful' "$ART/guest-diag.log"; then
  config_ok=1
fi

classification="UNKNOWN"
next_step="Inspect guest-diag.log and qemu.serial.log; do not broaden emulation until the concrete blocker is known."
if (( front == 1 )); then
  classification="STOCK_FRONTDOOR_REACHABLE"
  next_step="Proceed to stock login/API read-only probe, then persistence acceptance. FirmAE full-hardware fidelity is not required."
elif (( internal == 1 || sysapi_seen == 1 )); then
  classification="STOCK_MANAGEMENT_BACKEND_ALIVE_FRONTDOOR_MISSING"
  next_step="Stop spending time on TAP/full-SoC fidelity. Reuse stock sysapi/Lua/frontend and shim only the missing front-door/runtime dependencies."
elif (( debug == 1 )); then
  classification="GUEST_ALIVE_MANAGEMENT_STACK_UNRESOLVED"
  next_step="Use the captured guest diagnostic to identify the first failing service/config dependency; allow one minimal shim pass only."
else
  classification="FIRMAE_NOT_ECONOMICAL_FOR_WEB"
  next_step="Pivot to management-plane rehost from the exact stock rootfs/API map; do not chase hardware emulation."
fi

cat > "$REPORT" <<EOF_REPORT
# Xiaomi R4A stock management-plane run

- Run: ${RUN_ID}
- FirmAE: ${FIRMAE_DIR}
- IID: ${IID}
- Architecture: ${ARCH}
- Original FirmAE image modified: **no**
- Network mode: QEMU SLIRP/user-mode (WSL TAP bypass)
- Hard runtime limit: ${RUN_SECONDS}s

## Classification

**${classification}**

## Evidence flags

- stock front-door TCP/80 reachable through at least one emulated NIC: ${front}
- stock internal sysapi/share port reachable: ${internal}
- FirmAE debug shell reachable: ${debug}
- sysapihttpd seen in guest evidence: ${sysapi_seen}
- FCGI/LuCI process seen in guest evidence: ${fcgi_seen}
- runtime sysapi config test reported success: ${config_ok}

## Decision

${next_step}

## Artifacts

- probe.tsv — host-side port/API observations
- qemu.serial.log — guest serial evidence
- guest-diag.log — processes/listeners/runtime config test (when hook ran)
- runtime-sysapihttpd.conf — exact runtime config (when available)
- static-web-map.txt — stock config listeners/includes from the disposable clone
- api-endpoints.txt — statically discovered stock API paths
- e2fsck.log — clone filesystem repair evidence
EOF_REPORT

cat "$REPORT"
echo "[routerlab] artifacts: $ART"
