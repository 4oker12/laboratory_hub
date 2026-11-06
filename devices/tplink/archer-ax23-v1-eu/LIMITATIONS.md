# Non-claims and hardware boundaries

- The official firmware *was* acquired and rootfs extracted; stock BusyBox was executed under qemu-mipsel. This does not imply uhttpd, CGI, login, or setter execution.
- No original AX23 auth/Quick Setup/WAN/WLAN setter or backend has yet been executed. Nothing is called `RUNTIME_STOCK_CONFIRMED` for those functions.
- A stock config file is structural evidence, not a successful change.
- Radio transmission, Wi-Fi RF strength/rates, Ethernet PHY, switch fabric, hardware NAT, ISP DHCP, actual VLAN forwarding, LEDs and hardware reset require a physical router.
- A later userspace-only rehost may prove software-state transitions, never physical throughput.
- No consumer credentials, router flash programming, host DHCP changes, WAN tests, 0.0.0.0 binding or modifications to AX55/C20/Xiaomi/mobile are permitted.
- Firmware image and rootfs stay out of Git; only reproducible source metadata and bounded textual logs are tracked.


## Current management-server blocker

A genuine stock `uhttpd` process has been attempted under QEMU/chroot, but did not expose HTTP, reporting missing `sysmode` state and failing to connect to `ubus`. This is a software runtime-environment blocker, *not* evidence that the firmware is encrypted or that AX23 auth is impossible. At the present evidence level, all SET/GET, login, wizard and persistence functions remain unverified.


## Updated evidence boundary

Original `uhttpd`, `ubusd` and CGI/LuCI **do execute original login read callbacks** (`check_factory_default`, `keys`, `auth`) inside QEMU/chroot. This supersedes earlier HTTP-only limitations. Authenticated session, creation of first administrator, Quick Setup, WAN, Wi-Fi, config persistence, hardware PHY and radio remain unverified. `get_firmware_info` still returns HTTP 500. Only original stock read callbacks have `RUNTIME_STOCK_CONFIRMED` status.


## First-admin limitation updated

**First-admin creation itself is now runtime-confirmed**, via original stock browser -> original encryption -> original LuCI `initial_login` -> `accountmgnt` update -> stock `is_default=false` readback, in a namespace-isolated disposable rootfs clone. This supersedes older text saying all writes are unverified.

There is still **no** verified normal authenticated session, stok, Quick Setup, WAN/WLAN configuration roundtrip, or cold-boot/flash persistence. New-uhttpd-process persistence is a separate pending experiment. Real hardware behavior remains unverified.

