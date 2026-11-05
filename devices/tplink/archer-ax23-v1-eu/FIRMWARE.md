# Official AX23 EU V1 firmware audit

## Measured stock provenance
- Vendor support: https://www.tp-link.com/uk-ua/support/download/archer-ax23/v1/
- Listed build: `1.1.3 Build 20250905`; released 2025-11-12; no newer V1 EU build on the checked official page.
- Official archive: https://static.tp-link.com/upload/firmware/2025/202511/20251112/Archer%20AX23%28EU%29_1.0_250905.zip
- ZIP: 15,647,550 bytes; SHA256 `f910fedaa2fd6f002785bc80eaa8388dd7ac34f3c03b752807984f7e032d3305`.
- Embedded BIN: `AX23v1.0_eu_jp_kr_ru-up-ver1-1-3-P1[20250905-rel39233]_2025-09-05_10.56.05.bin`.
- BIN: 15,051,062 bytes; SHA256 `217495e28251104ecbffaa1bbb361fc123bcc90707ba0650aef1a44c8c685839`.

## Container map from binwalk and actual extraction

| Start byte | Hex | Evidence |
| ---: | --- | --- |
| 8212 | `0x2014` | uImage kernel header; MIPS Linux, LZMA; image size 3,103,713 bytes |
| 8276 | `0x2054` | LZMA-compressed kernel data |
| 3111990 | `0x2F7C36` | SquashFS little-endian v4, xz, 11,894,474 bytes, 2,498 inodes |

The rootfs was actually extracted using `unsquashfs -o 3111990`. File metadata established MIPS32 little-endian BusyBox, dynamic uClibc loader. The original rootfs contains UCI-style config files and LuCI components, but **their existence alone is not runtime/API proof**.

## Reproduce
Run the model's `audit-local.sh` against the unchanged official ZIP. GitHub Actions run #2 contains the original extraction logs and hashes:
https://github.com/4oker12/laboratory_hub/actions/runs/42024790956

Note: initial workflow run #1 failed because square brackets in the BIN name were treated as an unzip filename pattern. Run #2 fixed that audit-script error; this was not an encrypted-firmware blocker.
