#!/usr/bin/env bash
set -Eeuo pipefail

BASE="${ROUTERLAB_CUDY_BASE:-http://127.0.0.1:${ROUTERLAB_CUDY_PORT:-18093}}"
PASSWORD="${ROUTERLAB_CUDY_LOGIN_PASSWORD:?ROUTERLAB_CUDY_LOGIN_PASSWORD is required}"
COOKIE="${ROUTERLAB_CUDY_COOKIE:-${TMPDIR:-/tmp}/routerlab-cudy-fresh-auth.cookies}"
WORK="${ROUTERLAB_CUDY_AUTH_WORK:-${TMPDIR:-/tmp}/routerlab-cudy-auth-$$}"

mkdir -p "$WORK"
rm -f "$COOKIE"

BODY="$WORK/login.body"
HEADERS="$WORK/login.headers"
VERIFY="$WORK/verify.body"

form_value() {
  local file="$1" name="$2"
  sed -n "s/.*name=\"$name\"[^>]*value=\"\([^\"]*\)\".*/\1/p" "$file" | head -n1
}

http_get_login() {
  local code
  code="$(curl -sS --max-time 10 --max-redirs 5 -L     -D "$HEADERS" -b "$COOKIE" -c "$COOKIE"     -o "$BODY" -w '%{http_code}' "$BASE/cgi-bin/luci" || true)"
  echo "INFO auth_form_http=$code"
  case "$code" in
    200|401|403) ;;
    *) echo "ERROR auth_form_unreachable http=$code"; exit 60 ;;
  esac
}

http_get_login

if ! grep -q 'name="luci_password"' "$BODY" 2>/dev/null; then
  echo "ERROR login_form_missing"
  exit 61
fi

USERNAME="$(form_value "$BODY" "luci_username")"
[[ -n "$USERNAME" ]] || USERNAME="admin"
ACTION="$(sed -n 's/.*<form[^>]*action="\([^"]*\)".*/\1/p' "$BODY" | head -n1)"
[[ -n "$ACTION" ]] || ACTION="/cgi-bin/luci/"

SALT="$(form_value "$BODY" "salt")"
CSRF="$(form_value "$BODY" "_csrf")"
TOKEN_FIELD=0
grep -q 'name="token"' "$BODY" 2>/dev/null && TOKEN_FIELD=1

SUBMITTED_PASSWORD="$PASSWORD"
TOKEN=""

if [[ -n "$SALT" ]]; then
  SUBMITTED_PASSWORD="$(printf '%s%s' "$PASSWORD" "$SALT" | sha256sum | awk '{print $1}')"
  echo "INFO auth_transform=sha256_password_plus_salt"

  if [[ "$TOKEN_FIELD" == "1" ]]; then
    TOKEN="$(curl -sS --max-time 8 -b "$COOKIE" -c "$COOKIE"       -X POST "$BASE/cgi-bin/luci/admin/get_token" 2>/dev/null || true)"
    [[ -n "$TOKEN" ]] || { echo "ERROR login_token_missing"; exit 62; }
    SUBMITTED_PASSWORD="$(printf '%s%s' "$SUBMITTED_PASSWORD" "$TOKEN" | sha256sum | awk '{print $1}')"
    echo "INFO auth_token_binding=enabled"
  else
    echo "INFO auth_token_binding=disabled"
  fi
else
  echo "INFO auth_transform=plain_legacy"
fi

args=(
  --data-urlencode "zonename=UTC"
  --data-urlencode "timeclock=$(date +%s)"
  --data-urlencode "luci_username=$USERNAME"
  --data-urlencode "luci_password=$SUBMITTED_PASSWORD"
)
[[ -n "$CSRF" ]] && args+=(--data-urlencode "_csrf=$CSRF")
[[ -n "$SALT" ]] && args+=(--data-urlencode "salt=$SALT")
[[ -n "$TOKEN" && "$TOKEN_FIELD" == "1" ]] && args+=(--data-urlencode "token=$TOKEN")

POST_CODE="$(curl -sS --max-time 15   -D "$WORK/post.headers" -b "$COOKIE" -c "$COOKIE"   -X POST "$BASE$ACTION" "${args[@]}"   -o "$WORK/post.body" -w '%{http_code}' || true)"
echo "INFO auth_post_http=$POST_CODE"

case "$POST_CODE" in
  200|302|303|401|403) ;;
  *) echo "ERROR auth_post_transport http=$POST_CODE"; exit 63 ;;
esac

VERIFY_CODE="$(curl -sS --max-time 10 --max-redirs 5 -L   -b "$COOKIE" -c "$COOKIE"   -o "$VERIFY" -w '%{http_code}'   "$BASE/cgi-bin/luci/admin/network/summary?embedded=&nextbtn=" || true)"
echo "INFO auth_verify_http=$VERIFY_CODE"

case "$VERIFY_CODE" in
  200|302) ;;
  *) echo "ERROR fresh_auth_verify_transport http=$VERIFY_CODE"; exit 64 ;;
esac

if grep -q 'name="luci_password"' "$VERIFY" 2>/dev/null    && grep -qiE 'Login|Invalid password' "$VERIFY" 2>/dev/null; then
  echo "ERROR fresh_auth_rejected"
  exit 65
fi

if ! grep -qiE 'Summary|Save|Apply|Internet|Wireless|Router|WAN|network' "$VERIFY" 2>/dev/null; then
  echo "ERROR fresh_auth_protected_content_unrecognized"
  exit 66
fi

echo "FRESH_AUTH=PASS"
