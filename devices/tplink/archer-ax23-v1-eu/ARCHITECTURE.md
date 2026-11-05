# AX23 stock Management Plane — evidence-first map

## What is known from the exact stock rootfs
- `/etc/config/network`, `/etc/config/iptv`, `/etc/config/luci`, `/etc/config/uhttpd` exist.
- `/usr/lib/lua/luci/sgi/cgi.lua` exists and is Lua 5.1 bytecode.
- `/bin/busybox` is ELF MIPS32 LE r2 dynamically linked through `/lib/ld-uClibc.so.0`.
- The original **`/usr/sbin/uhttpd` executable exists** and is ELF MIPS32 LE uClibc. `/www/cgi-bin/luci` exists. The stock uhttpd config declares HTTP `0.0.0.0:80` and HTTPS `0.0.0.0:443`, web root `/www`, CGI prefix `/cgi-bin`. **These are stock-config values, never to be used as host rehost listeners.**
- Stock MIPS BusyBox **did execute** under QEMU-user in [Actions #4](https://github.com/4oker12/laboratory_hub/actions/runs/42025818490) with expected output; original HTTP server/CGI still not executed.
- Original LuCI controller filenames observed: `controller/login.lua`, `controller/admin/quick_setup.lua`, `network.lua`, `wireless.lua`, `iptv.lua`; the exact methods require code analysis.
- Original frontend candidate paths: `/www/webpages/modules/login/initLogin/models.js`, `login/localLogin/models.js`, `/www/webpages/modules/qs/script.js`, `/www/webpages/modules/advanced/network/internetAdv/script.js`, `/www/webpages/modules/advanced/wireless/wirelessSettings/wirelessRouter/script.js`.
- Original client crypto-related files present: `/www/webpages/js/libs/encrypt.js`, `tpEncrypt.js`, `cryptoJS.min.js`. **Presence alone does not prove the algorithm used by AX23 login.**

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
