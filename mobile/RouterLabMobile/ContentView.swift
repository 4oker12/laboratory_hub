import SwiftUI
import WebKit

// A link only starts local discovery; it never supplies an IP or credentials.
enum RouterLabInvocation {
    static func startsDiscovery(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        guard parts.scheme?.lowercased() == "https",
              let host = parts.host?.lowercased(),
              parts.user == nil, parts.password == nil,
              parts.port == nil, parts.fragment == nil else { return false }
        // Apple's generated link needs no provider-owned domain. Both forms
        // only start discovery; all query values are ignored.
        return (parts.path == "/connect" && parts.query == nil) ||
            (host == "appclip.apple.com" && parts.path == "/id" &&
             parts.query?.hasPrefix("=") == true)
    }
}

// WKWebView is an origin-bound transport for the router's CGI endpoints.
// The visible RouterLab UI is a full-screen Shadow DOM app, not stock Netis UI.
struct RouterWebView: UIViewRepresentable {
    let session: RouterSession
    func makeUIView(context: Context) -> WKWebView { session.makeWebView() }
    func updateUIView(_ view: WKWebView, context: Context) {}
}

struct ContentView: View {
    @StateObject private var session = RouterSession()
    @State private var routerAddress = RouterSession.lastWorkingAddress
    @State private var showManualAddress = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                Image(systemName: "wifi.router").foregroundColor(.accentColor)
                Text("RouterLab").font(.headline)
                Spacer()
                if session.deviceVerified {
                    Text("Netis N2")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.secondary)
                } else {
                    Text("iOS")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 11)

            ZStack {
                // Always keep the native router origin loaded. Hide it entirely
                // until the CGI fingerprint confirms the supported Netis.
                RouterWebView(session: session)
                    .opacity(session.deviceVerified ? 1 : 0.01)
                    .allowsHitTesting(session.deviceVerified)

                if !session.deviceVerified {
                    VStack(spacing: 16) {
                        Image(systemName: session.isDiscovering ? "antenna.radiowaves.left.and.right" : "wifi.exclamationmark")
                            .font(.system(size: 42))
                            .foregroundColor(.accentColor)
                        Text(session.isDiscovering ? "Ищем ваш роутер" : "Не удалось найти Netis N2")
                            .font(.title2.bold())
                        Text(session.isDiscovering ? session.discoveryProgress : session.state)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                        if session.isDiscovering {
                            ProgressView().padding(.top, 6)
                        } else {
                            Button("Повторить поиск") { session.startDiscovery() }
                                .buttonStyle(.borderedProminent)
                                .accessibilityIdentifier("retryDiscovery")
                        }
                        Button(showManualAddress ? "Скрыть ввод адреса" : "Указать адрес вручную") {
                            showManualAddress.toggle()
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("showManualAddress")
                        if showManualAddress {
                            HStack(spacing: 8) {
                                TextField("http://192.168.2.1", text: $routerAddress)
                                    .keyboardType(.URL)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .textFieldStyle(.roundedBorder)
                                    .accessibilityIdentifier("routerAddress")
                                Button("Открыть") { session.open(routerAddress) }
                                    .buttonStyle(.borderedProminent)
                                    .accessibilityIdentifier("openRouter")
                            }
                        }
                    }
                    .padding(22)
                    .frame(maxWidth: 400)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: .systemBackground))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if session.deviceVerified {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.shield")
                        .foregroundColor(.green)
                    Text("Подтверждён: \(session.verifiedHost)")
                    Spacer()
                    Button("Обновить") { session.open("http://\(session.verifiedHost)") }
                        .font(.caption)
                }
                .font(.caption2)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
            }
        }
        .onOpenURL { url in
            #if !ROUTERLAB_APP_CLIP
            if RouterLabDeepLink.isDiscoveryLink(url) {
                session.startDiscovery()
            } else if let address = RouterLabDeepLink.routerAddress(from: url) {
                routerAddress = address
                session.open(address)
            }
            #endif
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            guard let url = activity.webpageURL,
                  RouterLabInvocation.startsDiscovery(url) else { return }
            session.startDiscovery()
        }
    }
}
