# AX23 evidence matrix — 2026-11-05

| Function | Grade | Directly observed stock evidence | What remains |
| --- | --- | --- | --- |
| Official file provenance | Measured vendor artifact | ZIP and BIN SHA-256 / exact byte counts, workflow run #2 | Nothing for selected source |
| Image kernel/layout | STATIC_STOCK_CONFIRMED | uImage MIPS LZMA at 8212; SquashFS xz at 3111990 | Kernel execution excluded |
| Rootfs extraction | STATIC_STOCK_CONFIRMED | Genuine successful unsquashfs extraction | Full code inventory |
| ELF architecture | STATIC_STOCK_CONFIRMED | Stock BusyBox ELF MIPS32 LE r2, uClibc loader | Binary execution smoke |
| Stock web/API | UNVERIFIED | `/etc/config/uhttpd`, `/etc/config/luci`, `/usr/lib/lua/luci/sgi/cgi.lua` present | Real frontend/server/handler path |
| Create admin | UNVERIFIED | None | Actual stock code/state transition |
| Login/session/logout | UNVERIFIED | None | Crypto, request and server proof |
| Quick Setup/ISP | UNVERIFIED | None | State machine / backend |
| WAN DHCP/PPPoE/static | UNVERIFIED | Stock `/etc/config/network` file exists | Original SET/GET + state delta |
| Wi-Fi 2.4/5 GHz | UNVERIFIED | None | Original setter/readback |
| VLAN/IPTV | UNVERIFIED | `/etc/config/iptv` file exists | Original handler and readback |
| Persistence | UNVERIFIED | None | Original write and cold readback |
| RF/PHY/NAT performance | BLOCKED_REQUIRES_HARDWARE | No hardware available | Physical test |

The documented allowed grades for **functions** are `RUNTIME_STOCK_CONFIRMED`, `STATIC_STOCK_CONFIRMED`, `FRONTEND_ONLY`, `SIMULATED_NON_EVIDENCE`, `BLOCKED_REQUIRES_HARDWARE`; `UNVERIFIED` indicates a function not yet investigated. A 200 status or fake readback is insufficient. Stock evidence: https://github.com/4oker12/laboratory_hub/actions/runs/42024790956
