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

# 7) Invoke the discovered stock finalizer in the correct luci.app context.
# Only late service execution is suppressed: the stock qsetup.apply() still
# owns UCI mutation/commit, including luci.main.wizard = 0.
cat > "$RUNTIME/tmp/routerlab-stock-apply.lua" <<'LUA'
local app = require("luci.app")
assert(type(app) == "table", "luci.app missing")
assert(type(app.qsetup) == "table", "luci.app.qsetup missing")
assert(type(app.qsetup.apply) == "function", "qsetup.apply missing")

local apply = app.qsetup.apply
local env = getfenv(apply)
assert(type(env) == "table", "qsetup.apply environment missing")
assert(type(env.sys) == "table", "qsetup sys boundary missing")

env.sys.fork_apply = function(arg)
  local f = io.open("/tmp/routerlab-web-apply-boundary.log", "a")
  if f then
    f:write("fork_apply")
    if type(arg) == "table" then
      for i,v in ipairs(arg) do f:write(" ", tostring(v)) end
    end
    f:write("\n")
    f:close()
  end
  return true
end

env.sys.fork_exec = function(cmd)
  local f = io.open("/tmp/routerlab-web-apply-boundary.log", "a")
  if f then
    f:write("fork_exec <suppressed>\n")
    f:close()
  end
  return true
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
