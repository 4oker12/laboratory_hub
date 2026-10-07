#!/usr/bin/env bash
set -Eeuo pipefail

# Xiaomi R4A Global 3.0.24 persistent management-plane emulator.
#
# Authenticity boundary:
# - exact stock rootfs is the immutable source of /www, fcgi-cgi, LuCI and Xiaomi API;
# - qemu-user executes the original MIPSel FastCGI/LuCI userspace;
# - compat-frontdoor.py replaces ONLY Xiaomi sysapihttpd transport/session plumbing that
#   aborts under qemu-user on SO_ORIGINAL_DST/session state;
# - persistent router state v1 is the writable UCI /etc/config tree.
#
# No RF/PHY/switch ASIC emulation. No subscriber-installed OpenWrt is assumed.

COMMAND="${1:-}"
[[ -n "$COMMAND" ]] || COMMAND="status"
if (($#)); then shift; fi

ROOTFS="${HOME}/routerlab-xiaomi-r4a/audit/squashfs-root"
BASE="${HOME}/routerlab-xiaomi-r4a/virtual-router"
HTTP_PORT=18090
FCGI_PORT=8920
INSTALL_DEPS=0
PROFILE="factory"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTDOOR="$SCRIPT_DIR/compat-frontdoor.py"
UI_GUARD="$SCRIPT_DIR/ui-guard.js"
SHIM_DIR="$SCRIPT_DIR/runtime-shims"

usage() {
  cat <<'EOF'
Usage: virtual-router.sh <command> [options]

Commands:
  start          Cold-start from exact stock rootfs + saved persistent state
  stop           Stop runtime and save persistent state
  restart        Save state, destroy runtime, cold-start again
  status         Show listeners and stock init_info health
  reset          Stop without saving and delete persistent state

Options:
  --rootfs PATH  Exact extracted Xiaomi R4A Global 3.0.24 rootfs
  --base PATH    Emulator work/state directory
  --port PORT    Local HTTP port (default 18090)
  --profile MODE Seed profile: factory|configured (default factory)
  --install-deps Install host qemu-user/proot utilities if missing
  -h, --help

Local lab URL after start:
  http://127.0.0.1:18090/

Factory lab login:
  admin / admin
EOF
}

while (($#)); do
  case "$1" in
    --rootfs) ROOTFS="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --port) HTTP_PORT="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --install-deps) INSTALL_DEPS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$COMMAND" in
  start|stop|restart|status|reset) ;;
  -h|--help) usage; exit 0 ;;
  *) echo "Unknown command: $COMMAND" >&2; usage >&2; exit 2 ;;
esac

[[ "$HTTP_PORT" =~ ^[0-9]+$ ]] || { echo "port must be numeric" >&2; exit 2; }
(( HTTP_PORT >= 1024 && HTTP_PORT <= 64000 )) || { echo "port must be 1024..64000" >&2; exit 2; }
[[ "$PROFILE" == "factory" || "$PROFILE" == "configured" ]] || { echo "profile must be factory or configured" >&2; exit 2; }

STATE="$BASE/state-v1"
RUNTIME="$BASE/runtime"
LAB="$RUNTIME/rootfs"
PIDDIR="$RUNTIME/pids"
LOGDIR="$BASE/logs"
STATE_CONFIG="$STATE/etc-config"

language_capability_file() {
  printf '%s\n' "$STATE/LANGUAGE_CAPABILITY"
}

materialize_language_registry() {
  local cfg="$STATE_CONFIG/luci"
  local cap
  cap="$(language_capability_file)"

  mkdir -p "$STATE"
  if [[ ! -f "$cfg" ]]; then
    printf 'status=missing\nsource=missing-luci-config\nlanguages=\n' > "$cap"
    echo "[virtual-router] language capability missing: $cfg not found" >&2
    return 0
  fi

  python3 - "$ROOTFS" "$cfg" "$cap" <<'PY'
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
cfg = pathlib.Path(sys.argv[2])
cap = pathlib.Path(sys.argv[3])

text = cfg.read_text(encoding="utf-8", errors="replace")
lines = text.splitlines(keepends=True)

section_start = None
section_end = len(lines)
for i, line in enumerate(lines):
    if re.match(r"^\s*config\s+internal\s+['\"]?languages['\"]?\s*$", line):
        section_start = i
        for j in range(i + 1, len(lines)):
            if re.match(r"^\s*config\s+", lines[j]):
                section_end = j
                break
        break

if section_start is None:
    cap.write_text("status=missing\nsource=missing-languages-section\nlanguages=\n")
    print("[virtual-router] language capability missing: luci languages section absent", file=sys.stderr)
    raise SystemExit(0)

existing = {}
for line in lines[section_start + 1:section_end]:
    m = re.match(r"^\s*option\s+['\"]?([A-Za-z0-9_-]+)['\"]?\s+['\"]([^'\"]+)['\"]\s*$", line)
    if m:
        existing[m.group(1)] = m.group(2)

if existing:
    codes = ",".join(sorted(existing))
    cap.write_text(f"status=ready\nsource=stock-uci\nlanguages={codes}\n")
    print(f"[virtual-router] language capability ready from existing UCI: {codes}")
    raise SystemExit(0)

languages = {}
defaults_dir = root / "etc" / "uci-defaults"
if defaults_dir.is_dir():
    for path in sorted(defaults_dir.iterdir()):
        if not path.is_file():
            continue
        data = path.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(
            r"uci\s+set\s+luci\.languages\.([A-Za-z0-9_-]+)\s*=\s*(['\"])(.*?)\2",
            data,
        ):
            languages[m.group(1)] = m.group(3)

source = "stock-uci-defaults"
if not languages:
    # LuCI translation packages materialize luci.languages from installed
    # translation packs. Raw squashfs may contain the .lmo payloads while the
    # first-boot UCI-defaults side effect has not happened yet. Reconstruct only
    # that registry from the exact stock pack inventory; do not alter Xiaomi API
    # handlers or synthesize their responses.
    label = {
        "en": "English",
        "uk": "Ukrainian",
        "ru": "Russian",
        "de": "Deutsch",
        "es": "Español",
        "fr": "Français",
        "it": "Italiano",
        "pt": "Português",
        "tr": "Türkçe",
        "zh_cn": "简体中文",
        "zh_tw": "繁體中文",
    }
    i18n_dir = root / "usr" / "lib" / "lua" / "luci" / "i18n"
    if i18n_dir.is_dir():
        for path in sorted(i18n_dir.glob("base.*.lmo")):
            pack_code = path.name[len("base."):-len(".lmo")]
            if re.fullmatch(r"[A-Za-z0-9_-]+", pack_code):
                # LuCI's translation package materializer writes UCI option
                # names with '-' converted to '_' (subst -,_ in luci.mk).
                code = pack_code.replace("-", "_")
                languages[code] = label.get(code, code)
    source = "stock-lmo-inventory"

if not languages:
    cap.write_text("status=missing\nsource=no-stock-language-packs\nlanguages=\n")
    print("[virtual-router] language capability missing: no stock language packs materialized", file=sys.stderr)
    raise SystemExit(0)

insert = [
    f"\toption {code} '{value.replace(chr(39), '')}'\n"
    for code, value in sorted(languages.items())
]
lines[section_start + 1:section_start + 1] = insert
cfg.write_text("".join(lines), encoding="utf-8")

codes = ",".join(sorted(languages))
cap.write_text(f"status=ready\nsource={source}\nlanguages={codes}\n")
print(f"[virtual-router] language capability materialized from {source}: {codes}")
PY
}

language_capability_value() {
  local key="$1" cap
  cap="$(language_capability_file)"
  [[ -f "$cap" ]] || return 0
  awk -F= -v k="$key" '$1 == k {sub(/^[^=]*=/, ""); print; exit}' "$cap"
}

ensure_deps() {
  local missing=()
  local c
  for c in proot qemu-mipsel-static python3 curl nc ss pgrep; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  if ((${#missing[@]})); then
    if (( INSTALL_DEPS == 0 )); then
      echo "[virtual-router] missing host dependencies: ${missing[*]}" >&2
      echo "[virtual-router] rerun with --install-deps" >&2
      exit 3
    fi
    echo "[virtual-router] installing host-only dependencies"
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
      qemu-user-static proot python3 curl netcat-openbsd iproute2 procps
  fi
}

validate_source() {
  ROOTFS="$(readlink -f "$ROOTFS")"
  [[ -d "$ROOTFS" ]] || { echo "[virtual-router] rootfs not found: $ROOTFS" >&2; exit 1; }
  local required=(
    usr/bin/spawn-fcgi
    usr/bin/fcgi-cgi
    www/cgi-bin/luci
    etc/config/account
    etc/config/misc
    etc/config/xiaoqiang
  )
  local f
  for f in "${required[@]}"; do
    [[ -e "$ROOTFS/$f" ]] || { echo "[virtual-router] exact stock authority missing: /$f" >&2; exit 1; }
  done
  [[ -f "$FRONTDOOR" ]] || { echo "[virtual-router] compat front door missing: $FRONTDOOR" >&2; exit 1; }
  [[ -f "$UI_GUARD" ]] || { echo "[virtual-router] UI guard missing: $UI_GUARD" >&2; exit 1; }
  [[ -f "$SHIM_DIR/ubus.lua" ]] || { echo "[virtual-router] ubus runtime shim missing: $SHIM_DIR/ubus.lua" >&2; exit 1; }
  [[ -f "$SHIM_DIR/getmac" ]] || { echo "[virtual-router] factory MAC runtime shim missing: $SHIM_DIR/getmac" >&2; exit 1; }
  [[ -f "$SHIM_DIR/luci-sys.lua" ]] || { echo "[virtual-router] luci.sys runtime shim missing: $SHIM_DIR/luci-sys.lua" >&2; exit 1; }
}

seed_factory_state() {
  echo "[virtual-router] creating R4A lab state profile=$PROFILE"
  rm -rf "$STATE"
  mkdir -p "$STATE_CONFIG"
  cp -a "$ROOTFS/etc/config/." "$STATE_CONFIG/"

  # A raw squashfs contains LuCI translation payloads but may not contain the
  # writable first-boot UCI registry produced by language-package materialization.
  # Restore that missing boot side effect in persistent state, not in stock APIs.
  materialize_language_registry

  if [[ "$PROFILE" == "configured" ]]; then
    if grep -q "option 'INITTED'" "$STATE_CONFIG/xiaoqiang"; then
      sed -i "s/option 'INITTED'.*/option 'INITTED' 'YES'/" "$STATE_CONFIG/xiaoqiang"
    else
      printf "\n\toption 'INITTED' 'YES'\n" >> "$STATE_CONFIG/xiaoqiang"
    fi
  else
    sed -i "/option 'INITTED'/d" "$STATE_CONFIG/xiaoqiang"
  fi

  cat > "$STATE_CONFIG/network" <<'EOF'
config interface 'loopback'
	option ifname 'lo'
	option proto 'static'
	option ipaddr '127.0.0.1'
	option netmask '255.0.0.0'

config interface 'lan'
	option ifname 'eth0.1'
	option proto 'static'
	option ipaddr '192.168.31.1'
	option netmask '255.255.255.0'

config interface 'wan'
	option ifname 'eth0.2'
	option proto 'dhcp'
EOF

  cat > "$STATE_CONFIG/wireless" <<'EOF'
config wifi-device 'mt7603e'
	option type 'mt7603e'
	option vendor 'ralink'
	option channel '0'
	option bw '0'
	option autoch '2'
	option radio '1'
	option txpwr 'max'
	option hwband '2_4G'
	option hwmode '11ng'
	option disabled '0'
	option country 'EU'
	option region '1'
	option aregion '6'
	option ed_chk '1'

config wifi-iface
	option device 'mt7603e'
	option ifname 'wl1'
	option network 'lan'
	option mode 'ap'
	option ssid 'Xiaomi_R4A_Lab'
	option encryption 'psk2'
	option key 'RouterLab123'
	option hidden '0'

config wifi-device 'mt7612'
	option type 'mt7612'
	option vendor 'ralink'
	option channel '0'
	option bw '0'
	option autoch '2'
	option radio '1'
	option txpwr 'max'
	option hwband '5G'
	option hwmode '11ac'
	option disabled '0'
	option country 'EU'
	option region '1'
	option aregion '6'
	option ed_chk '1'

config wifi-iface
	option device 'mt7612'
	option ifname 'wl0'
	option network 'lan'
	option mode 'ap'
	option ssid 'Xiaomi_R4A_Lab_5G'
	option encryption 'psk2'
	option key 'RouterLab123'
	option hidden '0'
EOF

  printf '%s\n' 'routerlab-xiaomi-r4a-state-v1' > "$STATE/FORMAT"
  printf '%s\n' "$PROFILE" > "$STATE/PROFILE"
  sha256sum "$ROOTFS/www/cgi-bin/luci" "$ROOTFS/etc/config/misc" > "$STATE/stock-authority.sha256"
}

save_state() {
  [[ -d "$LAB/etc/config" ]] || return 0
  local next="$STATE/etc-config.next"
  local prev="$STATE/etc-config.prev"
  mkdir -p "$STATE"
  rm -rf "$next" "$prev"
  mkdir -p "$next"
  cp -a "$LAB/etc/config/." "$next/"
  if [[ -d "$STATE_CONFIG" ]]; then
    mv "$STATE_CONFIG" "$prev"
  fi
  mv "$next" "$STATE_CONFIG"
  rm -rf "$prev"
  date -u +%FT%TZ > "$STATE/LAST_SAVED"
}

prepare_runtime() {
  [[ -f "$STATE/FORMAT" ]] || seed_factory_state
  # Migrate pre-materializer state-v1 directories without overwriting an existing
  # language registry. This is idempotent and touches only persistent UCI state.
  materialize_language_registry
  echo "[virtual-router] cold boot: exact stock rootfs + state-v1"
  rm -rf "$RUNTIME"
  mkdir -p "$LAB" "$PIDDIR" "$LOGDIR"
  cp -a --reflink=auto "$ROOTFS/." "$LAB/"
  cp -a "$STATE_CONFIG/." "$LAB/etc/config/"

  # Runtime-only compatibility: stock first-run DHCP conflict detection asks
  # netifd through ubus. qemu-user has no guest kernel/netifd/ubusd, so shadow
  # only the ubus Lua module with a narrow adapter backed by stock UCI state.
  #
  # Stock WAN templates also resolve the browser's LAN IP through luci.sys.net.ip4mac
  # and read factory MACs through /sbin/getmac -> Factory MTD. Under qemu-user/PRoot
  # /proc/net/arp is the host kernel table (a file bind does not replace it), while
  # router Factory MTD does not exist. Model those two missing runtime facts at their
  # native command/module boundaries rather than changing stock templates or Xiaomi
  # business logic. The immutable source rootfs is never modified.
  cp "$SHIM_DIR/ubus.lua" "$LAB/usr/lib/lua/ubus.lua"
  install -m 0755 "$SHIM_DIR/getmac" "$LAB/sbin/getmac"
  cp "$LAB/usr/lib/lua/luci/sys.lua" "$LAB/usr/lib/lua/luci/sys.stock.lua"
  cp "$SHIM_DIR/luci-sys.lua" "$LAB/usr/lib/lua/luci/sys.lua"
}

read_pid() {
  local name="$1"
  [[ -f "$PIDDIR/$name" ]] && cat "$PIDDIR/$name" || true
}

port_owner_pids() {
  local port="$1"
  ss -lntp 2>/dev/null |
    awk -v p=":$port" '$4 ~ p"$" {print}' |
    grep -oE 'pid=[0-9]+' |
    cut -d= -f2 |
    sort -u || true
}

reclaim_stale_routerlab_port() {
  local port="$1" kind="$2"
  local p cmd matched=0 unknown=0

  for p in $(port_owner_pids "$port"); do
    [[ "$p" =~ ^[0-9]+$ ]] || continue
    cmd="$(ps -p "$p" -o args= 2>/dev/null || true)"

    case "$kind" in
      fcgi)
        if [[ "$cmd" == *qemu-mipsel-static*fcgi-cgi* ]] || [[ "$cmd" == *proot*spawn-fcgi* ]]; then
          echo "[virtual-router] reclaiming stale RouterLab FCGI pid=$p on port $port"
          kill -TERM "$p" 2>/dev/null || true
          matched=1
        else
          echo "[virtual-router] port $port is owned by non-RouterLab pid=$p: $cmd" >&2
          unknown=1
        fi
        ;;
      http)
        if [[ "$cmd" == *compat-frontdoor.py* ]]; then
          echo "[virtual-router] reclaiming stale RouterLab front door pid=$p on port $port"
          kill -TERM "$p" 2>/dev/null || true
          matched=1
        else
          echo "[virtual-router] port $port is owned by non-RouterLab pid=$p: $cmd" >&2
          unknown=1
        fi
        ;;
    esac
  done

  if (( matched == 1 )); then
    for _ in {1..12}; do
      nc -z -w1 127.0.0.1 "$port" 2>/dev/null || return 0
      sleep 0.25
    done
  fi

  (( unknown == 0 ))
}

stop_runtime() {
  local save="${1:-1}"
  local front launcher p

  front="$(read_pid frontdoor)"
  launcher="$(read_pid spawn-fcgi)"

  if [[ "$front" =~ ^[0-9]+$ ]]; then
    kill -TERM "$front" 2>/dev/null || true
  fi
  sleep 0.2

  if [[ "$save" == "1" ]]; then
    save_state
  fi

  if [[ -f "$PIDDIR/fcgi-children" ]]; then
    while read -r p; do
      [[ "$p" =~ ^[0-9]+$ ]] || continue
      kill -TERM "$p" 2>/dev/null || true
    done < "$PIDDIR/fcgi-children"
  fi
  if [[ "$launcher" =~ ^[0-9]+$ ]]; then
    kill -TERM "$launcher" 2>/dev/null || true
  fi
  sleep 0.5

  # Never kill an arbitrary listener just because it uses the same port.
  reclaim_stale_routerlab_port "$FCGI_PORT" fcgi || true
  reclaim_stale_routerlab_port "$HTTP_PORT" http || true

  rm -rf "$PIDDIR"
}

start_runtime() {
  prepare_runtime

  local qemu proot
  qemu="$(command -v qemu-mipsel-static)"
  proot="$(command -v proot)"

  if nc -z -w1 127.0.0.1 "$FCGI_PORT" 2>/dev/null; then
    reclaim_stale_routerlab_port "$FCGI_PORT" fcgi || true
  fi
  if nc -z -w1 127.0.0.1 "$HTTP_PORT" 2>/dev/null; then
    reclaim_stale_routerlab_port "$HTTP_PORT" http || true
  fi

  if nc -z -w1 127.0.0.1 "$FCGI_PORT" 2>/dev/null; then
    echo "[virtual-router] FCGI port $FCGI_PORT is still in use after safe stale-process cleanup" >&2
    exit 5
  fi
  if nc -z -w1 127.0.0.1 "$HTTP_PORT" 2>/dev/null; then
    echo "[virtual-router] HTTP port $HTTP_PORT is still in use after safe stale-process cleanup" >&2
    exit 5
  fi

  : > "$LOGDIR/fcgi.log"
  : > "$LOGDIR/frontdoor.log"

  nohup "$proot" -0 -q "$qemu" -R "$LAB" -w / \
    /usr/bin/spawn-fcgi -a 127.0.0.1 -p "$FCGI_PORT" -u root -U nobody -F 1 -- \
    /usr/bin/fcgi-cgi -c 4 >>"$LOGDIR/fcgi.log" 2>&1 &
  local launcher=$!
  echo "$launcher" > "$PIDDIR/spawn-fcgi"

  local ok=0
  for _ in {1..20}; do
    if nc -z -w1 127.0.0.1 "$FCGI_PORT" 2>/dev/null; then ok=1; break; fi
    sleep 0.25
  done
  if (( ok == 0 )); then
    echo "[virtual-router] stock FCGI failed to expose 127.0.0.1:$FCGI_PORT" >&2
    sed -n '1,160p' "$LOGDIR/fcgi.log" >&2 || true
    exit 6
  fi

  pgrep -f 'qemu-mipsel-static.*fcgi-cgi' > "$PIDDIR/fcgi-children" 2>/dev/null || true

  nohup python3 "$FRONTDOOR" \
    --rootfs "$LAB" \
    --port "$HTTP_PORT" \
    --fcgi-port "$FCGI_PORT" \
    --ui-guard "$UI_GUARD" \
    --stock-init-gate \
    >>"$LOGDIR/frontdoor.log" 2>&1 &
  local front=$!
  echo "$front" > "$PIDDIR/frontdoor"

  ok=0
  for _ in {1..20}; do
    if nc -z -w1 127.0.0.1 "$HTTP_PORT" 2>/dev/null; then ok=1; break; fi
    sleep 0.25
  done
  if (( ok == 0 )); then
    echo "[virtual-router] compatibility front door failed on 127.0.0.1:$HTTP_PORT" >&2
    sed -n '1,160p' "$LOGDIR/frontdoor.log" >&2 || true
    exit 7
  fi

  local code body
  body="$RUNTIME/init-info.json"
  code="$(curl -sS --max-time 8 -H 'Host: router.miwifi.com' \
    -o "$body" -w '%{http_code}' \
    "http://127.0.0.1:$HTTP_PORT/cgi-bin/luci/api/xqsystem/init_info" || true)"
  if [[ "$code" != "200" ]]; then
    echo "[virtual-router] stock init_info health failed: HTTP $code" >&2
    cat "$body" >&2 2>/dev/null || true
    exit 8
  fi

  printf '%s\n' "$HTTP_PORT" > "$RUNTIME/http-port"
  printf '%s\n' "$ROOTFS" > "$RUNTIME/source-rootfs"

  local inited
  inited="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("inited","?"))' "$body" 2>/dev/null || echo "?")"

  echo "[virtual-router] READY"
  echo "[virtual-router] URL: http://127.0.0.1:$HTTP_PORT/"
  echo "[virtual-router] STOCK_INITED=$inited"
  local lang_status lang_source lang_codes
  lang_status="$(language_capability_value status)"
  lang_source="$(language_capability_value source)"
  lang_codes="$(language_capability_value languages)"
  echo "[virtual-router] LANGUAGE_CAPABILITY=${lang_status:-unknown} source=${lang_source:-unknown} languages=${lang_codes:-}"
  if [[ "$inited" == "0" && "$lang_status" != "ready" ]]; then
    echo "[virtual-router] mode: factory setup blocked at country/language; stock language packs are not materialized"
  elif [[ "$inited" == "0" ]]; then
    echo "[virtual-router] mode: factory setup; open the URL and follow the stock Xiaomi wizard"
  else
    echo "[virtual-router] mode: configured; stock admin login is active"
  fi
  echo "[virtual-router] persistent state: $STATE_CONFIG"
}

show_status() {
  local http=down fcgi=down code=000 inited=unknown tmp
  nc -z -w1 127.0.0.1 "$HTTP_PORT" 2>/dev/null && http=up || true
  nc -z -w1 127.0.0.1 "$FCGI_PORT" 2>/dev/null && fcgi=up || true
  tmp="$RUNTIME/status-init-info.json"
  if [[ "$http" == "up" ]]; then
    code="$(curl -sS --max-time 3 -H 'Host: router.miwifi.com' -o "$tmp" -w '%{http_code}' \
      "http://127.0.0.1:$HTTP_PORT/cgi-bin/luci/api/xqsystem/init_info" || true)"
    if [[ "$code" == "200" ]]; then
      inited="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("inited","unknown"))' "$tmp" 2>/dev/null || echo unknown)"
    fi
  fi
  echo "HTTP_FRONTDOOR=$http port=$HTTP_PORT"
  echo "STOCK_FCGI=$fcgi port=$FCGI_PORT"
  echo "STOCK_INIT_INFO_HTTP=$code"
  echo "STOCK_INITED=$inited"
  echo "LANGUAGE_CAPABILITY=$(language_capability_value status || true)"
  echo "LANGUAGE_SOURCE=$(language_capability_value source || true)"
  echo "LANGUAGES=$(language_capability_value languages || true)"
  [[ -f "$STATE/PROFILE" ]] && echo "STATE_PROFILE=$(cat "$STATE/PROFILE")"
  if [[ -f "$STATE/LAST_SAVED" ]]; then
    echo "STATE_LAST_SAVED=$(cat "$STATE/LAST_SAVED")"
  elif [[ -f "$STATE/FORMAT" ]]; then
    echo "STATE_LAST_SAVED=seed"
  else
    echo "STATE_LAST_SAVED=none"
  fi
}

ensure_deps
validate_source

case "$COMMAND" in
  start)
    if [[ -d "$PIDDIR" ]] || nc -z -w1 127.0.0.1 "$HTTP_PORT" 2>/dev/null; then
      stop_runtime 1
    fi
    start_runtime
    ;;
  stop)
    stop_runtime 1
    echo "[virtual-router] stopped; state saved"
    ;;
  restart)
    stop_runtime 1
    start_runtime
    echo "[virtual-router] cold restart complete"
    ;;
  status)
    show_status
    ;;
  reset)
    stop_runtime 0
    rm -rf "$STATE" "$RUNTIME"
    seed_factory_state
    echo "[virtual-router] persistent state reset to profile=$PROFILE"
    ;;
esac
