# Xiaomi R4A stock virtual router

Target: **Xiaomi Mi Router 4A Gigabit Edition (R4A) v1**, factory Global firmware **3.0.24** (`miwifi_r4a_all_03233_3.0.24_INT.bin`).

This RouterLab target is a management-plane emulator for the **factory Xiaomi firmware**. It does not require a subscriber to install OpenWrt. Xiaomi's own stock firmware is OpenWrt-derived internally, so its original LuCI/UCI components are part of the vendor firmware.

## What is authentic

The emulator runs from the exact stock 3.0.24 rootfs:

- original Xiaomi `/www` frontend;
- original MIPSel `fcgi-cgi`;
- original LuCI dispatcher/controllers;
- original Xiaomi authentication and real `stok`;
- original WAN/Wi-Fi setter and read APIs;
- original UCI configuration semantics.

`compat-frontdoor.py` replaces **only** the Xiaomi `sysapihttpd` transport/session layer. The stock server reaches its vendor original-destination/session code under qemu-user, receives the sentinel `0.0.0.1:65535`, and aborts the worker. Replacing that transport does not replace router configuration logic.

Not emulated: RF, PHY, switch ASIC, Wi-Fi radio behavior, LEDs/GPIO or a live WAN link.

## Proven stock path

The automated acceptance currently proves:

```text
exact stock 3.0.24
  -> stock login / real stok
  -> POST set_wan wanType=dhcp
  -> POST set_wifi 2.4 GHz
  -> POST set_wifi 5 GHz
  -> stock Wi-Fi read-back
  -> persist UCI state
  -> destroy runtime clone
  -> recreate runtime from immutable stock rootfs
  -> restore persisted state
  -> login again
  -> stock Wi-Fi read-back after cold boot
```

The WAN configured state persists as `network.wan.proto=dhcp`. Live `wan_info` can still fail in the lab because it asks for runtime interface/IP/link/ubus data. That is a live-network-state limitation, not a failure of the stock WAN setter.

PPPoE is not on the current critical path.

## Run the virtual router on Windows

From the repository root:

```powershell
.\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\Run-VirtualRouter.ps1 -Action Start
```

Then open:

```text
http://127.0.0.1:18090/
```

Lab credentials for the exact factory account fixture:

```text
admin / admin
```

Lifecycle:

```powershell
.\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\Run-VirtualRouter.ps1 -Action Status
.\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\Run-VirtualRouter.ps1 -Action Restart
.\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\Run-VirtualRouter.ps1 -Action Stop
.\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\Run-VirtualRouter.ps1 -Action Reset
```

`Restart` is a cold management-plane boot: the current UCI state is saved, the runtime rootfs clone is destroyed, a new clone is made from the immutable stock rootfs, persisted state is restored, and stock LuCI/API is started again.

`Reset` deletes the lab's persistent state. The next `Start` creates the initialized factory test fixture again.

## State boundary

Persistent state v1 is deliberately narrow:

```text
exact immutable stock rootfs
        +
persistent /etc/config state
        |
        v
fresh runtime clone
        |
        +-- original fcgi-cgi
        +-- original LuCI/Xiaomi API
        +-- compatibility HTTP front door
```

This is enough for the current DHCP + Wi-Fi configuration acceptance. File-backed NVRAM or selected runtime-state shims should be added only when a concrete stock API requires them.

## Research history

`management-plane-agent.sh` and `management-plane-rehost.sh` remain evidence/research tools. Full-system FirmAE was retired for this target after a bounded run showed that it was not economical for reaching the stock Web UI.

The primary development target is now `virtual-router.sh`, not full SoC emulation.


## First Router Agent client

`router-client.py` is the first programmatic client that drives the exact stock Xiaomi API through RouterLab.

Safety rules for this research version:

- `inspect` is read-only;
- `configure` is restricted to `localhost / 127.0.0.1 / ::1`;
- writes use the stock Xiaomi login, `set_wan`, `set_wifi` and `wifi_detail_all`;
- Wi-Fi is considered confirmed only after stock API read-back;
- a successful WAN setter response is recorded as an acknowledgement, but live WAN/link state remains unknown in the emulator and is not claimed.

Examples:

```powershell
python .\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\router-client.py inspect

python .\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\router-client.py inspect --admin-password admin

python .\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\router-client.py configure `
  --admin-password admin `
  --ssid-24 RouterLab24 `
  --ssid-5 RouterLab5G `
  --wifi-password RouterLabPass88
```

## Ukraine target scope

For RouterLab, Xiaomi variants sold for or commonly used in Ukraine should be prioritized as **Global / International / EU** firmware targets.

China-only firmware variants are secondary compatibility targets unless field evidence shows that they are common among subscribers.

The current first authority remains:

```text
Xiaomi Mi Router 4A Gigabit Edition (R4A)
Global / International firmware 3.0.24
```

Do not create a separate emulator per retail SKU by default. First compare the management-plane contract: login, `stok`, initial setup, WAN APIs and Wi-Fi APIs. Reuse one adapter/profile when those contracts are materially the same; split only when firmware behavior actually diverges.

## Target interaction modes

RouterLab intentionally models two operator-relevant Xiaomi states.

### 1. Factory / first run

This is the state of a new router or a router after factory reset:

```text
INITTED=0
→ browser root
→ stock /init.html
→ stock first-run wizard
→ choose normal router mode / WAN type
→ DHCP or PPPoE credentials
→ Wi-Fi name/password
→ admin password
→ stock set_router_normal
→ INITTED=1
→ configured router
```

For this R4A 3.0.24 target, the quick setup experience belongs to the uninitialized state; it is not treated as a permanent "Quick Setup" page in the normal configured UI.

PPPoE first-run configuration uses the exact stock `set_wan` request shape:

```text
wanType=pppoe
pppoeName=<username>
pppoePwd=<password>
```

RouterLab currently proves that this configuration is written by the stock backend. It does **not** claim a successful PPPoE Internet session because there is no emulated ISP PPPoE peer yet.

### 2. Configured / service

This is the normal support case after initial setup:

```text
INITTED=1
→ stock login
→ inspect current configuration
→ DHCP or PPPoE correction
→ inspect/change Wi-Fi 2.4/5 GHz
→ stock read-back
→ persistence across cold restart
```

The research client supports both DHCP and PPPoE writes in this mode. PPPoE credentials are accepted as inputs but are deliberately not returned in its JSON evidence output.

## HAR as adapter evidence

A future production router adapter should use HAR traces as one source of behavioral evidence, not as the only source of truth:

```text
browser HAR
  → real request order, endpoints, payloads, cookies/stok
stock Xiaomi JS
  → how the vendor UI constructs requests
stock Lua/controllers
  → required fields and backend semantics
RouterLab replay
  → prove the adapter reproduces the real contract
```

This avoids copying incidental browser traffic or turning a single HAR recording into business logic.


## Emulator-first validation

Physical Xiaomi hardware is **not required** for the current development stage.

The active target is:

```text
Router Agent
  -> http://127.0.0.1:18090
  -> RouterLab virtual Xiaomi R4A
  -> exact stock UI / LuCI / Xiaomi API
```

A physical R4A can be used later only as an additional compatibility check. Until then, request contracts are derived from stock Xiaomi JS, stock Lua/controllers and RouterLab replay.

## Unsupported UI guard

RouterLab does not try to fake hardware-dependent sections merely to make every menu item appear functional.

Confirmed unsupported sections are disabled only in the lab UI. The exact stock files remain unchanged.

Current guarded route:

```text
QoS -> unavailable in emulator
```

The menu link is visually disabled by a RouterLab-only injected guard. Direct navigation to the guarded route returns a short lab explanation instead of letting the stock page hang on unavailable runtime calls.

Unknown or untested sections are not disabled preemptively.


## Automated operator flows

RouterLab now exposes the two SIMNET-relevant management flows through the existing stock API client.

### Factory / first run

Start a clean virtual router:

```powershell
.\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\Run-VirtualRouter.ps1 -Action Reset -Profile Factory
.\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\Run-VirtualRouter.ps1 -Action Start -Profile Factory
```

Then run the automated stock first-run sequence:

```powershell
.\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\Run-RouterScenario.ps1 -Action FirstRun
```

The client performs:

```text
inited=0
-> exact Xiaomi factory login/stok
-> WAN DHCP
-> exact set_router_normal
-> Wi-Fi 2.4 + 5 GHz
-> admin password
-> inited=1
-> login again
-> stock Wi-Fi read-back
```

A first-run write can legitimately finish inside stock firmware while the HTTP/FastCGI
response is lost or times out. RouterLab therefore treats the write acknowledgement
and the resulting router state as separate evidence. After an ambiguous transport
error it verifies `inited=1`, router name, the new admin login and both Wi-Fi
networks before reporting success.

The same verification also makes `FirstRun` safe to retry across processes. If the
router is already `inited=1` and exactly matches the requested first-run state, the
retry performs read-only verification and returns
`already_completed_verified`. If the initialized state does not match, RouterLab
refuses to write and requires an explicit virtual-router reset.

### Configured / service

With an initialized virtual router running:

```powershell
.\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\Run-RouterScenario.ps1 -Action Inspect
.\devices\xiaomi\mi-router-4a-gigabit-r4a\3.0.24-int\Run-RouterScenario.ps1 -Action Service
```

The service flow is DHCP-first for SIMNET and verifies Wi-Fi through the stock read API after writes.

### Lab-only write safety

`first-run` and `service/configure` remain restricted to loopback targets in this research stage. A future physical-router validation will require an explicit safety change rather than silently allowing writes to arbitrary LAN addresses.
