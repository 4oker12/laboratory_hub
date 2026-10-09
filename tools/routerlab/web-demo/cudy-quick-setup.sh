#!/usr/bin/env bash
set -Eeuo pipefail

RUNTIME="${ROUTERLAB_CUDY_RUNTIME:-$HOME/cudy-wr1200-browser-lab/runtime}"
PORT="${ROUTERLAB_CUDY_PORT:-18093}"
QEMU="${QEMU_MIPSEL:-/usr/bin/qemu-mipsel-static}"
ADMIN_PASSWORD="${ROUTERLAB_CUDY_ADMIN_PASSWORD:-RouterLabAdmin88}"
WIFI_PASSWORD="${ROUTERLAB_CUDY_WIFI_PASSWORD:-RouterLabWifi88}"

[[ -d "$RUNTIME" ]] || { echo "ERROR runtime_missing"; exit 20; }
command -v curl >/dev/null || { echo "ERROR curl_missing"; exit 21; }
[[ -x "$QEMU" ]] || { echo "ERROR qemu_missing"; exit 22; }

proot_cmd=(
  proot -0 -r "$RUNTIME"
  -b /proc
  -b /dev
  -b "$RUNTIME/tmp:/var"
  -w /
  -q "$QEMU"
)

BASE="http://127.0.0.1:$PORT"
COOKIE="$RUNTIME/tmp/routerlab-web.cookies"
BODY="$RUNTIME/tmp/routerlab-web.body"
rm -f "$COOKIE" "$BODY"

uci_get() {
  "${proot_cmd[@]}" /sbin/uci -q get "$1" 2>/dev/null || true
}

form_value() {
  local file="$1" name="$2"
  sed -n "s/.*name=\"$name\"[^>]*value=\"\([^\"]*\)\".*/\1/p" "$file" | head -n1
}

get_page() {
  local url="$1" out="$2"
  local headers="$RUNTIME/tmp/routerlab-web-get.headers"
  local code
  code="$(curl -sS --max-time 10     -D "$headers"     -b "$COOKIE" -c "$COOKIE"     -o "$out"     -w '%{http_code}'     "$BASE$url")"
  case "$code" in
    200|302|401|403) ;;
    *)
      echo "ERROR get_failed url=$url http=$code"
      sed -n '1,20p' "$headers" 2>/dev/null || true
      exit 35
      ;;
  esac
}

fetch_factory_form() {
  local candidate headers code
  headers="$RUNTIME/tmp/routerlab-web-factory.headers"

  for candidate in     "/cgi-bin/luci"     "/cgi-bin/luci/"     "/cgi-bin/luci/admin/wizard"
  do
    code="$(curl -sS --max-time 10       -D "$headers"       -b "$COOKIE" -c "$COOKIE"       -o "$BODY"       -w '%{http_code}'       "$BASE$candidate")"

    if grep -q 'name="_csrf"' "$BODY" 2>/dev/null       && grep -q 'name="salt"' "$BODY" 2>/dev/null
    then
      echo "STEP factory_form ok"
      return 0
    fi

    echo "INFO factory_form_candidate=$candidate http=$code"
    grep -i '^Location:' "$headers" 2>/dev/null | head -n1 || true
  done

  echo "ERROR factory_auth_contract_missing"
  exit 32
}

post_page() {
  local url="$1"; shift
  # Do not follow POST redirects: an explicit -X POST plus -L can replay the
  # mutation against the redirect target. We only need the stock response and
  # Set-Cookie from the original endpoint.
  curl -sS --max-time 15 -b "$COOKIE" -c "$COOKIE"     -X POST "$BASE$url" "$@" -o "$BODY"
}

post_cbi() {
  local label="$1" url="$2" token="$3"; shift 3
  [[ -n "$token" ]] || { echo "ERROR missing_token_$label"; exit 30; }
  post_page "$url"     --data-urlencode "token=$token"     --data-urlencode "timeclock=$(date +%s)"     --data-urlencode "cbi.submit=1"     "$@"
  echo "STEP $label ok"
}

wizard_before="$(uci_get luci.main.wizard)"
if [[ "$wizard_before" == "0" ]]; then
  echo "STEP already_configured ok"
  echo "RESULT wizard=0"
  echo "RESULT defpasswd=$(uci_get luci.sauth.defpasswd)"
  echo "RESULT wan_proto=$(uci_get network.wan.proto)"
  echo "RESULT ssid_2g=$(uci_get wireless.wlan00.ssid)"
  echo "RESULT ssid_5g=$(uci_get wireless.wlan10.ssid)"
  exit 0
fi
[[ "$wizard_before" == "1" ]] || { echo "ERROR unexpected_wizard=$wizard_before"; exit 31; }

echo "STEP preflight ok"

# 1) Create the administrator password through the stock factory wizard.
# Do not let curl auto-follow LuCI redirects here: this stock image can bounce
# between unauthenticated bootstrap routes. Probe the known stock factory
# endpoints directly and use the first real form containing _csrf + salt.
fetch_factory_form
csrf="$(form_value "$BODY" "_csrf")"
salt="$(form_value "$BODY" "salt")"
[[ -n "$csrf" && -n "$salt" ]] || {
  echo "ERROR factory_auth_contract_missing"
  exit 32
}

# Follow the stock sysauth browser contract instead of selecting password
# hashing by model/version. Newer Cudy builds call /admin/get_token before
# submit and optionally bind the password hash to that token when a token input
# is present. Older builds only do sha256(password + salt).
sysauth_js="$RUNTIME/tmp/routerlab-sysauth.js"
auth_token=""
auth_has_token_field=0
auth_uses_token_endpoint=0
rm -f "$sysauth_js"

script_src="$(grep -oE '<script[^>]+src="[^"]*sysauth\.js[^"]*"' "$BODY" 2>/dev/null | head -n1 | sed -n 's/.*src="\([^"]*\)".*/\1/p' || true)"
if [[ -z "$script_src" ]]; then
  script_src="/luci-static/bootstrap/js/sysauth.js"
fi
script_src="${script_src%%\?*}"

set +e
curl -sS --max-time 8 -b "$COOKIE" -c "$COOKIE" "$BASE$script_src" -o "$sysauth_js"
sysauth_js_rc=$?
set -e

if [[ "$sysauth_js_rc" -eq 0 && -s "$sysauth_js" ]]; then
  if grep -q "passwordValue + .*salt" "$sysauth_js" 2>/dev/null; then
    echo "INFO auth_contract=sha256_password_plus_salt"
  else
    echo "ERROR unknown_sysauth_password_transform"
    exit 36
  fi

  if grep -q "/cgi-bin/luci/admin/get_token" "$sysauth_js" 2>/dev/null; then
    auth_uses_token_endpoint=1
    set +e
    auth_token="$(curl -sS --max-time 8 -b "$COOKIE" -c "$COOKIE" -X POST "$BASE/cgi-bin/luci/admin/get_token" 2>/dev/null)"
    token_rc=$?
    set -e
    if [[ "$token_rc" -ne 0 || -z "$auth_token" ]]; then
      echo "ERROR auth_token_fetch_failed rc=$token_rc"
      exit 37
    fi
    echo "INFO auth_token_endpoint=present"
  fi
else
  # Known older R26 browser contract. We still require the stock form salt and
  # use the transform already proven across 1.17.4..2.4.23.
  echo "INFO auth_contract=legacy_sha256_password_plus_salt"
fi

if grep -q 'name="token"' "$BODY" 2>/dev/null; then
  auth_has_token_field=1
fi

password_hash="$(printf '%s%s' "$ADMIN_PASSWORD" "$salt" | sha256sum | awk '{print $1}')"
if [[ "$auth_has_token_field" == "1" ]]; then
  [[ -n "$auth_token" ]] || { echo "ERROR auth_token_required_but_missing"; exit 38; }
  password_hash="$(printf '%s%s' "$password_hash" "$auth_token" | sha256sum | awk '{print $1}')"
  echo "INFO auth_token_binding=enabled"
else
  echo "INFO auth_token_binding=disabled"
fi

factory_headers="$RUNTIME/tmp/routerlab-factory-post.headers"
factory_code="$(curl -sS --max-time 15   -D "$factory_headers"   -b "$COOKIE" -c "$COOKIE"   -X POST "$BASE/cgi-bin/luci/admin/wizard"   --data-urlencode "_csrf=$csrf"   --data-urlencode "salt=$salt"   ${auth_has_token_field:+}   --data-urlencode "zonename=UTC"   --data-urlencode "timeclock=$(date +%s)"   --data-urlencode "luci_username=admin"   --data-urlencode "luci_password=$password_hash"   -o "$BODY" -w '%{http_code}' || true)"

# If this browser generation renders a token input, add it exactly as stock JS
# does. Use a second request only when the previous command could not include it
# portably; factory password creation is guarded by authoritative defpasswd
# below, so a failed first request never counts as success.
if [[ "$auth_has_token_field" == "1" && "$(uci_get luci.sauth.defpasswd)" == "1" ]]; then
  factory_code="$(curl -sS --max-time 15     -D "$factory_headers"     -b "$COOKIE" -c "$COOKIE"     -X POST "$BASE/cgi-bin/luci/admin/wizard"     --data-urlencode "_csrf=$csrf"     --data-urlencode "token=$auth_token"     --data-urlencode "salt=$salt"     --data-urlencode "zonename=UTC"     --data-urlencode "timeclock=$(date +%s)"     --data-urlencode "luci_username=admin"     --data-urlencode "luci_password=$password_hash"     -o "$BODY" -w '%{http_code}' || true)"
fi
echo "INFO factory_post_http=$factory_code"

defpasswd="$(uci_get luci.sauth.defpasswd)"
[[ "$defpasswd" == "0" ]] || { echo "ERROR admin_password_not_committed defpasswd=$defpasswd"; exit 33; }
echo "STEP admin_password ok"

guide_step() {
  local n="$1"
  get_page "/cgi-bin/luci/admin/guide?step=$n" "$RUNTIME/tmp/routerlab-guide-$n.json"
  echo "STEP guide_$n ok"
}

# 2) Router work mode.
guide_step 0
get_page "/cgi-bin/luci/admin/system/workmode?embedded=&nextbtn=" "$BODY"
token="$(form_value "$BODY" "token")"
post_cbi workmode "/cgi-bin/luci/admin/system/workmode?embedded=&nextbtn=" "$token"   --data-urlencode "cbid.system.board.workmode=router"

# 3) Time zone.
guide_step 1
get_page "/cgi-bin/luci/admin/system/timezone?embedded=&nextbtn=" "$BODY"
token="$(form_value "$BODY" "token")"
tz_field="$(grep -oE 'name="cbid\.system\.[^"]+\.timezone"' "$BODY" | head -n1 | cut -d'"' -f2 || true)"
if [[ -n "$tz_field" ]]; then
  post_cbi timezone "/cgi-bin/luci/admin/system/timezone?embedded=&nextbtn=" "$token"     --data-urlencode "$tz_field=GMT0"
else
  echo "STEP timezone skipped"
fi

# 4) WAN DHCP only (RouterLab acceptance scope).
guide_step 2
get_page "/cgi-bin/luci/admin/network/wan/config/detail?nomodal=&nextbtn=&proto=dhcp" "$BODY"
token="$(form_value "$BODY" "token")"
post_cbi wan_dhcp "/cgi-bin/luci/admin/network/wan/config/detail?nomodal=&nextbtn=&proto=dhcp" "$token"   --data-urlencode "cbid.network.wan.proto=dhcp"   --data-urlencode "cbid.network.wan.hostname=R26"   --data-urlencode "cbid.network.wan._proto2_1=none"

# 5) Keep the stock-generated SSID names, but configure WPA2 keys.
guide_step 3
ssid_2g="$(uci_get wireless.wlan00.ssid)"
ssid_5g="$(uci_get wireless.wlan10.ssid)"
[[ -n "$ssid_2g" && -n "$ssid_5g" ]] || { echo "ERROR stock_ssid_missing"; exit 34; }
get_page "/cgi-bin/luci/admin/network/wireless/config/simple?embedded=&nextbtn=" "$BODY"
token="$(form_value "$BODY" "token")"
post_cbi wireless "/cgi-bin/luci/admin/network/wireless/config/simple?embedded=&nextbtn=" "$token"   --data-urlencode "cbid.wireless.wlan00.ssid=$ssid_2g"   --data-urlencode "cbid.wireless.wlan00.encryption=psk2"   --data-urlencode "cbid.wireless.wlan00.key=$WIFI_PASSWORD"   --data-urlencode "cbid.wireless.wlan10.ssid=$ssid_5g"   --data-urlencode "cbid.wireless.wlan10.encryption=psk2"   --data-urlencode "cbid.wireless.wlan10.key=$WIFI_PASSWORD"

# 6) Final stock summary submit.
guide_step 4
get_page "/cgi-bin/luci/admin/network/summary?embedded=&nextbtn=" "$BODY"
token="$(form_value "$BODY" "token")"
post_cbi summary "/cgi-bin/luci/admin/network/summary?embedded=&nextbtn=" "$token"
guide_step 5

# 7) Finalize using the stock mechanism exposed by this firmware generation.
#
# The stock browser wizard performs its normal final transition inside the
# network/summary CBI on_commit handler: it sets wizard=0, commits every changed
# UCI package, builds parsechain, and renders cbi/apply_xhr for service restart.
# Newer R26 firmware additionally exposes qsetup.apply(); keep that only as a
# compatibility fallback when the browser finalizer did not complete. Never
# synthesize wizard=0 ourselves.
wizard_after_summary="$(uci_get luci.main.wizard)"
if [[ "$wizard_after_summary" == "0" ]]; then
  echo "INFO finalizer=summary_cbi"
  restart_path="$(grep -oE "/cgi-bin/luci/admin/servicectl/restart/[A-Za-z0-9_,.-]+" "$BODY" 2>/dev/null | head -n1 || true)"
  if [[ -n "$restart_path" ]]; then
    echo "INFO summary_restart_path=$restart_path"
  else
    echo "INFO summary_restart_path=not-rendered"
  fi
  # The subsequent servicectl restart is the physical/service-application
  # boundary. In RouterLab rehost we intentionally do not restart emulated
  # network/radio services; the stock CBI has already owned mutation+commit.
  echo "STEP stock_apply ok"
else
  echo "INFO finalizer=qsetup_fallback"

# Invoke the discovered stock qsetup finalizer in the correct generation-specific
# context. Only late service execution is suppressed; stock qsetup.apply() owns
# UCI mutation/commit, including luci.main.wizard = 0.
cat > "$RUNTIME/tmp/routerlab-stock-apply.lua" <<'LUA'
local function log_line(line)
  local f = io.open("/tmp/routerlab-web-apply-boundary.log", "a")
  if f then f:write(line, "\n"); f:close() end
end

local function fork_apply_shim(arg)
  local parts = {"fork_apply"}
  if type(arg) == "table" then
    for _,v in ipairs(arg) do parts[#parts + 1] = tostring(v) end
  end
  log_line(table.concat(parts, " "))
  return true
end

local function fork_exec_shim(cmd)
  log_line("fork_exec <suppressed>")
  return true
end

local function patch_sys(t)
  if type(t) ~= "table" then return false end
  t.fork_apply = fork_apply_shim
  t.fork_exec = fork_exec_shim
  return true
end

-- 2.4.x exposes qsetup through luci.app and resolves sys from the function
-- environment. 2.1.x still has stock qsetup.apply(), but captures luci.sys as
-- an upvalue. Patch only that late service boundary in whichever shape the
-- stock firmware uses.
local sys_ok, sys = pcall(require, "luci.sys")
if sys_ok then patch_sys(sys) end

local qsetup
local app_ok, app = pcall(require, "luci.app")
if app_ok and type(app) == "table" and type(app.qsetup) == "table" then
  qsetup = app.qsetup
else
  local q_ok, q = pcall(require, "luci.apprpc.qsetup")
  if q_ok and type(q) == "table" then qsetup = q end
end

assert(type(qsetup) == "table", "stock qsetup module missing")
assert(type(qsetup.apply) == "function", "stock qsetup.apply missing")

local apply = qsetup.apply
local env = getfenv(apply)
if type(env) == "table" and type(env.sys) == "table" then
  patch_sys(env.sys)
end

for i = 1, 32 do
  local name, value = debug.getupvalue(apply, i)
  if not name then break end
  if type(value) == "table" then patch_sys(value) end
end

local ok, result = xpcall(function()
  return apply({})
end, debug.traceback)

if not ok then
  io.stderr:write(tostring(result), "\n")
  os.exit(40)
end

print("stock_apply_result=" .. tostring(result))
LUA

set +e
apply_output="$("${proot_cmd[@]}" /usr/bin/lua /tmp/routerlab-stock-apply.lua 2>&1)"
apply_rc=$?
set -e
printf '%s\n' "$apply_output"
[[ "$apply_rc" -eq 0 ]] || { echo "ERROR stock_apply_failed rc=$apply_rc"; exit 40; }
echo "STEP stock_apply ok"
fi

wizard_after="$(uci_get luci.main.wizard)"
defpasswd_after="$(uci_get luci.sauth.defpasswd)"
wan_after="$(uci_get network.wan.proto)"
ssid_2g_after="$(uci_get wireless.wlan00.ssid)"
ssid_5g_after="$(uci_get wireless.wlan10.ssid)"
enc_2g_after="$(uci_get wireless.wlan00.encryption)"
enc_5g_after="$(uci_get wireless.wlan10.encryption)"
key_2g_after="$(uci_get wireless.wlan00.key)"
key_5g_after="$(uci_get wireless.wlan10.key)"

[[ "$wizard_after" == "0" ]] || { echo "ERROR wizard_not_finalized value=$wizard_after"; exit 41; }
[[ "$defpasswd_after" == "0" ]] || { echo "ERROR defpasswd_regressed value=$defpasswd_after"; exit 42; }
[[ "$wan_after" == "dhcp" ]] || { echo "ERROR wan_not_dhcp value=$wan_after"; exit 43; }
[[ -n "$ssid_2g_after" && -n "$ssid_5g_after" ]] || { echo "ERROR wifi_ssid_missing_after_apply"; exit 44; }
[[ -n "$key_2g_after" && -n "$key_5g_after" ]] || { echo "ERROR wifi_key_missing_after_apply"; exit 45; }
[[ "$enc_2g_after" != "none" && "$enc_5g_after" != "none" ]] || { echo "ERROR wifi_encryption_missing_after_apply"; exit 46; }

echo "STEP verify ok"
echo "RESULT wizard=$wizard_after"
echo "RESULT defpasswd=$defpasswd_after"
echo "RESULT wan_proto=$wan_after"
echo "RESULT ssid_2g=$ssid_2g_after"
echo "RESULT ssid_5g=$ssid_5g_after"
