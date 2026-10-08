# Cudy WR1200 R26 firmware compatibility matrix

Purpose: turn the proven WR1200 V2/R26 2.4.23 bootstrap into a reusable contract suite.

Reference firmware:
- WR1200 V2/R26 2.4.23
- archive SHA-256: `def1d4b8472b5fef4d0f13d337d6c2f11127d14ef6bd7100780dbac0115aa35c`
- BIN SHA-256: `b9842ca6d6b54d4d2b8bb4d13457ee674ba2d13540443af1cf1ce82708ea02cd`

First candidate:
- WR1200 V2/R26 2.4.12
- official archive: `WR1200V2-R26-2.4.12-20250703-144919-flash.zip`

The runner does three kinds of comparison:

1. **Image/rootfs** — hashes, SquashFS layout, release metadata.
2. **Management contract** — LuCI/qsetup/controllers/CBI/templates/UCI defaults.
3. **Behavior** — factory reset runtime, stock admin bootstrap, Router mode, WAN DHCP,
   Wi-Fi, stock `qsetup.apply()`, and final `wizard=0` verification.

The important output is `compatibility-report.md`. It reports the first runtime stage
where the candidate stops matching the known-good 2.4.23 flow.

A changed binary hash is not automatically an incompatibility. Runtime behavior is authoritative.

Unknown firmware is never silently treated as compatible: it must pass this suite or receive
a separate adapter/profile.
