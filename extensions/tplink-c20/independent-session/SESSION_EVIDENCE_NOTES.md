# v0.8.0 — cookie/session evidence, not a proven fix

Observed on physical v0.7.9: Login CGI HTTP 200, decrypted ret=0, but reload keeps LOGIN_FORM; first LAN_WLAN request receives ERR_EMPTY_RESPONSE. This does **not** prove successful browser authentication.

Changes:
- WebRequest onSendHeaders/onHeadersReceived (`extraHeaders`) **observes** Cookie/Set-Cookie presence and classifies JSESSIONID/Authorization names and SameSite **without storing values**.
- Uses chrome.cookies.getAll read-only to compare unpartitioned and extension-partitioned cookie counts/names. Unsupported partition query is marked unsupported, not zero.
- Captures stock iframe document.cookie and hasStorageAccess flags immediately after CGI ACK. HttpOnly cookies cannot be detected by document.cookie.
- Does not modify/set/copy any cookies, does not add headers, does not create stock tabs, does not retry LOGIN.
- Existing real-hardware confirmed WIFI_SET path unchanged.

One hardware attempt only after block timer cleared and all other copies disabled. Preserve LOGIN_SESSION_TRACE, no password/cookie values.
