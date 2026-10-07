# Cudy WR1200 research target

Status: discovery/scoping. No exact hardware target is registered yet because Cudy
ships several incompatible WR1200 hardware revisions.

## Known hardware families

Official Cudy download pages currently expose:

- WR1200 1.0 — legacy firmware family `WR1200-R7`.
- WR1200 2.0 — firmware family `WR1200V2-R26`.
- WR1200 2.1 — uses the same published `WR1200V2-R26` firmware family as 2.0.
- WR1200 3.0 — separate firmware family `WR1200V3-R149`.

Therefore "WR1200" is not one Laboratory Hub target. The physical hardware revision
must be known before an exact firmware authority/device.json is created.

## First exact target candidate

If the physical router is WR1200 2.0 or 2.1, start from the V2/R26 family. Official
firmware 2.4.23 is published as:

`WR1200V2-R26-2.4.23-20251224-145945-flash.zip`

If the physical router is WR1200 3.0, use the separate V3/R149 target. Official Cudy
also provides a live WR1200 emulator showing LuCI-derived management UI behavior.

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

## Blocker before exact implementation

Read the bottom label of the physical router and record the complete hardware revision,
for example `WR1200 EU 2.0`, `WR1200 2.1`, or `WR1200 3.0`.
