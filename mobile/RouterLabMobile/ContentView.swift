import SwiftUI
import WebKit

// One pilot target. iPhone must already be on the Netis Wi-Fi.
// The real HTML panel is injected into the stock router page.
struct RouterWebView: UIViewRepresentable {
    let session: RouterSession
    func makeUIView(context: Context) -> WKWebView { session.makeWebView() }
    func updateUIView(_ view: WKWebView, context: Context) {}
}

struct ContentView: View {
    @StateObject private var session = RouterSession()
    @State private var routerAddress = RouterSession.lastWorkingAddress

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("RouterLab · Netis N2").font(.headline)
                Spacer()
                Text("iOS Pilot").font(.caption).foregroundColor(.secondary)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)

            HStack(spacing: 8) {
                TextField("Адрес роутера", text: $routerAddress)
                    .font(.system(.footnote, design: .monospaced))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("routerAddress")
                Button("Открыть") { session.open(routerAddress) }
                    .accessibilityIdentifier("openRouter")
                Button("Обновить") { session.open(session.address) }
                    .accessibilityIdentifier("refreshRouter")
            }
            .buttonStyle(.bordered)
            .padding(.horizontal, 10).padding(.bottom, 7)

            // A full-size WKWebView, not an iframe or a remote hosted panel.
            // Network requests and the Shadow DOM control panel share the router origin.
            RouterWebView(session: session)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            Text(session.state)
                .font(.caption2)
                .foregroundColor(.secondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 5)
        }
        .onOpenURL { url in
            guard let address = RouterLabDeepLink.routerAddress(from: url) else { return }
            routerAddress = address
            session.open(address)
        }
    }
}
