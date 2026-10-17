Focused validation passed: accepted-login-wizard-or-unknown.test.cjs, logout-offscreen-state-refresh.test.cjs, offscreen-encrypted-login.test.cjs, and contract.test.cjs (4/4 files).

The physical trace showed one explicit protected WLAN read failed with NETWORK_ERROR (readyState 4, 163 ms), then later refreshes were blocked by the one-read fence. The diagnostic build now retains only the transient derived crypto context for one additional user-triggered read, with a hard cap of two explicit reads and no LOGIN retry. STATE_REFRESH_CONTEXT reports cookie metadata, crypto/context presence and age, bridge result, and request/response wire flags; it never logs cookie values, passwords, SSIDs, Wi-Fi keys, tokens, or protected response bodies.

A test simulates a failed read, a stock WebGUI session becoming available, and a successful second explicit READ_WLAN; it confirms exactly one LOGIN, a two-read cap, and session cleanup after success. Physical READ_WLAN still awaits the user's next log.

## Physical trace follow-up — 2026-10-16 23:48

The user's 23:45 refresh proves transient crypto restoration succeeded (`cryptoRestored=true`, stored context age 96 sec), the JSESSIONID cookie existed before/after and the cookie bridge was installed. One password-free explicit READ_WLAN was sent with a cookie, then failed as `C20_OFFSCREEN_HTTP_NETWORK_ERROR` / `NETWORK_ERROR`, readyState 4, 164 ms; the wire trace has a request but no response event. This rules out the earlier worker-context and missing-cookie hypotheses for this attempt. The `fenceReadAttempted=false` and count 0 in `STATE_REFRESH_CONTEXT` are the pre-read snapshot, emitted before the read; this refresh consumed explicit read 1 of 2.

Diagnostic-only improvement: `onCompleted` / `onErrorOccurred` now append a bounded CGI outcome to `STATE_REFRESH_CONTEXT.readWire`; on failure the only new field is an allowlisted Chrome `net::ERR_*` code. It records no request URL, headers, cookies, credentials, ciphertext or response body. Focused syntax checks and all four targeted suites passed. Updated unpacked folder and ZIP.

Physical READ_WLAN is still unconfirmed. The installed browser has not loaded this diagnostic-only update. Reloading the extension clears the transient session crypto; therefore do not reload and then press LOGIN during the router's 600-second cooldown. On a later allowed fresh test, load `RouterLab-cookie-fix-test-v2`, do one login and one state refresh, then share only `STATE_REFRESH` and `STATE_REFRESH_CONTEXT`.


## 2026-10-17 cookie-store loss finding

The 00:46:58 refresh had crypto context, but Chrome cookie storage was empty. Cookie bridge preflight correctly refused the protected request (`COOKIE_NOT_PRESENT`); `wire=[]`, so no READ_WLAN was sent. Updated the diagnostic package to keep only the fresh router-issued JSESSIONID in chrome.storage.session for at most 30 minutes alongside the pending crypto context, never in logs or persistent storage, and use it only for the bounded explicit protected read. Added a deterministic test where Chrome drops the cookie from its cookie store; one password-free refresh confirms WLAN without another LOGIN. Focused syntax checks and all four targeted suites pass. Physical confirmation remains pending; stop authentication attempts while LOGIN_LOCKED is displayed.

## 2026-10-17 UI button repair

Changed setup UI render state so `inspectBusy` and `confirmFactoryLogin` are re-enabled after an action finishes; previously the global busy lock disabled all buttons and render omitted these two. `node --check setup.js` passed. Focused tests passed: `accepted-login-wizard-or-unknown`, `logout-offscreen-state-refresh`, `offscreen-encrypted-login`, and `contract` (4/4). Build suffix: `20261017-COOKIE-SESSION-CACHE-02`.
## 2026-10-17 stock-session refresh repair

Explicit refresh from `LOGIN_FORM` now reloads the offscreen TP-Link document once and inspects it, so a session established in the stock WebGUI can be detected. The flow never submits LOGIN or a password. Added `stock-session-refresh-from-login.test.cjs`, which confirms one protected read and zero credential submissions when refreshed stock state is authenticated. `node --check background.js`, `node --check setup.js`, and 5 focused suites passed. Build suffix: `20261017-COOKIE-SESSION-CACHE-03`. Physical retest pending.
## 2026-10-17 stale-cookie bootstrap and read error diagnostics

The supplied preflight traces had one existing JSESSIONID, RSA params HTTP 200 without a fresh Set-Cookie, and zero password posts. Added same-origin read-only `GET /` before RSA params to capture a fresh router-issued cookie when firmware rotates/renews it; fail-closed behavior remains if none is proven. Added sanitized root-bootstrap and XHR failure metadata for future traces. Deterministic test covers a non-empty stale cookie jar renewed by `GET /`. Syntax checks passed; 5 focused suites passed. Build suffix: `20261017-COOKIE-SESSION-CACHE-04`. Hardware verification pending.
## 2026-10-17 expired-cookie rejection

Read-only inspection of the physical router found `GET /` returns HTTP 200 and a `JSESSIONID` with `Expires=Thu, 01 Jan 1970 00:00:01 GMT`, an expired/deletion cookie. The parser previously accepted any non-empty JSESSIONID and could mislabel this as fresh-session evidence. It now rejects expired cookies and `Max-Age<=0`. Validation passed: syntax checks plus `session-cookie-evidence`, `offscreen-encrypted-login`, `offscreen-legacy-login`, and `accepted-login-wizard-or-unknown` suites (4/4). Hardware login/read not attempted.

## 2026-10-17 no-visible-tab fallback

The CACHE-05 physical trace showed a brief VISIBLE_TAB request after hidden cookie preflight failed. Source tracing identified `captureFirstPartyBootstrapCookie()` as the temporary inactive-tab fallback. Removed it: no normal router tab is created for cookie bootstrap, and missing fresh-cookie evidence fails closed before LOGIN. Added a regression case requiring zero tabs and zero password posts when no cookie is issued. Validation passed: syntax checks plus `offscreen-encrypted-login`, `session-cookie-evidence`, `offscreen-legacy-login`, and `accepted-login-wizard-or-unknown` (4/4 suites). Build `20261017-COOKIE-SESSION-CACHE-06`; hardware LOGIN/READ_WLAN not attempted.
2026-10-17: Physical CACHE-06 trace showed one pre-existing JSESSIONID sent on ROOT, then no Cookie on RSA params; both responses exposed a Set-Cookie name but the fail-closed parser did not accept a fresh session. Added value-free `sessionCookieEvidence` classifications (fresh captured, expired/deletion, invalid, ambiguous, or not eligible context) to distinguish those cases on the next read-only attempt. Bumped build to `20261017-COOKIE-SESSION-CACHE-07`. No login behavior was loosened; no password POST is allowed without proven fresh-cookie bridge. Local cookie-evidence and encrypted-login tests pass; hardware verification pending.
