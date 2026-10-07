# Cudy WR1200 research target

Status: target selected for implementation: **WR1200 V2 / R26 firmware family**.
The exact physical label (2.0 vs 2.1) is still pending confirmation, but Cudy publishes
the same V2/R26 firmware family for both revisions, so Laboratory Hub can proceed at
the firmware-family level without pretending that the retail hardware revision is known.

## Known hardware families

Official Cudy download pages currently expose:

- WR1200 1.0 — legacy firmware family `WR1200-R7`.
- WR1200 2.0 — firmware family `WR1200V2-R26`.
- WR1200 2.1 — uses the same published `WR1200V2-R26` firmware family as 2.0.
- WR1200 3.0 — separate firmware family `WR1200V3-R149`.

Therefore "WR1200" is not one universal Laboratory Hub target. This branch deliberately
selects only the V2/R26 family shared by WR1200 2.0 and 2.1. WR1200 1.0 and 3.0 remain
separate future targets.

## Selected implementation target

Selected target id:

`cudy-wr1200-v2-r26-2.4.23`

Official firmware selected as the starting authority:

`WR1200V2-R26-2.4.23-20251224-145945-flash.zip`

Published by Cudy for both WR1200 2.0 and WR1200 2.1. The file hash is intentionally
left pending until Laboratory Hub acquires the exact archive and computes it locally.
WR1200 3.0 remains a separate V3/R149 target.

## Goal

Repeat the Xiaomi workflow without assuming that Cudy has the same API shape:

1. acquire and hash the exact vendor firmware;
2. extract filesystem/rootfs and identify architecture/web stack;
3. map login/session/CSRF/auth behavior;
4. map first-run wizard as a state machine and dependency graph;
5. map WAN DHCP/PPPoE and Wi-Fi 2.4/5 GHz read/write paths;
6. identify required hidden preconditions and state mutations;
7. rehost the stock management plane where practical;
8. build a headless client that can perform supported scenarios without the browser;
9. verify read-back, persistence, cold restart and factory-reset behavior;
10. record unsupported hardware/runtime boundaries instead of synthesizing success.

## Capability acceptance rule

A capability is supported only when its full dependency closure is proven. For example,
"change Wi-Fi password" means auth/session + required state + write call + stock
read-back + persistence, not merely finding one endpoint that returns HTTP 200.

## Sources to capture

- exact firmware image and SHA-256;
- Cudy official emulator/HAR;
- frontend JavaScript;
- LuCI/controllers/backend scripts from firmware;
- UCI/default config and init scripts;
- GPL source package where it materially explains generated/runtime state;
- A/B causal tests for dependencies that cannot be proven statically.

## Remaining hardware confirmation

The physical SIMNET-stocked router label should still be photographed when convenient.
If it says WR1200 2.0 or 2.1, it confirms the selected V2/R26 family. If it says 3.0,
that physical unit must move to a separate V3/R149 target rather than silently reusing
this profile.
