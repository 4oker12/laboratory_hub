# RouterLab App Clip — engineering checkpoint

Updated 2026-11-03. The code and unsigned builds pass CI. The Sideloadly route was physically tested and did not invoke an App Clip.

| State | Evidence |
|---|---|
| GREEN — current unsigned CI | Commit `7091f3e0e4167e4521a08863cdbef3d3628ddae0`, [Actions run 41603646499](https://github.com/4oker12/laboratory_hub/actions/runs/41603646499): Chromium/Python tests, project validation, unsigned iOS Simulator, unsigned iPhone parent and embedded App Clip builds all passed. Nine targeted signing tests passed locally with `python -m unittest discover -s mobile/tests -p test_appclip_signing.py -v`. |
| YELLOW — signed export | The manual workflow is opt-in and has not been dispatched. No two valid parent/Clip profiles plus test device UDID are available for it. |
| RED — Sideloadly physical route | The PR #15 standalone unsigned IPA (239335 bytes; MD5 `98CA3253A5186BF9035C26F88D9DD766`) matches Sideloadly's recorded input. After installation, Local Experience was saved with the QR prefix and Sideloadly's final bundle ID. The QR opened the `example.com` page in Safari, not an App Clip card. Reinstalling the IPA and registering the local experience again produced the same result. Sideloadly appended a suffix to the bundle IDs, leaving the installed full-app ID and Clip ID outside the expected parent-plus-Clip relationship. This identifies a signing/installation-path failure, not a router or QR payload failure; the exact entitlement/caching cause is not independently proven. |
| RED — App Clip router read | No App Clip process launch or real Netis/TP-Link read through the Clip. |

The QR URL `https://example.com/connect` is only a local-experience placeholder. It is not a public RouterLab service. Public Apple default links require App Store Connect configuration and release; a provider-owned domain additionally requires Associated Domains and AASA.

Next physical action requires a correctly signed and cached App Clip from Xcode Development/Ad Hoc export or an equivalent Apple-supported path. Repeat the QR test only after that changes; repeated Sideloadly installs and local-experience registration have already failed. Keep router configuration unchanged.
