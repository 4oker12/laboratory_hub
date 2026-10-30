# Netis N2 FW4 — RouterLab Quick Setup Pilot 5, physical acceptance (2026-10-30)

## Scope and evidence
The operator completed **RouterLab Pilot 5** factory Quick Setup on the **physical Netis N2 FW4** connected over Wi-Fi, including the expected disconnect, manual reconnect, and explicit **Refresh** in the extension. The operator reported successful operation after refreshing. This **is an extension-driven physical test**, not just a stock-UI HAR replay or simulator result.

Exact user-provided RouterLab diagnostic trace:

```text
03:24:36 DETECTED N2 FW4
03:24:36 FACTORY_GUIDE_CONFIRMED
03:24:47 FACTORY_PASSWORD_VALIDATED_NOT_SENT
03:25:47 FACTORY_SET_APPLY_UNCONFIRMED_NO_AUTORETRY
03:27:30 CONFIGURED_AFTER_FACTORY
03:27:30 READBACK_OK WAN WLAN IGMP
03:27:30 FACTORY_READBACK_AFTER_RECONNECT_OK
03:27:41 READBACK_OK WAN WLAN IGMP
```

## Interpretation
- `FACTORY_GUIDE_CONFIRMED`: factory state was identified before write.
- `FACTORY_PASSWORD_VALIDATED_NOT_SENT`: initial password input was validated locally; no premature password write.
- `FACTORY_SET_APPLY_UNCONFIRMED_NO_AUTORETRY`: the single factory POST was initiated, but no HTTP response was available because Wi-Fi disconnected as expected. This **must not** be reported as a failed configuration or blindly retried.
- `CONFIGURED_AFTER_FACTORY`: after user manually reconnected, the same router was detected in configured state.
- `FACTORY_READBACK_AFTER_RECONNECT_OK` and later `READBACK_OK WAN WLAN IGMP`: extension readback after reconnect succeeded twice, including a manual refresh.

**Acceptance result:** PASS for the concrete Netis N2 FW4 factory DHCP/Wi-Fi Quick Setup with expected Wi-Fi drop, manual reconnect, re-detection, and subsequent readback through RouterLab Pilot 5.

## Preserve
- Do not retry `wan_set_shortcut` on HTTP status 0 or transport interruption after first submission.
- Do not show an error for expected Wi-Fi disconnect while applying new SSIDs; prompt the user to reconnect and refresh.
- Keep router identity re-validation after Wi-Fi/network changes, rather than reusing the previous TP-Link/Netis session.
- Pilot 5 fixed a UI bug in Pilot 4: factory admin password step had no visible Next button because the shared actions container was hidden. Pilot 5 exposes Next and a WAN/Wi-Fi continuation.

## Not claimed by this test
- Persistence after cold power-cycle/reboot.
- Configured-state WAN/SSID/password modifications.
- WAN PPPoE and Static IP.
- Other Netis models/firmware variants.
- Full source of the physical Pilot 5 extension uploaded/committed into this GitHub branch. This branch currently contains adapter research, and the full v0.8.22 extension with Pilot 5 patches was shared as a conversation ZIP.

## Follow-up
1. Preserve Pilot 5 as known-good physical checkpoint and avoid unrelated refactors.
2. Fix retained old UI when the operator switches physically between Netis and TP-Link without closing the tab, by invalidating stale device binding and rediscovering upon navigation/network identity change.
3. Only then expand configured-state operations and complete a separate cold-boot persistence check if needed.
