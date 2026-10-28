# RouterLab — Netis N2 FW4 (CIS)

This branch adds a protocol adapter **without introducing a second user interface**. The existing RouterLab UI under `extensions/tplink-c20/independent-session` remains the canonical reference for styling, typography and the Factory/Configured flow.

## Evidence and scope

Source: sanitized command contract extracted from a user-supplied HAR captured on October 28, 2026 (not committed). Identified device: `N2`, firmware `N2-V4.0.1.4317`, vendor `CIS`, router IP observed `192.168.1.1`. Hardware revision not independently established.

Observed endpoints:

- `POST /cgi-bin/skk_get.cgi` — read status/settings;
- `POST /cgi-bin/skk_set.cgi` — apply settings;
- `POST /cgi-bin/login.cgi` — authentication.

The firmware returns JSON-like text with trailing commas. The adapter strips trailing commas outside strings before `JSON.parse`; it never evaluates router-provided JavaScript.

## Supported adapter methods

- `detect()` — identify model, firmware and initial stage;
- `read('base'|'guide'|'wan_lan'|'wlan'|'igmp'|'routerState')`;
- `login(password)` — Base64 form encoding as observed (Base64 is **not** encryption);
- `readWan()`, `readWifi()`, `readIgmp()`;
- `setRadioPower(band,power,{confirmed:true})`, `setIgmp({proxy,snooping,confirmed:true})` — write followed by readback;
- `factoryDhcp(input,{confirmed:true})` — observed factory DHCP wizard body only. If connection is interrupted, reports `APPLY_UNCONFIRMED` and does not retry automatically.

All mutation methods require explicit confirmation; a successful HTTP response is **not** considered proof that configuration persisted after reboot.

## Common RouterLab UI contract

```js
// When loaded into an authorized extension context:
const transport = RouterLabNetisFW4.createFetchTransport({
  baseUrl: 'http://192.168.1.1/' // sample only; resolve actual LAN gateway
});
const netis = new RouterLabNetisFW4.NetisFW4Adapter({transport});
const device = await netis.detect();
const uiFlow = RouterLabNetisFW4.toSharedFlow(await netis.read('base'));
// FIRST_CONNECT / KNOWN_PASSWORD / UNAVAILABLE -> existing RouterLab screens
```

**MV3 integration included in this branch:** `extensions/tplink-c20/independent-session/` now bundles the Netis adapter and a separate `netis-dispatch.js` route in the existing service worker. The single shared `setup.html` and `setup.css` are preserved. Choose **Netis N2 FW4** in the model selector; `setup.js` remains C20-only and `netis-setup.js` controls the Netis route. There is no automatic gateway discovery yet: the verified HAR origin `http://192.168.1.1/` is allowlisted and used for Netis. Other N2 addresses require a follow-up identification step.

## Still unverified on physical N2

- Standalone Wi-Fi SSID and WPA password changes *after* factory setup;
- WAN PPPoE, static IP, and independent DHCP writes;
- Failed login and session expiration handling;
- Successful factory apply, readback after reconnect, and reboot persistence.

Commands for unverified write operations must not be simulated as confirmed successes.

## Tests

```bash
node --test tests/netis_n2_fw4_protocol.test.cjs
```

This is a **shared MV3 extension preview**, not a claim of end-to-end hardware validation. GitHub Actions tests and packages the unpacked extension as `RouterLab-C20-NetisN2-FW4-preview` after successful checks. Extract the artifact and use Chrome `chrome://extensions` → Developer mode → Load unpacked → the folder containing `manifest.json`. The Netis path is manual model selection, not autodetection; only `192.168.1.1` is supported in this trial. Do not commit raw HAR captures, passwords, cookies, MAC addresses or private customer information.
