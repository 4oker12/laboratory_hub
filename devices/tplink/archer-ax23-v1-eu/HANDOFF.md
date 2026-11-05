# AX23 handoff (isolation from AX55)

Repository: `4oker12/laboratory_hub`
Branch: `research/routerlab-archer-ax23-v1-eu-rehost`
Base: `main`; PR only, do not merge.
Model-only directories: `devices/tplink/archer-ax23-v1-eu/`, `tests/firmware/archer_ax23_v1_eu/` and one workflow. AX55 Issue #18 belongs to a second agent.

## Accomplished
- Verified newest listed TP-Link AX23 EU hardware V1 firmware 1.1.3 Build 20250905.
- Downloaded vendor ZIP inside GitHub Actions; measured genuine ZIP and BIN SHA256.
- Mapped MIPS uImage and extracted original SquashFS at offset 3111990.
- Observed MIPS32 LE BusyBox, `/etc/config/uhttpd`, `/etc/config/luci` and UCI config.
- Local read-only audit script available; no stock management API execution claimed.

Stock audit: https://github.com/4oker12/laboratory_hub/actions/runs/42024790956

## Next proof
1. Inventory stock /www, /usr/lib/lua/luci, /usr/sbin, init; locate real server, session and CGI/RPC binaries.
2. Run limited stock MIPS binary smoke under QEMU-user. Execute no router init, flash, rf or network scripts.
3. Recover stock browser JS -> HTTP server -> handlers -> config storage path.
4. Start genuine stock handler on loopback 127.0.0.1:18023, preserving vendor control flow.
5. Test first admin/login, Quick Setup and DHCP/Wi-Fi readback, and classify each with exact evidence tier.
6. Update docs/PR after verified stock runtime results. No inherited assumptions from C20 or Xiaomi.

If a runtime call fails, document its precise dependency and avoid synthetic success.
