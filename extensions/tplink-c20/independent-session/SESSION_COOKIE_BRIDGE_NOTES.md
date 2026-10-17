# v0.8.3 — Fix fresh-JSESSIONID race and blocked /cgi/getBusy route

## What the physical v0.8.2 trace proved

`/cgi/getGDPRParm` returned HTTP 200 with `Set-Cookie: JSESSIONID`, but the immediate `chrome.cookies.getAll()` query returned no JSESSIONID. The old code set `cookieBridge=COOKIE_NOT_PRESENT` **yet still sent LOGIN** (`loginPosts=1`); the LOGIN request had no Cookie header and the subsequent WLAN read failed.

Another independent source defect: `offscreen-vendor-control-main.js` allowed `/cgi/getBusy`, but the shared Service Worker `routeAllowed` guard did not. Thus the bridge's read-only wire preflight could not execute.

## Fix

* Collect **only a freshly issued** JSESSIONID from the router's `Set-Cookie` response of this explicit attempt's RSA request, in service-worker volatile memory; no token value in diagnostics or storage.
* If the Cookies API is temporarily behind or the iframe blocks third-party cookies, construct a narrowly scoped **temporary DNR rule** from the exact server-issued cookie, not a fabricated ID. The rule applies only to no-tab router-origin CGI requests for `192.168.0.1`, plus the corresponding hidden iframe navigation.
* The whitelist now allows the stock read-only `POST /cgi/getBusy`, without permitting arbitrary URLs.
* Before attempting LOGIN, require a successful `/cgi/getBusy` response **and wire evidence that the cookie header was attached** in the no-tab context. If cookie capture fails or DNR is rejected, the request **stops with `loginPosts=0`**.
* A newly issued cookie from the LOGIN response may replace the RSA cookie for later protected reads; no second password POST is performed.
* Distinguish `cookieBridgeSource=FRESH_RSA_SET_COOKIE` from `FRESH_COOKIE_STORE_CANDIDATE` and `NO_VERIFIED_FRESH_COOKIE`. All are non-secret statuses.
* Preserve AES/RSA, legacy `UserName`/`Passwd`, read/Wi-Fi save, retry fences and the 3-attempts/10-minute safety limit.

## Scope of confidence

45 local test files pass, including a simulation with an immediate RSA Set-Cookie but a still-empty Chrome cookie jar, and a simulation requiring **zero password POSTs** if no cookie can be obtained. Actual DNR behavior and login success must be checked on the physical Archer. Do not repeat a failed LOGIN; router lockout is possible.
