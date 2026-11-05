import SwiftUI

@main
struct WR3000ProbeApp: App {
    var body: some Scene {
        WindowGroup { ProbeView() }
    }
}

struct ProbeView: View {
    @StateObject private var probe = WR3000Probe()
    @State private var host = "192.168.10.1"
    @State private var username = "admin"
    @State private var password = ""
    @State private var exportFile: URL?
    @State private var previousFile: URL?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Подключение к WR3000 V1") {
                    TextField("LAN IP", text: $host)
                        .keyboardType(.numbersAndPunctuation)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Логин", text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Пароль администратора", text: $password)
                    Button(busy ? "Выполняется..." : "Проверить и авторизоваться") {
                        busy = true
                        let secret = password
                        password = ""
                        Task {
                            await probe.run(host: host, username: username, password: secret)
                            busy = false
                        }
                    }.disabled(busy)
                    Text("Запись настроек отключена. Приложение не сбрасывает роутер и не меняет WAN/Wi-Fi.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Результат") {
                    Text(probe.status)
                    ForEach(probe.records.reversed()) { record in
                        HStack(alignment: .top) {
                            Text(record.phase).font(.caption.monospaced()).frame(width: 120, alignment: .leading)
                            VStack(alignment: .leading) {
                                Text(record.outcome)
                                Text("HTTP \(record.httpStatus.map(String.init) ?? "—") · \(record.durationMs) мс · \(record.bytes) Б")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("Диагностика") {
                    Button("Сформировать JSON-лог") {
                        exportFile = probe.exportFile()
                    }
                    if let exportFile {
                        ShareLink(item: exportFile) {
                            Label("Поделиться / сохранить лог", systemImage: "square.and.arrow.up")
                        }
                    }
                    Button("Найти журнал предыдущего теста") {
                        previousFile = probe.exportPreviousFile()
                    }
                    if let previousFile {
                        ShareLink(item: previousFile) {
                            Label("Экспорт предыдущего журнала", systemImage: "clock.arrow.circlepath")
                        }
                    }
                    Text("Пароль администратора, cookie, CSRF и содержимое ответов не записываются.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("RouterLab · WR3000")
        }
    }
}
