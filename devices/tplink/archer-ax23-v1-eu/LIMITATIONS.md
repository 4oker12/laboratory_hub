# Non-claims and hardware boundaries

- The official firmware *was* acquired and rootfs extracted. This does not imply HTTP or the AX23 login protocol is operational in a virtual environment.
- No original AX23 auth/Quick Setup/WAN/WLAN setter or backend has yet been executed. Nothing is called `RUNTIME_STOCK_CONFIRMED` for those functions.
- A stock config file is structural evidence, not a successful change.
- Radio transmission, Wi-Fi RF strength/rates, Ethernet PHY, switch fabric, hardware NAT, ISP DHCP, actual VLAN forwarding, LEDs and hardware reset require a physical router.
- A later userspace-only rehost may prove software-state transitions, never physical throughput.
- No consumer credentials, router flash programming, host DHCP changes, WAN tests, 0.0.0.0 binding or modifications to AX55/C20/Xiaomi/mobile are permitted.
- Firmware image and rootfs stay out of Git; only reproducible source metadata and bounded textual logs are tracked.
