# AX23 handoff (isolation from AX55)

Repository: `4oker12/laboratory_hub`
Branch: `research/routerlab-archer-ax23-v1-eu-rehost`
Base: `main`; PR only, do not merge.
Model-only directories: `devices/tplink/archer-ax23-v1-eu/`, `tests/firmware/archer_ax23_v1_eu/` and one workflow. AX55 Issue #18 belongs to a second agent.

## Accomplished
- Verified newest listed TP-Link AX23 EU hardware V1 firmware 1.1.3 Build 20250905.
- Downloaded vendor ZIP inside GitHub Actions; measured genuine ZIP and BIN SHA256.
- Mapped MIPS uImage and extracted original SquashFS at offset 3111990.
- Observed original MIPS32 LE `uhttpd`, `ubus`, Lua and BusyBox, `/www/cgi-bin/luci`, LuCI admin controllers for network, wireless, IPTV, Quick Setup, login.
- Original BusyBox executed under QEMU-user: `STOCK_AX23_MIPS_BUSYBOX_RUNTIME_OK` in Actions #4. This does NOT prove uhttpd/API runtime or router configuration.
- Inventory found original auth-related JS `encrypt.js`, `tpEncrypt.js`, `cryptoJS.min.js`, and vendor web modules. Crypto and method names remain unverified.
- Local read-only audit script available; no stock management API execution claimed.

Stock rootfs audit: https://github.com/4oker12/laboratory_hub/actions/runs/42024790956
Stock paths + original executable smoke: https://github.com/4oker12/laboratory_hub/actions/runs/42025818490

## Next proof
1. Inspect actual startup config, auth JS/bytecode and vendor service dependencies; do not infer contracts from filenames.
2. Attempt stock uhttpd/CGI under isolated loopback; BusyBox already works under QEMU-user, but HTTP remains unverified.
3. Recover stock browser JS -> HTTP server -> handlers -> config storage path.
4. Start genuine stock handler on loopback 127.0.0.1:18023, preserving vendor control flow.
5. Test first admin/login, Quick Setup and DHCP/Wi-Fi readback, and classify each with exact evidence tier.
6. Update docs/PR after verified stock runtime results. No inherited assumptions from C20 or Xiaomi.

If a runtime call fails, document its precise dependency and avoid synthetic success.


## Runtime update — 2026-11-05

- Unlike PRoot on the current Ubuntu runner, temporary rootfs `chroot` with native host QEMU and copied host loader dependencies **executes original stock BusyBox**. This is the proven path for subsequent bounded experiments.
- Original stock `uhttpd` yields `sysmode: Entry not found` and `Failed to connect to ubus`, so original HTML and CGI not yet reachable.
- Original `ubusd` exists but the runtime `/var/run/ubus.sock` parent is not available on an uninitialized extracted rootfs. Avoid following an absolute stock `/var -> /tmp` symlink from the host; prepare its in-chroot `/tmp/run` counterpart.
- Next investigation: genuine stock `ubusd` socket availability, original init scripts/config that produce `sysmode`, and then actual stock HTTP file and CGI responses. Do not patch vendor handler outcomes.
- Read-only script: `stock-rehost-probe.sh`; static JS/bytecode inventory: `stock-contract-inventory.py`.
- [Chroot/ubus failure run](https://github.com/4oker12/laboratory_hub/actions/runs/42030658737).


## Current original API diagnostics — 2026-11-05

Stock management plane has progressed beyond static HTML. Real `uhttpd` + `ubusd` invoke the original CGI/LuCI JSON router; login form names `check_factory_default` and `keys` are backed by **both** stock JS model and original Lua bytecode strings. Under GET with only `form`, both return `{"success":false,"errorcode":"no such callback"}`; unknown form does not produce the same response. Stock callback error originates in `/usr/lib/lua/luci/model/controller.lua`. `ubus list` contains only `uhttpd`.

Next confirm whether the original read callback requires `operation=read` as GET query or as POST form data; do not equate HTTP 200 with success and do not send write operations. Compare the original frontend request contract before considering extra background daemons. Link: https://github.com/4oker12/laboratory_hub/actions/runs/42036327121


## Read callback breakthrough and next gate

[GitHub #42036910567](https://github.com/4oker12/laboratory_hub/actions/runs/42036910567) is a reproducible genuine stock LuCI **read success**: explicit `operation=read` as GET or POST body. Read-backed forms: `check_factory_default` and `keys`; [#42037621193](https://github.com/4oker12/laboratory_hub/actions/runs/42037621193) also proves `auth` read. Factory extracted image reports `is_default=true`. [#42038094446](https://github.com/4oker12/laboratory_hub/actions/runs/42038094446) captures the shapes of the crypto challenges and source identifiers without dumping keys.

**Next gate:** execute original first-admin flow from actual stock web client (or faithfully recovered `initial_login` write filter), using synthetic credentials only in ephemeral stock rootfs, then verify original check_factory_default readback and session. Browser smoke is under investigation; never claim login/config SET until proven. Firmware-info read gives 500 and remains separate limitation.


## CDP / first-admin target (verified 2026-11-05)

Stock browser CDP probe `stock-browser-probe.mjs` was added. [Original GUI + requests #42040942068](https://github.com/4oker12/laboratory_hub/actions/runs/42040942068); [UI selectors and request statuses #42041408774](https://github.com/4oker12/laboratory_hub/actions/runs/42041408774). Original first-admin view includes two visible password inputs (`input.password-hidden`), a visible `#init-login-button a.button-button`, and original form reads. `get_firmware_info` is still 500; others 200. CDP captures method/path/form/operation/status only, not payloads.

**Next gate:** use the original stock browser to attempt *synthetic* first-admin initialization **only in a fully separated PID/network/mount namespace**, snapshot disposable rootfs, and verify with native `check_factory_default` readback plus config delta. No claim of successful first login or persistence until observed. Never run router init or hardware scripts in the GitHub host namespace.

