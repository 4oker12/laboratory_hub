#!/usr/bin/env bash
# Called ONLY by sudo unshare --pid --net --mount --ipc --uts --fork --mount-proc.
set -Eeuo pipefail
ROOTFS="$1"
OUT="$2"
HOST_NETNS="$3"
HOST_PIDNS="$4"
if [[ "$(id -u)" != 0 ]]; then echo AX23_FIRST_ADMIN_SANDBOX=NOT_ROOT; exit 1; fi
if [[ "$(readlink /proc/self/ns/net)" == "$HOST_NETNS" ]]; then echo AX23_FIRST_ADMIN_SANDBOX=HOST_NETWORK_FORBIDDEN; exit 1; fi
if [[ "$(readlink /proc/self/ns/pid)" == "$HOST_PIDNS" ]]; then echo AX23_FIRST_ADMIN_SANDBOX=HOST_PID_FORBIDDEN; exit 1; fi
if ip -4 route show default | grep -q '^default'; then echo AX23_FIRST_ADMIN_SANDBOX=DEFAULT_ROUTE_FORBIDDEN; exit 1; fi
ip link set lo up
echo AX23_FIRST_ADMIN_SANDBOX=NAMESPACE_ISOLATION_CONFIRMED
# Stock daemons inherit only guest loopback, and PID/signal syscalls stay in this namespace.
export ROUTERLAB_AX23_SANDBOXED=1
export ROUTERLAB_AX23_VERIFIED_HOST_NETNS="$HOST_NETNS"
HERE="$(cd "$(dirname "$0")" && pwd)"
bash "$HERE/stock-rehost-probe.sh" "$ROOTFS" "$OUT"
