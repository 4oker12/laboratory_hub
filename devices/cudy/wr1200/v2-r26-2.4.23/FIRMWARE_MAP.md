# Cudy WR1200 V2/R26 2.4.23 firmware map

Status: stock-static discovery in progress.

## Authority

- Archive: `WR1200V2-R26-2.4.23-20251224-145945-flash.zip`
- Archive SHA-256: `def1d4b8472b5fef4d0f13d337d6c2f11127d14ef6bd7100780dbac0115aa35c`
- Flash binary SHA-256: `b9842ca6d6b54d4d2b8bb4d13457ee674ba2d13540443af1cf1ce82708ea02cd`
- Flash binary size: 7,930,011 bytes
- Evidence: GitHub Actions run 37586791174 completed successfully.

## Image layout

- U-Boot 1.1.3, build timestamp 2025-12-24.
- Linux MIPS uImage at `0x50000`.
- Kernel compression: LZMA.
- Image name: `R26`.
- SquashFS 4.0 rootfs at `0x276AFF` (2,583,295 decimal).
- SquashFS compression: XZ.
- Rootfs endianness: little endian.
- Extracted immutable rootfs: 1,156 regular files and 160 directories.

## Software base

Exact stock rootfs identifies itself as:

- LEDE 17.01.5
- revision 2.4.23
- target `ramips/mt7628`
- architecture `mipsel_24kc`

This is vendor stock firmware built on LEDE/OpenWrt. Laboratory Hub treats the exact Cudy image as the authority; upstream LEDE behavior is not a substitute for stock Cudy behavior.

## Management plane

Confirmed stock components:

- `uhttpd`
- LuCI
- `rpcd`
- `ubusd`
- `uci`
- stock Lua interpreter
- `/www/cgi-bin/luci`

Relevant stock LuCI controllers include:

- `index.lua`
- `network.lua`
- `wireless.lua`
- `system.lua`
- `ppp.lua`
- `services.lua`
- `servicectl.lua`

Many shipped Lua files are compiled Lua bytecode, so route/state reconstruction must use bytecode constants, runtime probing, and causal tests rather than pretending source text is available.

## Authentication clues

Stock LuCI dispatcher bytecode contains constants for:

- ubus session login/get/set/unset;
- `username` and `password`;
- `luci_username` and `luci_password`;
- `sysauth` cookie handling;
- configurable session timeout;
- factory-specific logic;
- `bdinfo factory`, `bdinfo check`, `getpasswd`, and `defpasswd`.

This strongly indicates that normal authentication is LuCI/ubus-session based, with additional Cudy factory-mode behavior. Exact first-login/factory semantics are not yet marked validated.

## Bootstrap/state creation

The immutable rootfs contains vendor UCI bootstrap scripts including:

- `01_network`
- `30_wlan`
- `99_fixwan`
- `99_oem`
- `98-board`
- `11_fix_passwd`
- `40_luci-wireless`

Notably, the initial immutable `/etc/config` inventory does not itself prove the final runtime `network` and `wireless` state. These bootstrap scripts are therefore part of the dependency graph and must be executed or reconstructed at the correct first-boot boundary.

## Wi-Fi clues

Stock LuCI bytecode contains Cudy-specific combined wireless configuration behavior and references to:

- 2.4 GHz and 5 GHz settings;
- `wireless.wlan00` / related sections;
- SSID;
- key/password;
- encryption;
- hidden network;
- isolation;
- channel;
- channel width;
- transmit power;
- country/regulatory settings;
- Smart Connect / combined-radio behavior.

Exact section names and write sequence still require stock-runtime validation.

## WAN clues

Stock rootfs includes network, PPP and service controllers plus bootstrap scripts that generate/fix WAN state. DHCP and PPPoE remain required target capabilities, but exact first-run dependencies and mutation order are not yet validated.

## Current dependency questions

1. What exact persistent flag distinguishes factory and configured state?
2. How does factory authentication derive or obtain its initial password?
3. Which UCI-default scripts are mandatory before LuCI can service WAN/Wi-Fi pages?
4. Which exact UCI sections are created for 2.4 GHz and 5 GHz?
5. Does the first-run flow use ordinary LuCI CBI pages, a dedicated wizard, or factory-only dispatcher branching?
6. Which hardware helpers (`bdinfo`, Wi-Fi/vendor daemons, interface probes) must be shimmed for userspace rehost?
7. What is the minimum dependency closure for DHCP, PPPoE and Wi-Fi password changes?

## Evidence discipline

Statuses in this file mean:

- **confirmed**: directly observed in exact stock static/runtime evidence;
- **clue**: present in stock bytecode/config but behavioral relationship not yet proven;
- **inference**: hypothesis awaiting runtime or causal validation.

No capability is considered validated from an endpoint/string alone.
