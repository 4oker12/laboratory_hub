# Cudy WR1200 V2.1 / R26 physical validation

Target physically tested:

- hardware: WR1200 V2.1
- firmware: 2.4.23-20251224-145945
- management IP: 192.168.10.1
- WAN was physically disconnected during the validation

This document records physical observations. It must not be used to rewrite the frozen pre-hardware evidence on `research/cudy-r26-prehardware-closeout`.

## Confirmed state machine

### 1. Factory

After a real hardware reset:

- GET `/cgi-bin/luci` returns the administrator-password creation page;
- form action is `/cgi-bin/luci/admin/wizard`;
- `_csrf` and `salt` are present;
- `token` is absent;
- stock factory password transform is `SHA256(password + salt)`;
- POST to `/cgi-bin/luci/admin/wizard` returns 302 and issues `sysauth`.

### 2. First-run in progress

After the administrator password is created but before the setup wizard is finalized:

- the router still routes unauthenticated users to the wizard;
- login form has `salt` and `token`;
- configured-login transform is:
  1. `h1 = SHA256(password + salt)`
  2. `h2 = SHA256(h1 + token)`
- authenticated guide routes and the predicted CBI field names are reachable.

### 3. Configured

After Summary/finalization:

- the factory form is gone;
- unauthenticated GET returns the normal login form;
- form action is `/cgi-bin/luci/`;
- `token` is present;
- the same two-stage configured-login transform succeeds and issues `sysauth`.

## Factory setup physically confirmed

The pre-hardware request contract was replayed on the physical router and accepted for:

- Router mode;
- timezone;
- WAN DHCP;
- Wi-Fi 2.4 GHz and 5 GHz fields;
- Summary/finalizer.

The physical Summary response rendered:

`/cgi-bin/luci/admin/servicectl/restart/network,wireless,luci,system`

Stock client-side code calls it with POST and a token.

The physical router accepted that restart request, reported work on `/etc/config/network` and `/etc/config/wireless`, became temporarily unreachable, then returned to the normal configured login state.

## Cold-boot persistence physically confirmed

After full power removal and power-on:

- the configured Wi-Fi network returned;
- the client obtained a DHCP address in `192.168.10.0/24`;
- `192.168.10.1:80` became reachable again;
- the router remained in configured state rather than returning to factory setup.

This confirms physical Wi-Fi/LAN persistence for the tested target. Internal UCI values were not read directly from the physical router.

## Already-configured WAN flow physically confirmed

On an already configured router:

1. normal login with the existing administrator password succeeded;
2. WAN detail page returned HTTP 200;
3. expected DHCP fields were present:
   - `cbid.network.wan.proto`
   - `cbid.network.wan.hostname`
   - `cbid.network.wan._proto2_1`
4. current hostname was read as `R26`;
5. hostname was changed to a temporary marker and POST returned HTTP 200;
6. a fresh GET read the temporary value back;
7. the original hostname was restored;
8. a final GET read `R26` back.

For this hostname-only mutation the response did not render a separate `servicectl/restart/...` path. Do not generalize this to WAN protocol changes.

## Not yet physically closed

- DHCP -> Static -> DHCP protocol round trip;
- PPPoE;
- a live WAN peer and Internet validation;
- other Cudy hardware revisions or models;
- other R26 firmware versions on physical hardware;
- browser/Web Demo end-to-end against the physical router;
- direct-browser HTTPS-to-local-HTTP security constraints.

## Support rule

A rehost/firmware result is evidence about the management contract, not physical-device support by itself.

Mark a device path supported only after the relevant physical flow is tested for the concrete vendor + model + hardware revision + firmware family.
