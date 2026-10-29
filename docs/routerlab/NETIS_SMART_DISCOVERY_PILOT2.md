# Smart discovery for RouterLab Router-Origin Overlay v0.8.22

## Physical reproduction (29 October 2026)

On Netis N2 FW4 at `http://192.168.1.1/login.html`, read-only pilot showed `NETIS_SENDER_DENIED` while the router-origin overlay itself was visible.

**Root cause:** the original C20 worker has a top-level lexical `const URL = 'http://192.168.0.1/'`. The imported Netis worker used `new URL(sender.url)`, inadvertently resolving the router string rather than the built-in URL constructor. The exception was caught and converted to a sender denial. Fix: **`new globalThis.URL(sender.url)`**. The sender is still checked for the exact `chrome-extension://<current extension id>/setup.html?device=netis` origin and path; never weaken the sender check to bypass it.

## Launch policy — implemented in the standalone pilot 2 ZIP

- On installing/reloading, do not open TP-Link automatically.
- Chrome-action click chooses the active router tab, then a unique existing router tab.
- Known origin candidates: `192.168.0.1` (Archer C20), `192.168.1.1` (Netis N2 FW4). Origin is not proof of model; stock frontend / CGI must still verify.
- If no router tab is present, concurrently probe only granted addresses with **read-only** queries, bounded to 2.8 seconds. Confirm N2 through `POST skk_get.cgi app=base` / N2-V4 firmware identity; confirm C20 from model-specific stock HTML. Never auto-navigate to an unconfirmed model or issue login/SET during probing.
- If neither or both respond, show a lightweight informative launcher. It is not a replacement RouterLab UI.
- Preserve C20 stock router-origin login and Shadow DOM overlay; Netis pilot stays read/login only.
- Current Chrome APIs do not provide an OS gateway detector, so this probes explicit known private addresses. Do not call it universal or scan LAN.

## Evidence and artifact

Built from user-supplied original `RouterLab-Archer-C20-v0.8.22-WiFi-Status-Pilot(1).zip`, retaining original `routerlab-overlay.js` and `setup.css` byte-for-byte. Output: `RouterLab-v0.8.22-Netis-N2-FW4-Smart-Discovery-Pilot2.zip`. SHA-256: `cd6bba0522675a5055e15ef864f53c931a8ee3c80035ba75e57e1a8f1c47c517`.

Local Node validation: **59 of 59 test files pass**, including the original 57 baseline test files (one routing assertion intentionally updated to reject hardwired C20 launch) and new dispatcher tests; JS syntax checks pass. The browser visual smoke test was blocked by the execution environment and a real Netis end-to-end test is still pending.

**Important:** This GitHub branch currently contains modular adapter research, not the complete original 126-file v0.8.22 extension source. The downloadable pilot 2 ZIP was assembled in conversation and is not a GitHub build artifact. Do not merge this branch as a release until full source is checked in and physical validation performed.
