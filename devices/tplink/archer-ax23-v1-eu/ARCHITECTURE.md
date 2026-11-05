# AX23 stock Management Plane — evidence-first map

## What is known from the exact stock rootfs
- `/etc/config/network`, `/etc/config/iptv`, `/etc/config/luci`, `/etc/config/uhttpd` exist.
- `/usr/lib/lua/luci/sgi/cgi.lua` exists and is Lua 5.1 bytecode.
- `/bin/busybox` is ELF MIPS32 LE r2 dynamically linked through `/lib/ld-uClibc.so.0`.
- HTTP server configuration named `uhttpd` is present. The actual executable, sockets, backend routing and request contracts require additional examination.

## Request map (research hypothesis, not confirmed endpoints)

Browser stock HTML/JS -> stock HTTP server -> authentication/session -> stock CGI/RPC -> original config handler -> UCI or vendor persistence -> response.

Only evidence extracted from this AX23's own image can establish actual method names, request parameters, crypto, tokens, server side effects and readback behavior.

## Evidence required for rehost
1. Inspect and hash exact web/CGI/daemon files from stock image.
2. Identify init chain and hardware dependencies; match QEMU-user to observed MIPS32 LE ABI.
3. Start stock binary only in isolated loopback userspace. Never run real router init/flash scripts on host.
4. Verify first-run, login, Quick Setup, WAN/WLAN/VLAN setters through original handlers and original readback/config delta.
5. If a missing hardware service is shimmed, log it as environment support; a fabricated config response stays `SIMULATED_NON_EVIDENCE`.

Xiaomi R4A QEMU/PRoot plus original LuCI is only *methodology*, not AX23 handler, crypto or session proof. C20 results are likewise not AX23 protocol authority.
