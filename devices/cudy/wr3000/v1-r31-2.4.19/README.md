# RouterLab — Cudy WR3000 V1 / R31 / stock 2.4.19

**Scope:** Ukrainian-region experiment against the **WR3000 V1.0 (R31)** official stock image.
V2 and V3 are distinct hardware/firmware targets and are not assumed compatible.

## Confirmed from the official image

- Official download: https://www.cudy.com/ru-ru/pages/download-center/wr3000-1-0
- ZIP: `WR3000-R31-2.4.19-20250828-192837-sysupgrade.zip`
- Observed ZIP SHA256: `ae65e4ad44c616b64d149822370da74b3fd710cf12d407b380420d34f32fefbc`
- Observed firmware image SHA256: `a3db37cc6f8407d0469c789981f641405b541a323f4fe9614e4b20ca792b94b6`
- SquashFS 4.0 located at image offset 3,409,920; 1,568 regular files extracted by CI.
- Lua 5.1 stock bytecode parsed successfully in `luci.apprpc.qsetup` and `luci.apprpc.wifi`.

These hashes are observed downloads, not a vendor-published signed integrity statement.

## Static stock API evidence

The Lua 5.1 opcode analysis found these global function candidates and their immediate parameter counts:

| Module | Function | Parameter count | Static references |
|---|---|---:|---|
| qsetup | set_conf | 1 | wan, wifi, workmode |
| qsetup | set_wan | 1 | dhcp, pppoe, static, proto, gateway |
| qsetup | wifi_set_iface | 2 | ssid, key, encryption |
| qsetup | wifi_join | 2 | ssid, key |
| qsetup | apply | 1 | commit, network, wireless |
| wifi | getstatus | 1 | ssid, encryption, status |
| wifi | set_iface | 2 | encryption, ssid, key |
| wifi | set_device | 2 | channel, country |

**These are static hints only.** HTTP JSON-RPC shape, parameter value types, auth session, and write success on WR3000 have **not** been confirmed against physical hardware.

## iPhone diagnostic app

The separate `mobile/WR3000Probe` target is the first read-only hardware probe. It:
- accepts a private IPv4 LAN address; never attempts public/router-cloud traffic;
- attempts stock LuCI auth using the form salt/token candidate;
- verifies a protected page and `sysauth` session cookie;
- issues safe GET status requests and two candidate read-only JSON-RPC `wifi.getstatus` requests;
- records HTTP status, timing, response size/hash, and *field names only* (no raw pages, SSIDs, Wi-Fi keys, administrator password, cookies, or CSRF data);
- automatically persists the latest redacted trace, keeps a previous-session copy, and exports JSON via iOS Share.

**Physical wizard evidence (5 November 2026):** The user's sanitized iPhone JSON/HAR capture shows LuCI/CBI step-by-step form submissions for workmode, timezone, WAN, IPTV, both Wi-Fi radios, summary and restart/status polling. This is not evidence that a JSON-RPC `qsetup.set_conf` call is the actual browser wizard transport. Hardware revision and firmware build are masked/unverified; see `physical-wizard-observed.json`.

The physical factory view exposed `luci_password2` and `cbi-commit-btn` at `/cgi-bin/luci/`, but the initial form POST was not captured. The formerly speculative password write to `/cgi-bin/luci/admin/wizard` is now **disabled**. Login and read-only status checks use captured CBI routes; all WAN/Wi-Fi/apply writes remain disabled pending validation of values, session and server-side acknowledgments.

The iOS client also has an offline DHCP/PPPoE/Static WAN + dual Wi-Fi **Quick Setup form preview and validator**, with no network submission of these values. This is useful to validate the planned user experience before write commands are enabled.

It does **not** perform WAN/Wi-Fi Quick Setup writes. Reproduction must follow the observed CBI form flow unless a separate validated vendor API contract is proven. Never confuse the sanitized HAR's JSON wrapper with the real on-wire Content-Type.

## CI and testing

`probe_firmware.py --download --out wr3000-evidence` downloads the official archive, extracts rootfs, and generates text-only evidence. The CI workflow runs portable Python tests; unsigned IPA builds require the explicit macOS build job. An unsigned IPA needs local sideload signing before installation on a physical iPhone.

Test plan on a physical V1/R31:
1. Check sticker HW revision and running firmware before any actions.
2. Connect iPhone to WR3000 LAN Wi-Fi; check local network permission.
3. Run discovery/auth; export redacted JSON (also retained across relaunch).
4. Check status read and vendor read-only RPC results.
5. Only after validated request/response contracts and manual approval, test write-path on a backed-up/resettable router.

## Next iPhone test: RouterLab entry screen (5 November 2026)

The iPhone app, **not Safari**, now renders its own screen first and automatically
probes the router LAN IP (default: `192.168.10.1`). iOS cannot automatically
replace the stock page when somebody enters the router IP in Safari or joins Wi-Fi.

The read-only state machine is:

1. GET `/cgi-bin/luci`, preserving cookies for the current attempt and following
   only same-origin redirects.
2. If the **actual HTML input** `luci_password2` is present, show the
   RouterLab **new admin password + confirmation** screen.
3. Otherwise, if `luci_password` or `luci_username` inputs are present,
   show the RouterLab **existing administrator password** screen.
4. Otherwise display **unknown** and make diagnostics export accessible; never
   silently assume factory setup.
5. For an existing login the test app invokes a **candidate** LuCI auth flow and
   checks a protected endpoint and auth-cookie evidence. Success on the physical
   WR3000 is **not verified yet**.

**Safety/limitation:** The first-run password creation screen currently validates
the pair *offline* only; it does not send a guessed/unverified stock POST.
WAN/Wi-Fi/apply write actions remain disabled. Do not report these operations
as completed merely because the controls are visible.

**Diagnostic logging:** For every RouterLab request, keep phase, GET/POST path,
HTTP status, duration, bytes, MIME type, sanitized redirect category and response
hash prefix. For discovery, keep input **names only**, presence of CSRF/salt/token,
form-action **category** and the chosen entry-state decision. Never export form
values, credentials, session cookies, token values or response bodies. A new
discovery archives the previous JSON session.

**Test sequence:** connect iPhone to the WR3000 Wi-Fi → open RouterLab app →
confirm the screen chosen for its real state → optionally attempt an existing-login
test → export current and previous JSON. If the router is factory-reset, export
the log immediately after detection **before** using the stock UI to complete
initial setup. This is intended to fix the missing evidence from the earlier
page-world recorder, but the app does not yet capture the initial stock form POST.
