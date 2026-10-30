# Netis N2 FW4 — First-screen discovery pilot 3 (2026-10-29)

## Physical evidence

On the real N2 FW4 over Wi-Fi, the operator confirmed RouterLab status reading after directly opening `http://192.168.1.1/login.html`: `DETECTED N2 FW4`, `READBACK_OK WAN WLAN IGMP` (WAN DHCP, LAN IP 192.168.1.1, two Wi-Fi bands). Another URL to the same router, `http://192.168.1.1/login.html?utm_source=chatgpt.com`, showed `NETIS_SENDER_DENIED` on the first screen.

The screenshots alone do **not** prove that `utm_source` itself caused the sender denial; it might have been extension lifecycle, binding race, or an older installed build. The router origin is identical for both URLs.

## Pilot 3 code and behavior (ZIP built from user-supplied v0.8.22 source)

- Never strip the router URL query, redirect manually, or navigate to C20 by default. Active router tab is preferred, Netis detected by confirmed stock CGI response, not only the IP.
- Router-origin Netis content script sends `netis.overlayHello` **before** loading the extension iframe, with one safe retry only for the binding handshake (no login/SET).
- Worker binds a sender to a top-level Netis tab only after parsing the complete sender URL with `globalThis.URL` and checking exact `http://192.168.1.1` origin. This ignores query parameters.
- Worker sends positive binding ACK only after `chrome.storage.session.set` has resolved, closing MV3 eviction window. It rejects external/page-origin calls to `netis.*`, requires a trusted `chrome-extension://<runtime.id>/setup.html?device=netis` sender, and never retries password/SET.
- UI discovery verifies model `N2` + exact `N2-V4.*` firmware; status progresses to LOGIN or READY. If an error occurs, discovery spinner stops, displays error code on-screen and offers an explicit Retry button.
- C20 `routerlab-overlay.js` and `setup.css` **unchanged byte-for-byte**. Netis remains read/login only; no writes.
- Regression tests include tracked login URLs, pre-iframe binding, failed binding visibility, origin anti-spoof, and sender auth. **60 of 60 Node test files passed** in the local ZIP working copy; no physical Netis execution of pilot 3 yet.
- A local Playwright attempt to load a localhost preview was blocked by browser environment policy; it is not a passed browser test.

## Artifact and next physical test

In this conversation the generated ZIP is `RouterLab-v0.8.22-Netis-N2-FW4-AutoDetect-Pilot3.zip` (SHA-256 `2e9bfb85334d8924bc0f961eabb99c9f22df53ea9d08bba906af3f9cf9795a2e`).

Disable old pilot extensions, load the unpacked Pilot 3 folder in Chrome, remain connected to the real Netis Wi-Fi, and open the **same tracked URL** without editing it. Expected: model detected and readback shown without manual navigation; otherwise exact recoverable error for safe TXT export.

This document records the ZIP; the full v0.8.22 extension source and Pilot 3 patches have not yet been imported into this repository's branch. Draft PR is research, **not** a release.
