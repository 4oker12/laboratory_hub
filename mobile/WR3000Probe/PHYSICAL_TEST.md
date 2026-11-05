# WR3000 V1/R31 — first physical iPhone test (diagnostics + opt-in factory admin password)

This probe is **not** the finished RouterLab full setup flow. It never sends WAN change, Wi-Fi change, factory reset or reboot requests. An **experimental, single-attempt factory admin-password write** is available only after the stock factory form is detected and the user explicitly confirms the V1 label and the password; do not use it on an unknown router.

## Preconditions

1. Confirm the Cudy sticker says **WR3000 V1.0**. The current analyzed stock release is `R31 2.4.19`; a different release must be treated as an unverified variant.
2. Install the unsigned IPA **after local signing** using a sideload tool; a raw unsigned IPA will not install as-is.
3. Join the router's LAN Wi-Fi on the iPhone. The phone must have access to the router's management address. No WAN/internet access is necessary.
4. In iOS Settings → Wi-Fi → current network → Router, read the gateway IPv4. The example `192.168.10.1` is not guaranteed.
5. Allow RouterLab WR3000 to use Local Network, when iOS prompts.

## Test

1. Open **RouterLab WR3000**.
2. Enter LAN IPv4, username and router administrator password. This is sent only to that local IPv4 using the candidate stock LuCI auth sequence, not to GitHub or any external service.
3. Tap **Проверить и авторизоваться** once. If the iPhone disconnects from router Wi-Fi, reconnect and retry only after checking IP.
4. Review the result. Expected stages: `discovery`, `form`, `login`, `identity`, `read_only`, `rpc_wifi_wlan00`, `rpc_wifi_wlan10`, `rpc_result`.
5. If the stock factory screen is detected, diagnostic-only is the default. You may optionally confirm the physical **WR3000 V1.0** label, enter/confirm a new admin password and explicitly approve a single POST to the stock `/cgi-bin/luci/admin/wizard` endpoint. This is an unverified hardware write based on firmware-derived form fields. It can end the active Wi-Fi connection or require reauthentication. **No automatic retry** is performed.
6. Use **Сформировать JSON-лог → Поделиться / сохранить лог**. A second control can export the previous session after a newer test.

## Quick Setup preview (no WAN/Wi-Fi writes)

The separate "Быстрая настройка — локальный предпросмотр" section can be used **without** physical hardware. Choose DHCP, PPPoE, or Static IPv4 and enter SSIDs/passwords for both bands. **Проверить проект настроек (без отправки)** validates fields locally and displays only a credential-free summary.

There is no "Apply WAN" / "Save Wi-Fi" button, because exact physical WR3000 `qsetup.set_conf` request/response compatibility is not yet validated. The preview is not an actual configuration change.

## Interpretation

- `HTTP 200` on LuCI discovery proves a web endpoint answered; it does not prove login.
- `sysauth_cookie=true` plus protected page `HTTP 200` without a login form is a candidate authenticated session.
- `fields:ssid,up,channel,...` in `rpc_result` means the read-only Wi-Fi JSON-RPC returned recognizable keys.
- `HTTP 403` on protected pages implies missing/invalid authentication or access restrictions.
- `HTTP 404` may indicate firmware-specific route mismatch.
- `network_error:-1004` commonly means TCP connection refused / cannot connect; check gateway IPv4 and management HTTP.
- If device identity is not WR3000, stop before any future write experiments.

## Privacy and retention

The exported trace contains timestamps, the locally entered router IPv4, diagnostic operation labels, HTTP status, timing, response lengths, response SHA256 prefixes and names of selected Wi-Fi result fields. It intentionally **does not contain** the admin password, Wi-Fi keys, session cookies, CSRF/token values, raw HTML or raw router JSON results.

The application persists a bounded last-session log automatically and keeps one previous-session copy. Do not publicly publish logs without reviewing local IPv4 and other operational metadata.

## Pass/fail gates for the next development phase

- `G1`: firmware/HW identity confirmed on the physical router.
- `G2`: authentication validated by an authenticated read-only response.
- `G3`: JSON-RPC read-only Wi-Fi request returns expected fields.
- `G4`: exact `qsetup.set_conf`, `set_wan`, `wifi_set_iface`, `apply` JSON input shape recovered in controlled emulation.
- `G5`: explicit user approval and backed-up resettable test device before enabling any write.

The read-only client targets G1–G3. An explicitly approved factory-password-only experiment is separate; G4–G5 for WAN/Wi-Fi remain blocked. A successful POST HTTP status is **not** proof that the new password was applied; verify on the native login page.
