# RouterLab App Clip: link-first delivery checkpoint

The original mobile prototype described a subscriber receiving a link, joining the router Wi-Fi, and starting RouterLab without preinstalling the full app. Its README explicitly identified App Clip as the intended iPhone delivery mechanism. PR #7 deliberately switched to a signed full IPA to verify the physical Netis CGI path first; the IPA remains the engineering control build.

## Code shared with the full app

The experimental App Clip target in `project-with-appclip.yml` now uses the same `ContentView.swift`, `RouterSession.swift`, `RouterLabNetisFW4.js` and `RouterLabNetisPanel.js` as the full app. It starts bounded local Netis discovery, requires `login.cgi` success before showing configured-state data, and reads WAN, both WLAN bands and IGMP. The stock router page remains covered by RouterLab UI. The clip sets a read-only flag before page scripts load; its factory form and Apply path are disabled. The full app keeps its existing behavior.

An HTTPS invocation ending in `/connect` starts discovery only. It carries no router IP, password or command. The hostname is supplied by the future App Clip experience, not by this repository. `https://routerlab.example/connect` is a placeholder, not a working link.

## Delivery gates

1. Unsigned Simulator and iPhone builds in GitHub Actions prove compilation only. The existing Sideloadly full-app IPA does not prove App Clip installation or link invocation.
2. For a development test, archive the parent app with the embedded App Clip, export a *separately signed* Development or Ad Hoc App Clip, install it on the iPhone, and register a local experience under iOS Developer settings. Apple documents QR/NFC local invocation without public release; Safari Smart App Banner testing has publication prerequisites.
3. For subscribers, register the app and App Clip in App Store Connect with an Apple Developer Program membership, sign both targets with their correct identifiers and capabilities, upload the parent archive, configure a default App Clip experience and release after review. A provider-owned HTTPS site needs Associated Domains on both targets, an AASA file and a Smart App Banner. Apple also offers a generated default App Clip link after publication.
4. The phone needs connectivity to obtain the App Clip. It then needs permission for the local network and a connection to the Netis Wi-Fi for `http://192.168.2.1` CGI access. A factory router without internet may require acquiring the clip over cellular or another network *before* joining its Wi-Fi; this remains a physical test.

The App Clip `Info.plist` already declares local-network usage and permits HTTP inside WKWebView. These settings and same-origin CGI behavior still require a signed-device test. The iOS 16 deployment target imposes the 15 MB App Clip limit; measure the thinned signed variant before distribution. No App Store Connect record, real provider domain, signing profiles or public experience are present here.

Apple references: [create App Clip](https://developer.apple.com/documentation/appclip/creating-an-app-clip-with-xcode), [configure experiences](https://developer.apple.com/documentation/appclip/configuring-the-launch-experience-of-your-app-clip), [test local experiences](https://developer.apple.com/documentation/appclip/testing-the-launch-experience-of-your-app-clip), [associate website](https://developer.apple.com/documentation/appclip/associating-your-app-clip-with-your-website), [size limits](https://developer.apple.com/documentation/appclip/choosing-the-right-functionality-for-your-app-clip), [local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).
