# RouterLab — TP-Link Archer C20 v5 experimental extension

**Pilot scope:** first-time setup and editing existing WAN (DHCP/IPoE or PPPoE) and Wi-Fi (SSID/password on 2.4 and 5 GHz).

**Important:** This is a hands-on **assisted native UI prototype**, not a fully autonomous configured-router client. Actual physical router save, password changes and WAN changes have NOT yet been confirmed with this version. Do not use on a production access link before a test/recovery plan.

## Install

1. Download/clone branch `feat/routerlab-tplink-c20-first-run-edit`.
2. Go to `chrome://extensions`, enable Developer mode, choose `Load unpacked`.
3. Choose the **extensions/tplink-c20** directory (not repository root).
4. Connect Windows/Chrome to Archer C20 local LAN or Wi-Fi and open the router stock UI (normally `http://192.168.0.1`).
5. Open RouterLab extension popup and click **Открыть мастер на странице**.
6. Check model/revision and read the status in the side overlay before any writes.

## How it operates

- The popup injects logic.js and content.js directly into the already opened native TP-Link page. No background traffic, no external server, no credential storage.
- First Run: use the router's native factory password screen and Quick Setup wizard; fill fields through the overlay only on matched screens, then use native Next/Save.
- Edit: login in the native UI, choose Edit, use WAN or Wi-Fi navigation buttons; change only the requested parameters and use Save.
- WAN option/PPPoE field mapping is heuristic and fail-closed when fields are missing or ambiguous. Manual native entry may be needed until the stock DOM is recorded.
- Click **Проверить** after reopening the corresponding native settings screen. This only checks readable WAN mode/SSID fields, NOT passwords, internet connectivity, or post-reboot persistence.

## Hardware acceptance test order

1. Load Chrome extension. Verify pilot panel appears and identifies Archer C20 v5. If not, stop and record text/error.
2. On a preconfigured router, **read only**: navigate to Wi-Fi, check old SSIDs; no Save.
3. Change only 2.4 GHz SSID to a temporary value. Use Save, reconnect, verify native page changed.
4. Change and verify 2.4 GHz password using a real client association, then restore.
5. With a test WAN connection: verify DHCP type, switch to test PPPoE and back only when recovery path is available.
6. Separate factory reset test: first admin password, Quick Setup WAN, Wi-Fi, Save, reconnect, verify persistence after reboot.

Never interpret a successful HTTP response or button click as actual saved configuration.

## Known limitations

- Only TP-Link Archer C20 **v5** pilot. Other models and revisions deliberately blocked.
- The extension does NOT replay `/cgi_gdpr`, or bypass the stock login.
- Form names/navigation differ by firmware; unsupported screens fail closed.
- No guarantee of Wi-Fi/PPP password read-back; check with a real connection.
- Factory model/revision may not be visible to the page: checkbox for physical label confirmation is shown on the factory screen.
- All field changes and Save act in the currently opened native UI. You remain responsible for confirming settings before applying.

## Prior observed firmware

`3.16.0 0.9.1 v6038.0 Build 200821 Rel.52349n`, stock UI at `http://192.168.0.1/`, CGI endpoint `/cgi_gdpr` used internally by router UI.

## Test evidence requested

Provide model/revision, firmware, detected screen, buttons clicked, browser console errors, and actual outcome. Redact admin, Wi-Fi, and PPPoE passwords before sharing.

## Independent-session extension

The separate experimental MV3 build that attempts its own encrypted session is in [`independent-session`](independent-session/README.md). Load only one RouterLab build at a time. This build does not yet have confirmed standalone login plus protected WLAN read on physical hardware; its README distinguishes local tests from hardware evidence.
