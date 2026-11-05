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

It does **not** perform Quick Setup or write WAN/Wi-Fi settings. The write path is blocked until RPC payloads are derived and verified first in a safe lab environment and later on the actual V1 hardware.

## CI and testing

`probe_firmware.py --download --out wr3000-evidence` downloads the official archive, extracts rootfs, and generates text-only evidence. The CI workflow runs portable Python tests; unsigned IPA builds require the explicit macOS build job. An unsigned IPA needs local sideload signing before installation on a physical iPhone.

Test plan on a physical V1/R31:
1. Check sticker HW revision and running firmware before any actions.
2. Connect iPhone to WR3000 LAN Wi-Fi; check local network permission.
3. Run discovery/auth; export redacted JSON (also retained across relaunch).
4. Check status read and vendor read-only RPC results.
5. Only after validated request/response contracts and manual approval, test write-path on a backed-up/resettable router.
