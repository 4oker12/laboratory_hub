#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="${ROUTERLAB_CUDY_TARGET:-}"
[[ -n "$TARGET" ]] || TARGET="lab"

run_physical_stage1() {
  local base="${ROUTERLAB_CUDY_BASE:-}"
  local work="${ROUTERLAB_CUDY_PHYSICAL_WORK:-}"
  local admin_password="${ROUTERLAB_CUDY_ADMIN_PASSWORD:-}"

  [[ -n "$base" ]] || base="http://192.168.10.1"
  [[ -n "$work" ]] || work="$HOME/.routerlab/cudy-wr1200-physical"

  local cookie="$work/cookies.txt"
  local body="$work/login.body"
  local headers="$work/login.headers"
  local guide_body="$work/guide0.body"
  local guide_headers="$work/guide0.headers"
  local sysauth="$work/sysauth.js"

  command -v curl >/dev/null || { echo "ERROR curl_missing"; exit 21; }
  command -v sha256sum >/dev/null || { echo "ERROR sha256sum_missing"; exit 22; }

  mkdir -p "$work"
  chmod 700 "$work" 2>/dev/null || true
  rm -f "$cookie" "$headers" "$guide_headers"
  umask 077

  echo "STEP physical_preflight begin"
  code="$(curl -sS --max-time 10 --connect-timeout 4 \
    -D "$headers" -c "$cookie" -o "$body" -w '%{http_code}' \
    "$base/cgi-bin/luci")"
  case "$code" in 200|302|401|403) ;; *)
    echo "ERROR physical_login_http=$code"
    exit 60
  esac

  grep -q 'HW: WR1200 V2.1' "$body" || {
    echo "ERROR physical_hardware_mismatch"
    exit 61
  }
  grep -q 'FW: 2.4.23-20251224-145945' "$body" || {
    echo "ERROR physical_firmware_mismatch"
    exit 62
  }

  form_value_physical() {
    local file="$1" name="$2"
    sed -n "s/.*name=\"$name\"[^>]*value=\"\([^\"]*\)\".*/\1/p" "$file" | head -n1
  }

  csrf="$(form_value_physical "$body" "_csrf")"
  salt="$(form_value_physical "$body" "salt")"
  token="$(form_value_physical "$body" "token")"
  username="$(form_value_physical "$body" "luci_username")"
  action="$(sed -n 's/.*<form[^>]*action="\([^"]*\)".*/\1/p' "$body" | head -n1)"

  [[ "$action" == "/cgi-bin/luci/" ]] || {
    echo "ERROR physical_form_action=$action"
    exit 63
  }
  [[ "$username" == "admin" && -n "$csrf" && -n "$salt" && -n "$token" ]] || {
    echo "ERROR physical_auth_contract_missing"
    exit 64
  }

  sysauth_src="$(grep -oE 'src="[^"]*sysauth\.js[^"]*"' "$body" | head -n1 | cut -d'"' -f2)"
  [[ -n "$sysauth_src" ]] || {
    echo "ERROR physical_sysauth_reference_missing"
    exit 65
  }
  sysauth_code="$(curl -sS --max-time 10 --connect-timeout 4 \
    -o "$sysauth" -w '%{http_code}' "$base$sysauth_src")"
  [[ "$sysauth_code" == "200" ]] || {
    echo "ERROR physical_sysauth_http=$sysauth_code"
    exit 66
  }
  grep -q "luci_password2" "$sysauth" &&
  grep -q "sha256" "$sysauth" &&
  grep -q "input\[name='salt'\]" "$sysauth" &&
  grep -q "input\[name='token'\]" "$sysauth" || {
    echo "ERROR physical_sysauth_contract_changed"
    exit 67
  }

  echo "INFO target=physical"
  echo "INFO hardware=WR1200_V2.1"
  echo "INFO firmware=2.4.23-20251224-145945"
  echo "INFO form_action=$action"
  echo "INFO auth_contract=sha256(password+salt)->sha256(hash+token)"
  echo "STEP physical_preflight ok"

  if [[ -z "$admin_password" ]]; then
    read -r -s -p "New Cudy admin password (8-64 chars): " admin_password
    echo
  fi
  admin_len="$(printf '%s' "$admin_password" | wc -c | tr -d ' ')"
  (( admin_len >= 8 && admin_len <= 64 )) || {
    echo "ERROR admin_password_length"
    exit 68
  }

  # Refresh all challenge values immediately before the first mutating request.
  code="$(curl -sS --max-time 10 --connect-timeout 4 \
    -D "$headers" -b "$cookie" -c "$cookie" -o "$body" -w '%{http_code}' \
    "$base/cgi-bin/luci")"
  case "$code" in 200|302|401|403) ;; *)
    echo "ERROR physical_fresh_login_http=$code"
    exit 69
  esac

  csrf="$(form_value_physical "$body" "_csrf")"
  salt="$(form_value_physical "$body" "salt")"
  token="$(form_value_physical "$body" "token")"
  username="$(form_value_physical "$body" "luci_username")"
  action="$(sed -n 's/.*<form[^>]*action="\([^"]*\)".*/\1/p' "$body" | head -n1)"
  [[ "$action" == "/cgi-bin/luci/" && "$username" == "admin" && -n "$csrf" && -n "$salt" && -n "$token" ]] || {
    echo "ERROR physical_fresh_auth_contract_changed"
    exit 70
  }

  h1="$(printf '%s%s' "$admin_password" "$salt" | sha256sum | awk '{print $1}')"
  password_hash="$(printf '%s%s' "$h1" "$token" | sha256sum | awk '{print $1}')"
  admin_password=""
  h1=""

  post_code="$(curl -sS --max-time 15 --connect-timeout 4 \
    -D "$headers" -b "$cookie" -c "$cookie" \
    -o "$body" -w '%{http_code}' \
    -X POST "$base$action" \
    --data-urlencode "_csrf=$csrf" \
    --data-urlencode "token=$token" \
    --data-urlencode "salt=$salt" \
    --data-urlencode "zonename=UTC" \
    --data-urlencode "timeclock=$(date +%s)" \
    --data-urlencode "luci_username=$username" \
    --data-urlencode "luci_password=$password_hash")"
  password_hash=""

  session_issued=0
  if grep -qi '^Set-Cookie:[[:space:]]*sysauth=' "$headers"; then
    session_issued=1
  fi

  # Persist only sanitized evidence, never the live session cookie.
  sed -E 's/(Set-Cookie:[[:space:]]*sysauth=)[^;]+/\1<redacted>/I' "$headers" > "$headers.safe"
  rm -f "$headers"

  echo "INFO admin_post_http=$post_code"
  echo "INFO session_cookie_issued=$session_issued"
  [[ "$session_issued" == "1" ]] || {
    rm -f "$cookie"
    echo "ERROR physical_admin_session_not_issued"
    exit 71
  }

  guide_code="$(curl -sS --max-time 10 --connect-timeout 4 \
    -D "$guide_headers" -b "$cookie" -c "$cookie" \
    -o "$guide_body" -w '%{http_code}' \
    "$base/cgi-bin/luci/admin/guide?step=0")"
  sed -E 's/(Set-Cookie:[[:space:]]*sysauth=)[^;]+/\1<redacted>/I' "$guide_headers" > "$guide_headers.safe"
  rm -f "$guide_headers" "$cookie"

  case "$guide_code" in 200|302) ;; *)
    echo "ERROR physical_guide_http=$guide_code"
    exit 72
  esac
  if grep -q 'id="luci_password2"' "$guide_body"; then
    echo "ERROR physical_admin_returned_to_login"
    exit 73
  fi

  echo "STEP admin_password ok"
  echo "PHYSICAL_STAGE1=PASS"
  echo "NEXT=inspect_stock_wizard_then_continue_same_quick_setup_flow"
}

if [[ "$TARGET" == "physical" ]]; then
  run_physical_stage1
  exit 0
fi

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
password_hash="$(printf '%s%s' "$ADMIN_PASSWORD" "$salt" | sha256sum | awk '{print $1}')"
post_page "/cgi-bin/luci/admin/wizard"   --data-urlencode "_csrf=$csrf"   --data-urlencode "salt=$salt"   --data-urlencode "zonename=UTC"   --data-urlencode "timeclock=$(date +%s)"   --data-urlencode "luci_username=admin"   --data-urlencode "luci_password=$password_hash"

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
