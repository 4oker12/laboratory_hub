import SwiftUI

// Deep links only select a private router address. No script or credentials
// are accepted through URLs to avoid accidental execution from untrusted links.
enum RouterLabDeepLink {
    // Public launch contract for an already-installed app, no IP required:
    // routerlab://discover
    static func isDiscoveryLink(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.scheme?.lowercased() == "routerlab" &&
            parts.host?.lowercased() == "discover" &&
            parts.path.isEmpty &&
            parts.user == nil && parts.password == nil &&
            parts.port == nil && parts.query == nil && parts.fragment == nil
    }
    static func routerAddress(from url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "routerlab",
              components.host?.lowercased() == "open",
              components.path.isEmpty,
              components.user == nil, components.password == nil,
              components.port == nil,
              let items = components.queryItems, items.count == 1,
              items[0].name == "host",
              let host = items[0].value,
              RouterSession.isPrivateIPv4(host) else { return nil }
        return "http://\(host)"
    }
}

@main
struct RouterLabMobileApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}