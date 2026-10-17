# RouterLab Archer C20 v0.7.7 — session / post-login CGI control

Based on v0.7.5. Same Chrome MV3 UI and existing physical C20 legacy login
(`UserName/Passwd` + RSA/AES). Not a new project or Git branch.

## Findings from the physical trace (2026-10-16)

- After a zero-code `/cgi_gdpr` login, the old build issued three WLAN read
  retries plus stock `$.act/$.exe` calls from UI-stage inspections. Router logs
  showed a burst of `net::ERR_EMPTY_RESPONSE` immediately after login.
- The old discovery code could take a Quick Setup screen in a *separate native
  TP-Link tab* as RouterLab's own state. Closing that tab then exposed the
  extension's unauthenticated offscreen iframe.
- On network loss during login POST, an early no-resubmit fence was missing.

## Changes

1. Only one encrypted `LAN_WLAN` read immediately after an accepted login.
   No automatic retry on CGI transport failure; no forced iframe reload.
2. `pageState` and `quickStage` are DOM-only: no implicit stock `$.act/$.exe`
   protected read when checking a wizard or login screen.
3. A native TP-Link tab is no longer silently used as the RouterLab session.
   It is used only after the explicit vendor-session action.
4. Preserve a verified WLAN snapshot for 30 seconds; discovery immediately
   after a successful login does not issue a duplicate protected CGI read.
5. Store the no-resubmit login fence **before** the encrypted password POST.
   It remains if the reply is lost or the session is unresolved; confirmed
   login rejection clears it to allow controlled manual correction.
6. A further protected read is allowed **only when the user clicks** Refresh
   State and the reloaded page no longer shows the login form.
7. Limit credential-bearing login posts to three per rolling ten minutes in
   `chrome.storage.session`. RSA parameter queries and data reads do not count.
8. Print `LOGIN_SESSION_TRACE` with `LOGIN`, `READ_WLAN`, status and own source
   label. No password, session token, cookies, plaintext, crypto material or
   HTTP response bodies are logged.

## Hardware status

The original normal login was physically confirmed on v0.7.0. New v0.7.7
lifecycle behavior is tested locally with the mock firmware; it has **not**
been validated on the physical Archer. In particular, a third-party offscreen
iframe may still be prevented by the browser/router from acquiring the same
first-party session as a stock TP-Link tab. Do not claim session success unless
`LOGIN_PROTECTED_READ_OK` or a visible, exact wizard stage is confirmed.

## Test safely

1. Disable **all older RouterLab builds**, including any separately installed
   diagnostics/working versions. If a lockout is in effect, wait it out.
2. Load the unpacked `routerlab-archer-c20-v077` directory via
   `chrome://extensions` (Developer mode -> Load unpacked).
3. With no separate `192.168.0.1` tab open, click Detect once.
4. On a router with an existing admin password, click Login **only once**.
   If in VERIFY_STATE, **do not re-enter the password**; use Refresh State once.
5. Copy `LOGIN_SESSION_TRACE`, `OFFSCREEN_ENCRYPTED_LOGIN`, `STATE_REFRESH` and
   the current phase. Do not send any credentials/cookies.

**Test command:** `for f in tests/*.test.cjs; do node "$f" || exit 1; done`
