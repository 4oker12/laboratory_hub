#!/usr/bin/env bash
# Runs genuine MIPS binaries only inside disposable vendor-rootfs clone.
# Never configures a physical router or changes the runner's network interfaces.
set -Eeuo pipefail
SRC="${1:?pass extracted stock rootfs}"; OUT="${2:?pass output dir}"
SRC="$(realpath "$SRC")"; OUT="$(realpath -m "$OUT")"
mkdir -p "$OUT"
LAB="$OUT/runtime-rootfs"
cp -a --reflink=auto "$SRC" "$LAB"
# Only the disposable isolated browser-validation guest can opt into the
# UI-only fallback. The original firmware tree stays untouched.
if [[ "${ROUTERLAB_AX23_UI_PREVIEW:-0}" == '1' ]]; then
  python3 "$(dirname "$0")/ui-preview-compat.py" preview \
    "$SRC/www/webpages/modules/main/main.js" "$LAB/www/webpages/modules/main/main.js"
fi
# Stock /var may be an absolute link to /tmp. Never traverse it from the host.
mkdir -p "$LAB/tmp"
VAR_LINK="$(readlink "$LAB/var" 2>/dev/null || true)"
if [[ "$VAR_LINK" == "/tmp" ]]; then
  mkdir -p "$LAB/tmp/run" "$LAB/tmp/lock"
else
  mkdir -p "$LAB/var/run" "$LAB/var/lock"
fi
printf 'STOCK_VAR_SYMLINK=%s\n' "$VAR_LINK" > "$OUT/path-layout.txt"
ls -ld "$LAB/tmp" "$LAB/tmp/run" "$LAB/var" >> "$OUT/path-layout.txt" 2>&1 || true
QEMU="$(command -v qemu-mipsel-static || command -v qemu-mipsel)"
port=18023
report="$OUT/runtime-report.txt"
printf 'AX23 stock runtime-only proof. No mock HTTP backend.\n' > "$report"
experiment_say(){ printf '%s\n' "$*" | tee -a "$report"; }
experiment_fail(){ printf 'NETIFD_EXPERIMENT_ERROR=%s\n' "$*" >&2; exit 1; }

http_trial() {
  local label="$1" pid code result
  local netifd_pgid=''
  local -a vendor_env=()
  if [[ "$label" == 'stock-chroot-with-stock-ubusd' &&
        "${ROUTERLAB_AX23_TRACE_LUA:-0}" == '1' ]]; then
    [[ "${ROUTERLAB_AX23_SANDBOXED:-0}" == '1' &&
       -n "${ROUTERLAB_AX23_VERIFIED_HOST_NETNS:-}" &&
       "$(readlink /proc/self/ns/net)" != "$ROUTERLAB_AX23_VERIFIED_HOST_NETNS" ]] \
      || experiment_fail 'LUA_TRACE_REQUIRES_VERIFIED_ISOLATED_NETNS'
    install -m 0644 "$(dirname "$0")/stock-lua-trace.lua" "$LAB/tmp/ax23-lua-init.lua"
    vendor_env=(env LUA_INIT=@/tmp/ax23-lua-init.lua)
    experiment_say 'AX23_LUA_INIT_TRACE=ENABLED_ISOLATED_CGI_ONLY'
    # LUA_INIT is not necessarily executed by embedded/custom LuCI runtime.
    # Inject only into a verified shebang Lua CGI in the DISPOSABLE clone;
    # never patch an ELF, shell entrypoint, symlink, original rootfs or host.
    local cgi_source="$SRC/www/cgi-bin/luci" cgi_clone="$LAB/www/cgi-bin/luci"
    if python3 "$(dirname "$0")/stock-lua-cgi-inject.py" \
       "$cgi_source" "$cgi_clone" > "$OUT/lua-cgi-injection-status.txt" 2>&1; then
      grep '^AX23_LUA_CGI_ENTRYPOINT_INSTRUMENT=' "$OUT/lua-cgi-injection-status.txt" | tee -a "$report"
    else
      grep '^AX23_LUA_CGI_ENTRYPOINT_INSTRUMENT=' "$OUT/lua-cgi-injection-status.txt" | tee -a "$report" || true
      experiment_say 'AX23_LUA_CGI_INJECTION=NOT_SUPPORTED_USE_ORIGINAL'
    fi
  fi
  result='NO_HTTP_RESPONSE'
  setsid timeout --kill-after=1s 88s sudo "${vendor_env[@]}" chroot "$LAB" /__host/qemu-mipsel \
    /usr/sbin/uhttpd -f -h /www -p "127.0.0.1:$port" -x /cgi-bin \
    > "$OUT/uhttpd-$label.log" 2>&1 &
  pid=$!
  for attempt in $(seq 1 16); do
    code="$(curl --noproxy '*' -sS --max-time 1 -o "$OUT/stock-$label.html" \
      -w '%{http_code}' "http://127.0.0.1:$port/webpages/index.html" 2>/dev/null || true)"
    if [[ "$code" == '200' ]]; then
      if cmp -s "$SRC/www/webpages/index.html" "$OUT/stock-$label.html"; then
        result='STOCK_UHTTPD_STATIC_BYTE_IDENTICAL'
      else
        result='STOCK_UHTTPD_HTTP_200_DIFFERENT_CONTENT'
      fi
      break
    fi
    sleep .3
  done
  echo "$label=$result" | tee -a "$report"
  if kill -0 "$pid" 2>/dev/null; then
    echo "$label-PROCESS=RUNNING" | tee -a "$report"
  else
    echo "$label-PROCESS=EXITED" | tee -a "$report"
  fi
  if [[ "$result" == 'STOCK_UHTTPD_STATIC_BYTE_IDENTICAL' ]]; then
    code="$(curl --noproxy '*' -sS --max-time 2 -o "$OUT/cgi-$label.response" \
      -w '%{http_code}' "http://127.0.0.1:$port/cgi-bin/luci" 2>/dev/null || true)"
    echo "$label-CGI_GET_HTTP_STATUS=${code:-NOT_REACHABLE}" | tee -a "$report"
    if [ "$code" = 500 ] && [ -f "$OUT/cgi-$label.response" ]; then
      python3 - "$OUT/cgi-$label.response" <<'PY' | tee -a "$report"
import pathlib,sys,re
raw=pathlib.Path(sys.argv[1]).read_bytes()
msg=raw[:220].decode('utf-8','replace')
msg=re.sub(r'[\r\n\t ]+',' ',msg)
msg=re.sub(r'[^A-Za-z0-9_./:;()=,\- ]','?',msg)
print('AX23_STOCK_CGI_500_DIAG='+msg)
PY
    fi

    echo "$label-CGI_GET_BYTES=$(wc -c < "$OUT/cgi-$label.response")" | tee -a "$report"
    for route in 'slash|/cgi-bin/luci/' 'check_factory_default|/cgi-bin/luci/login?form=check_factory_default' 'keys|/cgi-bin/luci/login?form=keys' 'invalid_form|/cgi-bin/luci/login?form=unrecognized_read_only_probe'; do
      name="${route%%|*}"
      rel="${route#*|}"
      c="$(curl --path-as-is --noproxy '*' -sS --max-time 2 -D "$OUT/cgi-$name.headers" -o "$OUT/cgi-$name.body" -w '%{http_code}' "http://127.0.0.1:$port$rel" 2>/dev/null || true)"
      bytes="$(wc -c < "$OUT/cgi-$name.body" 2>/dev/null || echo 0)"
      sha="$(sha256sum "$OUT/cgi-$name.body" 2>/dev/null | awk '{print $1}')"
      echo "$label-CGI_ADDITIONAL_GET=$rel HTTP_STATUS=$c BODY_BYTES=$bytes SHA256=$sha" | tee -a "$report"
      grep -iE '^Content-Type:' "$OUT/cgi-$name.headers" 2>/dev/null | tr -d '\r' | head -n 1 | tee -a "$report" || true
    done
    python3 - "$OUT/cgi-check_factory_default.body" "$OUT/cgi-keys.body" "$OUT/cgi-invalid_form.body" <<'PY' | tee -a "$report"
import json, pathlib, sys
for filename in sys.argv[1:]:
    p=pathlib.Path(filename)
    if not p.is_file():
        print('CGI_PAYLOAD_CLASS',p.name,'MISSING'); continue
    raw=p.read_bytes()
    if not raw:
        print('CGI_PAYLOAD_CLASS',p.name,'EMPTY'); continue
    try:
        d=json.loads(raw)
    except (ValueError,UnicodeDecodeError):
        typ='HTML' if b'<html' in raw[:256].lower() or b'<!doctype' in raw[:256].lower() else 'OTHER_NONJSON'
        print('CGI_PAYLOAD_CLASS',p.name,typ); continue
    keys=sorted(map(str,d.keys()))[:30] if isinstance(d,dict) else []
    print('CGI_PAYLOAD_CLASS',p.name,'JSON',type(d).__name__,'TOP_LEVEL_KEYS',','.join(keys))
    if isinstance(d,dict) and isinstance(d.get('data'),dict):
        print('CGI_DATA_KEYS',p.name,','.join(sorted(map(str,d['data'].keys()))[:30]))
    if isinstance(d,dict):
        success=d.get('success')
        if isinstance(success,bool):
            print('CGI_SUCCESS_FIELD',p.name,success)
        error=d.get('errorcode')
        if isinstance(error,(int,float)) and not isinstance(error,bool):
            print('CGI_ERRORCODE',p.name,error)
        elif isinstance(error,str) and error.lstrip('+-').isdigit() and len(error)<12:
            print('CGI_ERRORCODE',p.name,error)
        elif isinstance(error,str) and len(error)<34 and __import__('re').fullmatch(r'[A-Za-z][A-Za-z_\- ]{0,32}',error):
            print('CGI_ERRORCODE',p.name,error)
        else:
            print('CGI_ERRORCODE',p.name,'NONNUMERIC_OR_ABSENT',type(error).__name__)

# Raw responses may contain tokens. Never print their values, copy them to GitHub or commit them.
PY
    echo '--- original AX23 login form read-only operation transport experiments ---' | tee -a "$report"
    for form in check_factory_default keys auth get_firmware_info; do
      for mode in get_query post_form; do
        n="read-$form-$mode"
        url="http://127.0.0.1:$port/cgi-bin/luci/login?form=$form"
        if [ "$mode" = get_query ]; then
          code="$(curl --noproxy '*' -sS --max-time 2 -D "$OUT/$n.headers" -o "$OUT/$n.body" -w '%{http_code}' "$url&operation=read" 2>/dev/null || true)"
        else
          # HTTP POST transports a *read* callback; never sends operation=write.
          code="$(curl --noproxy '*' -sS --max-time 2 -D "$OUT/$n.headers" -o "$OUT/$n.body" -w '%{http_code}' -X POST --data 'operation=read' "$url" 2>/dev/null || true)"
        fi
        echo "READ_ONLY_FORM=$form MODE=$mode HTTP=$code BYTES=$(wc -c < "$OUT/$n.body" 2>/dev/null || echo 0)" | tee -a "$report"
      done
    done
    python3 - "$OUT" <<'PY' | tee -a "$report"
import pathlib,json,re,sys
root=pathlib.Path(sys.argv[1])
for form in ('check_factory_default','keys','auth','get_firmware_info'):
 for mode in ('get_query','post_form'):
  name='read-'+form+'-'+mode
  f=root/(name+'.body')
  if not f.is_file(): print('AX23_FORM_READ',name,'MISSING'); continue
  try: obj=json.loads(f.read_bytes())
  except (ValueError,UnicodeError): print('AX23_FORM_READ',name,'NON_JSON','bytes',f.stat().st_size); continue
  if isinstance(obj,dict):
   ok=obj.get('success')
   error=obj.get('errorcode')
   if not isinstance(ok,bool): ok='UNSPECIFIED'
   if not isinstance(error,(str,int,float)): error='UNSPECIFIED'
   if isinstance(error,str) and not re.fullmatch(r'[a-zA-Z_0-9 \-]{0,40}',error): error='REDACTED'
   print('AX23_FORM_READ',name,'success',ok,'error',error,'top_keys',','.join(sorted(obj.keys())))
   if isinstance(obj.get('data'),dict):
    print('AX23_FORM_READ_DATA_KEYS',name,','.join(sorted(obj['data'].keys())[:40]))
    data=obj['data']
    if form=='check_factory_default':
     for key in ('is_default','cloud_ever_login'):
      val=data.get(key)
      if isinstance(val,bool): print('AX23_FACTORY_STATE',key,val)
      else: print('AX23_FACTORY_STATE',key,'TYPE',type(val).__name__)
    if form=='keys':
     for key in ('username','password'):
      val=data.get(key)
      if isinstance(val,str): print('AX23_KEY_PAYLOAD_SHAPE',key,'string_length',len(val))
      elif isinstance(val,dict): print('AX23_KEY_PAYLOAD_SHAPE',key,'object_fields',','.join(sorted(val.keys())[:25]))
      elif isinstance(val,list):
       print('AX23_KEY_PAYLOAD_SHAPE',key,'array_length',len(val))
       for i,elem in enumerate(val[:3]):
        if isinstance(elem,dict): print('AX23_KEY_ARRAY_ENTRY',key,i,'object_keys',','.join(sorted(map(str,elem.keys()))[:20]))
        elif isinstance(elem,str): print('AX23_KEY_ARRAY_ENTRY',key,i,'string_length',len(elem))
        else: print('AX23_KEY_ARRAY_ENTRY',key,i,'type',type(elem).__name__)
      else: print('AX23_KEY_PAYLOAD_SHAPE',key,'type',type(val).__name__)
    if form=='auth':
     for key in ('key','seq'):
      val=data.get(key)
      if isinstance(val,str): print('AX23_AUTH_FIELD_SHAPE',key,'string_length',len(val))
      elif isinstance(val,dict): print('AX23_AUTH_FIELD_SHAPE',key,'object_keys',','.join(sorted(map(str,val.keys()))[:20]))
      elif isinstance(val,(int,float)): print('AX23_AUTH_FIELD_SHAPE',key,'numeric')
      elif isinstance(val,list): print('AX23_AUTH_FIELD_SHAPE',key,'array_length',len(val))
      else: print('AX23_AUTH_FIELD_SHAPE',key,'type',type(val).__name__)


  else: print('AX23_FORM_READ',name,'JSON_TYPE',type(obj).__name__)
PY
  fi

  if [[ "$result" == 'STOCK_UHTTPD_STATIC_BYTE_IDENTICAL' ]]; then
    echo '--- stock SPA browser read-only smoke (no form submitted) ---' | tee -a "$report"
    CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
    if [[ -z "$CHROME" ]]; then
      echo 'STOCK_CHROME_BROWSER=NOT_PRESENT_NO_UI_CLAIM' | tee -a "$report"
    else
      echo 'STOCK_CHROME_BROWSER=AVAILABLE' | tee -a "$report"
      mkdir -p "$OUT/chrome-profile"
      if timeout --kill-after=2s 15s "$CHROME" --headless=new --no-sandbox --disable-gpu \
        --disable-dev-shm-usage --disable-background-networking --no-first-run --virtual-time-budget=5000 \
        --user-data-dir="$OUT/chrome-profile" --dump-dom "http://127.0.0.1:$port/webpages/index.html" \
        > "$OUT/stock-browser-dom.html" 2> "$OUT/stock-browser-stderr.log"; then
        echo 'STOCK_CHROME_DUMP_DOM=COMPLETED' | tee -a "$report"
      else
        echo 'STOCK_CHROME_DUMP_DOM=NONZERO_OR_TIMEOUT' | tee -a "$report"
      fi
      echo "STOCK_CHROME_STDERR_BYTES=$(wc -c < "$OUT/stock-browser-stderr.log")" | tee -a "$report"
      python3 - "$OUT/stock-browser-dom.html" <<'PY' | tee -a "$report"
from html.parser import HTMLParser
from pathlib import Path
import re,sys
class C(HTMLParser):
 def __init__(self):
  super().__init__(); self.password=0; self.inputs=0; self.scripts=0
 def handle_starttag(self,tag,attrs):
  attr=dict(attrs)
  if tag=='input':
   self.inputs+=1
   if (attr.get('type') or '').lower()=='password': self.password+=1
  if tag=='script': self.scripts+=1
p=Path(sys.argv[1])
if p.exists():
 s=p.read_text(errors='replace'); c=C(); c.feed(s)
 print('STOCK_BROWSER_DOM_BYTES',p.stat().st_size,
       'INPUTS',c.inputs,'PASSWORD_INPUTS',c.password,'SCRIPTS',c.scripts,
       'INITIAL_LOGIN_MARKER',bool(re.search(r'initial.login|initLogin',s,re.I)))
else: print('STOCK_BROWSER_DOM=NOT_CAPTURED')
# No DOM, cookies, credentials, scripts or token-bearing responses printed.
PY
    fi
  fi
  if [[ "$result" == 'STOCK_UHTTPD_STATIC_BYTE_IDENTICAL' ]]; then
    READ_CLIENT="$(cd "$(dirname "$0")" && pwd)/stock-read-client.mjs"
    if command -v node >/dev/null 2>&1; then
      node "$READ_CLIENT" "http://127.0.0.1:$port" | tee -a "$report"
    else
      echo 'STOCK_AX23_READ_CLIENT=NODE_NOT_INSTALLED' | tee -a "$report"
    fi
  fi
  if [[ "$result" == "STOCK_UHTTPD_STATIC_BYTE_IDENTICAL" && -n "$CHROME" ]] && command -v node >/dev/null 2>&1; then
    echo '--- original stock first-login UI CDP read-only ---' | tee -a "$report"
    BROWSER_PROBE="$(cd "$(dirname "$0")" && pwd)/stock-browser-probe.mjs"
    mkdir -p "$OUT/chrome-cdp-profile"
    setsid timeout --signal=KILL 20s "$CHROME" --headless=new --no-sandbox \
      --disable-gpu --disable-dev-shm-usage --disable-background-networking --no-first-run \
      --remote-debugging-address=127.0.0.1 --remote-debugging-port=19223 \
      '--remote-allow-origins=*' --user-data-dir="$OUT/chrome-cdp-profile" about:blank \
      >"$OUT/chrome-cdp-stderr.log" 2>&1 &
    browser_pid=$!
    if timeout --kill-after=1s 14s node "$BROWSER_PROBE" "http://127.0.0.1:$port/webpages/index.html" \
        >"$OUT/chrome-cdp-probe.log" 2>&1; then
      cat "$OUT/chrome-cdp-probe.log" | tee -a "$report"
    else
      grep '^STOCK_AX23_CDP_READ_ONLY=' "$OUT/chrome-cdp-probe.log" | head -n 1 | tee -a "$report" || true
      echo 'STOCK_AX23_CDP_READ_ONLY=BLOCKED' | tee -a "$report"
    fi
    kill -TERM -- "-$browser_pid" 2>/dev/null || true
    sleep .1
    kill -KILL -- "-$browser_pid" 2>/dev/null || true
  fi
  if [[ "$result" == "STOCK_UHTTPD_STATIC_BYTE_IDENTICAL" && "$(printenv ROUTERLAB_AX23_SANDBOXED || true)" == "1" ]]; then
    echo '--- isolated synthetic first-admin original stock UI experiment ---' | tee -a "$report"
    find "$LAB/etc/config" -maxdepth 1 -type f -print0 | sort -z | xargs -0 -r sha256sum \
      > "$OUT/ax23-config-before.sha256"
    FIRST_ADMIN_SOURCE="$(cd "$(dirname "$0")" && pwd)/stock-first-admin-experiment.mjs"
    mkdir -p "$OUT/first-admin-chrome-profile"
    setsid timeout --signal=KILL 42s "$CHROME" --headless=new --no-sandbox \
      --disable-gpu --disable-dev-shm-usage --disable-background-networking --no-first-run \
      --remote-debugging-address=127.0.0.1 --remote-debugging-port=19224 \
      '--remote-allow-origins=*' --user-data-dir="$OUT/first-admin-chrome-profile" about:blank \
      > "$OUT/first-admin-chrome.log" 2>&1 &
    first_browser_pid=$!
    if timeout --kill-after=2s 32s node "$FIRST_ADMIN_SOURCE" \
        > "$OUT/first-admin-result.log" 2>&1; then
      cat "$OUT/first-admin-result.log" | tee -a "$report"
    else
      grep '^AX23_FIRST_ADMIN' "$OUT/first-admin-result.log" | head -n 15 | tee -a "$report" || true
      echo 'AX23_FIRST_ADMIN_EXPERIMENT=NONZERO' | tee -a "$report"
    fi
  # Optional original netifd experiment: ONLY inside a verified no-default-route
  # mount/PID/network namespace. Never run stock netifd on the runner host.
  if [[ "$label" == 'stock-chroot-with-stock-ubusd' &&
        "${ROUTERLAB_AX23_TRY_NETIFD:-0}" == '1' ]]; then
    [[ "$(id -u)" -eq 0 &&
       "${ROUTERLAB_AX23_SANDBOXED:-0}" == '1' &&
       -n "${ROUTERLAB_AX23_VERIFIED_HOST_NETNS:-}" &&
       "$(readlink /proc/self/ns/net)" != "$ROUTERLAB_AX23_VERIFIED_HOST_NETNS" ]] \
       || experiment_fail 'NETIFD_EXPERIMENT_FORBIDDEN_OUTSIDE_VERIFIED_NAMESPACE'
    ! ip -4 route show default | grep -q '^default' \
       || experiment_fail 'NETIFD_EXPERIMENT_FORBIDDEN_DEFAULT_ROUTE_ALREADY_PRESENT'
    [[ -x "$LAB/sbin/netifd" ]] || experiment_fail 'STOCK_NETIFD_NOT_PRESENT'
    experiment_say 'NETIFD_ISOLATED_EXPERIMENT=START_ORIGINAL_STOCK_DAEMON_ONLY'
    # Use a bounded new process group; no init scripts or physical interfaces.
    setsid timeout --kill-after=1s 65s sudo chroot "$LAB" /__host/qemu-mipsel \
       /sbin/netifd > "$OUT/stock-netifd.private.log" 2>&1 &
    netifd_pgid=$!
    sleep 2
    if ip -4 route show default | grep -q '^default'; then
      experiment_say 'NETIFD_ISOLATED_EXPERIMENT=DEFAULT_ROUTE_CREATED_STOPPING'
      kill -TERM -- "-$netifd_pgid" 2>/dev/null || true
      experiment_fail 'STOCK_NETIFD_CREATED_DEFAULT_ROUTE_IN_GUEST'
    fi
    # Sample the real stock ubus registry for up to six seconds: native
    # netifd can take time to register its objects after reaching ubusd.
    local ubus_cli='' netifd_poll_count=0
    for ubus_exe in /bin/ubus /sbin/ubus /usr/bin/ubus; do
      if [[ -f "$LAB$ubus_exe" ]]; then ubus_cli="$ubus_exe"; break; fi
    done
    [[ -n "$ubus_cli" ]] || experiment_fail 'STOCK_UBUS_CLI_NOT_PRESENT'
    for netifd_poll_count in $(seq 1 12); do
      timeout --kill-after=1s 2s sudo chroot "$LAB" /__host/qemu-mipsel \
         "$ubus_cli" -s /var/run/ubus.sock list \
         > "$OUT/ax23-netifd-ubus.private" 2>/dev/null || true
      grep -Eq '^network([.]|$)' "$OUT/ax23-netifd-ubus.private" 2>/dev/null && break
      sleep .5
    done
    experiment_say "AX23_NETIFD_ISOLATED_UBUS_POLL_COUNT=$netifd_poll_count"
    if grep -Eq '^network([.]|$)' "$OUT/ax23-netifd-ubus.private" 2>/dev/null; then
      experiment_say 'AX23_NETIFD_ISOLATED_UBUS_NETWORK_FAMILY=REGISTERED'
    else
      experiment_say 'AX23_NETIFD_ISOLATED_UBUS_NETWORK_FAMILY=NOT_REGISTERED'
    fi
    if kill -0 "$netifd_pgid" 2>/dev/null; then
      experiment_say 'AX23_NETIFD_ISOLATED_PROCESS=ALIVE_AFTER_POLL'
    else
      experiment_say 'AX23_NETIFD_ISOLATED_PROCESS=EXITED_EARLY'
    fi
    local netifd_factory_http
    netifd_factory_http="$(curl --noproxy '*' -sS --max-time 3 -o /dev/null \
      -w '%{http_code}' "http://127.0.0.1:$port/cgi-bin/luci/login?form=check_factory_default&operation=read" \
      2>/dev/null || true)"
    experiment_say "AX23_NETIFD_ISOLATED_FACTORY_CGI_HTTP=${netifd_factory_http:-NO_RESPONSE}"
    if ip -4 addr show dev lo 2>/dev/null | grep -q '127[.]0[.]0[.]1'; then
      experiment_say 'AX23_NETIFD_ISOLATED_LOOPBACK_IPV4=YES'
    else
      experiment_say 'AX23_NETIFD_ISOLATED_LOOPBACK_IPV4=NO'
      # Stock netifd reconfigured lo and removed 127.0.0.1 in the guest.
      # Restore *only* isolated namespace loopback for a bounded health read.
      # This is runtime scaffolding, not a vendor configuration success.
      ip link set lo up
      ip -4 addr add 127.0.0.1/8 dev lo \
        >/dev/null 2>&1 || experiment_say 'AX23_NETIFD_LOOPBACK_RESTORE=ADD_FAILED'
      sleep .3
    fi
    if ip -4 addr show dev lo 2>/dev/null | grep -q '127[.]0[.]0[.]1'; then
      experiment_say 'AX23_NETIFD_LOOPBACK_RESTORE=IPV4_PRESENT'
    else
      experiment_say 'AX23_NETIFD_LOOPBACK_RESTORE=IPV4_STILL_MISSING'
    fi
    local netifd_factory_after_restore
    netifd_factory_after_restore="$(curl --noproxy '*' -sS --max-time 4 -o /dev/null \
      -w '%{http_code}' "http://127.0.0.1:$port/cgi-bin/luci/login?form=check_factory_default&operation=read" \
      2>/dev/null || true)"
    experiment_say "AX23_NETIFD_FACTORY_CGI_AFTER_LOOPBACK_RESTORE=${netifd_factory_after_restore:-NO_RESPONSE}"
    # Reload the genuine browser-origin SPA in the *existing* session while
    # the stock network ubus object is present. Read-only observer: no token,
    # password or encrypted body is printed or replayed by our harness.
    if [[ "$netifd_factory_after_restore" == '200' ]] && command -v node >/dev/null; then
      timeout --kill-after=2s 15s node \
        "$(cd "$(dirname "$0")" && pwd)/stock-netifd-page-reprobe.mjs" \
        | tee -a "$report" \
        || experiment_say 'AX23_NETIFD_PAGE_REPROBE=NONZERO_OR_TIMEOUT'
    fi
    ! ip -4 route show default | grep -q '^default' \
      || experiment_fail 'DEFAULT_ROUTE_FORBIDDEN_AFTER_LOOPBACK_RESTORE'
    if [[ -n "$netifd_pgid" ]]; then
      kill -TERM -- "-$netifd_pgid" 2>/dev/null || true
      sleep .2
      kill -KILL -- "-$netifd_pgid" 2>/dev/null || true
      netifd_pgid=''
    fi
  fi

    # A new stock uhttpd process, same copied rootfs and original ubusd:
    # verifies that factory=false is not just transient in the browser/process.
    if grep -Fxq 'AX23_FIRST_ADMIN=STOCK_TRANSITION_CONFIRMED' "$OUT/first-admin-result.log" && [[ -f "$LAB/etc/config/accountmgnt" ]]; then
      # Stock ubus allows one uhttpd object. Stop the original process GROUP,
      # not merely the timeout wrapper, before starting a fresh vendor daemon.
      current_pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
      if [[ "$current_pgid" == "$pid" ]]; then
        kill -TERM -- "-$pid" 2>/dev/null || true
        sleep .35
        kill -KILL -- "-$pid" 2>/dev/null || true
        echo 'AX23_ORIGINAL_HTTPD_GROUP_STOPPED=YES' | tee -a "$report"
      else
        echo 'AX23_ORIGINAL_HTTPD_GROUP_STOPPED=NOT_VERIFIED' | tee -a "$report"
      fi
      sleep .4
      echo '--- original factory state via FRESH stock uhttpd process ---' | tee -a "$report"
      timeout --kill-after=1s 8s sudo chroot "$LAB" /__host/qemu-mipsel \
        /usr/sbin/uhttpd -f -h /www -p '127.0.0.1:18024' -x /cgi-bin \
        > "$OUT/fresh-uhttpd.log" 2>&1 &
      freshpid=$!
      new_status=0
      for try in $(seq 1 12); do
        new_status="$(curl --noproxy '*' -sS --max-time 1 -o "$OUT/fresh-uhttpd-factory.json" \
          -w '%{http_code}' 'http://127.0.0.1:18024/cgi-bin/luci/login?form=check_factory_default&operation=read' 2>/dev/null || true)"
        [[ "$new_status" == 200 ]] && break
        sleep .13
      done
      python3 - "$OUT/fresh-uhttpd-factory.json" "$new_status" <<'PY' | tee -a "$report"
import json,pathlib,sys
p=pathlib.Path(sys.argv[1])
if sys.argv[2]!='200' or not p.is_file():
 print('AX23_FRESH_UHTTPD_FACTORY_READBACK=NO_HTTP_SUCCESS')
else:
 try:
  obj=json.loads(p.read_bytes())
  found=obj.get('success') is True and obj.get('data',{}).get('is_default') is False
  print('AX23_FRESH_UHTTPD_FACTORY_READBACK='+('STOCK_PERSISTED_AFTER_HTTPD_RESTART' if found else 'NOT_CONFIRMED'))
 except (ValueError,UnicodeError,TypeError,AttributeError):
  print('AX23_FRESH_UHTTPD_FACTORY_READBACK=INVALID_RESPONSE')
PY
      echo 'AX23_FRESH_UHTTPD_LOG:' | tee -a "$report"
      tail -n 6 "$OUT/fresh-uhttpd.log" | tee -a "$report" || true
      kill "$freshpid" 2>/dev/null || true
      echo 'AX23_PERSISTENCE_SCOPE=FRESH_STOCK_UHTTPD_PROCESS_SAME_GUEST_ROOTFS_AND_UBUSD_NOT_FULL_REBOOT' | tee -a "$report"
    fi
    kill -TERM -- "-$first_browser_pid" 2>/dev/null || true
    sleep .1
    kill -KILL -- "-$first_browser_pid" 2>/dev/null || true
    find "$LAB/etc/config" -maxdepth 1 -type f -print0 | sort -z | xargs -0 -r sha256sum \
      > "$OUT/ax23-config-after.sha256"
    python3 - "$OUT/ax23-config-before.sha256" "$OUT/ax23-config-after.sha256" <<'PY' | tee -a "$report"
import pathlib,sys
def read(filename):
 out={}
 for line in pathlib.Path(filename).read_text().splitlines():
  digest,path=line.split('  ',1)
  out[path]=digest
 return out
before,after=map(read,sys.argv[1:])
changed=sorted(pathlib.Path(p).name for p in (before.keys()|after.keys()) if before.get(p)!=after.get(p))
print('AX23_FIRST_ADMIN_STOCK_ETC_CONFIG_CHANGED_FILES='+','.join(changed[:25]))
print('AX23_FIRST_ADMIN_STOCK_ETC_CONFIG_CHANGE_COUNT='+str(len(changed)))
PY
  fi
  # After real stock-browser requests, capture exact *live* ubus registry
  # and classify native CGI exceptions. No guest services are synthesized.
  # Run before killing uhttpd/ubusd; never expose secrets from raw stderr.
  if [[ "$label" == 'stock-chroot-with-stock-ubusd' ]]; then
    : > "$OUT/ax23-live-ubus-objects.private"
    for ubus_exe in /bin/ubus /sbin/ubus /usr/bin/ubus; do
      if [[ -f "$LAB$ubus_exe" ]]; then
        timeout --kill-after=1s 4s sudo chroot "$LAB" /__host/qemu-mipsel \
          "$ubus_exe" -s /var/run/ubus.sock list \
          > "$OUT/ax23-live-ubus-objects.private" \
          2> "$OUT/ax23-ubus-error.private" || true
        break
      fi
    done
    python3 "$(cd "$(dirname "$0")" && pwd)/stock-runtime-error-evidence.py" \
      "$OUT/uhttpd-$label.log" \
      "$OUT/ax23-live-ubus-objects.private" \
      "$OUT/ax23-runtime-errors-redacted.json" | tee -a "$report"
  fi
  if [[ "$label" == 'stock-chroot-with-stock-ubusd' &&
        "${ROUTERLAB_AX23_TRACE_LUA:-0}" == '1' ]]; then
    local lua_trace_file="$LAB/tmp/ax23-lua-trace.private"
    if [[ -f "$lua_trace_file" ]]; then
      local init_count call_count
      init_count="$(grep -c '^AX23_LUA_HOOK_START=' "$lua_trace_file" || true)"
      call_count="$(grep -c '^AX23_LUA_RING_FRAME=' "$lua_trace_file" || true)"
      experiment_say "AX23_LUA_INIT_CGI_INVOCATIONS=$init_count"
      experiment_say "AX23_LUA_HOOK_RING_FRAMES=$call_count"
      # Each request has a separate final ring. No raw paths or values.
      grep -E '^AX23_LUA_(HOOK_|RING_FRAME=|LOADED_|SOURCE_CATEGORY_|CONTROLLER_)' "$lua_trace_file" | tail -n 95 | tee -a "$report" || true
    else
      experiment_say 'AX23_LUA_INIT_TRACE=NOT_OBSERVED_IN_CGI'
    fi
  fi
  echo "$label-STDERR_BYTES=$(wc -c < "$OUT/uhttpd-$label.log")" | tee -a "$report"
  # Terminate only the optional guest netifd process group.
  if [[ -n "$netifd_pgid" ]]; then
    kill -TERM -- "-$netifd_pgid" 2>/dev/null || true
    sleep .1
    kill -KILL -- "-$netifd_pgid" 2>/dev/null || true
  fi
  kill "$pid" 2>/dev/null || true
  # Previous wait on the QEMU child caused an eight-minute CI hang; do not wait here.
  tail -n 12 "$OUT/uhttpd-$label.log" | tee -a "$report"
}
# Previous PRoot on Ubuntu 26.04 failed even on guest BusyBox, so omit it from
# subsequent default CI probes.  No PRoot result is evidence of stock uhttpd.
echo 'PROOT_PREVIOUSLY_BLOCKED=YES; use tested QEMU chroot mode' | tee -a "$report"
echo '--- original stock LuCI/CGI metadata ---' | tee -a "$report"
echo 'STOCK_LUA_INTERPRETER_METADATA:' | tee -a "$report"
ls -l "$SRC/usr/bin/lua" 2>&1 | tee -a "$report" || true
file "$SRC/usr/bin/lua" 2>&1 | tee -a "$report" || true
readlink "$SRC/usr/bin/lua" 2>/dev/null | tee -a "$report" || true
ls -ld "$SRC/www/cgi-bin" "$SRC/www/cgi-bin/luci" | tee -a "$report" || true
file "$SRC/www/cgi-bin/luci" | tee -a "$report" || true
echo "STOCK_CGI_SHEBANG=$(head -n 1 "$SRC/www/cgi-bin/luci" | head -c 90)" | tee -a "$report"
readlink "$SRC/www/cgi-bin/luci" | tee -a "$report" || true
echo '--- chroot / stock MIPS QEMU fallback (ephemeral runner only) ---' | tee -a "$report"
# QEMU is a host-side compatibility executable, never a replacement AX23 API.
# Copy its x86_64 dynamic dependencies into the disposable rootfs clone only.
mkdir -p "$LAB/__host"
cp "$QEMU" "$LAB/__host/qemu-mipsel"
while IFS= read -r lib; do
  [[ -f "$lib" ]] || continue
  mkdir -p "$LAB$(dirname "$lib")"
  cp -L "$lib" "$LAB$lib"
done < <(ldd "$QEMU" | awk '{for (i=1; i<=NF; i++) if (substr($i,1,1)=="/") print $i}' | sort -u)
mkdir -p "$LAB/dev"
for entry in 'null 1 3' 'urandom 1 9'; do
  read -r name major minor <<< "$entry"
  test -e "$LAB/dev/$name" || sudo mknod -m 666 "$LAB/dev/$name" c "$major" "$minor"
done
if timeout --kill-after=1s 3s sudo chroot "$LAB" /__host/qemu-mipsel /usr/bin/lua -v > "$OUT/stock-lua-smoke.log" 2>&1; then
  echo 'STOCK_LUA_INTERPRETER_DIRECT=PASS' | tee -a "$report"
else
  echo 'STOCK_LUA_INTERPRETER_DIRECT=NONZERO_OR_UNAVAILABLE' | tee -a "$report"
  tail -n 3 "$OUT/stock-lua-smoke.log" | tee -a "$report" || true
fi
if timeout 8 sudo chroot "$LAB" /__host/qemu-mipsel /bin/busybox echo STOCK_AX23_CHROOT_BUSYBOX_OK > "$OUT/chroot-smoke.log" 2>&1; then
  echo 'CHROOT_STOCK_BUSYBOX=OK' | tee -a "$report"
else
  echo 'CHROOT_STOCK_BUSYBOX=BLOCKED' | tee -a "$report"
fi
tail -n 8 "$OUT/chroot-smoke.log" | tee -a "$report"
if grep -q 'CHROOT_STOCK_BUSYBOX=OK' "$report"; then
  http_trial "stock-chroot"
  if grep -q 'stock-chroot=NO_HTTP_RESPONSE' "$report" && [ -f "$LAB/sbin/ubusd" ]; then
    echo 'CHROOT_STOCK_UBUSD_TRIAL=START' | tee -a "$report"
    timeout --kill-after=1s 95s sudo chroot "$LAB" /__host/qemu-mipsel /sbin/ubusd -s /var/run/ubus.sock > "$OUT/ubusd-chroot.log" 2>&1 &
    cpid=$!
    sleep 1
    http_trial "stock-chroot-with-stock-ubusd"
    echo '--- stock ubus registry (read-only, no objects invented) ---' | tee -a "$report"
    for ubus_exe in /bin/ubus /sbin/ubus /usr/bin/ubus; do
      if [ -f "$LAB$ubus_exe" ]; then
        if timeout --kill-after=1s 3s sudo chroot "$LAB" /__host/qemu-mipsel "$ubus_exe" -s /var/run/ubus.sock list >"$OUT/stock-ubus-objects.txt" 2>"$OUT/stock-ubus-error.txt"; then
          echo "STOCK_UBUS_OBJECT_COUNT=$(wc -l < "$OUT/stock-ubus-objects.txt")" | tee -a "$report"
          head -n 25 "$OUT/stock-ubus-objects.txt" | tee -a "$report"
        else
          echo 'STOCK_UBUS_LIST=BLOCKED' | tee -a "$report"
          head -n 3 "$OUT/stock-ubus-error.txt" | tee -a "$report"
        fi
        break
      fi
    done
    kill "$cpid" 2>/dev/null || true
    # No wait on emulated daemon here either.
    tail -n 10 "$OUT/ubusd-chroot.log" | tee -a "$report"
  fi
fi
echo '--- stock runtime-path and sysmode source candidates ---' | tee -a "$report"
cat "$OUT/path-layout.txt" | tee -a "$report"
echo 'STOCK_SYSMODE_PATHS:' | tee -a "$report"
timeout 7 grep -rIl 'sysmode' "$SRC/etc/init.d" "$SRC/etc/config" "$SRC/usr/lib/lua/luci" 2>/dev/null \
  | sed "s#^$SRC##" | sed -n '1,35p' | tee -a "$report" || true
echo 'STOCK_UBUS_SOCKET_PRESENT='$(test -S "$LAB/tmp/run/ubus.sock" && echo yes || echo no) | tee -a "$report"
echo "STOCK_SYSMODE_CONFIG_PRESENT=$(test -f "$SRC/etc/config/sysmode" && echo yes || echo no)" | tee -a "$report"
find "$SRC" -maxdepth 5 -name '*sysmode*' -print 2>/dev/null | sed "s#^$SRC##" | head -n 25 | tee -a "$report" || true
echo 'EVIDENCE_LIMIT=No CGI SET, no login success, no credential use, no config write.' | tee -a "$report"
