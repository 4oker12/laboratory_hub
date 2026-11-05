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
    @State private var newAdminPassword = ""
    @State private var newAdminConfirmation = ""
    @State private var exportFile: URL?
    @State private var previousFile: URL?
    @State private var busy = false
    @State private var autoDiscovered = false
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

    private func rediscover() {
        busy = true
        password = ""
        newAdminPassword = ""
        newAdminConfirmation = ""
        Task {
            await probe.discover(host: host)
            busy = false
        }
    }

    private func signIn() {
        let submittedPassword = password
        password = ""
        busy = true
        Task {
            await probe.signIn(host: host, username: username, password: submittedPassword)
            busy = false
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Роутер") {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Cudy WR3000").font(.headline)
                            Text("RouterLab · собственный интерфейс")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if busy { ProgressView() }
                    }
                    TextField("Локальный IP", text: $host)
                        .keyboardType(.numbersAndPunctuation)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(busy)
                    Button(busy ? "Определение..." : "Проверить состояние заново") {
                        rediscover()
                    }.disabled(busy)
                    Text(probe.status).font(.footnote)
                }

                switch probe.entryState {
                case .idle, .checking:
                    Section("Определение состояния") {
                        ProgressView("Проверяем штатную страницу Cudy...")
                        Text("Пока ничего не меняем на роутере.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                case .createPassword:
                    Section("Первая настройка · создание пароля") {
                        Text("Роутер показывает заводскую форму создания пароля администратора.")
                            .font(.footnote)
                        SecureField("Создайте пароль администратора", text: $newAdminPassword)
                            .textContentType(.newPassword)
                        SecureField("Повторите новый пароль", text: $newAdminConfirmation)
                            .textContentType(.newPassword)
                        Button("Проверить ввод и записать диагностику") {
                            probe.prepareFactoryPassword(newAdminPassword,
                                                         confirmation: newAdminConfirmation)
                            newAdminPassword = ""
                            newAdminConfirmation = ""
                        }
                        Text("В этой тестовой сборке отправка нового пароля на роутер отключена: штатный запрос первого запуска ещё не подтверждён. Это реальное распознавание формы, не симуляция создания.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                case .signIn:
                    Section("Роутер настроен · вход") {
                        TextField("Логин администратора", text: $username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("Пароль администратора", text: $password)
                            .textContentType(.password)
                        Button(busy ? "Вход..." : "Войти через RouterLab") {
                            signIn()
                        }.disabled(busy || password.isEmpty)
                        Text("Вход выполняется через проверяемый механизм LuCI. Если сервер отвергнет его, диагностический журнал сохранит причину без пароля.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                case .connected:
                    Section("Сессия") {
                        Label("Авторизация подтверждена", systemImage: "checkmark.shield")
                        Text("Считывание статуса выполнено. Запись WAN/Wi-Fi пока выключена.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                case .unknown:
                    Section("Не удалось распознать интерфейс") {
                        Text("Ни заводская форма, ни стандартный вход не подтверждены. Экспортируйте журнал: в нём будут имена полей, тип ответа и шаг распознавания.")
                            .font(.footnote)
                    }
                case .unreachable:
                    Section("Нет подключения к роутеру") {
                        Text("Подключитесь к Wi-Fi WR3000, проверьте LAN IP и нажмите «Проверить состояние заново».")
                            .font(.footnote)
                    }
                }

                if probe.entryState == .connected {
                    Section("Быстрая настройка · локальный предпросмотр") {
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
                        if let draftResult { Text(draftResult).font(.footnote) }
                        Text("WAN и Wi-Fi в этом режиме не записываются на роутер.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }

                Section("Диагностика · журнал") {
                    Text("Событий: \(probe.records.count). Последняя сессия сохраняется на iPhone; при повторном обнаружении предыдущая переносится в отдельный файл.")
                        .font(.footnote)
                    Button("Подготовить JSON для экспорта") {
                        exportFile = probe.exportFile()
                    }
                    if let exportFile {
                        ShareLink(item: exportFile) {
                            Label("Поделиться журналом", systemImage: "square.and.arrow.up")
                        }
                    }
                    Button("Показать предыдущий журнал") {
                        previousFile = probe.exportPreviousFile()
                    }
                    if let previousFile {
                        ShareLink(item: previousFile) {
                            Label("Экспорт предыдущей сессии", systemImage: "clock.arrow.circlepath")
                        }
                    }
                    ForEach(Array(probe.records.suffix(35).reversed())) { record in
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(record.phase) · \(record.outcome)")
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                            Text("\(record.requestMethod ?? "—") \(record.path) | HTTP \(record.httpStatus.map(String.init) ?? "—") | \(record.durationMs) мс | \(record.bytes) Б")
                                .font(.caption2).foregroundStyle(.secondary)
                            if let mime = record.responseMimeType {
                                Text("Ответ: \(mime)")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                    Text("Не сохраняются содержимое ответов, пароли, значения токенов и cookie. Фиксируются имена полей и безопасные признаки ответов.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("RouterLab · WR3000")
            .task {
                guard !autoDiscovered else { return }
                autoDiscovered = true
                busy = true
                await probe.discover(host: host)
                busy = false
            }
        }
    }
}
