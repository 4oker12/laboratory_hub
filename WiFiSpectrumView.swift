import Foundation
import SwiftUI
import Charts
import UniformTypeIdentifiers
import UIKit

// NetCheck's own Swift implementation, informed by public WiFiAnalyzer concepts.
// No GPL source, assets, or Android API code is copied.
// AirPort Utility export contains SSID,BSSID,RSSI,Channel,Time, not BSS airtime.
// Never call the number of BSSIDs "channel utilization %".
struct SpectrumAP: Identifiable, Codable {
    var ssid: String
    var bssid: String
    var rssi: Int
    var channel: Int
    var time: String

    var id: String { bssid.lowercased() }
    var band: Int {
        (1...14).contains(channel) ? 2 : ((32...196).contains(channel) ? 5 : 0)
    }
    var MHz: Int {
        if channel == 14 { return 2484 }
        return band == 2 ? 2407 + channel * 5 : 5000 + channel * 5
    }
    var strength: String {
        rssi >= -65 ? "Сильный" : (rssi >= -76 ? "Средний" : "Слабый")
    }
}

struct SpectrumSample: Identifiable, Codable {
    var id: Int
    var ap: SpectrumAP
}

struct SpectrumSnapshot: Codable {
    var samples: [SpectrumSample]
    var createdAt: Date
}

enum SpectrumCSV {
    enum CSVError: LocalizedError {
        case empty, unreadable, noData
        var errorDescription: String? {
            switch self {
            case .empty: return "Нет текста CSV. Используйте «Поделиться → Копировать» в AirPort Utility."
            case .unreadable: return "Нужен CSV AirPort Utility с колонками SSID, BSSID, RSSI, Channel и Time."
            case .noData: return "Не удалось получить ни одной корректной сети с каналом и RSSI."
            }
        }
    }

    // Conservative RFC4180-style parser: quotes, escaped quotes and newline
    // handling. Reject malformed scan instead of fabricating empty values.
    static func rows(_ text: String) -> [[String]] {
        var out = [[String]]()
        var row = [String]()
        var field = ""
        var quoted = false
        let chars = Array(text)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if quoted {
                if c == "\"" {
                    if i + 1 < chars.count && chars[i + 1] == "\"" {
                        field.append("\"")
                        i += 1
                    } else {
                        quoted = false
                    }
                } else {
                    field.append(c)
                }
            } else if c == "\"" {
                quoted = true
            } else if c == "," || c == ";" {
                row.append(field.trimmingCharacters(in: .whitespacesAndNewlines))
                field = ""
            } else if c == "\n" || c == "\r" {
                row.append(field.trimmingCharacters(in: .whitespacesAndNewlines))
                if row.contains(where: { !$0.isEmpty }) { out.append(row) }
                row = []
                field = ""
                if c == "\r" && i + 1 < chars.count && chars[i + 1] == "\n" { i += 1 }
            } else {
                field.append(c)
            }
            i += 1
        }
        row.append(field.trimmingCharacters(in: .whitespacesAndNewlines))
        if row.contains(where: { !$0.isEmpty }) { out.append(row) }
        return out
    }

    static func parse(_ text: String) throws -> [SpectrumSample] {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CSVError.empty }
        let input = rows(text)
        guard let head = input.first, head.count >= 5,
              head[0].lowercased().contains("ssid"),
              ["bssid","bss"].contains(head[1].lowercased().replacingOccurrences(of: " ", with: "")),
              head[2].lowercased().contains("rssi") else { throw CSVError.unreadable }
        var result = [SpectrumSample]()
        for row in input.dropFirst().prefix(10000) {
            guard row.count >= 5,
                  let rssi = Int(row[2]),
                  (-110 ... -1).contains(rssi),
                  let channel = Int(row[3]),
                  (1...196).contains(channel),
                  !row[1].isEmpty else { continue }
            let ap = SpectrumAP(ssid: row[0].isEmpty ? "(скрытая сеть)" : row[0],
                                bssid: row[1], rssi: rssi, channel: channel, time: row[4])
            guard ap.band != 0 else { continue }
            result.append(SpectrumSample(id: result.count, ap: ap))
        }
        if result.isEmpty { throw CSVError.noData }
        return result
    }
}

struct SpectrumRadio: Identifiable {
    var band: Int
    var ssid: String
    var channel: Int
    var id: Int { band }
}

@MainActor
final class SpectrumModel: ObservableObject {
    @Published var samples = [SpectrumSample]()
    @Published var error = ""
    @Published var source = "Сканирование не загружено"
    @Published var loadedAt: Date?
    @Published var mySSID = ""
    @Published var netisHost = "192.168.2.1"
    @Published var netisStatus = "Текущий канал роутера ещё не прочитан."
    @Published var netisRadios = [SpectrumRadio]()
    @Published var netisBusy = false

    private let saved: URL

    init() {
        let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        saved = folder.appendingPathComponent("NetCheck-AirPort-LastScan.json")
        if let data = try? Data(contentsOf: saved),
           let cache = try? JSONDecoder().decode(SpectrumSnapshot.self, from: data) {
            samples = cache.samples
            loadedAt = cache.createdAt
            source = "Последний импорт AirPort Utility (локально сохранён)"
        }
    }

    var latest: [SpectrumAP] {
        var keyed = [String: SpectrumAP]()
        for item in samples { keyed[item.ap.id] = item.ap }
        return keyed.values.sorted { $0.rssi > $1.rssi }
    }
    var distinctSSIDs: [String] {
        Array(Set(latest.map(\.ssid))).sorted()
    }
    var isLoaded: Bool { !latest.isEmpty }

    func load(_ raw: String) {
        do {
            let parsed = try SpectrumCSV.parse(raw)
            samples = parsed
            loadedAt = Date()
            mySSID = ""
            error = ""
            source = "AirPort Utility · CSV · \(parsed.count) наблюдений"
            let snap = SpectrumSnapshot(samples: parsed, createdAt: Date())
            if let bytes = try? JSONEncoder().encode(snap) {
                try? bytes.write(to: saved, options: .atomic)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func fromClipboard() {
        guard let text = UIPasteboard.general.string else {
            error = "В буфере нет текста. В AirPort Utility нажмите «Поделиться → Копировать»."
            return
        }
        load(text)
    }

    func clear() {
        samples = []
        loadedAt = nil
        mySSID = ""
        source = "Сканирование не загружено"
        error = ""
        try? FileManager.default.removeItem(at: saved)
    }

    func filtered(_ band: Int) -> [SpectrumAP] { latest.filter { $0.band == band } }
    func neighbors(_ band: Int) -> [SpectrumAP] {
        filtered(band).filter { mySSID.isEmpty || $0.ssid != mySSID }
    }

    // An overlap indicator for 2.4GHz, NOT measured airtime or a throughput forecast.
    // Default 20 MHz spectrum assumption because AirPort exports no channel width.
    func overlapScore(_ channel: Int, _ band: Int) -> Double {
        let targetFreq = band == 2 ? 2407 + 5 * channel : 5000 + 5 * channel
        return neighbors(band).reduce(0) { sum, ap in
            let separation = Double(abs(ap.MHz - targetFreq))
            let overlap = band == 2 ? max(0, 1 - separation / 20) : (separation == 0 ? 1.0 : 0.0)
            let weight = max(0.08, min(1.0, Double(ap.rssi + 95) / 45))
            return sum + overlap * weight
        }
    }

    func suggestChannels(_ band: Int) -> [(Int, Double)] {
        let channels = band == 2 ? [1, 6, 11] :
            [36,40,44,48,52,56,60,64,100,104,108,112,116,120,124,128,132,136,140,144,149,153,157,161,165]
        return channels.map { ($0, overlapScore($0, band)) }.sorted { $0.1 < $1.1 }
    }

    // The only supported router read is the previously captured Netis N2 FW4
    // POST /cgi-bin/skk_get.cgi. Never attempts writes or tries credentials.
    private func privateHost(_ s: String) -> Bool {
        let x = s.split(separator: ".", omittingEmptySubsequences: false).compactMap { Int($0) }
        guard x.count == 4, x.allSatisfy({ (0...255).contains($0) }) else { return false }
        return x[0] == 10 || (x[0] == 172 && (16...31).contains(x[1])) ||
            (x[0] == 192 && x[1] == 168)
    }

    private func jsonObject(_ data: Data) throws -> [String: Any] {
        guard data.count < 1_500_000, let raw = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "NetCheck", code: 1,
                          userInfo: [NSLocalizedDescriptionKey:"Некорректный ответ роутера"])
        }
        var output = ""
        var quoted = false, escaped = false
        let chars = Array(raw)
        for (i,c) in chars.enumerated() {
            if quoted {
                output.append(c)
                if escaped { escaped = false }
                else if c == "\\" { escaped = true }
                else if c == "\"" { quoted = false }
            } else if c == "\"" {
                quoted = true
                output.append(c)
            } else if c == "," {
                let following = chars.dropFirst(i+1).first(where: { !$0.isWhitespace })
                if following != "}" && following != "]" { output.append(c) }
            } else {
                output.append(c)
            }
        }
        guard let bytes = output.data(using: .utf8),
              let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
            throw NSError(domain: "NetCheck", code: 2,
                          userInfo: [NSLocalizedDescriptionKey:"Формат ответа Netis не подтверждён"])
        }
        return value
    }

    private func readNetisApp(_ app: String, host: String) async throws -> [String: Any] {
        guard ["base","wlan"].contains(app), privateHost(host),
              let url = URL(string: "http://\(host)/cgi-bin/skk_get.cgi") else {
            throw NSError(domain: "NetCheck", code: 3,
                          userInfo: [NSLocalizedDescriptionKey:"Нужен локальный IPv4-адрес роутера"])
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.setValue("application/x-www-form-urlencoded; charset=UTF-8", forHTTPHeaderField:"Content-Type")
        request.setValue("XMLHttpRequest", forHTTPHeaderField:"X-Requested-With")
        request.httpBody = (app == "base" ? "app=base" :
            "mode_name=skk_get&wl_link=0&app=wlan").data(using: .utf8)
        let (data,response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw NSError(domain: "NetCheck", code: 4,
                          userInfo: [NSLocalizedDescriptionKey:"CGI не ответил HTTP 200"])
        }
        return try jsonObject(data)
    }

    private func field(_ raw: Any?) -> String {
        if let s = raw as? String { return s }
        if let n = raw as? NSNumber { return n.stringValue }
        return ""
    }
    func refreshNetis() async {
        let host = netisHost.trimmingCharacters(in: .whitespacesAndNewlines)
        guard privateHost(host) else {
            netisStatus = "Укажите адрес роутера в частной локальной сети."
            return
        }
        netisBusy = true
        netisStatus = "Читаем только настройки Wi-Fi; ничего не изменяем…"
        defer { netisBusy = false }
        do {
            let base = try await readNetisApp("base",host:host)
            guard field(base["model"]) == "N2",
                  field(base["version"]).hasPrefix("N2-V4."),
                  field(base["vender"]) == "CIS" else {
                netisStatus = "Это не подтверждённый Netis N2 FW4 CIS. Чтение остановлено."
                return
            }
            let wlan = try await readNetisApp("wlan",host:host)
            guard field(wlan["model"]) == "N2",
                  field(wlan["version"]) == field(base["version"]),
                  field(wlan["vender"]) == "CIS",
                  let list = wlan["wlan"] as? [[String: Any]] else {
                netisStatus = "Ответ WLAN не соответствует подтверждённой модели."
                return
            }
            var found = [SpectrumRadio]()
            for (band, idxField) in [(2,"wl2g_idx"),(5,"wl5g_idx")] {
                guard let idx = Int(field(wlan[idxField])), list.indices.contains(idx),
                      let channel = Int(field(list[idx]["channel"])),
                      (1...196).contains(channel) else { continue }
                let encoded = field(list[idx]["ssid"])
                let decoded = Data(base64Encoded:encoded).flatMap { String(data:$0,encoding:.utf8) }
                found.append(SpectrumRadio(band:band,ssid:decoded ?? "(не определён)",channel:channel))
            }
            netisRadios = found
            netisStatus = found.isEmpty ? "Каналы не прочитаны из ответа WLAN." :
                "Netis N2 · \(field(base["version"])) · текущие каналы прочитаны"
        } catch {
            netisStatus = "Чтение Netis не удалось: \(error.localizedDescription). Используйте AirPort CSV."
        }
    }
}

private struct SpectrumPoint: Identifiable {
    let id: String
    let bssid: String
    let ssid: String
    let freq: Double
    let power: Double
}

struct WiFiSpectrumView: View {
    @StateObject private var model = SpectrumModel()
    @State private var band = 2
    @State private var showImporter = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment:.leading, spacing:16) {
                    HStack {
                        Image(systemName:"waveform.path").foregroundStyle(.blue)
                        Text("Анализ Wi-Fi").font(.title2.bold())
                    }
                    introduction
                    importCard
                    netisCard
                    if model.isLoaded {
                        results
                    } else {
                        emptyCard
                    }
                    Text("NetCheck не измеряет реальную занятость эфира в процентах. AirPort CSV не содержит airtime/channel utilization, ширину канала и спектральный шум. Показатели соседей — реальные измерения iPhone в момент сканирования; оценка пересечений условная.")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding()
            }
            .navigationBarTitleDisplayMode(.inline)
            .fileImporter(isPresented:$showImporter,
                          allowedContentTypes:[.commaSeparatedText,.plainText,.text,.data]) { result in
                switch result {
                case .success(let url):
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    do {
                        let values = try Data(contentsOf:url)
                        guard values.count <= 2_000_000,
                              let text = String(data:values,encoding:.utf8) else {
                            model.error = "Файл слишком большой или не UTF-8 CSV."
                            return
                        }
                        model.load(text)
                    } catch { model.error = "Не удалось открыть файл: \(error.localizedDescription)" }
                case .failure(let error): model.error = error.localizedDescription
                }
            }
        }
    }

    private var introduction: some View {
        VStack(alignment:.leading,spacing:7) {
            Text("Кто мешает вашему Wi-Fi?").font(.headline)
            Text("Соседние сети, каналы, частоты, сила сигнала и возможные пересечения — по сканированию с этого iPhone.")
            Text("iOS не разрешает NetCheck сканировать соседей напрямую. Для реальных данных используем бесплатную Apple AirPort Utility.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var importCard: some View {
        VStack(alignment:.leading,spacing:10) {
            Text("1. Получить список соседних сетей").font(.headline)
            Text("AirPort Utility → Настройки iPhone → AirPort Utility → «Сканер Wi-Fi» ВКЛ → открыть AirPort → Сканер Wi-Fi → Сканировать → Остановить → Поделиться → Копировать.")
                .font(.subheadline)
            Link("Установить AirPort Utility", destination:URL(string:"https://apps.apple.com/app/airport-utility/id427276530")!)
                .font(.subheadline)
            HStack {
                Button { model.fromClipboard() } label: {
                    Label("Вставить скан",systemImage:"doc.on.clipboard")
                }.buttonStyle(.borderedProminent)
                Button { showImporter = true } label: {
                    Label("Открыть CSV",systemImage:"folder")
                }.buttonStyle(.bordered)
            }
            if model.isLoaded {
                Text(model.source).font(.caption).foregroundStyle(.secondary)
                Button("Удалить локально сохранённое сканирование",role:.destructive) { model.clear() }
                    .font(.caption)
            }
            if !model.error.isEmpty {
                Label(model.error,systemImage:"exclamationmark.triangle")
                    .font(.caption).foregroundStyle(.red)
            }
        }
        .padding(13)
        .background(.gray.opacity(0.08),in:RoundedRectangle(cornerRadius:14))
    }

    private var netisCard: some View {
        VStack(alignment:.leading,spacing:9) {
            Text("2. Канал роутера (если поддерживается)").font(.headline)
            Text("Подтверждённый адаптер: Netis N2 FW4 CIS. Только чтение, без пароля и изменения настроек.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                TextField("Адрес Netis, например 192.168.2.1",text:$model.netisHost)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.numbersAndPunctuation)
                    .textFieldStyle(.roundedBorder)
                Button("Читать") { Task { await model.refreshNetis() } }
                    .buttonStyle(.bordered)
                    .disabled(model.netisBusy)
            }
            Text(model.netisStatus).font(.caption).foregroundStyle(.secondary)
            ForEach(model.netisRadios) { item in
                HStack {
                    Text(item.band == 2 ? "2,4 ГГц" : "5 ГГц").fontWeight(.medium)
                    Spacer()
                    Text("Канал \(item.channel)")
                    if !item.ssid.isEmpty {
                        Text(item.ssid).lineLimit(1).font(.caption).foregroundStyle(.secondary)
                    }
                }.font(.subheadline)
            }
        }
        .padding(13)
        .background(.gray.opacity(0.08),in:RoundedRectangle(cornerRadius:14))
    }

    private var emptyCard: some View {
        VStack(alignment:.leading,spacing:6) {
            Label("Соседи и графики пока без данных",systemImage:"wifi.slash").font(.headline)
            Text("Это не ноль соседей: сканирование ещё не импортировано. После импорта появятся настоящие SSID, BSSID, RSSI, каналы и графики.")
                .font(.subheadline).foregroundStyle(.secondary)
            Text("Занятость канала: нет данных. Мы не заменяем её количеством соседних точек.")
                .font(.caption)
        }.padding(14).frame(maxWidth:.infinity,alignment:.leading)
            .background(.gray.opacity(0.07),in:RoundedRectangle(cornerRadius:14))
    }

    private var results: some View {
        VStack(alignment:.leading,spacing:13) {
            HStack {
                Text("Результат сканирования").font(.headline)
                Spacer()
                Text("\(model.latest.count) точек доступа").font(.caption.monospacedDigit())
            }
            if let date = model.loadedAt {
                Text("Импорт: \(date.formatted(date:.abbreviated,time:.shortened)) · данные не обновляются автоматически")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Text("Ваша сеть:")
                Menu(model.mySSID.isEmpty ? "Не выбрана" : model.mySSID) {
                    Button("Не выбрана") { model.mySSID = "" }
                    ForEach(model.distinctSSIDs,id:\.self) { ssid in
                        Button(ssid) { model.mySSID = ssid }
                    }
                }
            }.font(.subheadline)
            Picker("Диапазон",selection:$band) {
                Text("2,4 ГГц").tag(2)
                Text("5 ГГц").tag(5)
            }.pickerStyle(.segmented)
            let aps = model.filtered(band)
            HStack(spacing:8) {
                miniMetric("\(aps.count)","точек доступа")
                miniMetric("\(aps.filter { $0.rssi >= -65 }.count)","сильных сигналов")
                miniMetric("\(Set(aps.map(\.channel)).count)","занятых каналов*")
            }
            if aps.isEmpty {
                Text("В этом диапазоне сети не обнаружены в последнем экспорте.")
                    .font(.subheadline)
            } else {
                channelRatings
                channelPlot
                neighborsTable(aps)
                signalHistory
            }
            Text("* «Занятые каналы» = каналы с найденными точками доступа, НЕ процент занятости радиоэфира и не доказанная перегрузка.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func miniMetric(_ number: String,_ caption:String) -> some View {
        VStack(alignment:.center,spacing:3) {
            Text(number).font(.title2.bold().monospacedDigit())
            Text(caption).font(.caption2).multilineTextAlignment(.center)
        }
        .frame(maxWidth:.infinity,minHeight:70)
        .background(.gray.opacity(0.08),in:RoundedRectangle(cornerRadius:11))
    }

    private var channelRatings: some View {
        VStack(alignment:.leading,spacing:8) {
            Text("Сравнение каналов").font(.headline)
            if band == 2 {
                let rated = model.suggestChannels(2)
                let best = rated.first?.0 ?? 1
                ForEach(rated,id:\.0) { channel,score in
                    HStack(spacing:10) {
                        Text("\(channel)").font(.headline.monospacedDigit()).frame(width:32)
                        GeometryReader { proxy in
                            let width = min(1, score / max(2.5,(rated.map(\.1).max() ?? 0.1)))
                            ZStack(alignment:.leading) {
                                Capsule().fill(.gray.opacity(0.12))
                                Capsule().fill(channel == best ? Color.green : Color.orange)
                                    .frame(width:max(2,proxy.size.width * width))
                            }
                        }.frame(height:13)
                        Text(channel == best ? "Меньше пересечений" : "Есть пересечения")
                            .font(.caption2).frame(width:130,alignment:.leading)
                    }
                }
                Text("В этом сканировании канал \(best) выглядит менее пересекающимся с соседями. Это гипотеза для теста, а не гарантия улучшения скорости.")
                    .font(.caption)
            } else {
                Text("На 5 ГГц CSV AirPort не содержит ширину каналов (20/40/80/160 МГц), поэтому достоверно выбрать лучший канал по этому файлу нельзя. Показываем обнаруженные сети и их первичные каналы.")
                    .font(.caption)
            }
        }.padding(12).background(.gray.opacity(0.07),in:RoundedRectangle(cornerRadius:12))
    }

    private var plotPoints: [SpectrumPoint] {
        let aps = Array(model.filtered(band).prefix(12))
        return aps.flatMap { ap -> [SpectrumPoint] in
            // 20 MHz ASSUMED for an illustration only; width is not present
            // in AirPort's CSV, especially important for 5 GHz networks.
            let c = Double(ap.MHz)
            return (0...8).map { i in
                let x = c - 12 + Double(i) * 3
                let strength = max(0, 1 - abs(x-c)/12)
                return SpectrumPoint(
                    id:"\(ap.id)-\(i)", bssid:ap.id, ssid:ap.ssid,
                    freq:x, power:-95 + Double(ap.rssi + 95) * strength
                )
            }
        }
    }

    private var channelPlot: some View {
        VStack(alignment:.leading,spacing:6) {
            Text("График частот").font(.headline)
            Chart(plotPoints) { p in
                LineMark(x:.value("Частота МГц",p.freq),
                         y:.value("RSSI",p.power),series:.value("BSSID",p.bssid))
                .foregroundStyle(by:.value("Точка",p.bssid))
                .interpolationMethod(.linear)
            }
            .chartYScale(domain:-100 ... -30)
            .chartXScale(domain:band == 2 ? 2400.0 ... 2484.0 : 5150.0 ... 5850.0)
            .chartLegend(.hidden)
            .frame(height:210)
            Text("До 12 сильнейших точек доступа. Высота = RSSI в dBm. Ширина кривой условно 20 МГц: AirPort не сообщает реальную ширину.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func neighborsTable(_ aps: [SpectrumAP]) -> some View {
        VStack(alignment:.leading,spacing:8) {
            Text("Найденные сети рядом").font(.headline)
            ForEach(Array(aps.prefix(40))) { ap in
                HStack(spacing:7) {
                    Image(systemName:"wifi")
                        .foregroundStyle(ap.rssi >= -65 ? .green : (ap.rssi >= -76 ? .orange : .red))
                    VStack(alignment:.leading,spacing:2) {
                        Text(ap.ssid).font(.subheadline.bold()).lineLimit(1)
                        Text(ap.bssid).font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength:4)
                    VStack(alignment:.trailing,spacing:2) {
                        Text("Кан. \(ap.channel) · \(ap.MHz) МГц").font(.caption.monospacedDigit())
                        Text("\(ap.rssi) dBm · \(ap.strength)").font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Divider()
            }
            if aps.count > 40 {
                Text("Показаны 40 из \(aps.count) сетей").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var signalHistory: some View {
        VStack(alignment:.leading,spacing:6) {
            Text("История силы сигнала").font(.headline)
            let all = model.samples.filter { $0.ap.band == band &&
                (model.mySSID.isEmpty ? $0.ap.id == model.filtered(band).first?.id : $0.ap.ssid == model.mySSID) }
            if all.count > 1 {
                Chart(all.suffix(200)) { v in
                    LineMark(x:.value("Номер замера",v.id),
                             y:.value("RSSI, dBm",v.ap.rssi),
                             series:.value("BSSID",v.ap.bssid))
                    .foregroundStyle(by:.value("BSSID",v.ap.bssid))
                }
                .chartYScale(domain:-100 ... -30)
                .chartLegend(.hidden)
                .frame(height:150)
                Text("Измерения внутри экспортированного сканирования. Для определённой сети выберите её выше. Разные BSSID одного SSID показаны отдельно.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Для истории требуется несколько последовательных измерений одной точки доступа. Запустите сканирование AirPort на 20–40 секунд.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
