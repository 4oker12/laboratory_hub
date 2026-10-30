# Archer C20 V5 physical identity gate (2026-10-31)

## Observed physical target

- Firmware: `3.16.0 0.9.1 v6038.0 Build 200821 Rel.52349n`.
- UI hardware string: `Archer C20 v5 00000002`.
- Serial number: deliberately **not stored**.
- Label country/variant: **not verified**.
- Product ID / Board ID: **not verified**.
- Device firmware backup: **not available**.

## Evidence and distinction

- TP-Link official forum documents C20(INWISP) devices with the same `v6038.0` firmware branch and the same `v5 00000002` hardware string: https://community.tp-link.com/en/home/forum/topic/216088
- TP-Link staff explicitly state ISP builds can reject the generic EU firmware even for identical physical hardware. The observed refusal is `4503`.
- One third-party software catalog lists a `Archer C20(RUWISP)v5 ... (200821)` image, matching our target *build date*; this is an **unverified, non-vendor firmware source**, and does NOT prove binary equivalence or installation compatibility: https://www.tplink.su/downloads/
- TP-Link has a separately published C20(INWISP) V5 build `210407` intended **only for Indian INWISP**: https://community.tp-link.com/en/home/forum/topic/269216 . This is NOT an upgrade recommendation for the target.
- Public stock EU V5 `260317` and RU V5 `260615` were fetched and identified in CI; these are reference images for offline reverse engineering and NOT preapproved upgrade files.

## Safety decision

**NO FLASH / NO CROSS-REGION UPGRADE** until the printed bottom label confirms the exact variant, supported vendor firmware lineage, firmware image header/product ID compatibility, backup and recovery procedure. UI `00000002` is insufficient to identify RU, EU, RUWISP, INWISP, or another ISP variant.

## Next validation

1. Check physical bottom label with serial number and MAC redacted. Only model/country/hardware designation is needed.
2. Compare official RU/EU images and the target original image, if lawfully available, offline: magic, partitions, header model and product identifiers, software stack, auth, management routes.
3. If label indicates WISP/ISP, locate a **verified matching vendor/ISP release** rather than trying EU/RU stock in the updater.
4. Keep the user's existing physical device operational for RouterLab stock transport tests until a proven recovery/backup path exists.
