# AX23 evidence matrix — 2026-11-05

| Function | Grade | Directly observed stock evidence | What remains |
| --- | --- | --- | --- |
| Official file provenance | Measured vendor artifact | ZIP and BIN SHA-256 / exact byte counts, workflow run #2 | Nothing for selected source |
| Image kernel/layout | STATIC_STOCK_CONFIRMED | uImage MIPS LZMA at 8212; SquashFS xz at 3111990 | Kernel execution excluded |
| Rootfs extraction | STATIC_STOCK_CONFIRMED | Genuine successful unsquashfs extraction | Full code inventory |
| ELF architecture | STATIC_STOCK_CONFIRMED | BusyBox, uhttpd, ubus, Lua: ELF MIPS32 LE r2, uClibc loader | HTTP/CGI runtime |
| Stock BusyBox execution | RUNTIME_STOCK_CONFIRMED (basic executable only) | Original BusyBox returned exit 0 + `STOCK_AX23_MIPS_BUSYBOX_RUNTIME_OK` under qemu-mipsel in run #4 | No auth/config inference permitted |
| Stock frontend and daemon inventory | STATIC_STOCK_CONFIRMED | Real `/usr/sbin/uhttpd`, `/www/cgi-bin/luci`, stock login/quick-setup frontend and LuCI controller filenames | Endpoint semantics / actual startup |
| Stock web/API runtime | UNVERIFIED | No HTTP/CGI service actually exercised yet | Read-only daemon and genuine API calls |
| Create admin | UNVERIFIED | None | Actual stock code/state transition |
| Login/session/logout | UNVERIFIED | None | Crypto, request and server proof |
| Quick Setup/ISP | UNVERIFIED | None | State machine / backend |
| WAN DHCP/PPPoE/static | UNVERIFIED | Stock `/etc/config/network` file exists | Original SET/GET + state delta |
| Wi-Fi 2.4/5 GHz | UNVERIFIED | None | Original setter/readback |
| VLAN/IPTV | UNVERIFIED | `/etc/config/iptv` file exists | Original handler and readback |
| Persistence | UNVERIFIED | None | Original write and cold readback |
| RF/PHY/NAT performance | BLOCKED_REQUIRES_HARDWARE | No hardware available | Physical test |

The documented allowed grades for **functions** are `RUNTIME_STOCK_CONFIRMED`, `STATIC_STOCK_CONFIRMED`, `FRONTEND_ONLY`, `SIMULATED_NON_EVIDENCE`, `BLOCKED_REQUIRES_HARDWARE`; `UNVERIFIED` indicates a function not yet investigated. A 200 status or fake readback is insufficient. Stock evidence: https://github.com/4oker12/laboratory_hub/actions/runs/42024790956 and https://github.com/4oker12/laboratory_hub/actions/runs/42025818490


## Rehost attempts: evidence, not successful configuration

| Probe | Verified outcome | Evidence |
| --- | --- | --- |
| Genuine BusyBox inside chroot | **Runtime success**, original stock executable with stock rootfs | [GitHub run #42030387445](https://github.com/4oker12/laboratory_hub/actions/runs/42030387445) |
| Genuine uhttpd inside chroot | **Runtime started but HTTP not reachable**; stderr `sysmode: Entry not found`, `Failed to connect to ubus` | [GitHub run #42030658737](https://github.com/4oker12/laboratory_hub/actions/runs/42030658737) |
| Genuine ubusd | Binary present; first run failed to create expected socket `usock: No such file or directory` | [GitHub run #42030658737](https://github.com/4oker12/laboratory_hub/actions/runs/42030658737) |
| PRoot + dynamic qemu-user | Guest BusyBox blocked; not an AX23 code rejection | [GitHub run #42029941835](https://github.com/4oker12/laboratory_hub/actions/runs/42029941835) |

**No** AX23 login, Quick Setup, WAN, Wi-Fi or IPTV function is yet `RUNTIME_STOCK_CONFIRMED`. Basic process execution does not prove any configuration function.


## First original stock HTTP success — 2026-11-05

[GitHub Actions run 42031674202](https://github.com/4oker12/laboratory_hub/actions/runs/42031674202) was **cancelled by CI timeout during shutdown**, **after** these exact observations:

```text
CHROOT_STOCK_BUSYBOX=OK
STOCK_AX23_CHROOT_BUSYBOX_OK
stock-chroot=NO_HTTP_RESPONSE
sysmode: Entry not found
Failed to connect to ubus
CHROOT_STOCK_UBUSD_TRIAL=START
stock-chroot-with-stock-ubusd=STOCK_UHTTPD_STATIC_BYTE_IDENTICAL
stock-chroot-with-stock-ubusd-PROCESS=RUNNING
stock-chroot-with-stock-ubusd-CGI_GET_HTTP_STATUS=403
```

Interpretation:

1. Original stock `ubusd` plus fixed in-chroot `/var/run` socket directory unblock original stock `uhttpd` serving original `/www/webpages/index.html`.
2. **Byte-identical original static HTML** establishes actual stock HTTP daemon execution. It is not a stand-in static server.
3. Original CGI endpoint returned **HTTP 403**; this proves a request reached the HTTP stack, **not** successful CGI execution, login or config changes.
4. The job-level `cancelled` status describes a shutdown hang after the HTTP probe. The prior log lines remain verified evidence; the runtime script must not use unbounded `wait` for emulator children.
5. Remaining research: distinguish uhttpd CGI permission/loader failures from LuCI's own access-control rejection; then run original read-only login endpoints before attempting any write/persistence.

No router hardware was touched; `127.0.0.1:18023` only. No credentials sent, firmware binaries or stock assets committed.
