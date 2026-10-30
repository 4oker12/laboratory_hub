# Cudy WR1300 V4 / R98 — independent RouterLab research

## Scope and evidence discipline

**Goal:** reproduce the complete WR1200 research sequence **from first principles** for WR1300 **hardware V4 / board R98**, without assuming that any WR1200 endpoint or password transformation transfers.

Target stock firmware: `2.5.41-20261014-101624`, published **2026-10-20**. Manufacturer's archive: `WR1300V4-R98-2.5.41-20261014-101624-flash.zip`.

Official page: https://www.cudy.com/pages/download-center/wr1300-4-0

Archive URL: https://www.cudy.com/cdn/shop/files/WR1300V4-R98-2.5.41-20261014-101624-flash.zip?v=1073746789692126678

Official emulator: https://support.cudy.com/emulator/WR1300V4.0/ (**2.3.8**, not the target 2.5.41; useful as a UI clue only).

Hardware: MT7621 / 128 MiB RAM / 16 MiB NOR / MT7603E 2.4 GHz / MT7663E 5 GHz / five gigabit Ethernet ports. Source: https://lists.openwrt.org/pipermail/openwrt-devel/2026-May/044816.html

Reference project: `devices/cudy/wr1200/v2-r26-2.4.23/`, `tools/routerlab/cudy-r26-compat/`, and `tools/routerlab/hardware/cudy-wr1200/PHYSICAL_VALIDATION.md`. The WR1200 reference is physically verified only for **WR1200 V2.1 / R26 / 2.4.23**.

## Status at creation

- [x] Confirmed exact V4 official model, image name, release date, vendor download address.
- [x] Confirmed WR1300 V4 manufacturer emulator is a different firmware generation (2.3.8).
- [x] Inspected the WR1200 source research/tooling and physical-validation requirements.
- [x] Downloaded exact V4 archive on CI and computed SHA-256. These are measured hashes, not vendor-provided signatures.
- [x] Extracted V4 flash image and detected valid SquashFS at 0x3313BF (not R26 offset).
- [x] Recorded release/CPU ABI and first LuCI contract snapshot; **auth sequence and behavioral contracts remain unverified**.
- [x] First-pass static diff: 311 shared LuCI paths, 123 byte-identical; 125 new WR1300 paths, 6 paths only on WR1200; qsetup changes require review.
- [ ] Reproduce stock first boot / wizard **without** claiming it is equivalent to WR1200.
- [ ] Validate real WR1300 V4 factory/authenticated modes and WAN/Wi-Fi GET/POST via HAR.
- [ ] Test read-after-write, rollback and power-cycle persistence.
- [ ] Integrate a WR1300-specific RouterLab adapter only after the wire contract is established.

**Important:** availability of a route, string or function name in extracted firmware does **not** prove API access or successful state mutation. Distinguish `static_confirmed`, `rehost_confirmed`, `physical_confirmed`, and `unverified`.

## Execution

Repository CI: `.github/workflows/cudy-wr1300-v4-discovery.yml`.

The runner downloads and extracts **both stock images** and saves a static-contract comparison as an artifact. Firmware *binaries* and rootfs are intentionally excluded from the shared artifact, which stores concise evidence reports instead. This is static research, not a physical-router result.

For local Linux / WSL:

```bash
sudo apt-get update
sudo apt-get install -y curl unzip file squashfs-tools binutils python3
bash tools/routerlab/cudy-wr1300-v4/prepare-and-compare.sh "$HOME/wr1300-v4-discovery"
```

For an already downloaded manufacturer ZIP:

```bash
CUDY_WR1300_ZIP=/path/to/WR1300V4-R98-2.5.41-20261014-101624-flash.zip \
  bash tools/routerlab/cudy-wr1300-v4/prepare-and-compare.sh "$HOME/wr1300-v4-discovery"
```

Optional environment variable WR1300_TARGET_ONLY=1 skips reference download and explicitly marks comparison incomplete.

### Physical capture contract (when access to the device is available)

Capture in isolated LAN without WAN dependency where possible. Four independent states:

1. **Factory**: GET entry, observed form action, CSRF/salt/token and actual POST outcome (do not copy WR1200 formula).
2. **First-run active**: wizard step requests/responses, Router mode, DHCP, Wi-Fi names/passwords, summary and finalizer; never assume the same field names.
3. **Configured**: logout/login, protected read, WAN DHCP/PPPoE, wireless read; record cookies by **name only**, redact values.
4. **Persistence**: read-after-write, harmless reversible Wi-Fi change, restoration, re-login, cold boot; confirm that observed config survives.

For every action: HAR request method + path, content-type, request keys (redact credentials/SSID/passwords), response status, redirect/cookie header names, session state, on-device outcome. Keep full raw HAR private; share a sanitized contract capture.

**Safety:** never flash a firmware or run destructive configuration from the static analysis scripts. No credentials, cookie values or personal network identifiers should enter the repository.

## Acceptance gates

| Gate | Required proof | Current |
|---|---|---|
| G0 image acquisition | exact ZIP/BIN measured hashes, valid decompressed rootfs | **passed (CI 41053610202)** |
| G1 management plane | routes, Lua bytecode, configs, runtime dependencies | pending |
| G2 factory/bootstrap | real or authentic stock-runtime HTTP sequence | pending |
| G3 WAN/Wi-Fi | real GET/POST, read-after-write + rollback | pending |
| G4 RouterLab | adapter tests, session handling, error handling | pending |
| G5 resilience | cold-boot persistence, interruption/reconnect, recovery | pending |

Do **not** mark hardware supported at G0–G2. Build and validate before merging.

## Verified first-pass stock-image evidence (GitHub Actions 41053610202)

- ZIP SHA-256: dbcc6b0e424ed0f2f00aebf2061ed9998680046680a129b93d9c22764e2ba2f2
- BIN SHA-256: 02edf67070836a700142ef22abb8d9ac7f156b96586d52e6ccb199f493ad04b6
- BIN size: 13,172,891 bytes; SquashFS offset: 3,347,391 (0x3313BF)
- Rootfs: 2,508 files and 199 directories
- Stock release: LEDE 17.01.5, revision 2.5.41, ramips/mt7621, mipsel_24kc
- Stock LuCI starts with wizard=1 and factory=1, but this alone does not prove real factory HTTP behavior.
- qsetup.lua differs by bytes but retains shared clues; new printable constants: dhcpv6, luci.model.cbi.wireless.wireless_utils, selectwan, wan_port.
- Reference WR1200 has 1,156 files and uses ramips/mt7628, so cross-board hardware simulation must not reuse R26 shims.

Run: https://github.com/4oker12/laboratory_hub/actions/runs/41053610202

## Second-pass AppRPC and bytecode inventory (CI 41054100686)

Read-only disassembly succeeded using the existing WR1200 bytecode inspection
tools, applied to the **WR1300 rootfs** without reusing R26 runtime shims.

- 19 shipped Lua modules under usr/lib/lua/luci/apprpc.
- qsetup.lua: 24,721 bytes, compiled Lua bytecode; printable constants include
  set_wan, wifi_set_iface, wifi_join, apply, fork_apply, commit,
  selectwan, wan_port, wlan00, wlan10, dhcpv6.
- wifi.lua: 20,753 bytes, compiled Lua bytecode; constants include
  get_aplist, aplist, wlan00 and wlan10.
- index.lua: 8,366 bytes, compiled Lua bytecode; constants include
  action_wizard, action_login, sysauth, token, salt, show_wizard.
- dispatcher.lua: 26,685 bytes; strings include sysauth,
  csrftoken, apply_needed and cbi/apply_xhr.
- Stock index.lua contains a sysauth cookie-format string with HttpOnly
  and SameSite=Strict; this is static evidence, **not** browser validation.
- The stock AppRPC directory contains net.lua; no network.lua was detected.

These observations are promising for a shared RouterLab adapter model but
**do not establish callable methods, request method/path, auth formula,
CSRF requirements, or side effects.**

Latest successful Action:
https://github.com/4oker12/laboratory_hub/actions/runs/41054100686
