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
    @State private var confirmPassword = ""
    @State private var physicalV1Confirmed = false
    @State private var passwordWriteConfirmation = false
    @State private var draftWANMode: DraftWANMode = .dhcp
    @State private var draftPPPoEUser = ""
    @State private var draftPPPoEPass = ""
    @State private var draftStaticIP = ""
    @State private var draftStaticMask = ""
    @State private var draftStaticGateway = ""
    @State private var draftSSID24 = ""
    @State private var draftKey24 = ""
    @State private var draftSSID5 = ""
    @State private var draftKey5 = ""
    @State private var draftResult: String?

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
                    if probe.factoryPasswordFormDetected {
                        Text("Штатная форма первоначальной регистрации администратора обнаружена.")
                            .font(.footnote)
                        Toggle("Подтверждаю: на наклейке WR3000 V1.0", isOn: $physicalV1Confirmed)
                        SecureField("Повторите новый пароль", text: $confirmPassword)
                        Button("Создать пароль администратора (запись)") {
                            passwordWriteConfirmation = true
                        }
                        .disabled(busy || !physicalV1Confirmed || password.isEmpty || password != confirmPassword)
                        .confirmationDialog(
                            "Изменить пароль администратора WR3000?",
                            isPresented: $passwordWriteConfirmation,
                            titleVisibility: .visible
                        ) {
                            Button("Создать пароль (одна попытка)", role: .destructive) {
                                let newPassword = password
                                password = ""
                                confirmPassword = ""
                                busy = true
                                Task {
                                    await probe.run(host: host, username: username,
                                                    password: newPassword, factoryPasswordSetup: true)
                                    busy = false
                                }
                            }
                        } message: {
                            Text("Будет отправлена команда изменения пароля на локальный WR3000 V1. WAN и Wi-Fi не меняются. Реальное выполнение ещё не подтверждено на железе.")
                        }
                    }
                    Text("Запись настроек отключена. Приложение не сбрасывает роутер и не меняет WAN/Wi-Fi.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Быстрая настройка — локальный предпросмотр") {
                    Picker("Тип WAN", selection: $draftWANMode) {
                        ForEach(DraftWANMode.allCases) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    if draftWANMode == .pppoe {
                        TextField("Логин PPPoE", text: $draftPPPoEUser)
                            .textInputAutocapitalization(.never)
                        SecureField("Пароль PPPoE", text: $draftPPPoEPass)
                    } else if draftWANMode == .staticIP {
                        TextField("IPv4", text: $draftStaticIP)
                            .keyboardType(.numbersAndPunctuation)
                        TextField("Маска", text: $draftStaticMask)
                            .keyboardType(.numbersAndPunctuation)
                        TextField("Шлюз", text: $draftStaticGateway)
                            .keyboardType(.numbersAndPunctuation)
                    }
                    TextField("SSID 2,4 ГГц", text: $draftSSID24)
                        .textInputAutocapitalization(.never)
                    SecureField("Пароль Wi-Fi 2,4 ГГц", text: $draftKey24)
                    TextField("SSID 5 ГГц", text: $draftSSID5)
                        .textInputAutocapitalization(.never)
                    SecureField("Пароль Wi-Fi 5 ГГц", text: $draftKey5)
                    Button("Проверить проект настроек (без отправки)") {
                        let draft = QuickSetupDraft(
                            wanMode: draftWANMode,
                            pppoeUsername: draftPPPoEUser, pppoePassword: draftPPPoEPass,
                            staticIP: draftStaticIP, staticMask: draftStaticMask,
                            staticGateway: draftStaticGateway,
                            ssid24: draftSSID24, key24: draftKey24,
                            ssid5: draftSSID5, key5: draftKey5
                        )
                        draftResult = draft.redactedSummary()
                    }
                    if let draftResult {
                        Text(draftResult).font(.footnote)
                    }
                    Text("WAN/Wi-Fi не записываются на роутер: точный контракт set_conf/apply пока не прошёл проверку.")
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
