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
