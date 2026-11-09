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
