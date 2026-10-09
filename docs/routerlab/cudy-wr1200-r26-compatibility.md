# RouterLab — Cudy WR1200 V2/R26 firmware compatibility

## Reference

Reference firmware: **WR1200 V2/R26 2.4.23**.

RouterLab validates compatibility behaviorally. A changed Lua/template hash is evidence of
implementation drift, but it is not by itself an incompatibility.

## Tested firmware generations

The same stock browser bootstrap contract has completed end to end on:

| Firmware | Factory bootstrap | Router/DHCP/Wi-Fi | Stock finalizer | Final state |
|---|---|---|---|---|
| 2.4.23 | PASS | PASS | summary CBI | wizard=0 |
| 2.4.12 | PASS | PASS | summary CBI | wizard=0 |
| 2.2.8 | PASS | PASS | summary CBI | wizard=0 |
| 2.1.1 | PASS | PASS | summary CBI | wizard=0 |
| 1.17.4 | PASS | PASS | summary CBI | wizard=0 |

The acceptance path also verifies `defpasswd=0`, WAN `dhcp`, and persisted Wi-Fi
SSID/key/encryption state in the writable runtime.

## Common finalizer contract

The important common denominator is **not** `luci.apprpc.qsetup.apply()`.

Across every tested generation, the normal browser wizard finishes through the stock
`network/summary` CBI commit path. Its `on_commit` logic:

1. applies the pending wizard values;
2. sets `luci.main.wizard=0`;
3. reads the UCI change set;
4. commits changed packages;
5. builds the service `parsechain`;
6. marks `apply_needed`;
7. renders the stock `cbi/apply_xhr` service-apply response.

Newer firmware also exposes `qsetup.apply()`. RouterLab keeps qsetup as a compatibility
fallback/API path, but the browser adapter prefers the browser's own summary-CBI finalizer.

RouterLab never writes `wizard=0` directly.

## Service-application boundary

The service chain is firmware/state dependent and must not be hard-coded. Examples observed:

- 2.4.23: `network,wireless,luci,system`
- 2.4.12: `network,wireless,luci,system`
- 2.2.8: `network,luci,system`
- 2.1.1: `network,luci,system`
- 1.17.4: `luci,wireless,system`

The stock response itself renders the correct
`/admin/servicectl/restart/<parsechain>` path. A real-device adapter should consume that
returned contract rather than infer the chain from a firmware version.

In the RouterLab userspace rehost, the subsequent physical/service restart is intentionally
suppressed at the late boundary. Configuration mutation and commit remain stock-owned.

## Compatibility rule

Do not select behavior by a loose rule such as “vendor=Cudy”.

The adapter should:

1. detect the stock factory/auth contract;
2. walk the stock wizard forms;
3. submit the stock summary;
4. read the authoritative postcondition;
5. if `wizard=0`, accept the stock summary finalizer and consume its rendered service chain;
6. only if the summary did not finalize, probe the supported qsetup fallback;
7. stop on an unknown contract instead of guessing POST fields.

This keeps firmware-specific variation below a stable RouterLab contract while allowing
the stock firmware to remain authoritative.
