#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo " RouterLab Web Demo — Stage 2"
echo " detect -> quick setup -> stock qsetup.apply -> verify"
echo "============================================================"

# Stop an older Web Demo instance if a previous terminal/session left it alive.
# Match only this RouterLab server and its dedicated port.
set +e
for pid in $(pgrep -f "tools/routerlab/web-demo/server.py.*--port 19080" 2>/dev/null); do
  [[ "$pid" != "$" ]] && kill -TERM "$pid" 2>/dev/null
done
set -e
sleep 0.3

bash "$SCRIPT_DIR/cudy-factory-runtime.sh" reset

echo
echo "Opening web demo on port 19080."
echo "Use the browser as the subscriber."
echo

exec python3 "$SCRIPT_DIR/server.py"   --runtime "$HOME/cudy-wr1200-browser-lab/runtime"   --router-base "http://127.0.0.1:18093"   --host "0.0.0.0"   --port 19080
