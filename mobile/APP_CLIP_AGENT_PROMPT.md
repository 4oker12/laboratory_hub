# Agent prompt — RouterLab App Clip: finish everything possible without paid Apple access

You are continuing an existing RouterLab project in repository 4oker12/laboratory_hub.
Work from feat/routerlab-appclip-signed-ci-gate, based on PR #14 (feat/routerlab-ios-dual-netis-tplink-c20).
Do not restart from a blank example. Read mobile/APP_CLIP.md, mobile/APP_CLIP_LOCAL_TEST.md, mobile/APP_CLIP_SIGNING.md and the existing iOS Actions workflow before making changes.

## Goal

Deliver a reproducible, CI-verified App Clip engineering checkpoint: intact Netis N2 FW4 and TP-Link C20 read-only paths, full iOS app and embedded App Clip compiled by GitHub Actions, correct bundles and entitlements, safe QR local test instructions, and an optional fail-closed manual signing workflow for credentials already available. Do not claim physical success until the actual iPhone 12 launches the App Clip through Local Experience and reads a real router.

## Non-negotiable financial/time constraints

- Budget for new paid services: $0. Do NOT subscribe, enroll, buy, place an order, attach a card, charge credits, or create financial commitments.
- Do NOT initiate Apple Developer Program enrollment or App Store Connect submission, and do not request financial details.
- Do NOT tell the user to wait days/weeks for approval or otherwise defer work. Complete all code/CI/documentation/test work achievable now. Mark Apple signing/physical QR gate BLOCKED only if genuine profiles/device access are absent.
- Use existing GitHub Actions and repository, free/available build/test tools and already-authorized resources. Do not invent workarounds that forge Apple entitlements or evade signing requirements.
- Do not change the user's live Netis/WISP or TP-Link configuration, factory reset, or send speculative CGI SET requests.

## Steps

1. Inspect the complete current PR stack, current branch and CI; reconcile documentation that may describe older checkpoints. Preserve verified physical read-only Netis CGI behavior (iPhone 12, Netis N2 FW4, local IP 192.168.2.1). Do not generalize physical Netis success to C20 or App Clip.
2. Run the existing Chromium/Playwright and Python tests, XcodeGen structure checks, Simulator and unsigned iPhone/embedded-clip builds. Fix observable test/build failures, not arbitrary components. Pin action/tool versions only when required to restore reproducibility.
3. Check child App Clip Info.plist, bundle IDs (dev.routerlab.mobile and dev.routerlab.mobile.Clip), parent-child association entitlement, on-demand target type, embedded resources, link handler and default read-only guard. Explicitly distinguish a local-only QR placeholder from a public service.
4. Validate mobile/scripts/prepare_appclip_signing.py with unit tests: enforce two distinct exact App IDs, same Apple Team, expiry, registered iPhone, method compatibility and correct XcodeGen/export-options output. No secrets in logs.
5. Keep the manually dispatched .github/workflows/routerlab-appclip-signed.yml disabled by default in practice: it requires already-provided certificate and profiles. It must never run on untrusted PRs and must not upload signed artifacts unless the user explicitly opts in. Remember workflow_dispatch becomes available through the default branch after merge.
6. Create/update a small status document with green (CI verified), yellow (code ready, hardware unverified), red (missing Apple signing/device evidence). Include exact Actions run URLs, test commands, revision hashes and sanitized failure evidence.
7. Open one small draft PR to the previous integration branch. Do not merge, publish, buy services or remove prior working builds without explicit approval. If tests cannot be run because of environment constraints, mark them UNVERIFIED instead of claiming success.

## Acceptance criteria

- All accessible no-cost automated checks pass, or errors are listed precisely.
- Signed workflow remains opt-in and fails closed when Apple signing inputs are absent.
- No credentials/SSID/session tokens/raw protected CGI data exposed.
- Real Local Experience remains NOT VERIFIED until signed Clip installed/cached and QR opens Clip (not full app/Safari).
- Deliver exact next physical test the user can perform, and distinguish block caused by Apple signing from a code defect.

## Response format

Report: what changed (paths + PR), exact tests run/results, what is blocked and why, and the minimum next action. Be concise. Do not imply paid Apple registration is a prerequisite for code compilation.

## Context/token efficiency

- Work in small, testable batches. First inspect only changed App Clip/iOS files, PR #15 diff, and relevant workflow logs; do not reload the whole RouterLab/TP-Link reverse-engineering repository on every step.
- Maintain a short checkpoint: current branch/commit, files changed, pass/fail CI checks, physical gates, and exactly one next action. Reuse this checkpoint when continuing in another agent session.
- Use normal/medium reasoning for straightforward file changes and CI review; reserve high-effort reasoning for Apple signing anomalies, WKWebView authentication/session issues, or a failing integration test.
- Never paste megabytes of logs, full HAR, full Xcode output, or secrets into the model context; select the minimal relevant error lines and keep raw artifacts on the trusted CI runner.
