#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo " RouterLab Web Demo — Stage 1"
echo " factory Cudy -> browser -> detect"
echo "============================================================"

"$SCRIPT_DIR/cudy-factory-runtime.sh" reset

echo
echo "Opening web demo on port 19080."
echo "Use the browser as the subscriber; no more terminal actions are required."
echo

exec python3 "$SCRIPT_DIR/server.py"   --runtime "$HOME/cudy-wr1200-browser-lab/runtime"   --router-base "http://127.0.0.1:18093"   --host "0.0.0.0"   --port 19080
