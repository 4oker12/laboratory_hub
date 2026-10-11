# Cudy WR1200 V2.1 / R26 physical bootstrap

Physical target:

- hardware: WR1200 V2.1
- firmware: 2.4.23-20251224-145945
- management IP: 192.168.10.1

This branch contains post-hardware adaptation work. The frozen pre-hardware evidence remains on `research/cudy-r26-prehardware-closeout` and must not be rewritten to make the prediction look better after the fact.

## Correct physical state model

### Factory state

After a real hardware reset:

- GET `/cgi-bin/luci` shows the administrator-password creation page;
- form action is `/cgi-bin/luci/admin/wizard`;
- `_csrf` and `salt` are present;
- `token` is absent;
- stock password transform is one stage:
  `SHA256(password + salt)`;
- successful POST issues `sysauth` and enters the first-run setup flow.

### First-run in progress

After the administrator password exists but before Summary/finalization:

- the first-run flow is still active;
- login form has `salt` and `token`;
- normal authenticated login uses:
  1. `h1 = SHA256(password + salt)`
  2. `h2 = SHA256(h1 + token)`.

### Configured state

After finalization:

- normal login form action is `/cgi-bin/luci/`;
- `token` is present;
- the same two-stage configured-login transform is used.

## Scripts

### cudy-physical-bootstrap.ps1

This was the first post-hardware probe and predates the real factory-reset calibration.

Use it as a configured-login/sysauth probe only. Do not treat its original assumptions as evidence for the factory contract.

### cudy-configured-wan-dhcp-regression.ps1

Regression for an already configured router.

Default mode is read-only:

- verifies configured state;
- logs in with the existing administrator password;
- opens the WAN DHCP page;
- checks the expected WAN field contract.

With `-ExerciseHostname` it additionally:

- records the original WAN hostname;
- writes a temporary hostname;
- reads it back;
- restores the original hostname;
- verifies the restore.

The script does not factory-reset the router and does not change Wi-Fi.

## Evidence

See `PHYSICAL_VALIDATION.md` for the physically confirmed state machine, factory flow, service restart behavior, cold-boot persistence, configured WAN flow, and remaining untested cases.
