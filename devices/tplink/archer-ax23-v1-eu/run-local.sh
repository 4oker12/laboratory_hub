#!/usr/bin/env bash
# RouterLab AX23(EU) V1: original vendor firmware in isolated local Linux/WSL2.
# Docker not required. Never runs on host network or changes a physical router.
set -Eeuo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${ROUTERLAB_AX23_CACHE:-${HOME}/.cache/routerlab/archer-ax23-v1-eu}"
CACHE="$(realpath -m "$CACHE")"
STOCK="$CACHE/stock-rootfs"
GUEST="$CACHE/guest-rootfs"
STATE="$CACHE/state"
LOGS="$CACHE/logs"
ZIP="$CACHE/firmware-official.zip"
BIN="$CACHE/firmware-official.bin"
PORT=18023
URL="http://127.0.0.1:$PORT"
ZIP_URL='https://static.tp-link.com/upload/firmware/2025/202511/20251112/Archer%20AX23%28EU%29_1.0_250905.zip'
ZIP_SHA='f910fedaa2fd6f002785bc80eaa8388dd7ac34f3c03b752807984f7e032d3305'
BIN_SHA='217495e28251104ecbffaa1bbb361fc123bcc90707ba0650aef1a44c8c685839'

say(){ printf '[RouterLab AX23] %s\n' "$*"; }
fail(){ say "ERROR: $*" >&2; exit 1; }
usage(){
cat <<'USAGE'
Virtual AX23(EU) V1 with ORIGINAL TP-Link stock frontend and backend:
  bash run-local.sh start    Download official verified firmware and start
  bash run-local.sh status   Check genuine LuCI factory-state callback
  bash run-local.sh logs     Print recent local stock daemon/proxy logs
  bash run-local.sh stop     Stop isolated guest and local bridge
  bash run-local.sh reset    Reset only virtual guest config (confirmation)
Open in Windows/WSL browser:
  http://127.0.0.1:18023/webpages/index.html
Requires WSL2 or Linux with unshare/netns and qemu-mipsel binfmt.
Does NOT expose a public URL. Login/Quick Setup are still under research.
USAGE
}
need(){ command -v "$1" >/dev/null 2>&1 || fail "Required executable missing: $1"; }
check_cache(){
 case "$CACHE" in /|/home|/root|/tmp|/mnt|/mnt/c|/mnt/d) fail "Unsafe cache path $CACHE";; esac
 [[ ! -L "$CACHE" ]] || fail "Cache path is a symlink"
 mkdir -p "$CACHE" "$STATE" "$LOGS"
}
file_pid(){ [[ -r "$STATE/$1.pid" ]] && cat "$STATE/$1.pid" || true; }
live_pid(){ local pid="$1"; [[ "$pid" =~ ^[0-9]+$ ]] && ps -p "$pid" -o pid= >/dev/null 2>&1; }
within_guest_ns(){
 local pid="$1" namespace=''
 [[ "$pid" =~ ^[0-9]+$ ]] || return 1
 # Linux restricts reading root-owned /proc/<pid>/ns from an ordinary user.
 namespace="$(readlink "/proc/$pid/ns/net" 2>/dev/null || true)"
 if [[ -z "$namespace" && "$(id -u)" != 0 ]]; then
  namespace="$(sudo -n readlink "/proc/$pid/ns/net" 2>/dev/null || true)"
 fi
 [[ -n "$namespace" && "$namespace" != "$(readlink /proc/self/ns/net)" ]]
}
is_wsl(){ grep -qiE 'microsoft|wsl' /proc/sys/kernel/osrelease 2>/dev/null; }
install_deps(){
 local missing=0
 for item in curl unzip unsquashfs qemu-mipsel socat unshare nsenter ip file python3; do
  command -v "$item" >/dev/null || { say "Missing: $item"; missing=1; }
 done
 if ((missing)); then
  need apt-get
  say 'Installing emulation dependencies with sudo...'
  sudo apt-get update -qq
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
   curl unzip squashfs-tools qemu-user qemu-user-binfmt socat iproute2 file python3
 fi
 for item in curl unzip unsquashfs qemu-mipsel socat unshare nsenter ip file python3 sha256sum chroot ldd; do need "$item"; done
 if command -v update-binfmts >/dev/null 2>&1; then
  sudo update-binfmts --enable qemu-mipsel >/dev/null 2>&1 || true
 fi
 [[ -r /proc/sys/fs/binfmt_misc/qemu-mipsel ]] || fail 'MIPS binfmt_misc is missing. Stock Lua CGI cannot be launched without kernel binfmt.'
 grep -q '^enabled' /proc/sys/fs/binfmt_misc/qemu-mipsel || fail 'qemu-mipsel binfmt is disabled.'
}
ensure_firmware(){
 local provided="${ROUTERLAB_AX23_OFFICIAL_ZIP:-}"
 if [[ -n "$provided" ]]; then
  [[ -f "$provided" ]] || fail 'Supplied official ZIP not found'
  if [[ ! -f "$ZIP" ]] || ! (cd "$CACHE" && echo "$ZIP_SHA  firmware-official.zip" | sha256sum -c --status); then
   cp "$provided" "$ZIP"
  fi
 fi
 if [[ ! -f "$ZIP" ]] || ! (cd "$CACHE" && echo "$ZIP_SHA  firmware-official.zip" | sha256sum -c --status); then
  say 'Downloading official AX23(EU) V1 firmware...'
  curl -fLsS --retry 2 --connect-timeout 20 --max-time 120 "$ZIP_URL" -o "$ZIP.tmp"
  mv "$ZIP.tmp" "$ZIP"
 fi
 (cd "$CACHE" && echo "$ZIP_SHA  firmware-official.zip" | sha256sum -c) || fail 'ZIP SHA256 mismatch'
 if [[ ! -f "$BIN" ]] || ! (cd "$CACHE" && echo "$BIN_SHA  firmware-official.bin" | sha256sum -c --status); then
  unzip -p "$ZIP" '*.bin' > "$BIN.tmp"
  mv "$BIN.tmp" "$BIN"
 fi
 (cd "$CACHE" && echo "$BIN_SHA  firmware-official.bin" | sha256sum -c) || fail 'BIN SHA256 mismatch'
 if [[ ! -f "$STOCK/.routerlab-ax23-v1-verified" ]]; then
  say 'Extracting stock SquashFS at offset 3111990...'
  rm -rf -- "$STOCK.new"
  unsquashfs -no-xattrs -d "$STOCK.new" -o 3111990 "$BIN" > "$LOGS/unsquashfs.log" 2>&1 || fail 'Stock SquashFS extraction failed'
  [[ -x "$STOCK.new/usr/sbin/uhttpd" && -x "$STOCK.new/sbin/ubusd" && -f "$STOCK.new/www/cgi-bin/luci" ]] || fail 'Stock LuCI components not present'
  touch "$STOCK.new/.routerlab-ax23-v1-verified"
  mv "$STOCK.new" "$STOCK"
 fi
}
prepare_guest(){
 [[ -e "$GUEST" ]] || { say 'Creating persistent disposable guest configuration...'; cp -a --reflink=auto "$STOCK" "$GUEST"; }
 [[ -x "$GUEST/usr/sbin/uhttpd" && -f "$GUEST/www/cgi-bin/luci" ]] || fail 'Guest rootfs incomplete; use reset'
 mkdir -p "$GUEST/tmp" "$GUEST/__host" "$GUEST/dev"
 if [[ -L "$GUEST/var" && "$(readlink "$GUEST/var")" == /tmp ]]; then
  mkdir -p "$GUEST/tmp/run" "$GUEST/tmp/lock"
 else
  mkdir -p "$GUEST/var/run" "$GUEST/var/lock"
 fi
 local qemu; qemu="$(command -v qemu-mipsel)"
 cp "$qemu" "$GUEST/__host/qemu-mipsel"
 while IFS= read -r lib; do
  [[ -f "$lib" ]] || continue
  mkdir -p "$GUEST$(dirname "$lib")"
  cp -L "$lib" "$GUEST$lib"
 done < <(ldd "$qemu" | awk '{for(i=1;i<=NF;i++)if(substr($i,1,1)=="/")print $i}' | sort -u)
 for part in 'null 1 3' 'urandom 1 9'; do
  read -r name major minor <<< "$part"
  [[ -e "$GUEST/dev/$name" ]] || sudo mknod -m 666 "$GUEST/dev/$name" c "$major" "$minor"
 done
 sudo chroot "$GUEST" /__host/qemu-mipsel /bin/busybox echo STOCK_MIPS_OK | grep -Fxq STOCK_MIPS_OK || fail 'Stock BusyBox cannot execute'
}
run_guest(){
 local hostnet="$1"
 [[ "$(id -u)" == 0 ]] || fail 'Guest namespace requires root'
 [[ "$(readlink /proc/self/ns/net)" != "$hostnet" ]] || fail 'Guest shares host network: refusing'
 ! ip -4 route show default | grep -q '^default' || fail 'Guest has a default route: refusing'
 ip link set lo up
 printf '%s\n' "$BASHPID" > "$STATE/namespace.pid"
 say "STOCK_GUEST_NAMESPACE_PID=$BASHPID NETNS=$(readlink /proc/self/ns/net)"
 chroot "$GUEST" /__host/qemu-mipsel /sbin/ubusd -s /var/run/ubus.sock > "$LOGS/ubusd.log" 2>&1 &
 local ubpid=$!
 printf '%s\n' "$ubpid" > "$STATE/ubusd.pid"
 say "STOCK_GUEST_UBUSD_PID=$ubpid"
 local ok=0
 for x in $(seq 1 30); do
  [[ -S "$GUEST/tmp/run/ubus.sock" || -S "$GUEST/var/run/ubus.sock" ]] && { ok=1; break; }
  sleep .1
 done
 ((ok)) || fail 'Stock ubusd socket not available'
 chroot "$GUEST" /__host/qemu-mipsel /usr/sbin/uhttpd -f -h /www -p "127.0.0.1:$PORT" -x /cgi-bin > "$LOGS/uhttpd.log" 2>&1 &
 local webpid=$!
 printf '%s\n' "$webpid" > "$STATE/uhttpd.pid"
 say "STOCK_GUEST_UHTTPD_PID=$webpid"
 cleanup_guest(){ kill "$webpid" "$ubpid" 2>/dev/null || true; wait "$webpid" "$ubpid" 2>/dev/null || true; }
 trap cleanup_guest EXIT TERM INT
 # Preserve guest namespace while both original MIPS daemons run.
 while :; do
  if ! kill -0 "$ubpid" 2>/dev/null; then
   say 'STOCK_GUEST_UBUSD_EXITED'
   tail -n 5 "$LOGS/ubusd.log" >&2 || true
   break
  fi
  if ! kill -0 "$webpid" 2>/dev/null; then
   say 'STOCK_GUEST_UHTTPD_EXITED'
   tail -n 5 "$LOGS/uhttpd.log" >&2 || true
   break
  fi
  sleep .5
 done
}
run_proxy(){
 local nspid="$1"
 [[ "$(id -u)" == 0 ]] || fail 'Proxy requires root to enter guest netns'
 within_guest_ns "$nspid" || fail 'Guest namespace unavailable'
 printf '%s\n' "$BASHPID" > "$STATE/proxy.pid"
 # PUBLIC/BIND ALL INTERFACES IS FORBIDDEN; all listeners stay localhost.
 exec socat -d -d "TCP-LISTEN:$PORT,bind=127.0.0.1,reuseaddr,fork" \
  "EXEC:\"nsenter -t $nspid -n socat STDIO TCP:127.0.0.1:$PORT\",nofork"
}
status(){
 local nspid proxypid
 nspid="$(file_pid namespace)"; proxypid="$(file_pid proxy)"
 if ! live_pid "$nspid" || ! within_guest_ns "$nspid" || ! live_pid "$proxypid"; then
  say 'STOPPED (isolated guest or loopback proxy not running)'
  return 1
 fi
 local json
 json="$(curl --noproxy '*' -fsS --max-time 4 "$URL/cgi-bin/luci/login?form=check_factory_default&operation=read" 2>/dev/null || true)"
 [[ -n "$json" ]] || { say 'Stock Lua CGI is not reachable'; return 1; }
 printf '%s' "$json" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d.get("success") is True;v=d.get("data",{}).get("is_default");assert isinstance(v,bool);print("[RouterLab AX23] RUNNING original LuCI, factory_default="+str(v).lower())' || return 1
 say "Open: $URL/webpages/index.html"
}
start(){
 check_cache
 if status >/dev/null 2>&1; then status; return; fi
 if [[ -f "$STATE/namespace.pid" ]] && live_pid "$(file_pid namespace)"; then fail 'Guest still running; use stop first'; fi
 need sudo; sudo -v
 install_deps; ensure_firmware; prepare_guest
 say 'Starting vendor uhttpd and ubusd inside isolated network namespace...'
 local hostnet; hostnet="$(readlink /proc/self/ns/net)"
 for name in namespace ubusd uhttpd proxy; do : > "$STATE/$name.pid"; done
 for name in namespace ubusd uhttpd proxy; do : > "$LOGS/$name.log"; done
 sudo -n env ROUTERLAB_AX23_CACHE="$CACHE" unshare --net --mount --ipc --uts --fork -- \
  bash "$HERE/run-local.sh" internal-guest "$hostnet" > "$LOGS/namespace.log" 2>&1 &
 local nspid=''
 for x in $(seq 1 60); do
  nspid="$(file_pid namespace)"
  if within_guest_ns "$nspid" && [[ -s "$STATE/uhttpd.pid" ]] && live_pid "$(file_pid uhttpd)"; then break; fi
  sleep .15
 done
 if ! within_guest_ns "$nspid"; then
  say "Guest namespace failed: namespace_pid=${nspid:-absent}" >&2
  if [[ "$nspid" =~ ^[0-9]+$ ]]; then sudo -n readlink "/proc/$nspid/ns/net" >&2 || true; fi
  for f in namespace ubusd uhttpd; do
   echo "---- $f.log ----" >&2
   tail -n 25 "$LOGS/$f.log" >&2 2>/dev/null || true
  done
  fail 'Cannot start original AX23 guest namespace; unsafe host-network fallback refused'
 fi
 sudo -n env ROUTERLAB_AX23_CACHE="$CACHE" bash "$HERE/run-local.sh" internal-proxy "$nspid" > "$LOGS/proxy.log" 2>&1 &
 for x in $(seq 1 60); do
  [[ -s "$STATE/proxy.pid" ]] && curl --noproxy '*' -fsS --max-time 1 "$URL/webpages/index.html" -o /dev/null 2>/dev/null && break
  sleep .15
 done
 status || fail 'Local stock CGI/HTTP health check failed. See: bash run-local.sh logs'
 curl --noproxy '*' -fsS --max-time 4 "$URL/webpages/index.html" -o "$CACHE/readback.html"
 cmp -s "$STOCK/www/webpages/index.html" "$CACHE/readback.html" || fail 'Stock HTML mismatch'
 rm -f "$CACHE/readback.html"
 say 'Original stock HTML byte-identical: PASS'
 if is_wsl; then say 'Windows Chrome can normally open WSL localhost forwarding.'; fi
 say 'Only virtual guest config is writable. No physical AX23 was touched.'
}
stop(){
 check_cache; need sudo; sudo -v
 local pid expected
 for name in proxy namespace uhttpd ubusd; do
  pid="$(file_pid "$name")"
  [[ "$pid" =~ ^[0-9]+$ ]] || continue
  live_pid "$pid" || continue
  case "$name" in
   proxy) expected='TCP-LISTEN:18023';;
   namespace) expected='internal-guest';;
   uhttpd) expected='uhttpd';;
   ubusd) expected='ubusd';;
  esac
  if sudo grep -azq -- "$expected" "/proc/$pid/cmdline" 2>/dev/null; then
   sudo kill -TERM "$pid" 2>/dev/null || true
  else
   say "Stale PID $pid ($name) not killed; command mismatch"
  fi
 done
 sleep .3
 for name in proxy namespace uhttpd ubusd; do rm -f "$STATE/$name.pid"; done
 say "Stop requested. Guest configuration kept at $GUEST"
}
logs(){
 check_cache
 for name in namespace ubusd uhttpd proxy; do
  echo "--- $name.log ---"
  [[ ! -f "$LOGS/$name.log" ]] || tail -n 20 "$LOGS/$name.log"
 done
}
reset(){
 check_cache
 if live_pid "$(file_pid namespace)"; then fail 'Stop the guest before reset'; fi
 [[ -d "$GUEST" ]] || { say 'No guest configuration to reset'; return; }
 if [[ "${1:-}" != --yes ]]; then
  printf 'Delete ONLY the virtual AX23 configuration? Type RESET: '
  local reply; read -r reply
  [[ "$reply" == RESET ]] || fail 'Reset cancelled'
 fi
 [[ "$GUEST" == "$CACHE/guest-rootfs" && -d "$STOCK" ]] || fail 'Reset path guard failed'
 sudo rm -rf -- "$GUEST"
 say 'Guest reset. Next start clones original factory configuration.'
}
case "${1:-help}" in
 start) start;;
 status) status;;
 logs) logs;;
 stop) stop;;
 reset) reset "${2:-}";;
 internal-guest) check_cache;run_guest "${2:?host network namespace}";;
 internal-proxy) check_cache;run_proxy "${2:?guest PID}";;
 help|--help|-h) usage;;
 *) usage;exit 2;;
esac
