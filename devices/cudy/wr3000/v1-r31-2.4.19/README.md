# Cudy WR3000 V1 (R31) — stock firmware research

Target is specifically Cudy WR3000 V1.0/R31 with official stock firmware 2.4.19.
Source: https://www.cudy.com/ru-ru/pages/download-center/wr3000-1-0

The stock 2.4.19 firmware download is identified, but full rootfs and firmware-derived authentication/Quick Setup contracts remain unverified. Do not reuse WR1200 or WR3000 V2/V3 write commands by assumption.

Research script: `probe_firmware.py --download --out wr3000-evidence` requires Python 3 and `unsquashfs`. It records hashes and scans original firmware for relevant stock backend modules. Images and original vendor code are not redistributed.

iPhone diagnostic client lives in `mobile/WR3000Probe/`. It uses local IPv4 only, sends one candidate LuCI authentication flow, and issues only GET requests after login. It records response status, timing, size, SHA256 prefix and stage, not passwords, cookies, CSRF or raw router configuration. Exported JSON is suitable for troubleshooting.

**Write operations are deliberately disabled** until the exact V1/R31 firmware has been inspected, specific vendor API contracts recovered, and then verified on hardware. The unsigned iOS IPA requires sideload signing. This build is NOT a finished Quick Setup implementation or an update to the existing RouterLab mobile harness.

## Static verification from the stock R31 2.4.19 image

CI extracted the original image `WR3000-R31-2.4.19-20250828-192837-sysupgrade.bin`, SHA256 `a3db37cc6f8407d0469c789981f641405b541a323f4fe9614e4b20ca792b94b6`.
SquashFS is v4.0/XZ at byte offset `3409920` (`0x340800`), with **1,568 regular files** extracted. A non-root CI runner cannot create `/dev/console`, which does not prevent source-level analysis.

**Stock-derived authentication (not yet tested on physical WR3000):**

- `www/luci-static/bootstrap/js/sysauth.js`: `luci_password = SHA256(password + salt)`; if the form has a `token` field, `luci_password = SHA256(previous_hash + token)`. If `salt` does not exist, the stock JS supplies un-hashed password.
- `usr/lib/lua/luci/view/themes/bootstrap/sysauth.htm`: when `defpasswd=1` and `wizard=1`, form submits to `/cgi-bin/luci/admin/wizard` to **create admin password**. Normal login submits to `/cgi-bin/luci/`. The iPhone read-only probe now **detects but does not submit** the factory form.
- `usr/lib/lua/luci/view/wizard.htm`: front-end uses `gui.show_wizard(...)`, `wizard_xhr_load`, dynamic step form URLs and `new FormData(form)`, not one universal write endpoint. Per-step form schemas and save/apply behavior need further stock analysis.
- `usr/lib/lua/luci/view/wan/config.htm`: stock WAN types `dhcp` and `pppoe`; detail form under `admin/network/wan/config/detail`; diagnostics under `admin/network/wan/config/detect`.
- `usr/lib/lua/luci/apprpc/qsetup.lua`: Lua bytecode, stock symbols `set_wan`, `fork_apply`, `wlan00`, `wlan10`, `encryption`, `dynssid`. String names alone **do not** prove callable signatures.
- `usr/lib/lua/luci/model/cbi/network/summary.lua`: stock summary and Save & Apply logic, also compiled Lua bytecode.

This evidence supports the sign-in and first-run **state detection**. It does **not** establish an end-to-end Quick Setup write contract or warrant any claim that WAN/WiFi writes work.

### Lab milestones

1. Read-only iOS probe and redacted JSON diagnostics: **CI build verified**, hardware test pending.
2. Official R31 firmware retrieval, rootfs, stock login and wizard static protocol: **validated**.
3. Exact wizard step contracts, vendor RPC input/output, persistence and rollback: **pending**.
4. Independent native RouterLab WAN/Wi-Fi write paths: **disabled pending contract and hardware proof**.
5. Integration into existing RouterLab iOS app rather than stand-alone probe: **pending**.
