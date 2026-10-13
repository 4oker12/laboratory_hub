# RouterLab Cudy 0.5 — Chrome Web Store handoff

STATUS: package is built and validated locally; the store item has **not been published**. Do not invent a store URL or promise installation directly from GitHub Pages.

## Target user flow
1. ISP operator sends the **actual Chrome Web Store item URL** (after publication).
2. Subscriber selects Add to Chrome and approves permission for local Cudy UI.
3. The extension's `chrome.runtime.onInstalled({reason:'install'})` handler opens `http://192.168.10.1/cgi-bin/luci`.
4. The packaged content scripts classify Factory / Incomplete / Configured / Unknown and show the local RouterLab panel.
5. If Wi-Fi is not connected at install time, subscriber joins Cudy Wi-Fi and presses the extension icon to reopen it.

This first-run tab opening does not happen on updates, to avoid disrupting existing browsing.
No network connection is required to run the installed extension against Cudy.

## Files and checks
The tested Chrome MV3 0.5.0 ZIP, provided in the RouterLab conversation, contains: `manifest.json`, `background.js`, `classifier.js`, `content.js`, and PNG icons 16/48/128.
Tests verified JavaScript syntax, manifest integrity, classifier's existing 9 state tests, runtime.install handler simulation, and ZIP CRC. Browser end-to-end after installing from Chrome Web Store and actual first-run browser event remain unverified.

## Submission
- Open https://chrome.google.com/webstore/devconsole.
- Register / sign in as a Chrome Web Store developer, complete publisher setup / 2FA.
- Create new item, upload the **ZIP package** with manifest at the ZIP root.
- Complete Store listing (supported hardware, current diagnostic functionality), Privacy practices, and screenshots/graphics.
- Privacy policy: https://4oker12.github.io/laboratory_hub/routerlab-telegram-test/privacy.html
- Submit for review. After approval, copy the actual Store URL; that is the Telegram link.

## Release scope
Read-only state classifier and automatic Cudy navigation. Bootstrap changes are NOT enabled in 0.5. The extension does not factory-reset or change customer settings.
It only matches `http://192.168.10.1/*`.
