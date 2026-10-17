# RouterLab Archer C20 — state-first routing v0.7.3

Scope: reuse v0.7.2 factory/wizard workflows and v0.7.0 physically demonstrated legacy UserName/Passwd + Base64 RSA/AES login. No changes to the encrypted login packet, Wi-Fi setters, WAN protocol, or the existing Quick Setup steps.

## Evidence rules

1. `FACTORY_PASSWORD`: actual two-password stock screen, not a factory string in an unloaded script.
2. `LOGIN_FORM`: actual stock one-password form; *unless* first-password transition fence or accepted-zero-ack fence is active.
3. `LOGIN_LOCKED`: visible stock lockout text (five attempts / too many login attempts). No password request sent.
4. `QUICK_SETUP_ACTIVE`: visible wizard + recognized actual form step `ISP_WAN`, `VLAN_DEFAULTS`, `WIRELESS`, or `SUMMARY`. Menu link alone is insufficient. This takes precedence over stale Wi-Fi read.
5. `WIFI_EDITOR`: protected WLAN read of two distinct 2.4 and 5 GHz instances, with real dynamic stack identifiers, or the vendor's confirmed protected stock list read.
6. `VERIFY_STATE`: login returned `vendorRet=0` but neither the wizard nor protected configuration read was confirmed. This is NOT a wrong-password verdict. No blind retry. User can report what is visible in the stock UI; their answer is diagnostic evidence only, never authorizes configuration actions.

## After encrypted CGI login

- A nonzero vendor code is a rejection; never attempt another dialect automatically.
- A zero vendor acknowledgement triggers protected LAN_WLAN read. If it works, preserve the previously physically proven configured-router path.
- On failed WLAN read, persist only a non-secret `c20PendingAcceptedLoginStateV1` fence. Check stock UI, refresh the hidden router-origin iframe **once**, and check again. If the visible wizard is confirmed, route to QUICK_SETUP but do not auto-save: require an explicit user action to continue.
- If no configured/wizard stage is confirmed, expose VERIFY_STATE and do not resend login or infer a wrong password. The fence lasts for the browser extension's session storage lifetime, including service-worker restarts. It is cleared when wizard or protected configuration is confirmed.

## Stalled factory-password transition

If the first password was submitted and the stock page remains on a real LOGIN_FORM longer than 20 seconds, RouterLab asks the user rather than waiting for Quick Setup forever. An explicit confirmation triggers a **fresh passive screen check**. Only a confirmed login form unlocks the normal login UI, and the confirmation itself sends **no credentials**. A visible stock lockout blocks login.

## Safety and limits

- The login packet (`UserName`/`Passwd` Base64, encrypted via existing RSA/AES) is untouched.
- No credentials/cookies/tokens/CGI responses are written to diagnostic logs or session storage. The stored fence contains only a timestamp and status string.
- No hidden extra browser windows or automatic password retries.
- An explicitly selected response from the user is NOT treated as proof of authentication or Quick Setup completion.
- Stock session/cookie behavior after one iframe refresh, wizard appearance and lockout detection require **physical C20 validation**. Local mocks are not proof.

## Local validation

39 test files pass, including `accepted-login-wizard-or-unknown`, `state-first-routing` and `vendor-visible-lockout`. See `TEST_REPORT.md`.
