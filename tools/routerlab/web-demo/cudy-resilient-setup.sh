#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUICK="$SCRIPT_DIR/cudy-quick-setup.sh"
MAX_ATTEMPTS="${ROUTERLAB_RECOVERY_ATTEMPTS:-4}"
WAIT_ATTEMPTS="${ROUTERLAB_REDISCOVERY_ATTEMPTS:-20}"
WAIT_DELAY="${ROUTERLAB_REDISCOVERY_DELAY:-1}"
PORT="${ROUTERLAB_CUDY_PORT:-18093}"
BASE="${ROUTERLAB_CUDY_BASE:-http://127.0.0.1:$PORT}"
BASE="${BASE%/}"
CANDIDATES="${ROUTERLAB_CUDY_CANDIDATE_BASES:-$BASE}"

is_recoverable_rc() {
  case "$1" in
    7|18|28|35|52|56|90) return 0 ;;
    *) return 1 ;;
  esac
}

probe_base() {
  local b="$1" code
  code="$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "$b/cgi-bin/luci" 2>/dev/null || true)"
  case "$code" in
    200|302|401|403) return 0 ;;
    *) return 1 ;;
  esac
}

rediscover() {
  local i b
  echo "STATE REDISCOVERING"
  for ((i=1; i<=WAIT_ATTEMPTS; i++)); do
    for b in $CANDIDATES; do
      b="${b%/}"
      if probe_base "$b"; then
        BASE="$b"
        export ROUTERLAB_CUDY_BASE="$BASE"
        echo "STATE RECONNECTED attempt=$i"
        echo "INFO rediscovered_base=$BASE"
        return 0
      fi
    done
    sleep "$WAIT_DELAY"
  done
  echo "STATE REDISCOVERY_FAILED"
  return 1
}

attempt=1
preserve_cookie=0
while (( attempt <= MAX_ATTEMPTS )); do
  echo "STATE CONFIGURING attempt=$attempt"
  set +e
  ROUTERLAB_PRESERVE_COOKIE="$preserve_cookie" bash "$QUICK"
  rc=$?
  set -e

  if [[ "$rc" -eq 0 ]]; then
    echo "STATE VERIFYING"
    echo "RESILIENT_SETUP=PASS attempts=$attempt"
    exit 0
  fi

  echo "INFO setup_attempt_rc=$rc"

  if ! is_recoverable_rc "$rc"; then
    echo "STATE FAILED_NONRECOVERABLE rc=$rc"
    exit "$rc"
  fi

  echo "STATE CONNECTION_LOST_EXPECTED rc=$rc"

  # Fault injection is one-shot by definition. A real transport failure has no
  # such variable, so unsetting it does not alter production behavior.
  unset ROUTERLAB_FAULT_AFTER_STAGE

  if ! rediscover; then
    echo "ERROR router_not_rediscovered"
    exit 70
  fi

  # A transport interruption does not imply session invalidation. Keep the
  # stock cookie jar for the retry; the quick adapter can still fall back to
  # explicit auth if the router rejects it.
  preserve_cookie=1
  attempt=$((attempt + 1))
done

echo "STATE FAILED_RETRY_BUDGET"
echo "ERROR recovery_attempts_exhausted attempts=$MAX_ATTEMPTS"
exit 71
