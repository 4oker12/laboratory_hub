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

