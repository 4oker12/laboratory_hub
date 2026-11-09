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
    @State private var showC20Diagnostics = false
    @State private var showTechnicalJournal = false
    @State private var manualRouterProfile = "tplink-archer-c54"
    @State private var manualRouterAddress = ""
    @State private var showModelOverride = false

    private var manualModelSelector: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("Выбор модели вручную")
                .font(.subheadline.weight(.semibold))
            Text("Выбор назначает адаптер, но сам по себе не подтверждает модель и не разрешает запись.")
                .font(.caption)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Picker("Производитель и модель", selection: $manualRouterProfile) {
                ForEach(session.manualModels) { model in
                    Text(model.name).tag(model.id)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("manualRouterModelPicker")
            Text("Последний доступный адрес: \(session.manualRouterAddressHint)")
                .font(.caption2)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Адрес роутера (если другой): http://192.168.0.1", text: $manualRouterAddress)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("manualRouterIPAddress")
            Button("Выбрать модель и открыть адаптер") {
                let target = manualRouterAddress.trimmingCharacters(in: .whitespacesAndNewlines)
                session.selectRouterModel(manualRouterProfile,
                    at: target.isEmpty ? session.manualRouterAddressHint : target)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("applyManualRouterModel")
        }
        .padding(12)
        .frame(maxWidth: 480)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                Image(systemName: "wifi.router").foregroundColor(.accentColor)
                Text("RouterLab").font(.headline)
                Spacer()
                if session.deviceVerified {
                    Text(session.verifiedDevice)
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
                    .allowsHitTesting(session.deviceVerified && (
                        session.verifiedDevice == "TP-Link Archer C20"
                            ? session.c20PanelReady
                            : session.genericIdentifiedOnly
                                ? (session.genericPanelReady || session.genericStockManual)
                                : true))

                // During a C20 top-level reload WKWebView can briefly paint
                // the stock TP-Link login page before document-end scripts
                // inject RouterLab. Keep it covered until the panel reports
                // its own state. This is independent of Netis.
                if session.deviceVerified &&
                    ((session.verifiedDevice == "TP-Link Archer C20" && !session.c20PanelReady) ||
                     (session.genericIdentifiedOnly &&
                      !session.genericPanelReady && !session.genericStockManual)) {
                    VStack(spacing: 10) {
                        Image(systemName: "wifi.router")
                            .font(.system(size: 28))
                            .foregroundColor(.accentColor)
                        Text("RouterLab").font(.headline)
                        Text("Восстанавливаем интерфейс роутера…")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: .systemBackground))
                    .accessibilityIdentifier("c20NavigationShield")
                }

                if !session.deviceVerified {
                    ScrollView {
                      VStack(spacing: 16) {
                        Image(systemName: session.isDiscovering ? "antenna.radiowaves.left.and.right" : "wifi.exclamationmark")
                            .font(.system(size: 42))
                            .foregroundColor(.accentColor)
                        Text(session.isDiscovering ? "Ищем ваш роутер" : "Не удалось найти поддерживаемый роутер")
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
                        if !session.isDiscovering {
                            VStack(alignment: .leading, spacing: 7) {
                                HStack(spacing: 8) {
                                    Image(systemName: session.passiveFoundLocalPage
                                          ? "network" : "wifi.exclamationmark")
                                        .foregroundColor(.accentColor)
                                    Text(session.passiveFoundLocalPage
                                         ? "Локальная страница отвечает"
                                         : "Локальный интерфейс не отвечает")
                                        .font(.subheadline.bold())
                                }
                                if session.passiveFoundLocalPage {
                                    Text("Адрес страницы: \(session.manualRouterAddressHint)")
                                    Text("Производитель: \(session.passiveVendor.isEmpty ? "не установлен" : session.passiveVendor + " (предположительно)")")
                                    Text("Модель: \(session.passiveModelHint.isEmpty ? "не установлена" : session.passiveModelHint + " (предположительно)")")
                                    Text(session.passivePageDescription)
                                    Text(session.passiveTechnologyDescription)
                                } else {
                                    Text("На проверенных адресах не удалось загрузить веб-страницу. Это не доказывает неисправность роутера: адрес управления может быть другим.")
                                }
                                Text("Ни авторизация, ни совместимость прошивки не подтверждены. RouterLab не отправлял запросы изменения настроек.")
                                    .foregroundColor(.secondary)
                            }
                            .font(.caption)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color(uiColor: .secondarySystemBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .accessibilityIdentifier("unknownDevicePassiveReport")
                            manualModelSelector
                            Button("Копировать диагностику распознавания") {
                                UIPasteboard.general.string = session.identityDiagnosticsText
                            }
                            .buttonStyle(.bordered)
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
                      .frame(maxWidth: .infinity)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: .systemBackground))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if session.verifiedDevice == "TP-Link Archer C20" || (!session.deviceVerified && !session.c20Diagnostics.isEmpty) {
                DisclosureGroup(isExpanded: $showTechnicalJournal) {
                    ScrollView {
                        Text(session.logs.filter { $0.contains("C20_") }.suffix(35).joined(separator: "\n"))
                            .font(.system(size: 10, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .padding(.top, 6)
                    }
                    .frame(maxHeight: 145)
                } label: {
                    Text("Журнал навигации и авторизации · TP-Link")
                        .font(.caption2)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
            }
            // Native C20 diagnostics stay reachable even if the stock router
            // login navigates and recreates its entire WKWebView document.
            if session.deviceVerified && session.verifiedDevice == "TP-Link Archer C20" {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Button(showC20Diagnostics ? "Скрыть диагностику" : "Диагностика · логи") {
                            showC20Diagnostics.toggle()
                        }
                        .font(.caption.weight(.semibold))
                        Spacer()
                        if showC20Diagnostics {
                            Button("Копировать") {
                                UIPasteboard.general.string = session.c20DiagnosticsText
                            }
                            .font(.caption)
                        }
                    }
                    if showC20Diagnostics {
                        Text("Логи сохраняются при переходах между страницами TP-Link. Только коды событий; без паролей и содержимого CGI.")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        ScrollView(.vertical) {
                            Text(session.c20DiagnosticsText)
                                .font(.system(size: 10, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                        .frame(maxHeight: 168)
                        .padding(8)
                        .background(Color(uiColor: .secondarySystemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        HStack {
                            Button("Очистить журнал") { session.clearC20Diagnostics() }
                                .font(.caption2)
                            Spacer()
                            Text("\(session.c20Diagnostics.count) событий")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
            }

            if session.deviceVerified && session.genericIdentifiedOnly {
                DisclosureGroup("Выбрать другую модель", isExpanded: $showModelOverride) {
                    manualModelSelector
                }
                .font(.caption)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
            }

            if session.deviceVerified {
                HStack(spacing: 8) {
                    Image(systemName: session.firmwareVerified ? "checkmark.shield" : "wifi.router")
                        .foregroundColor(session.firmwareVerified ? .green : .orange)
                    Text(session.firmwareVerified ? "Подтверждён: \(session.verifiedHost)" : "Найден: \(session.verifiedHost) · версия уточняется")
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
