# Cudy WR3000 V1 (R31) — stock firmware research

Target is specifically Cudy WR3000 V1.0/R31 with official stock firmware 2.4.19.
Source: https://www.cudy.com/ru-ru/pages/download-center/wr3000-1-0

The stock 2.4.19 firmware download is identified, but full rootfs and firmware-derived authentication/Quick Setup contracts remain unverified. Do not reuse WR1200 or WR3000 V2/V3 write commands by assumption.

Research script: `probe_firmware.py --download --out wr3000-evidence` requires Python 3 and `unsquashfs`. It records hashes and scans original firmware for relevant stock backend modules. Images and original vendor code are not redistributed.

iPhone diagnostic client lives in `mobile/WR3000Probe/`. It uses local IPv4 only, sends one candidate LuCI authentication flow, and issues only GET requests after login. It records response status, timing, size, SHA256 prefix and stage, not passwords, cookies, CSRF or raw router configuration. Exported JSON is suitable for troubleshooting.

**Write operations are deliberately disabled** until the exact V1/R31 firmware has been inspected, specific vendor API contracts recovered, and then verified on hardware. The unsigned iOS IPA requires sideload signing. This build is NOT a finished Quick Setup implementation or an update to the existing RouterLab mobile harness.
