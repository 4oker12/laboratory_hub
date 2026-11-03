# RouterLab App Clip — engineering checkpoint

Updated 2026-11-03. This is a code and CI checkpoint; physical App Clip launch remains unverified.

| State | Evidence |
|---|---|
| GREEN — baseline CI | Commit `e289bb7473a880b75875f735ea093859651675fb`, [Actions run 41601466571](https://github.com/4oker12/laboratory_hub/actions/runs/41601466571): Chromium/Python tests, project validation, unsigned iOS Simulator, unsigned iPhone parent and embedded App Clip builds all passed. The earlier run [41595238169](https://github.com/4oker12/laboratory_hub/actions/runs/41595238169) passed on `e437cab9f20daffedc954e944792a4eb64d2682d`. |
| YELLOW — current signing guard | PR #15 adds an exact test-iPhone UDID check for both Apple profiles. Targeted test command: `python -m unittest discover -s mobile/tests -p test_appclip_signing.py -v`. The manual signed workflow is opt-in and has not been dispatched. |
| YELLOW — physical Sideloadly experiment | An older standalone unsigned App Clip IPA from PR #12 reached `Done, 100%` in Sideloadly. This does not establish that iOS cached an App Clip or that QR invocation launched it. It is not evidence for the newer C20-inclusive PR #15 build. |
| RED — signed QR and router read | No verified Apple-signed App Clip, iPhone Local Experience card, App Clip process launch, or real router read through the Clip. No two valid parent/Clip profiles plus test device UDID are available for the manual signing workflow. |

The QR URL `https://example.com/connect` is only a local-experience placeholder. It is not a public RouterLab service. Public Apple default links require App Store Connect configuration and release; a provider-owned domain additionally requires Associated Domains and AASA.

Next physical action: confirm that iPhone Settings → Developer → Local Experiences offers registration. If a correctly signed Clip becomes available, register that local experience and scan the QR from a second screen; record whether the card, Clip process, and read-only Netis CGI response actually appear. Keep router configuration unchanged.
