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


## Runtime dependency experiments (November 5, 2026)

- Stock `/bin/busybox` executed successfully **inside a disposable rootfs chroot** using original MIPS32 binary and host QEMU-user (GitHub Actions run #42030387445).
- Stock `/usr/sbin/uhttpd` under chroot attempted to start but produced **`sysmode: Entry not found`** and **`Failed to connect to ubus`**. The server did not serve original HTML. This is an exact stock process failure, not proof of login or CGI behavior.
- Original `/sbin/ubusd` exists. An early start attempt reported `usock: No such file or directory`; the disposable rootfs's `/var` symlink and runtime socket path require reproduction. See run #42030658737. Stock processes were never bound to a non-loopback host interface.
- On Ubuntu 26.04 runner, PRoot with dynamically linked qemu-user failed to start even BusyBox; chroot was the working minimal compatibility route.
- *No* router-specific `sysmode` semantics should be fabricated to make HTTP return 200. Restore a stock runtime dependency only when an actual stock script, config or binary proves it.


## Verified CGI form routing and callback boundary

Original AX23 frontend `modules/login/models.js` and binary Lua `controller/login.lua` share names `check_factory_default` and `keys`. Original `uhttpd` plus `ubusd` responds to `/cgi-bin/luci/login?form=...` with the stock JSON envelope. Without an explicit operation, the named forms return `no such callback` (from stock `luci/model/controller.lua`). Unknown forms yield another response shape. This proves HTTP/CGI plumbing, **not** that any auth operation has succeeded.

Do not infer missing ubus providers are the cause of callback failure until the precise original `operation` transport and callback registration contract is reproduced from stock JS/Lua. A test is in the model-specific workflow.

