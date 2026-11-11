# RouterLab Xiaomi — operator emulator architecture

Scope: responsive **offline training website**. It does not connect to or control a physical router. The styling and navigation approximate MiWiFi, but pixel-perfect equivalence to Xiaomi stock pages is **not yet validated**.

Verified initial target: Xiaomi Mi Router 4A Gigabit Edition (R4A), Global/International firmware 3.0.24. No additional hardware or firmware is claimed supported.

## Two separate execution modes

| Dimension | Static educational website (this folder) | Authentic stock rehost (devices/xiaomi/) |
|---|---|---|
| Source | RouterLab-owned HTML/CSS/JS | Original Xiaomi stock /www + original LuCI / FastCGI |
| Purpose | Operator training, simulated faults | Firmware API and browser research |
| WAN and Wi-Fi | Deterministic local fixture | Original Xiaomi WAN/Wi-Fi configuration API |
| Network calls | Forbidden by CSP | Only local explicit emulation backend |
| Credentials | Fictional training passwords, session-scoped | Local lab fixture; never real customers |
| Hosting | Static site / optional Pages | WSL and local stock rootfs, not public |
| Hardware | Not required | No live RF, PHY, switch, PPPoE peer |

A visual demo must never claim to have detected a real IP, link, radio, wireless client, PPPoE session, or ISP status. Real firmware images and proprietary bundles do not belong in the public static website.

## Layering and dependency direction

- catalog.js: exact hardware/firmware metadata, verified capabilities, compatible view profile. One record per validated firmware, grouped by family ID.
- scenarios.js: synthetic outages, clear labels and operator diagnostic prompts.
- core.js: pure state machine for factory wizard, login configuration, WAN DHCP/PPPoE, both Wi-Fi bands, LAN and reset. No browser or HTTP API dependency.
- storage.js: schema-validated, exact-model-keyed session state. Reset is explicit; no cross-model state leakage. Never use for production credentials.
- app.js: DOM controller and screen templates. Only here may HTML event handlers and view renderers live. Split views by firmware profile when a second divergent UI exists.
- style.css: the RouterLab-controlled training visual system.
- index.html: module composition and CSP. No remote scripts or connections.

Core must never import DOM, storage, real router clients or proprietary Xiaomi resources. Stock rehost compatibility shims stay in the exact devices/xiaomi firmware leaf.

## Adding Xiaomi variants

1. Obtain evidence of exact device hardware ID, firmware version/region and official image/hash.
2. Inspect stock browser pages, authentication and WAN/Wi-Fi contracts. Collect sanitized traces of first-run and configured UI.
3. Decide whether the variant genuinely supports the existing view/behavior profile. Otherwise implement a separate profile. Never guess cross-firmware API compatibility.
4. Add an explicit catalog record, UI fixtures, capabilities, tests and mobile/desktop screenshots.
5. Mark real hardware-dependent sections unsupported or synthetic, with operator guidance. Do not fabricate actual network readings.
6. Verify first-run, login, DHCP/PPPoE, 2.4/5 GHz, reset, persistence, navigation and offline policy. Commit, push, PR and record remaining gaps.

Do not pad the catalog with unverified devices.

## Start training website

From the repository root on a machine with Python:

    python3 -m http.server 8765 --directory docs/emulator/xiaomi

Visit http://127.0.0.1:8765/ on the same machine. Choose model, firmware, and factory/configured scenario. The password of the configured demo is RouterLab88. Real subscriber credentials must not be entered.

The selected training state is saved only for the current browser session; all displayed network failures are synthetic.

For the exact original Xiaomi UI, start the separate stock rehost from the repository root on Windows with prepared WSL, firmware and dependencies:

    .\Run-RouterLab.ps1 -Action Reset -Device xiaomi-r4a-3.0.24-int -Profile Factory
    .\Run-RouterLab.ps1 -Action Start -Device xiaomi-r4a-3.0.24-int -Profile Factory

Original stock UI then listens locally at http://127.0.0.1:18090/; this independent rehost is not embedded in the static website.

## Automated quality gate

    node --test tests/routerlab_xiaomi_operator_emulator_test.cjs
    node --check docs/emulator/xiaomi/catalog.js
    node --check docs/emulator/xiaomi/scenarios.js
    node --check docs/emulator/xiaomi/core.js
    node --check docs/emulator/xiaomi/storage.js
    node --check docs/emulator/xiaomi/app.js

Separate CI verifies only the offline demo. Existing firmware rehost CI remains independent.

## Browser acceptance before calling this complete

- Factory: region/language, WAN DHCP or PPPoE, Wi-Fi both bands, password; transition into configured state.
- Configured: login/logout, status, WAN, each Wi-Fi band, LAN/DHCP, security, system, clients and unsupported QoS notice.
- Saving one band must not change the other band; navigation retains saved state.
- Every fault must be labeled as simulated and provide an operator check.
- Refresh retains state in the same browser session; reset returns to initial setup.
- Mobile and desktop layout, keyboard accessibility, no outbound router/API requests.

Unverified today: visual pixel parity with stock UI; full browser end-to-end interaction in all screens; screenshot regression; languages and additional hardware/firmware profiles. These are tracked as future work rather than reported as done.
