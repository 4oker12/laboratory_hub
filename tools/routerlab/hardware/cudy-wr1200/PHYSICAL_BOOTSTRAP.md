# Cudy WR1200 V2.1 / R26 physical bootstrap

This path is intentionally separate from the rehost-only quick-setup runner.

## Why

The physical WR1200 V2.1 running firmware 2.4.23-20251224-145945 exposes the stock login form at:

- GET /cgi-bin/luci
- POST /cgi-bin/luci/

Its stock sysauth.js transforms the password as:

1. h1 = SHA256(password + salt)
2. luci_password = SHA256(h1 + token)

The older rehost helper posts a single salt hash to /cgi-bin/luci/admin/wizard and must not be used as the first physical mutation.

## Script

tools/routerlab/hardware/cudy-wr1200/cudy-physical-bootstrap.ps1

Default mode is read-only. It verifies:

- route/TCP reachability;
- HW/FW fingerprint;
- stock form action;
- _csrf, salt, token and admin username fields;
- stock sysauth.js contract.

No mutation occurs unless -ApplyAdminPassword is supplied.

With -ApplyAdminPassword the script:

- refreshes the stock form immediately before POST;
- asks for the password with Read-Host -AsSecureString;
- reproduces the stock two-stage SHA-256 transform locally;
- performs one POST to the action supplied by the stock form;
- does not follow POST redirects;
- redacts sysauth from saved headers;
- verifies an authenticated guide request;
- stops before WAN/Wi-Fi/final Apply.

This is deliberately Phase 1 of the physical acceptance run. The physical wizard is inspected after the first successful stock login/bootstrap before any additional configuration mutation.
