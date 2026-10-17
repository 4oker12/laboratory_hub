# Archer C20 v5 independent-session extension

The current experimental MV3 extension source is at [`extensions/tplink-c20/independent-session`](../../extensions/tplink-c20/independent-session/README.md). The existing assisted native-UI pilot remains at [`extensions/tplink-c20`](../../extensions/tplink-c20/README.md).

The independent-session extension can be loaded unpacked from its directory. It implements a vendor RSA/AES login and verifies authentication through a protected WLAN read. Cookie/session checks fail closed and the extension no longer opens a visible tab to bootstrap cookies.

Physical evidence so far confirms that the Archer C20 v5 is reachable and its CGI/RSA endpoints can return HTTP 200. A zero-ack login reply and HTTP status alone are insufficient. A standalone extension login followed by repeatable protected `READ_WLAN` has not yet been confirmed on the hardware. Automated tests are mocks and must not be described as physical success.

The optional direct read-only hardware probe is `tools/tplink-c20/Run-Physical-Read.ps1`. It is independent of the extension, prompts locally for the password, and never logs the credential or read-back SSIDs.
