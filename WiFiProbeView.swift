import Foundation
import SwiftUI
import UIKit

struct WiFiProbeSample: Codable, Identifiable {
    var id: UUID
    var timestamp: Date
    var ssid: String?
    var bssid: String?
    var rssi: Int?
    var noise: Int?
    var channel: Int?
    var standard: String?
    var txMbps: Double?
    var rxMbps: Double?
    var x: Double?
    var y: Double?
    var walkedMeters: Double?
    var surveyID: String?
    var method: String

    var snr: Int? {
        guard let rssi, let noise else { return nil }
        let n = rssi - noise
        return (-10...100).contains(n) ? n : nil
    }
    var band: String {
        guard let channel else { return "Нет данных" }
        if (1...14).contains(channel) { return "2,4 ГГц" }
        if (32...177).contains(channel) { return "5 ГГц" }
        return "Не определён"
    }
    var signalAssessment: String {
        if let snr {
            return snr >= 35 ? "Сильное соединение" : snr >= 25 ? "Хороший запас сигнала" :
                snr >= 15 ? "Умеренный запас" : "Малый запас сигнала"
        }
        guard let rssi else { return "Недостаточно данных" }
        return rssi >= -65 ? "Сильный сигнал" :
            rssi >= -75 ? "Средний сигнал" : "Слабый сигнал"
    }
}

enum ProbeParseError: LocalizedError {
    case wrongFormat, noMeasurements, unsafeInput
    var errorDescription: String? {
        switch self {
        case .wrongFormat: return "Нужен вывод команды NetCheck WiFi Probe (начало NCWIFI_V1)."
        case .noMeasurements: return "Команда не вернула подтверждённых значений RSSI, Noise, Channel или Tx/Rx."
        case .unsafeInput: return "Ответ команды превышает разрешённый размер."
        }
    }
}

enum ProbeParser {
    static func parse(_ text: String) throws -> WiFiProbeSample {
        guard text.utf8.count <= 8192 else { throw ProbeParseError.unsafeInput }
        let rows = text.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false)
        guard rows.first?.trimmingCharacters(in: .whitespacesAndNewlines) == "NCWIFI_V1" else {
            throw ProbeParseError.wrongFormat
        }
        var values = [String:String]()
        let keys: Set<String> = ["ssid","bssid","rssi","noise","channel","standard","tx","rx"]
        for raw in rows.dropFirst().prefix(24) {
            guard let index = raw.firstIndex(of: "=") else { continue }
            let key = String(raw[..<index]).lowercased().trimmingCharacters(in:.whitespaces)
            guard keys.contains(key) else { continue }
            let val = String(raw[raw.index(after:index)...]).trimmingCharacters(in:.whitespacesAndNewlines)
            if !values.keys.contains(key) { values[key] = String(val.prefix(256)) }
        }
        func int(_ key:String,_ range:ClosedRange<Int>) -> Int? {
            guard let value = values[key], let x = Int(value), range.contains(x) else { return nil }
            return x
        }
        func rate(_ key:String) -> Double? {
            guard let raw = values[key]?.lowercased(), !raw.isEmpty else { return nil }
            // Shortcuts may return numbers or formatted link rates, not throughput.
            let regex = try! NSRegularExpression(pattern:"[-+]?[0-9]+(?:[.,][0-9]+)?")
            let span = NSRange(raw.startIndex..<raw.endIndex,in:raw)
            guard let match = regex.firstMatch(in:raw,range:span),
                  let range = Range(match.range,in:raw),
                  let parsed = Double(raw[range].replacingOccurrences(of:",",with:".")) else { return nil }
            let mbps = raw.contains("gb") ? parsed * 1000 : parsed
            return (0...100000).contains(mbps) ? mbps : nil
        }
        func string(_ key:String) -> String? {
            guard let s = values[key], !s.isEmpty, s != "-", s != "(null)" else { return nil }
            return s
        }
        let rssi = int("rssi", -110 ... -1)
        let noise = int("noise", -120 ... -1)
        let channel = int("channel", 1 ... 233)
        let tx = rate("tx"), rx = rate("rx")
        guard rssi != nil || noise != nil || channel != nil || tx != nil || rx != nil else {
            throw ProbeParseError.noMeasurements
        }
        return WiFiProbeSample(
            id:UUID(),timestamp:Date(),ssid:string("ssid"),bssid:string("bssid"),
            rssi:rssi,noise:noise,channel:channel,standard:string("standard"),
            txMbps:tx,rxMbps:rx,x:nil,y:nil,walkedMeters:nil,surveyID:nil,
            method:"Apple Shortcuts · Get Network Details"
        )
    }
}

@MainActor
final class WiFiProbeStore: ObservableObject {
    @Published private(set) var samples = [WiFiProbeSample]()
    @Published var status = "Нажмите «Измерить» для запуска системной команды."
    @Published var showHelp = false
    @Published private(set) var pending = false
    private let storage: URL
    private var request: (ticket:String,started:Date,x:Double?,y:Double?,meters:Double?,surveyID:String?)?
    static let shortcutName = "NetCheck WiFi Probe"

    init() {
        let folder = FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0]
        storage = folder.appendingPathComponent("NetCheck-WiFiProbe-Readings.json")
        if let data = try? Data(contentsOf:storage),
           let saved = try? JSONDecoder().decode([WiFiProbeSample].self,from:data) {
            samples = Array(saved.suffix(250))
        }
    }

    var last: WiFiProbeSample? { samples.last }
    func samplesForSurvey(_ id: String) -> [WiFiProbeSample] {
        samples.filter { $0.surveyID == id && $0.x != nil && $0.y != nil }
    }

    private func save(_ item: WiFiProbeSample) {
        samples.append(item)
        if samples.count > 250 { samples.removeFirst(samples.count - 250) }
        if let encoded = try? JSONEncoder().encode(samples) {
            try? encoded.write(to: storage,options:.atomic)
        }
        status = "Замер записан: \(item.signalAssessment). Снимок не обновляется автоматически."
    }

    func start(x:Double? = nil,y:Double? = nil,meters:Double? = nil,surveyID:String? = nil) {
        let ticket = UUID().uuidString
        request = (ticket,Date(),x,y,meters,surveyID)
        pending = true
        var components = URLComponents()
        components.scheme = "shortcuts"
        components.host = "x-callback-url"
        components.path = "/run-shortcut"
        // Result is appended to the x-success callback by Shortcuts.
        let callback = "netcheck-probe://callback?ticket=\(ticket)"
        let cancel = "netcheck-probe://cancel?ticket=\(ticket)"
        let failure = "netcheck-probe://error?ticket=\(ticket)"
        components.queryItems = [
            URLQueryItem(name:"name",value:Self.shortcutName),
            URLQueryItem(name:"x-success",value:callback),
            URLQueryItem(name:"x-cancel",value:cancel),
            URLQueryItem(name:"x-error",value:failure)
        ]
        guard let url = components.url else {
            status = "Ошибка формирования ссылки для Shortcuts"
            pending = false
            return
        }
        status = "Ожидаем результат Apple Shortcuts. Если команда не установлена — откройте инструкцию."
        UIApplication.shared.open(url) { [weak self] opened in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if !opened {
                    self.pending = false
                    self.request = nil
                    self.status = "Не удалось открыть приложение «Команды»."
                }
            }
        }
    }

    func receive(url:URL) {
        guard url.scheme == "netcheck-probe",
              ["callback","cancel","error"].contains(url.host ?? ""),
              let c = URLComponents(url:url,resolvingAgainstBaseURL:false),
              let ticket = c.queryItems?.first(where:{$0.name=="ticket"})?.value,
              let req = request, ticket == req.ticket,
              Date().timeIntervalSince(req.started) < 300 else {
            status = "Отклонён устаревший или неподтверждённый ответ Shortcuts."
            return
        }
        pending = false
        request = nil
        if url.host == "cancel" {
            status = "Измерение отменено."
            return
        }
        if url.host == "error" {
            status = "Команда завершилась с ошибкой. Проверьте установку и вывод команды."
            return
        }
        guard let raw = c.queryItems?.first(where:{$0.name=="result"})?.value else {
            status = "Команда завершилась без текстового результата. В конце должно быть действие «Остановить и вывести»."
            return
        }
        do {
            var sample = try ProbeParser.parse(raw)
            sample.x = req.x
            sample.y = req.y
            sample.walkedMeters = req.meters
            sample.surveyID = req.surveyID
            save(sample)
        } catch {
            status = "Ошибка разбора Shortcuts: \(error.localizedDescription)"
        }
    }

    func paste(_ text:String, x:Double? = nil,y:Double? = nil,meters:Double? = nil,surveyID:String? = nil) {
        do {
            var sample = try ProbeParser.parse(text)
            sample.x = x
            sample.y = y
            sample.walkedMeters = meters
            sample.surveyID = surveyID
            save(sample)
        } catch {
            status = "Ошибка импорта: \(error.localizedDescription)"
        }
    }

    func removeHistory() {
        samples = []
        try? FileManager.default.removeItem(at:storage)
        status = "История локально удалена."
    }
}

struct WiFiProbeView: View {
    @ObservedObject var probe: WiFiProbeStore
    @State private var manual = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment:.leading,spacing:14) {
                    Label("Wi-Fi прямо на iPhone",systemImage:"waveform.path.ecg")
                        .font(.title2.bold())
                    Text("RSSI, шум, SNR, канал и Wi-Fi-линк из системной команды Apple. Это измерение текущего подключения, не сканер соседних сетей.")
                        .font(.subheadline)
                    Button {
                        probe.start()
                    } label: {
                        Label("Измерить через Shortcuts",systemImage:"bolt.fill")
                            .frame(maxWidth:.infinity)
                    }.buttonStyle(.borderedProminent)
                    Text(probe.status)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let sample = probe.last {
                        metrics(sample)
                    } else {
                        Text("Пока нет измерений. Здесь не показываются придуманные показатели.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    DisclosureGroup("Как установить NetCheck WiFi Probe",isExpanded:$probe.showHelp) {
                        VStack(alignment:.leading,spacing:8) {
                            Text("Команду достаточно установить один раз в Apple «Команды». Она работает без учётной записи роутера, камеры и внешнего сервера.")
                            Text("1. Добавьте команду NetCheck WiFi Probe из отдельного подписанного файла Shortcuts. Если подписанная команда отсутствует, создайте её по инструкции в комплекте.")
                            Text("2. В ней используются 8 действий «Получить сведения о сети Wi-Fi»: Network Name, BSSID, RSSI, Noise, Channel Number, TX Rate, RX Rate, Wi-Fi Standard.")
                            Text("3. Сформируйте итоговый Text строго как NCWIFI_V1 и строки вида rssi=значение, затем действие «Остановить и вывести». Название команды должно быть точным.")
                            Text("4. Запустите её в NetCheck. Shortcuts вернёт текст через x-success. Для проверки можно вставить текст вручную ниже.")
                        }
                        .font(.caption)
                    }
                    .padding(12)
                    .background(.gray.opacity(0.07),in:RoundedRectangle(cornerRadius:12))
                    VStack(alignment:.leading,spacing:8) {
                        Text("Резервный импорт результата").font(.headline)
                        TextEditor(text:$manual)
                            .font(.system(.caption,design:.monospaced))
                            .frame(height:95)
                            .overlay(RoundedRectangle(cornerRadius:8).stroke(.gray.opacity(0.3)))
                        HStack {
                            Button("Вставить из буфера") {
                                manual = UIPasteboard.general.string ?? ""
                            }.buttonStyle(.bordered)
                            Button("Сохранить измерение") {
                                probe.paste(manual)
                            }.buttonStyle(.borderedProminent)
                        }
                    }
                    Divider()
                    Text("История измерений").font(.headline)
                    if probe.samples.isEmpty {
                        Text("Нет данных.").foregroundStyle(.secondary)
                    } else {
                        ForEach(probe.samples.reversed().prefix(35)) { sample in
                            HStack {
                                VStack(alignment:.leading,spacing:3) {
                                    Text(sample.timestamp.formatted(date:.abbreviated,time:.shortened))
                                        .font(.caption.bold())
                                    Text(sample.ssid ?? "SSID неизвестен").font(.caption)
                                }
                                Spacer()
                                VStack(alignment:.trailing,spacing:3) {
                                    Text(sample.rssi.map {"\($0) dBm"} ?? "RSSI нет")
                                        .font(.subheadline.monospacedDigit())
                                    Text(sample.channel.map {"Канал \($0)"} ?? "Канал нет")
                                        .font(.caption)
                                }
                            }
                            Divider()
                        }
                        Button("Удалить все сохранённые измерения",role:.destructive) {
                            probe.removeHistory()
                        }.font(.caption)
                    }
                    Text("Данные хранятся только на iPhone. Нет автоматической отправки SSID/BSSID во внешние сервисы. TX/RX — согласованная скорость Wi-Fi-линка, а не скорость интернета. Команда выполняется отдельными запусками.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding()
            }
        }
    }

    private func metric(_ heading:String,_ value:String,_ note:String) -> some View {
        VStack(alignment:.leading,spacing:3) {
            Text(heading).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title2.bold().monospacedDigit())
            Text(note).font(.caption2).foregroundStyle(.secondary)
        }.frame(maxWidth:.infinity,alignment:.leading)
         .padding(12)
         .background(.gray.opacity(0.07),in:RoundedRectangle(cornerRadius:10))
    }

    private func metrics(_ value:WiFiProbeSample) -> some View {
        VStack(alignment:.leading,spacing:10) {
            HStack {
                Text(value.ssid ?? "Wi-Fi подключение").font(.headline)
                Spacer()
                Text(value.band).font(.caption)
            }
            Text(value.signalAssessment).font(.subheadline.bold())
            HStack(spacing:8) {
                metric("Сигнал",value.rssi.map {"\($0) dBm"} ?? "—","RSSI")
                metric("Шум",value.noise.map {"\($0) dBm"} ?? "—","Noise")
            }
            HStack(spacing:8) {
                metric("SNR",value.snr.map {"\($0) dB"} ?? "—","Сигнал минус шум")
                metric("Канал",value.channel.map {"\($0)"} ?? "—",value.band)
            }
            HStack(spacing:8) {
                metric("TX",value.txMbps.map {String(format:"%.0f", $0)+" Мбит/с"} ?? "—","PHY Link Rate")
                metric("RX",value.rxMbps.map {String(format:"%.0f", $0)+" Мбит/с"} ?? "—","PHY Link Rate")
            }
            if let standard = value.standard { Text("Wi-Fi: \(standard)").font(.caption) }
            if value.surveyID != nil { Text("Этот замер привязан к точке обхода.").font(.caption) }
        }
    }
}
