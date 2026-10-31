import Foundation
import SwiftUI
import WebKit

// Ephemeral entry point. No admin credentials or commands are accepted from URL.
// Until a vendor adapter verifies writes on hardware, this App Clip is read-only.
private enum RouterLabClipLaunch {
    static func routerAddress(from url: URL) -> String? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "https",
              parts.path == "/setup",
              parts.user == nil, parts.password == nil,
              let items = parts.queryItems,
              items.count == 1, items[0].name == "host",
              let host = items[0].value,
              RouterSession.isPrivateIPv4(host) else { return nil }
        return "http://\(host)"
    }
}

private struct RouterClipWebView: UIViewRepresentable {
    let session: RouterSession
    func makeUIView(context: Context) -> WKWebView { session.makeWebView() }
    func updateUIView(_ webView: WKWebView, context: Context) { }
}

private struct ClipHome: View {
    @StateObject private var session = RouterSession()
    @State private var showRouterPage = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("RouterLab").font(.headline)
            Text("Настройка интернета")
                .font(.system(size: 30, weight: .bold))
            Text("Подключитесь к Wi-Fi роутера и нажмите кнопку.")
                .foregroundColor(.secondary)
            if !session.detectedDevice.isEmpty {
                Label(session.detectedDevice, systemImage: "checkmark.circle")
                    .foregroundColor(.green)
            }
            Text(session.consumerMessage)
                .accessibilityIdentifier("customerStatus")
            Button("Проверить роутер") { session.beginConsumerSetup() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .accessibilityIdentifier("beginSetup")
            Button(showRouterPage ? "Скрыть настройки" : "Открыть штатные настройки") {
                showRouterPage.toggle()
            }
                .buttonStyle(.bordered)
            RouterClipWebView(session: session)
                .frame(height: showRouterPage ? 350 : 2)
                .opacity(showRouterPage ? 1 : 0.01)
                .accessibilityHidden(!showRouterPage)
            Spacer(minLength: 0)
        }
        .padding(20)
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            guard let url = activity.webpageURL,
                  let address = RouterLabClipLaunch.routerAddress(from: url) else { return }
            session.open(address)
            session.beginConsumerSetup()
        }
    }
}

@main
struct RouterLabAppClipApp: App {
    var body: some Scene {
        WindowGroup { ClipHome() }
    }
}
