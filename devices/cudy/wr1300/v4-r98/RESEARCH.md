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
- [ ] Download exact V4 archive **and compute its SHA-256**; do not populate a fabricated checksum.
- [ ] Extract flash image; detect kernel and SquashFS offsets dynamically (do not reuse R26 offset).
- [ ] Record release, CPU ABI, Cudy controllers, auth flow, stock UCI defaults, Lua bytecode and web assets.
- [ ] Diff rootfs/management contract with WR1200 reference using hashes, path changes and semantic evidence.
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
python3 tools/routerlab/cudy-wr1300-v4/prepare-and-compare.py --work "$HOME/wr1300-v4-discovery"
```

For an already downloaded manufacturer ZIP:

```bash
python3 tools/routerlab/cudy-wr1300-v4/prepare-and-compare.py \
  --archive /path/to/WR1300V4-R98-2.5.41-20261014-101624-flash.zip \
  --work "$HOME/wr1300-v4-discovery"
```

Optional `--target-only` skips reference download and marks comparison incomplete.

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
| G0 image acquisition | exact ZIP/BIN hashes, valid decompressed rootfs | pending |
| G1 management plane | routes, Lua bytecode, configs, runtime dependencies | pending |
| G2 factory/bootstrap | real or authentic stock-runtime HTTP sequence | pending |
| G3 WAN/Wi-Fi | real GET/POST, read-after-write + rollback | pending |
| G4 RouterLab | adapter tests, session handling, error handling | pending |
| G5 resilience | cold-boot persistence, interruption/reconnect, recovery | pending |

Do **not** mark hardware supported at G0–G2. Build and validate before merging.
