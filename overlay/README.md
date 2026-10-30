# RouterLab — Router-Origin Overlay: adapter-only work

## Immutable base

**Correct operator-facing UI:** Chrome Router-Origin Overlay **v0.8.22** (26 Oct 2026 checkpoint).

- The overlay is injected into the real router page (Shadow DOM); it is **not** a separate `setup.html` tab.
- Preserve original typography, widgets, native router-origin request/session and *one-time* login.
- The previous C20 v0.8.3 independent-session UI is **not** this base.
- The complete v0.8.22 extension source archive is **not present** in the accessible GitHub branches or available Library search results. Therefore this branch deliberately does **not** edit the C20 overlay or claim to offer an installable replacement.

## Existing, verified devices — do not reset or redo

- **TP-Link Archer C20 v5:** original v0.8.22 overlay checked on real hardware for login, protected read and successful SSID modification. Factory bootstrap remains separately unverified.
- **Cudy WR1200 V2.1/R26 2.4.23:** physical factory auth, router/DHCP/Wi-Fi first-run, stock summary finalizer, cold-boot persistence and configured WAN hostname read/change/restore verified in `research/cudy-r26-physical-bootstrap` — `tools/routerlab/hardware/cudy-wr1200/PHYSICAL_VALIDATION.md`. Cudy is **out of scope** here and no Cudy source files are changed.

## Current target — Netis N2 FW4 CIS

Source contract: 28 October 2026 user HAR, router model `N2`, FW `N2-V4.0.1.4317`, vendor `CIS`.

This branch adds **protocol and registration**, not new UI:

- `devices/netis/n2/fw4/netis-fw4.js`: get/login/set CGI contract, safe trailing-comma parser, factory-DHCP request, radio power and IGMP with post-write readback.
- `overlay/adapters/registry.js`: independent, read-only device probe registration, same-origin transport requirement and fail-closed fallback.
- `overlay/adapters/netis-n2-fw4.js`: Netis FW4 capability mapping for the unchanged Overlay host.
- `tests/netis_n2_fw4_overlay_adapter.test.cjs`: synthetic contract tests.

## How final integration must work once the real v0.8.22 source is available

1. Save and verify the original v0.8.22 extension as a stable checkpoint, including its 57 passing tests.
2. Add Netis protocol and descriptor as **additional scripts/modules** to the same extension/overlay loader. Do not port the independent-session UI.
3. Obtain `context.transport` from **actual router-origin** execution of the existing Overlay, not offscreen or arbitrary extension-origin fetch; preserve the user's router cookie/auth context.
4. Read-only model/firmware detection first, then keep the stock v0.8.22 UI unchanged. Only show actions whose actual FW contract has been verified.
5. Physically verify Login, reading, standalone SSID/PSK change, DHCP/PPPoE/Static where safe, reconnect, and reboot persistence, while separating request success from readback and cold persistence.
6. Test original C20 regression before release; don't call a test-verified adapter a physical completion.

Not supported yet for Netis: post-configuration SSID/PSK change, PPPoE/Static WAN writes, persistence after restart, generalized origin discovery. Unknown states fail closed. No unverified SET is offered as a success.

## Testing

```bash
node --test tests/netis_n2_fw4_overlay_adapter.test.cjs
```

Never put raw HAR files, passwords, tokens, or Wi-Fi keys in GitHub.
