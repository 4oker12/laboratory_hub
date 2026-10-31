import SwiftUI
import WebKit

struct RouterWebView: UIViewRepresentable {
    let session: RouterSession
    func makeUIView(context: Context) -> WKWebView { session.makeWebView() }
    func updateUIView(_ view: WKWebView, context: Context) {}
}

struct ContentView: View {
    @StateObject private var session = RouterSession()
    @State private var showTechnician = false
    @State private var showRouterPage = false
    @State private var showInputs = false
    @State private var showScenario = false
    @State private var exportFile: URL?

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 9) {
                Image(systemName: "wifi.router").font(.title2)
                Text("RouterLab").font(.title3.bold())
                Spacer()
                if showTechnician {
                    Text("Лаборатория").font(.caption).foregroundColor(.secondary)
                }
            }.padding(.horizontal, 16).padding(.top, 14)

            if !showTechnician {
                VStack(alignment: .leading, spacing: 17) {
                    Text("Настройка интернета")
                        .font(.system(size: 29, weight: .bold))
                    Text("Подключите телефон к Wi-Fi роутера. Остальное RouterLab проверит автоматически.")
                        .font(.subheadline).foregroundColor(.secondary)
                    if !session.detectedDevice.isEmpty {
                        Label(session.detectedDevice, systemImage: "checkmark.circle")
                            .foregroundColor(.green)
                    }
                    if !session.detectedBuild.isEmpty {
                        Text("Прошивка: Build \(session.detectedBuild)")
                            .font(.caption).foregroundColor(.secondary)
                    }
                    Text(session.consumerMessage)
                        .font(.subheadline)
                        .accessibilityIdentifier("customerStatus")
                    Button {
                        session.beginConsumerSetup()
                    } label: {
                        HStack {
                            Spacer()
                            Text("Проверить роутер")
                            Image(systemName: "arrow.right")
                            Spacer()
                        }
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .accessibilityIdentifier("beginSetup")
                    // Until firmware-specific WAN/bootstrap and read-back are proven,
                    // there is intentionally no "Internet configured" button/state.
                    Button(showRouterPage ? "Скрыть страницу роутера" : "Открыть штатные настройки") {
                        showRouterPage.toggle()
                    }
                    .buttonStyle(.bordered)
                }
                .padding(19)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.regularMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .padding(.horizontal, 12)
            } else {
                technicianControls
            }

            // WKWebView is always instantiated even when the stock page is hidden.
            // This is a local router page, not an iframe on the public launcher.
            RouterWebView(session: session)
                .frame(height: (showRouterPage || showTechnician) ? nil : 2)
                .opacity((showRouterPage || showTechnician) ? 1 : 0.01)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 8)
                .accessibilityHidden(!(showRouterPage || showTechnician))

            Button(showTechnician ? "Вернуться к простой настройке" : "Для специалиста") {
                showTechnician.toggle()
                showRouterPage = showTechnician
            }
            .font(.caption)
            .foregroundColor(.secondary)
            .padding(.bottom, 8)
        }
        .onOpenURL { url in
            if let address = RouterLabDeepLink.routerAddress(from: url) {
                session.open(address)
                session.beginConsumerSetup()
            } else {
                session.consumerMessage = "Ссылка не подходит: допускается только локальный IP роутера."
            }
        }
        .sheet(isPresented: $showScenario) { scenarioSheet }
    }

    private var technicianControls: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                TextField("http://192.168.0.1", text: $session.address)
                    .font(.system(.footnote, design: .monospaced))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textFieldStyle(.roundedBorder)
                Button("Открыть") { session.open(session.address) }
                    .buttonStyle(.borderedProminent)
            }
            HStack(spacing: 7) {
                Button {
                    if session.recording { session.stopAndReport() }
                    else { session.startRecording() }
                } label: {
                    Label(session.recording ? "Стоп" : "Запись", systemImage: "record.circle")
                }
                Button {
                    if session.replaying { session.stopAndReport() }
                    else { session.startReplay() }
                } label: {
                    Label(session.replaying ? "Стоп" : "Повтор", systemImage: "play.fill")
                }
                .disabled(session.steps.isEmpty && !session.replaying)
                Button { showInputs.toggle() } label: { Image(systemName: "key.fill") }
                Button { showScenario = true } label: { Label("\(session.steps.count)", systemImage: "list.number") }
            }
            .buttonStyle(.bordered).controlSize(.small)

            if showInputs {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Тестовые параметры хранятся только в памяти")
                        .font(.caption).foregroundColor(.secondary)
                    SecureField("Пароль администратора", text: Binding(
                        get: { session.adminPassword }, set: { session.adminPassword = $0 }))
                    TextField("Название Wi-Fi", text: Binding(
                        get: { session.wifiSSID }, set: { session.wifiSSID = $0 }))
                    SecureField("Пароль Wi-Fi", text: Binding(
                        get: { session.wifiPassword }, set: { session.wifiPassword = $0 }))
                    TextField("PPPoE логин", text: Binding(
                        get: { session.wanUsername }, set: { session.wanUsername = $0 }))
                    SecureField("PPPoE пароль", text: Binding(
                        get: { session.wanPassword }, set: { session.wanPassword = $0 }))
                }.textFieldStyle(.roundedBorder)
            }
            Text(session.state).font(.caption).lineLimit(3)
        }
        .padding(.horizontal, 12)
    }

    private var scenarioSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 10) {
                Text("Записано \(session.steps.count) действий. Секреты заменяются переменными.")
                    .font(.footnote).foregroundColor(.secondary)
                List(Array(session.steps.enumerated()), id: \.element.id) { index, step in
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(index + 1). \(step.kind.uppercased()) · \(step.label ?? "элемент")")
                            .font(.subheadline)
                        Text(step.selector).font(.caption.monospaced()).foregroundColor(.secondary)
                        if let placeholder = step.placeholder {
                            Text("Переменная: \(placeholder)").font(.caption).foregroundColor(.orange)
                        }
                    }
                }
                if let exportFile = exportFile {
                    ShareLink(item: exportFile, preview: SharePreview("RouterLab Mobile steps")) {
                        Label("Поделиться JSON", systemImage: "square.and.arrow.up")
                    }.padding(14)
                }
            }
            .navigationTitle("Сценарий")
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button("Закрыть") { showScenario = false }
            }}
        }
        .onAppear { exportFile = session.exportScenario() }
    }
}