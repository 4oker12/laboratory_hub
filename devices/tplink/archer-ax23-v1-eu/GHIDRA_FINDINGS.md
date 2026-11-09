# AX23 EU V1 — first Ghidra native/Quick Setup dependency triage

Date: 2026-11-09. Exact official firmware: AX23(EU) V1
`1.1.3 Build 20250905`, extracted from the vendor ZIP verified by SHA-256.
No physical device, WAN/LAN or real account was touched.

## What was actually executed

- Ghidra **12.2 official release** (`ghidra_12.2_PUBLIC_20261016.zip`,
  SHA256 `2c2cd776db3c1f6a097ba418922378ac3649cadd5e844a6f5f088ae628a7be67`),
  with **JDK 25**. The MIPS ELF post-script **ran** and emitted genuine
  function and string-xref metadata; see GitHub Actions
  [run #42568684171](https://github.com/4oker12/laboratory_hub/actions/runs/42568684171).
- **Complete verified run:** [#42569226546](https://github.com/4oker12/laboratory_hub/actions/runs/42569226546):
  `AX23_GHIDRA_NATIVE_HEADLESS=PASS`, 244 structurally allowlisted lines,
  six genuine MIPS ELF targets selected, with full firmware + Ghidra archive
  SHA256 verification. This supersedes earlier unsuccessful pipeline attempts.
- Two earlier runs were marked failed by a **report-extraction regex bug**,
  although Ghidra itself completed and emitted real xrefs. Another retry was
  blocked by an **external HTTP 504** during archive download. Both issues
  are separate from the AX23 binaries; the successful complete run above
  confirms the corrected headless pipeline.

### Six actual MIPS ELF targets found in stock rootfs

| Original stock path | Recorded keyword categories |
| --- | --- |
| `/usr/sbin/uhttpd` | ubus, uci, sysmode, network, config, interface |
| `/usr/bin/lua` | none of the selected category needles |
| `/sbin/ubusd` | ubus |
| `/lib/libuci.so` | uci, config |
| `/lib/libubus.so` | ubus |
| `/lib/libubox.so` | none of the selected category needles |

The categories indicate the presence of readable strings, **not** that a
function is reached from Quick Setup. Selected ELF binaries are processed
only in the ephemeral GitHub runner; their bytes are not committed or uploaded.

### Confirmed Ghidra output from genuine uhttpd

- `AX23_GHIDRA_SUMMARY=uhttpd.elf FUNCTIONS=322 NAMED_MATCHES=27
  STRING_CATEGORY_MATCHES=31 RAW_TEXT_EXPORTED=false`.
- The `sysmode`-category string at address `0040d448` has **4 xrefs**
  associated with `uh_get_operation_mode`.
- A `network`-category string at address `0040d468` has 2 xrefs
  associated with `uh_get_local_addr`.
- An `interface`-category string at address `0040d900` has 1 xref
  associated with `uh_cgi_request`.
- Several `ubus` category strings have xrefs from `main`;
  other uci/config categories are present.
- Ghidra also resolved original `libubus.so` functions
  `ubus_connect`, `ubus_lookup`, `ubus_invoke`,
  `ubus_complete_request`, and `ubus_add_object`;
  `libuci.so` includes `uci_load`, `uci_set`, `uci_commit`,
  `uci_get_profile` and `uci_lookup_ptr`. These are actual native symbol
  definitions; their existence alone does not locate the Lua CGI exception.
- The script intentionally does not publish original source bytes,
  decompiled text, credentials or secrets.

This creates a concrete lead on the **earlier stock startup log**
`sysmode: Entry not found`. It **does not** demonstrate that the same
function causes HTTP 500 in Quick Setup; an independent Lua error or
missing ubus service remains possible.

## Lua bytecode is a separate problem

`/usr/lib/lua/luci/controller/admin/quick_setup.lua` is **not an ELF binary**.
It starts with `1b4c75615100010404040804`:
the magic/version represent Lua 5.1, but the header's last ABI byte is `04`,
not the conventional Lua 5.1 boolean `00`/`01`.
The original **strict Lua 5.1** parser encountered the same nonstandard
constant tag **9** in all four controllers:
`quick_setup.lua` (offset 4283), `network.lua` (10498),
`wireless.lua` (3968) and `login.lua` (2005).
A separately labelled experimental parser then treated *only* tag 9 as
an **opaque 4-byte payload**, without interpreting its value.

**New positive structural result:** all four vendor bytecode files parse
to their exact ends with that one heuristic — Actions
[#42569618584](https://github.com/4oker12/laboratory_hub/actions/runs/42569618584),
`AX23_LUA51_OPAQUE_TAG9_4_BYTE_STRUCTURE=ALL_FOUR_COMPLETE_NOT_DECOMPILED`.

| Original bytecode controller | Structurally discovered prototypes | Category examples |
| --- | ---: | --- |
| `admin/quick_setup.lua` | 13 | dhcp, interface, iptv, network, ubus, uci, wan, wireless |
| `admin/network.lua` | 106 | config, dhcp, network, sysmode, ubus, uci |
| `admin/wireless.lua` | 84 | config, network, sysmode, ubus, uci |
| `login.lua` | 33 | config, sysmode, ubus, uci |

### Prototype-by-prototype Quick Setup dependency classification

A further independent scan of the **exact original vendor Lua bytecode**
[Actions #42569829041](https://github.com/4oker12/laboratory_hub/actions/runs/42569829041)
succeeded. It assigns only allowlisted literal categories to each parsed
Quick Setup function prototype (no raw strings, source or bytecode):

| Prototype index | Depth | Dependency string categories |
| ---: | ---: | --- |
| 1 | 0 | dhcp, iptv, network, quick_setup, uci, wan, wireless |
| 3 | 1 | uci, wireless |
| 4 | 1 | iptv, network, wireless |
| 5 | 1 | wan |
| 6 | 1 | iptv, network, uci, wan |
| 8 | 1 | uci |
| **10** | **1** | **interface, network, ubus, uci** |
| 13 | 1 | quick_setup |

Five other function prototypes have no direct literals in these categories;
that does not mean they have no relevant calls.

**Focused hypotheses, not call-graph proof:** prototype 10 is a good
candidate for the missing ubus/service inquiry because it groups
`interface`, `network`, `ubus` and `uci` within one function's direct
constant set. Prototype 6 is another candidate for WAN/IPTV config activity.
A runtime trace or Lua-specific disassembly is required before linking
either prototype to a particular HTTP 500.

**Important boundary:** the 4-byte length for tag 9 is an *empirically
consistent structural hypothesis*, not proof of the vendor type semantics.
The displayed function counts describe parsed prototype layouts under
that hypothesis. No source-level decompilation, call graph or exact
Quick Setup failure site has been recovered yet.
The earlier independent strict check
[#42569265514](https://github.com/4oker12/laboratory_hub/actions/runs/42569265514)
records the initial unsupported tag.

Independent string-category inventory for this compiled controller found:
`ubus`, `uci`, `quick_setup`, `network`, `wireless`, `wan`,
`interface`. This suggests candidate dependencies, not confirmed
call sites. The `network.lua` and `wireless.lua` controllers also carry
ubus/uci/sysmode categories.

## Evidence status / next reproducible gate

1. **CONFIRMED:** Ghidra works on vendor MIPS code; stock `uhttpd` has
   a `sysmode`-referencing function; Lua controller has vendor-specific
   bytecode layout or constants that need separate study.
2. **CONFIRMED separately:** stock `/admin/quick_setup?form=quick_setup`
   returned HTTP 500 in QEMU and the user's HAR; normal vendor
   `/login?form=login` and original interface loading have been exercised.
3. **NOT CONFIRMED:** the specific missing service, API argument or call
   that leads to Quick Setup HTTP 500. No UCI/WAN/WLAN write-readback proof.
4. **NEXT:** capture sanitized CGI failure class/trace **in isolated guest**,
   correlate it with actual `ubus list` objects and failed socket/file
   calls, then reverse only the relevant Lua path. Do not launch vendor
   hardware-initialization scripts on the Windows host or invent CGI success.
5. After proving a missing service, decide whether its original stock daemon
   can be started inside the **existing no-default-route network namespace**.
   Any unavoidable test double must be visibly labelled non-evidence and
   must not mark Quick Setup as configured.

## Reproduction

- `ghidra-native-inventory.py`: exact MIPS ELF selection; original paths
  and SHA-256 metadata only.
- `AX23NativeCallMap.java`: read-only Ghidra 12.2 headless cross references.
- `lua51-controller-structure.py`: separately triages the Lua 5.1 ABI.
- `.github/workflows/archer-ax23-ghidra-native-triage.yml`: isolated
  verified firmware extraction + pinned official Ghidra.
- `.github/workflows/archer-ax23-lua51-structure.yml`: lightweight
  independent Lua format investigation.

This research is **AX23 only**; no C20, AX55, Netis or mobile changes.

## Runtime dependency experiment: genuine stock netifd, network ubus, real Quick Setup

**Completed 2026-11-09; definitive isolated browser result:**
[Actions #42573906514](https://github.com/4oker12/laboratory_hub/actions/runs/42573906514).

### Baseline evidence

- Original stock ubus registry contained **only `uhttpd`** (one object)
  after UI activity. Lua CGI exception classifier identified real
  `/admin/quick_setup` dispatcher errors of class `NIL_UPVALUE_LENGTH`
  (Lua attempted length of a nil upvalue).
- Official extracted rootfs **does contain `/sbin/netifd`** and
  `/etc/init.d/network`; `/etc/config/network` exists, while
  `/etc/config/wireless` is **absent in this factory image**.
  `dnsmasq` is also present; `hostapd` and `rpcd` were not found at
  standard executable paths. The name search does not rule out
  vendor-specific equivalents.
- Standard Lua 5.1 opcode-20 (`LEN`) was **not found** in the 13
  `quick_setup.lua` prototypes under the hypothesis of standard opcode
  encoding. The nil-length exception may originate from a required
  module or vendor-customized instruction semantics; this is NOT proved.

### Native netifd isolated experiment

The optional experiment verifies a distinct PID/mount/network namespace
with no host default route and runs the **original MIPS `/sbin/netifd`**
under QEMU with original stock `ubusd` and `uhttpd`. No vendor init
scripts or physical interfaces are activated. Process group and runtime
are bounded.

- The genuine `netifd` **does register the `network` ubus object**,
  sometimes after several polling attempts. It can also reconfigure
  isolated loopback so `127.0.0.1` disappears temporarily;
  when this occurs, CGI is unreachable (HTTP `000`).
- The test restores loopback only **inside its private network
  namespace**. The authentic factory-state LuCI read returns HTTP
  **200** again and the first-admin account remains readable after
  uhttpd restart. This is environment scaffolding, not a vendor API shim.
- The final CDP test reloads the **genuine stock SPA** in the same browser
  session, without replaying credentials or request payloads, while
  original `netifd` is still running. Browser reported a vendor token
  present, the login form hidden, and two index resources. This is not
  proof of a successful protected configuration write/readback.

**Actual original POST read outcomes after netifd and loopback recovery:**

| Stock endpoint form | HTTP response |
| --- | --- |
| `/admin/quick_setup?form=quick_setup` | **500** |
| `/admin/firmware?form=upgrade` | 500 (2 requests) |
| `/admin/network?form=wan_ipv4_status` | 500 |
| `/admin/wireless?form=wireless_2g` | 500 |
| `/admin/wireless?form=wireless_5g` | 500 |

`/admin/status?form=all` had pending requests at observation cutoff;
their outcomes cannot be asserted.

The **original** LuCI stderr classifier still reports
`/admin/quick_setup CLASS=NIL_UPVALUE_LENGTH`.

### Interpretation and next diagnosis

- **CONFIRMED:** A missing `network` ubus provider was a real
  reproducible deficiency of the minimal rehost. A stock provider can
  register it, and isolated loopback connectivity can be restored.
- **CONFIRMED:** **Starting netifd alone does NOT repair Quick Setup**.
  The original browser still observes an authentic HTTP 500, and LuCI
  still raises `NIL_UPVALUE_LENGTH`.
- **NOT CONFIRMED:** The identity of the nil upvalue, missing resource or
  exact Lua callsite. It would be misleading to label the missing
  `/etc/config/wireless` or absent hardware as the proven sole cause.
- **NEXT:** identify the specific original Lua subroutine and dependency
  supplying that upvalue. Compare original controller imports and vendor
  init-generated data; inspect socket/file failures in an isolated
  namespace. Never fake a successful Quick Setup response or start
  network scripts on the workstation.

All operational test data is from an ephemeral original stock rootfs clone.
No local WSL user configuration or physical router was changed by CI.

## Lua execution-to-bytecode correlation — 2026-11-09

**Verified complete CI:** [Actions #42651552327](https://github.com/4oker12/laboratory_hub/actions/runs/42651552327)
(`success`). The input is the official extracted vendor
`/usr/lib/lua/luci/controller/admin/quick_setup.lua` and the metadata
captured from the **real** encrypted Quick Setup CGI requests in a
disposable, verified isolated QEMU guest.

### Findings

- The official compiled controller contains **13** structurally
  parsed Lua function prototypes under the previously documented
  opaque vendor tag-9 assumption.
- Original vendor `package.loaded["luci.controller.admin.quick_setup"]`
  contains **11 exported functions**, confirmed at Lua runtime.
- The **11 actual exported function definitions** match **exactly**
  the recovered bytecode prototype line ranges with IDs
  **2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13**.
- The only **nonexported** prototypes in the bytecode are **1**
  (module-level, source line 0) and **4** (lines 177–192).
  This description concerns function export membership, not proof
  of whether either function runs or raises the error.
- In the observed Quick Setup browser *read* requests, the trace reports
  `AX23_LUA_CONTROLLER_EXPORTED_CALL_EVENTS=0`, while a real
  `/admin/quick_setup` `NIL_UPVALUE_LENGTH` failure still occurs.
  The controller itself is loaded, and UCI, ubus and LuCI dispatcher
  modules are loaded. **The failure may be in controller initialization
  or dispatcher preparation before invoking an exported action.**
  However, an inline/nested closure or a vendor-customized debug function
  identity could evade the current exported-call observer.
- Native `error()`/`assert()` call-stack probes produced no triggers:
  the observed nil-length exception likely arises from Lua VM execution
  or a dependency rather than explicit stock calls to those two functions.
  This remains a hypothesis.
- Due to vendor-specific stripped debug metadata, `currentline` appears
  as `0` for most relevant compiled-code events. Standard
  `debug.getupvalue` does not yield named upvalue values despite
  nonzero `nups`; the observer therefore **does not identify or
  exclude any nil-valued upvalue**. A zero reported nil count is
  *not* evidence of valid initialized upvalues.

### Instrumentation and safety

The original `/www/cgi-bin/luci` from verified stock rootfs is
unchanged. During **opt-in isolated CI only**, a fail-closed script
instruments its byte-identical disposable clone with a read-only
`dofile` trace. That tracer records only predefined call categories,
numbers, load flags, function definition line ranges, and bounded
trace frames — **no passwords, HTTP payloads, cookies, `stok`,
upvalue values, source text, or proprietary bytecode**.

The new `quick-setup-runtime-bytecode-correlate.py` rechecks export
identity against the original vendor binary every run and reports:
`AX23_QS_EXPORTED_TO_STOCK_BYTECODE=PASS` and
`AX23_QS_NIL_UPVALUE_RUNTIME_ERROR=REPRODUCED`.

**Outstanding acceptance condition:** discover the original nil
upvalue's supplying function/service, make the genuine Quick Setup
`operation=read` and relevant `operation=write` return actual
successful results, and verify UCI readback. None of this has
been claimed accomplished by the current instrumentation.
