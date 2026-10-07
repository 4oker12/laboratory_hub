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

## Authentication contract — stock-static evidence

Stock LuCI dispatcher is Lua 5.1 bytecode, but its ordered constants directly expose the authentication machinery:

- ubus session `login/get/set/unset`;
- `luci_username` and `luci_password`;
- `sysauth` cookie handling;
- CSRF/authtoken checking;
- session expiry and configurable session timeout;
- `luci.main.factory`;
- `bdinfo factory`, `bdinfo check`, and `bdinfo checkuuid`;
- `getpasswd` / `defpasswd`;
- encrypted/hashed password transformation via `crypt` and SHA-256.

The stock `luci` config sets `sessiontime=3600` and `defpasswd=1`.

The vendor bootstrap script `11_fix_passwd` proves another hardware-backed credential dependency: unless debug/tty-login state bypasses it, the root password is derived from SHA-256 of `bdinfo fuuid` plus `bdinfo hmac`.

Therefore the rehost must model `bdinfo` identity inputs; replacing the whole login flow with a synthetic Lab login would destroy stock semantics. Exact browser/factory login request sequence remains runtime work.

## Bootstrap/state creation — stock-static evidence

The immutable rootfs contains vendor UCI bootstrap scripts including:

- `01_network`
- `30_wlan`
- `99_fixwan`
- `99_oem`
- `98-board`
- `11_fix_passwd`
- `40_luci-wireless`

Confirmed initial mutations include:

- default LAN IP `192.168.10.1`;
- R26 is classified by `98-board` as a router;
- R26 falls through to five physical ports in the board metadata;
- `system.@system[0].domain='cudy.net'`;
- `system.@system[0].default=0`;
- `network.wisp` is created disabled with DHCP semantics;
- `wan2` is created as a disabled auxiliary interface by `99_fixwan`.

The immutable rootfs does not contain the complete final runtime network/wireless state as static files. First-boot UCI materialization is therefore a real dependency boundary, not optional setup noise.

## Wi-Fi bootstrap and management contract

Stock bootstrap `30_wlan` proves the initial primary radio sections:

- 2.4 GHz: `wireless.wlan00`;
- 5 GHz: `wireless.wlan10`;
- default 2.4 GHz SSID: `Cudy-<MAC suffix>`;
- default 5 GHz SSID: `Cudy-<MAC suffix>-5G`;
- default encryption on ordinary boards: `psk-mixed`;
- default key comes from `bdinfo pin`, with `12345678` only as the script fallback;
- radio country comes from `bdinfo country`, with `US` as fallback;
- if `bdinfo checkuuid` is not OK, initial channels are forced to 6 and 36.

Guest sections are also named explicitly as `wlan02` and `wlan12`.

Stock LuCI `config_combine.lua` bytecode confirms operator-facing controls for SSID, password/key, encryption, hidden/isolate, channel, channel width, TX power, country and Smart Connect. Runtime acceptance is still required before marking read/write capabilities validated.

## WAN contract — stock-static evidence

Stock `network.lua` exposes the administration route `admin/network/wan`, CBI model `wan/wan`, WAN status/config views and actions including WAN detect/data/reload.

WAN autodetection depends on hardware/runtime facilities:

- `/proc/net/wandetect/proto`;
- `/sbin/wandetect all`;
- `wantype -i <iface> > /tmp/wantype`.

These are explicit rehost boundaries and should be shimmed only to the minimum extent necessary for the stock management plane.

`01_network` and `99_fixwan` prove UCI bootstrap dependencies around WAN/WISP state. DHCP and PPPoE remain required acceptance capabilities; exact write models and first-run ordering still require runtime validation.

## First-run/wizard state

The stock `luci` config starts with `option wizard 1`. The stock `index.lua` controller contains dedicated `wizard`, `setup`, `guide`, `action_guide`, `show_wizard` and UCI set/commit logic. This proves Cudy has an explicit first-run/wizard path rather than merely exposing ordinary configuration pages.

The exact transition value and ordering are not yet marked validated until exercised in the stock runtime. The working hypothesis to test is that `luci.main.wizard` is a principal persistent first-run state flag.

## Current dependency questions

1. What exact transition does `action_guide` perform on `luci.main.wizard`?
2. What values must the `bdinfo` hardware boundary return for R26 factory login and first boot?
3. Which subset/order of UCI-default scripts is required to reproduce authentic first-boot state?
4. Which exact WAN CBI fields map DHCP and PPPoE credentials into UCI?
5. Which hardware helpers beyond `bdinfo`, board identity, radio MAC discovery and WAN detect are mandatory for userspace rehost?
6. What is the minimum dependency closure for DHCP, PPPoE and Wi-Fi password changes?

## Evidence discipline

Statuses in this file mean:

- **confirmed**: directly observed in exact stock static/runtime evidence;
- **clue**: present in stock bytecode/config but behavioral relationship not yet proven;
- **inference**: hypothesis awaiting runtime or causal validation.

No capability is considered validated from an endpoint/string alone.
