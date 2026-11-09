# AX23 Quick Setup — vendor flow mapped, UI-only walk-through

## Source authority

- Official **Archer AX23(EU) V1 1.1.3 Build 20250905** firmware.
- Browser HAR from the isolated stock UI; the HAR provided the **actual unmodified** `/webpages/modules/qs/script.js` (165,740 bytes) and `/webpages/modules/qs/view.html` (67,104 bytes). The raw files are not copied to GitHub because they contain TP-Link proprietary assets.
- Original stock `qs/script.js` defines `quickSetupRouterSteps` and the route `/admin/quick_setup?form=quick_setup`.
- The user HAR also shows seven POST requests to this form that return HTTP 500 in the QEMU userspace guest. The failure's root cause is not proven; do not fabricate a CGI success or pretend Quick Setup is saved.

## Verified original Router-mode step IDs

The stock `quickSetupRouterSteps` definition includes these stages, in order (optional stages are conditionally reachable depending on hardware/certification):

1. `qsSetTimezone`
2. `qsSelectInternetPort` (only with `supportWanLanPort`)
3. `qsChooseInternetType`
4. `qsInternetEdit`
5. `qsWirelessSetting`
6. `qsInternetConnection` (transient; no step node)
7. `qsAutoUpdate` (optional)
8. `qsFwUpgrade` (transient)
9. `qsWifiBoostSet` (optional)
10. `qsSummary`
11. `qsDualNatDetect` (optional)
12. `qsExtenderGuidance` (optional)
13. `qsCloudAndTether` / `qsUXPlan` (conditions vary).

Stock `quickSetupModel` explicitly contains field mappings:
`networkConntype` -> `network_conntype`,
`wireless2gSsid` -> `wireless_2g_ssid`,
`wireless5gSsid` -> `wireless_5g_ssid`,
`wirelessSmartEnable` -> `smart_connect_smart_enable`,
`ispSpecialInternetVid` -> `isp_special_internet_vid`.
These are field mappings, **not** authenticated setters or proof of persistence.

## Current deliverable: fully navigable local training path

The original LuCI still runs on `127.0.0.1:18023` and the stock `/webpages/index.html` remains unchanged.
The same original `uhttpd` additionally serves a **separate RouterLab teaching UI**:

```
http://127.0.0.1:18023/webpages/routerlab-quick-setup.html
```

This custom UI is labelled **"Учебный маршрут — не штатный Quick Setup"**.
It supports five ordered stages:

`qsSetTimezone` → `qsChooseInternetType` → `qsInternetEdit` → `qsWirelessSetting` → `qsSummary` → local completion screen.

- WAN: DHCP/IPoE, PPPoE, Static IP (demo-only).
- Optional VLAN field, default off.
- Dual-band SSID/password + Smart Connect.
- Back/Next, validation and final summary.
- Final **safe report**: only stages, options and success of *local UI validation*; does not retain passwords, SSIDs, IPs, cookies, tokens, credentials or encrypted data.
- All values stay inside browser page memory; on refresh they reset to synthetic examples. No storage, no CGI requests, no router settings changed.
- Nothing in this custom page proves genuine protected AX23 `read`/`write`, WAN DHCP, Wi-Fi radio, flash persistence, or Quick Setup completion on hardware.
- The training path is intentionally separate from original vendor `qs/view.html` so its behavior cannot be misidentified as stock.

### Why this is not yet the original stock wizard working end-to-end

A true verified stock Quick Setup must exercise the actual `qs/script.js` controller and encrypted POSTs, receive a genuine original server success, then read back the changed `/etc/config` fields. The original firmware rootfs lacks some runtime dependencies in QEMU and currently returns HTTP 500 on the relevant form. The separate preview demonstrates **navigation and input validation only**, and makes the still-unimplemented adapter boundary explicit.

## Next acceptance on hardware

1. Capture browser stage IDs / encrypted calls from stock UI, never secret values.
2. Compare to field and form names identified in this map.
3. For DHCP/IPoE: read original WAN mode and post-configuration DHCP/route state.
4. For wireless: read back SSIDs from original protected read and confirm association from a client.
5. Verify persistence across restart; unsupported API is reported as unsupported, never simulated success.

No change to physical router, operator production infrastructure or AX55/C20 code.
