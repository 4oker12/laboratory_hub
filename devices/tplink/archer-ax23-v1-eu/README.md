# RouterLab — TP-Link Archer AX23(EU) V1 stock rehost research

**Target:** official Archer AX23(EU) hardware V1, 1.1.3 Build 20250905. **Status:** original image downloaded, identified and SquashFS rootfs successfully extracted in GitHub Actions. Stock vendor BusyBox runs under QEMU-user. Stock management HTTP/backend has NOT yet been started or validated. No physical router used.

## Provenance and repeatability
Official vendor page: https://www.tp-link.com/uk-ua/support/download/archer-ax23/v1/
Original ZIP: https://static.tp-link.com/upload/firmware/2025/202511/20251112/Archer%20AX23%28EU%29_1.0_250905.zip

- ZIP SHA256: `f910fedaa2fd6f002785bc80eaa8388dd7ac34f3c03b752807984f7e032d3305` (15,647,550 bytes).
- Original BIN SHA256: `217495e28251104ecbffaa1bbb361fc123bcc90707ba0650aef1a44c8c685839` (15,051,062 bytes).
- BIN name: `AX23v1.0_eu_jp_kr_ru-up-ver1-1-3-P1[20250905-rel39233]_2025-09-05_10.56.05.bin`.
- Kernel uImage: byte 8212 (`0x2014`), MIPS, LZMA.
- SquashFS 4.0: byte 3111990 (`0x2F7C36`), xz, 2,498 inodes, size 11,894,474 bytes.
- Stock BusyBox: ELF MIPS32 little-endian r2; dynamic loader `/lib/ld-uClibc.so.0`.
- Files observed: `/etc/config/network`, `/etc/config/iptv`, `/etc/config/luci`, `/etc/config/uhttpd`, `/usr/lib/lua/luci/sgi/cgi.lua`.

Primary evidence: [rootfs extraction run #2](https://github.com/4oker12/laboratory_hub/actions/runs/42024790956); [stock userspace inventory + BusyBox run #4](https://github.com/4oker12/laboratory_hub/actions/runs/42025818490).

## Observed stock management-plane paths and QEMU smoke
- Original HTTP server: `/usr/sbin/uhttpd` (MIPS32 LE); stock CGI entry: `/www/cgi-bin/luci`.
- Original backend controller candidates: `/usr/lib/lua/luci/controller/login.lua`, `admin/quick_setup.lua`, `admin/network.lua`, `admin/wireless.lua`, `admin/iptv.lua`.
- Original frontend: `/www/webpages/init.html`, `/www/webpages/modules/login/{initLogin,localLogin}/`, `/www/webpages/modules/qs/`, plus original JS `encrypt.js`, `tpEncrypt.js`, `cryptoJS.min.js`.
- Genuine stock MIPS BusyBox executed under `qemu-mipsel -L <extracted-rootfs>` with `STOCK_AX23_MIPS_BUSYBOX_RUNTIME_OK`; a non-fatal loader-cache warning was logged. No stock SET/GET or authentication call has been executed.

## Read-only local reproduction
Obtain the exact ZIP from the official manufacturer page. Run:

```bash
bash devices/tplink/archer-ax23-v1-eu/audit-local.sh '/path/to/official.zip' /tmp/ax23-audit
```

Optional `binwalk` and `unsquashfs` add output. No firmware or service is executed by this command. Real images are never committed.

## Boundaries
Only this model directory, `tests/firmware/archer_ax23_v1_eu`, and the model-specific GitHub workflow are changed. No changes to AX55 Issue #18 or any other RouterLab devices/mobile. No LAN binding or DHCP operations. Future rehost must use `127.0.0.1:18023`, and must execute actual stock handlers, not a simulated API.

See FIRMWARE, ARCHITECTURE, EVIDENCE, LIMITATIONS and HANDOFF for the exact evidence boundary.
