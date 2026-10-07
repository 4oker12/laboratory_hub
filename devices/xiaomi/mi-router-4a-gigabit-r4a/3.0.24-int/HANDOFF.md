# RouterLab Xiaomi R4A — Current Handoff

Repository: `4oker12/laboratory_hub`

Branch: `main`

Target firmware: Xiaomi Mi Router 4A Gigabit R4A Global/International `3.0.24`

Firmware SHA256:
`609b5b59b7b00365451fa358b5a79e0e4078b8a9a7aeb6a994a641287a093548`

## Project goal

RouterLab rehosts the stock Xiaomi management plane without requiring the physical router.
The intent is to execute the original stock userspace and preserve stock business logic:

- stock `/www` and browser UI
- stock LuCI/controllers
- stock FastCGI entrypoint
- stock Xiaomi APIs
- stock UCI/config semantics
- stock auth/stok behavior where practical
- persistent config state across cold restarts

The lab uses `qemu-user + PRoot`. It does **not** emulate the SoC, RF, PHY, switch ASIC, GPIO, LEDs, or a live WAN dataplane.

`compat-frontdoor.py` is a RouterLab-only compatibility layer for transport/session behavior that stock `sysapihttpd` cannot provide correctly under this userspace-only rehost. Do not move RouterLab compatibility behavior into real-router/shared client code.

## Main runtime

Primary launcher:

`devices/xiaomi/mi-router-4a-gigabit-r4a/3.0.24-int/virtual-router.sh`

Default local URL:

`http://127.0.0.1:18090/`

Default runtime directories:

- immutable extracted stock rootfs: `~/routerlab-xiaomi-r4a/audit/squashfs-root`
- RouterLab base: `~/routerlab-xiaomi-r4a/virtual-router`
- writable runtime rootfs: `~/routerlab-xiaomi-r4a/virtual-router/runtime/rootfs`
- persistent UCI state: `~/routerlab-xiaomi-r4a/virtual-router/state-v1/etc-config`

Factory state is `inited=0`; configured state is `inited=1`.

## Known runtime shims

Current narrow RouterLab shims model facts missing from the userspace-only environment:

- `runtime-shims/ubus.lua`
  - only narrow WAN status support
  - derives WAN protocol from stock UCI
- `runtime-shims/getmac`
  - deterministic factory MACs because Factory MTD is absent
- `runtime-shims/luci-sys.lua`
  - narrow fallback for browser client MAC lookup because guest `/proc/net/arp` cannot be reproduced via PRoot as a separate router kernel table

Do not broaden these into business-logic replacements.

## Browser wizard — current validated state

A real Chrome factory-wizard run proved that the browser itself successfully performs stock factory login:

`GET /cgi-bin/luci/api/xqsystem/login?...&init=1&privacy=0`

The stock response is `code:0` and a real 32-character stok is obtained.

Therefore the current real-browser blocker is **not** a missing browser session.

The browser then calls the stock endpoints with stok, including:

- `POST /api/misystem/set_location`
- `POST /api/misystem/set_language`

Validated behavior:

- `set_location` -> `{"code":0}`
- `set_language` -> `{"code":1511,"msg":"This language isn't supported yet."}` when the language registry is empty

The UI only advances after both operations return `code:0`. This `1511` was the factory-wizard blocker and is now fixed by RouterLab language-pack materialization.

## Root cause of 1511 — causally proven manually

The exact stock rootfs contains translation resources such as:

- `base.en.lmo`
- `base.uk.lmo`
- `base.ru.lmo`
- other locale resources

But the stock `/etc/config/luci` present in the squashfs contains an empty language registry:

```uci
config internal languages
```

Stock `setLang()` accepts a language only when that language is present in `luci.config.languages` (derived from UCI `/etc/config/luci`). With the registry empty, even languages whose translation packs exist are rejected with code `1511`.

A manual A/B test modified only the writable RouterLab state:

```uci
config internal languages
        option en 'English'
        option uk 'Ukrainian'
```

After a cold start from that persistent state, the same stock browser wizard passed the country/language stage successfully.

This is important evidence:

- no stock controller was patched
- no `code:0` was faked
- no API response was synthesized
- stock Xiaomi code itself accepted the language once the expected runtime registry existed

So the active problem is best described as **missing language-pack materialization / missing boot-time runtime state**, not a session bug and not simply "copy `/etc/config/luci` from the image".

## Language materialization — implemented and validated

RouterLab now restores the missing language-package side effect in `virtual-router.sh` without changing Xiaomi API/controller logic.

Materialization order:

1. preserve an already populated `luci.config.languages` registry;
2. if present, read stock `/etc/uci-defaults` entries that set `luci.languages.*`;
3. otherwise derive the registry from the exact stock `/usr/lib/lua/luci/i18n/base.*.lmo` inventory;
4. normalize language-pack names from `-` to `_` for UCI keys, matching LuCI translation-package materialization semantics;
5. persist the resulting registry in `state-v1/etc-config/luci`.

For this exact R4A 3.0.24 image, CI observed no usable stock UCI-default materializer and used:

`source=stock-lmo-inventory`

Materialized languages currently observed:

`de,en,es,fr,it,pt,ru,tr,uk,zh_hk,zh_tw`

RouterLab writes a persistent capability record:

`state-v1/LANGUAGE_CAPABILITY`

and exposes it through `virtual-router.sh status`:

- `LANGUAGE_CAPABILITY=ready|missing`
- `LANGUAGE_SOURCE=...`
- `LANGUAGES=...`

If no stock language packs can be materialized, factory mode is explicitly reported as blocked at country/language rather than pretending the wizard should pass.

The immutable squashfs remains unchanged. Stock `misystem/set_language` now returns `{"code":0}` after materialization.

GitHub Actions RouterLab run **#104** passed the full specialized suite, including:

- factory language materialization acceptance
- browser country/language probe
- factory-reset first-run acceptance
- PPPoE compatibility probe
- persistent cold boot
- router-client first-run/service acceptance

One implementation bug was caught by CI: raw pack names such as `zh-hk` / `zh-tw` cannot be written directly as UCI option keys. They are normalized to `zh_hk` / `zh_tw`, consistent with LuCI package behavior.

### Remaining route discrepancy

The exact browser-relevant endpoint `/api/misystem/set_language` is green after materialization. A diagnostic `/api/xqsystem/set_language` path can still return `1511` in some probes. Do not make that a blocker unless a real browser/runtime scenario depends on it; the current project rule is to follow the actual stock Chrome flow and continue to the next real blocker.

Do **not** solve this by:

- patching `setLang()`
- faking `code:0`
- adding a generic auth bypass
- treating `compat-frontdoor.py` as the language fix
- assuming the empty squashfs `config internal languages` is itself the final real-device runtime state

## Session compatibility branch history

A pre-init stok/session compatibility experiment exists on this branch. It was useful for distinguishing auth from business-logic failures, but real Chrome evidence shows the browser can perform stock factory login itself.

Keep session compatibility narrowly scoped and do not let it obscure the current blocker: stock language runtime state.

## Known good browser evidence

Current sequence observed from Chrome:

```text
GET  /api/xqsystem/init_info                -> code:0, inited:0
GET  /api/xqsystem/login?init=1&privacy=0   -> code:0, real stok
POST /;stok=.../api/misystem/set_location   -> code:0
POST /;stok=.../api/misystem/set_language   -> code:1511 when registry empty
```

After seeding `en` and `uk` into the persistent UCI language registry, the browser proceeds past the previous `Unknown error` screen.

## Other validated RouterLab behavior

Earlier acceptance already validated important non-wizard paths including:

- exact stock `init_info`
- WAN page rendering after narrow MAC/ARP compatibility shims
- WAN API coverage
- Wi-Fi API coverage
- `set_router_normal`
- transition to `inited=1`
- persistent `/etc/config` state across cold restart

Do not regress those while fixing language materialization.

## Next work order

Prioritize breadth, not endless focus on one secondary discrepancy.

1. Re-run the real browser wizard end-to-end from a fresh factory reset and record the **next actual blocker after language**.
2. Build/maintain a capability matrix for WAN, PPPoE, Wi-Fi, login/logout, reboot, persistence, factory reset, settings pages, and browser setup flows.
3. Keep RouterLab-only shims separated from code paths intended for real hardware.
4. Convert successful manual browser behavior into regression acceptance without replacing stock decisions.
5. Investigate the residual xqsystem/misystem set_language route discrepancy only if it becomes user-visible or blocks a real flow.

## Local operator commands

From PowerShell, repository path is normally:

`C:\Users\Andrei\Desktop\laboratory_hub`

Typical factory restart:

```powershell
wsl bash -lc 'cd /mnt/c/Users/Andrei/Desktop/laboratory_hub && bash devices/xiaomi/mi-router-4a-gigabit-r4a/3.0.24-int/virtual-router.sh reset --profile factory && bash devices/xiaomi/mi-router-4a-gigabit-r4a/3.0.24-int/virtual-router.sh start --profile factory'
```

Frontdoor log:

```powershell
wsl bash -lc 'tail -n 150 ~/routerlab-xiaomi-r4a/virtual-router/logs/frontdoor.log'
```

Do not treat `/dev/nvram: Permission denied`, `brctl: ... Function not implemented`, or similar hardware-facing noise as causal unless an actual failing stock call proves dependence on it.

## Current rule of evidence

A fix is preferred when RouterLab restores a missing environmental/runtime contract and then the **original stock Xiaomi code** returns the correct result.

That is the standard to preserve as the project expands to more firmware/models.
