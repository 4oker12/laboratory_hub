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
- That Actions run has a **failure status because the report-extraction filter
  accidentally retained the `(GhidraScript)` log suffix and then rejected
  the line**. The upstream headless log explicitly reported "Post-analysis
  succeeded", "Save succeeded" and "Import succeeded", while the downstream
  metadata-extraction step said `NO_COMPLETED_HEADLESS_SUMMARY`. The filter
  has since been corrected. The failure does not invalidate the real xrefs.
- A subsequent job successfully reverified the original firmware and Lua
  files, but the Ghidra release redownload received an external HTTP 504.
  This is a network/download failure, **not** proof of a firmware or
  decompiler error.

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
  other uci/config categories are present. The script intentionally does not
  publish original source bytes, decompiled text, credentials or secrets.

This creates a concrete lead on the **earlier stock startup log**
`sysmode: Entry not found`. It **does not** demonstrate that the same
function causes HTTP 500 in Quick Setup; an independent Lua error or
missing ubus service remains possible.

## Lua bytecode is a separate problem

`/usr/lib/lua/luci/controller/admin/quick_setup.lua` is **not an ELF binary**.
It starts with `1b4c75615100010404040804`:
the magic/version represent Lua 5.1, but the header's last ABI byte is `04`,
not the conventional Lua 5.1 boolean `00`/`01`.
Our deliberately bounded Lua prototype parser stops with an unknown
constant tag; **no valid decompilation or verified prototype count is claimed**.

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
