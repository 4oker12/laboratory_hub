# RouterLab Archer C20 v5 — independent-session extension

This is the complete unpacked Manifest V3 extension source for the experimental independent-session flow. It sits beside the assisted native-UI pilot in `extensions/tplink-c20`; the two extensions are separate builds and should not be loaded together during hardware testing.

## Load in Chrome

1. Clone the repository and open `chrome://extensions`.
2. Enable Developer mode, choose **Load unpacked**, and select this directory: `extensions/tplink-c20/independent-session`.
3. Open RouterLab from the extension toolbar. The current source build ID is printed in its technical journal.

No npm install is required. The extension uses built-in Chrome APIs and the Web Crypto API. Node.js 22 is used for the automated tests.

## Current behavior and limits

- The extension implements the Archer C20 v5 RSA/AES CGI login and protected WLAN read flow.
- Login is fail-closed when a usable router-issued session cookie cannot be proven; it does not open a visible TP-Link tab as a cookie fallback.
- A successful login response or HTTP 200 alone is not proof. The extension requires decrypted protected WLAN data before reporting the router as authenticated.
- Hardware confirmation of standalone login and repeatable `READ_WLAN` is still pending. Local mocks do not establish physical-router success.
- Do not use it to change WAN, Wi-Fi, admin credentials, firmware, or router state during this authentication investigation.

## Run tests

From this directory, run the test scripts with Node.js 22:

```powershell
Get-ChildItem .\tests\*.test.cjs | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw "Failed: $($_.Name)" } }
```

The focused login/cookie tests include `tests/offscreen-encrypted-login.test.cjs`, `tests/offscreen-legacy-login.test.cjs`, `tests/session-cookie-evidence.test.cjs`, and `tests/accepted-login-wizard-or-unknown.test.cjs`.

## Optional read-only hardware probe

From the repository root, run `tools/tplink-c20/Run-Physical-Read.ps1`. It prompts for the router password through a hidden PowerShell secure input, does not save it, sends one encrypted login, then performs two protected WLAN reads. Do not run it during a router lockout; stop if it reports a busy/unknown state or a network error. Its diagnostics omit password, cookie values, SSIDs, and Wi-Fi keys. This probe is separate from the Chrome extension and is not evidence that the extension itself works.
