import Foundation
import SwiftUI
import WebKit
import Darwin

// A recorded value is either a literal or a variable supplied at playback time.
// Passwords and WAN credentials are NEVER persisted to the steps or diagnostics.
struct RouterStep: Codable, Identifiable {
    var id = UUID()
    var kind: String
    var selector: String
    var value: String?
    var placeholder: String?
    var path: String
    var label: String?
}

// Consumer path never treats a completed click replay as successful configuration.
// Hardware read-after-write is mandatory before entering .verified.
enum ConsumerPhase: Equatable {
    case idle, connecting, identifying, connectWiFi, adapterNeeded, unsupported, verified
}

struct RouterModelChoice: Identifiable, Equatable {
    let id: String
    let name: String
}

final class RouterSession: NSObject, ObservableObject, WKNavigationDelegate, WKScriptMessageHandler {
    private static let addressKey = "RouterLabLastWorkingAddress"
    static var lastWorkingAddress: String {
        guard let saved = UserDefaults.standard.string(forKey: addressKey),
              let url = URL(string: saved), url.scheme == "http",
              let host = url.host, isPrivateIPv4(host),
              url.user == nil, url.password == nil else { return "http://192.168.1.1" }
        return "http://\(host)"
    }
    @Published var state = "Ожидание подключения"
    @Published var isDiscovering = true
    @Published var deviceVerified = false
    @Published var discoveryProgress = "Подготовка поиска…"
    @Published var verifiedHost = ""
    @Published var verifiedDevice = ""
    @Published var firmwareVerified = false
    @Published var consumerPhase: ConsumerPhase = .idle
    @Published var detectedDevice = ""
    @Published var detectedBuild = ""
    @Published var consumerMessage = "Подключитесь к Wi-Fi роутера и нажмите «Проверить роутер»."
    @Published var address = RouterSession.lastWorkingAddress
    @Published var recording = false
    @Published var replaying = false
    @Published var cursor = 0
    @Published var steps: [RouterStep] = []
    @Published var logs: [String] = []
    // Pure event codes only. This native log survives stock TP-Link reloads,
    // unlike diagnostic elements injected into a short-lived HTML document.
    @Published private(set) var c20Diagnostics: [String] = []
    // Hide the stock WebKit page while C20 navigates between documents.
    // Set true only after a mounted RouterLab panel reports its state.
    @Published var c20PanelReady = false
    @Published var genericIdentifiedOnly = false
    @Published var genericPanelReady = false
    @Published var genericStockManual = false
    @Published var manualModelSelected = false
    @Published var manualModels: [RouterModelChoice] = [
        RouterModelChoice(id: "tplink-archer-c54", name: "TP-Link Archer C54"),
        RouterModelChoice(id: "tplink-archer-c20", name: "TP-Link Archer C20"),
        RouterModelChoice(id: "netis-n2", name: "Netis N2"),
        RouterModelChoice(id: "cudy-wr1200", name: "Cudy WR1200"),
        RouterModelChoice(id: "cudy-wr1300", name: "Cudy WR1300"),
        RouterModelChoice(id: "cudy-wr3000", name: "Cudy WR3000")
    ]
    private var genericProfileId = ""
    private var lastReachableHost = ""
    private var manualSelectionPending = ""
    private var discoveryVendorHint = ""
    // Advisory evidence for UNKNOWN routers. Completely independent of login
    // and write gates; these never make deviceVerified=true.
    @Published var passivePageSeen = false
    @Published var passiveHost = ""
    @Published var passiveVendor = ""
    @Published var passiveModelHint = ""
    @Published var passiveEvidence = "NONE"
    @Published var passiveFamily = "UNKNOWN_WEB"
    @Published var passiveUI = "STATE_UNKNOWN"
    @Published var passiveConfidence = "UNKNOWN"
    private var passiveRank = 0
    private static let c20DiagnosticKey = "RouterLabC20DiagnosticsV1"
    private static let maxC20Events = 1800
    private static let c20Clock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter
    }()
    private var c20CookieBefore: (count: Int, jsession: Bool)?
    var c20DiagnosticsText: String {
        (["RouterLab C20 / local diagnostic codes only"] + c20Diagnostics).joined(separator: "\n")
    }
    // Copyable even if only a vendor is recognized and no panel can mount.
    // No credentials, cookie data, raw HTML or untrusted response payloads.
    var identityDiagnosticsText: String {
        let entries = logs.filter { $0.contains("DISCOVERY") || $0.contains("GENERIC panel") }
        return ([
            "RouterLab universal identity / sanitized events",
            "vendor_hint=" + (discoveryVendorHint.isEmpty ? "NONE" : discoveryVendorHint),
            "device=" + (genericIdentifiedOnly ? verifiedDevice : "NOT_CONFIRMED"),
            "firmware_verified=" + (firmwareVerified ? "YES" : "NO"),
            "passive_page_reachable=" + (passivePageSeen || !lastReachableHost.isEmpty ? "YES" : "NO"),
            "passive_host=" + (passiveHost.isEmpty ? "NONE" : passiveHost),
            "passive_vendor_hint=" + (passiveVendor.isEmpty ? "NONE" : passiveVendor),
            "passive_model_hint=" + (passiveModelHint.isEmpty ? "NONE" : passiveModelHint),
            "passive_evidence=" + passiveEvidence,
            "passive_family=" + passiveFamily,
            "passive_ui=" + passiveUI,
            "passive_confidence=" + passiveConfidence,
            "passive_authenticated=NO",
            "passive_write_enabled=NO"
        ] + Array(entries.suffix(30))).joined(separator: "\n")
    }

    private func c20Event(_ code: String, sourceTime: String? = nil) {
        guard code.count >= 3, code.count <= 65,
              code.range(of: "^[A-Z0-9_]+$", options: .regularExpression) != nil else { return }
        // JS events carry their own millisecond stamp to preserve order
        // across the asynchronous WKScriptMessageHandler bridge.
        let stamp: String
        if let time = sourceTime,
           time.range(of: "^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}$",
                         options: .regularExpression) != nil {
            stamp = time
        } else {
            stamp = Self.c20Clock.string(from: Date())
        }
        c20Diagnostics.append("\(stamp) \(code)")
        if c20Diagnostics.count > Self.maxC20Events {
            c20Diagnostics.removeFirst(c20Diagnostics.count - Self.maxC20Events)
        }
        // Only timestamps and allowlisted event codes are stored; never store
        // private IPs, SSIDs, passwords, cookie values, request bodies or URLs.
        UserDefaults.standard.set(c20Diagnostics, forKey: Self.c20DiagnosticKey)
    }

    // Diagnostic snapshots never store cookie names/values or full domains.
    // JSESSIONID presence and count changes are hints, NOT proof of login.
    private func captureC20CookieState(_ phase: String) {
        guard verifiedDevice == "TP-Link Archer C20", activeHost == verifiedHost,
              let view = webView, phase == "BEFORE" || phase == "AFTER" else { return }
        let host = activeHost
        view.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            DispatchQueue.main.async {
                guard let self = self, self.verifiedDevice == "TP-Link Archer C20",
                      self.activeHost == host else { return }
                let scoped = cookies.filter {
                    $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == host
                }
                let present = scoped.contains { $0.name.uppercased() == "JSESSIONID" }
                self.c20Event("NATIVE_COOKIE_\(phase)_JSESSIONID_" + (present ? "YES" : "NO"))
                if phase == "BEFORE" {
                    self.c20CookieBefore = (scoped.count, present)
                } else if let before = self.c20CookieBefore {
                    self.c20Event(before.count == scoped.count
                        ? "NATIVE_COOKIE_COUNT_UNCHANGED" : "NATIVE_COOKIE_COUNT_CHANGED")
                    self.c20Event(before.jsession == present
                        ? "NATIVE_JSESSIONID_PRESENCE_UNCHANGED" : "NATIVE_JSESSIONID_PRESENCE_CHANGED")
                } else {
                    self.c20Event("NATIVE_COOKIE_BASELINE_MISSING")
                }
            }
        }
    }

    func clearC20Diagnostics() {
        c20Diagnostics = []
        UserDefaults.standard.removeObject(forKey: Self.c20DiagnosticKey)
        c20Event("NATIVE_LOG_CLEARED")
    }

    // Keep these credentials only in memory, never in the exported scenario.
    var adminPassword = ""
    var wifiSSID = ""
    var wifiPassword = ""
    var wanUsername = ""
    var wanPassword = ""

    private weak var webView: WKWebView?
    private var activeHost = "192.168.0.1"
    private var candidateHosts: [String] = []
    private var candidateIndex = 0
    private var candidateGeneration = 0
    private var discoveryTimeout: DispatchWorkItem?
    private var expectedNavigation: WKNavigation?
    private var documentSerial = 0
    private var lastPlaybackSerial = -1
    private let storageKey = "RouterLabMobileRecordedSteps_v1"

    override init() {
        super.init()
        if let saved = UserDefaults.standard.stringArray(forKey: Self.c20DiagnosticKey) {
            c20Diagnostics = saved.filter { value in
                value.count <= 90 &&
                value.range(of: "^.{5,12} [A-Z0-9_]{3,65}$", options: .regularExpression) != nil
            }.suffix(Self.maxC20Events).map { $0 }
        }
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let previous = try? JSONDecoder().decode([RouterStep].self, from: data) {
            steps = previous
        }
    }

    func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let bridge = WKUserContentController()
        bridge.add(self, name: "routerlab")
        #if ROUTERLAB_APP_CLIP
        bridge.addUserScript(WKUserScript(source: "Object.defineProperty(window, '__RouterLabReadOnlyClip', {value: true});",
            injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        #endif
        // Same-origin, model-specific transport. Netis and Archer C20 have
        // different login/read contracts. Unknown devices never receive SET.
        var resources = ["RouterLabNetisFW4", "RouterLabNetisPanel", "RouterLabC20Panel"]
        #if !ROUTERLAB_APP_CLIP
        resources.append("RouterLabC20Setup") // Full app only; App Clip stays read-only.
        #endif
        // Passive fingerprints and the shared recorder load after tested adapters.
        resources.append(contentsOf: ["RouterLabDeviceRegistry", "RouterLabAdapterHub", "RouterLabC54Driver", "RouterLabUniversalPanel", "RouterLabPassiveUnknownProbe", "RouterLabRuntime"])
        for resource in resources {
            if let path = Bundle.main.path(forResource: resource, ofType: "js"),
               let script = try? String(contentsOfFile: path, encoding: .utf8) {
                bridge.addUserScript(WKUserScript(source: script,
                    injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .page))
            } else {
                addLog("ОШИБКА: \(resource).js отсутствует в сборке")
            }
        }
        configuration.userContentController = bridge
        configuration.websiteDataStore = .default() // Router's stock cookies and session.
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.scrollView.contentInsetAdjustmentBehavior = .never
        webView = view
        startDiscovery()
        return view
    }

    // Intentionally accept only literal private IPv4 router addresses.
    // No remote hosts, open redirects, generic URLs, or local-file loading.
    static func isPrivateIPv4(_ host: String) -> Bool {
        let fields = host.split(separator: ".", omittingEmptySubsequences: false)
        guard fields.count == 4 else { return false }
        var octets: [Int] = []
        for field in fields {
            guard !field.isEmpty, field.count <= 3,
                  field.allSatisfy({ $0.isASCII && $0.isNumber }),
                  let value = Int(field), value <= 255 else { return false }
            octets.append(value)
        }
        return octets[0] == 10 ||
            (octets[0] == 172 && (16...31).contains(octets[1])) ||
            (octets[0] == 192 && octets[1] == 168)
    }

    // Prefer the gateway-shaped address in the current Wi-Fi /24. This is a
    // bounded hint, not a port scan, and may be wrong on non-/24 networks.
    private static func wifiRouterHint() -> String? {
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0, let head = interfaces else { return nil }
        defer { freeifaddrs(head) }
        var p: UnsafeMutablePointer<ifaddrs>? = head
        while let item = p {
            defer { p = item.pointee.ifa_next }
            guard String(cString: item.pointee.ifa_name) == "en0",
                  let address = item.pointee.ifa_addr,
                  address.pointee.sa_family == UInt8(AF_INET) else { continue }
            var a = UnsafeRawPointer(address).assumingMemoryBound(to: sockaddr_in.self).pointee.sin_addr
            var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            guard inet_ntop(AF_INET, &a, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil else { continue }
            let ip = String(cString: buffer)
            let parts = ip.split(separator: ".")
            guard parts.count == 4 else { continue }
            let guess = parts.prefix(3).joined(separator: ".") + ".1"
            if isPrivateIPv4(guess) { return guess }
        }
        return nil
    }

    // Only a handful of private router candidates, never a LAN sweep.
    func startDiscovery() {
        var ordered = [String]()
        let preferred = URL(string: Self.lastWorkingAddress)?.host ?? ""
        for host in [Self.wifiRouterHint(), preferred, "192.168.2.1", "192.168.1.1", "192.168.0.1"].compactMap({ $0 }) {
            if Self.isPrivateIPv4(host) && !ordered.contains(host) { ordered.append(host) }
        }
        startProbe(hosts: ordered)
    }

    func open(_ input: String) {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme == "http",
              let host = url.host, Self.isPrivateIPv4(host),
              url.user == nil, url.password == nil, url.port == nil,
              (url.path.isEmpty || url.path == "/"), url.query == nil,
              url.fragment == nil else {
            state = "Введите локальный IPv4-адрес роутера, например 192.168.2.1"
            return
        }
        startProbe(hosts: [host])
    }

    // Manual selection is an explicit ADAPTER ROUTE, not evidence of identity.
    // Never unlock C54/C20/Netis writes based only on the user-selected label.
    func selectRouterModel(_ profileId: String, at input: String) {
        guard manualModels.contains(where: { $0.id == profileId }) else {
            state = "Модель отсутствует в каталоге адаптеров."
            return
        }
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme == "http",
              let host = url.host, Self.isPrivateIPv4(host),
              url.user == nil, url.password == nil, url.port == nil,
              (url.path.isEmpty || url.path == "/"),
              url.query == nil, url.fragment == nil else {
            state = "Укажите локальный IPv4 роутера, например http://192.168.0.1"
            return
        }
        stop()
        discoveryTimeout?.cancel()
        candidateGeneration += 1
        isDiscovering = false
        firmwareVerified = false
        genericPanelReady = false
        genericStockManual = false
        manualModelSelected = false
        manualSelectionPending = profileId
        deviceVerified = false
        verifiedDevice = ""
        verifiedHost = ""
        activeHost = host
        address = "http://\(host)"
        consumerPhase = .identifying
        consumerMessage = "Выбрана модель \(profileId). Проверяем доступность локального интерфейса."
        addLog("MANUAL adapter requested \(profileId) / verification required")
        // Reuse a genuinely loaded local page; otherwise navigate and wait.
        if lastReachableHost == host, webView?.url?.host == host {
            applyManualSelectionOnLoadedPage()
        } else if let view = webView {
            let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                                     timeoutInterval: 10)
            expectedNavigation = view.load(request)
        } else {
            manualSelectionPending = ""
            state = "Веб-модуль ещё не готов. Повторите подключение."
        }
    }

    // Prefer the most recent successfully loaded local management interface.
    // Manual selection never probes an arbitrary public address.
    var manualRouterAddressHint: String {
        lastReachableHost.isEmpty ? address : "http://\(lastReachableHost)"
    }
    var passiveFoundLocalPage: Bool {
        passivePageSeen || !lastReachableHost.isEmpty
    }
    var passivePageDescription: String {
        switch passiveUI {
        case "MULTIPLE_PASSWORD_FIELDS": return "Обнаружены несколько полей пароля; возможно первичная настройка."
        case "PASSWORD_FORM": return "Обнаружена форма ввода пароля."
        case "SETUP_TEXT_CANDIDATE": return "В заголовке обнаружены признаки мастера настройки."
        default: return "Состояние входа или первичной настройки не установлено."
        }
    }
    var passiveTechnologyDescription: String {
        switch passiveFamily {
        case "TPLINK_SU_CANDIDATE": return "Признак библиотеки TP-Link SU"
        case "TPLINK_LEGACY_CANDIDATE": return "Признак старого интерфейса TP-Link"
        case "LUCI_CANDIDATE": return "Признаки веб-интерфейса LuCI"
        case "NETIS_CGI_CANDIDATE": return "Признаки CGI семейства Netis"
        default: return "Технология управления не установлена"
        }
    }

    private func applyManualSelectionOnLoadedPage() {
        guard let view = webView, let url = view.url,
              url.host == activeHost, lastReachableHost == activeHost,
              !manualSelectionPending.isEmpty else { return }
        let requested = manualSelectionPending
        // Profile id is chosen from the native allowlisted catalog.
        guard requested.range(of: "^[a-z0-9-]{5,60}$", options: .regularExpression) != nil else { return }
        let javascript = "window.__RouterLabUniversalPanel?.selectManual('\(requested)')"
        view.evaluateJavaScript(javascript) { [weak self] result, error in
            guard let self = self, self.manualSelectionPending == requested else { return }
            if let error = error {
                self.state = "Не удалось загрузить адаптер: \(error.localizedDescription)"
                self.addLog("MANUAL JS adapter missing")
            } else if let result = result as? [String: Any], result["accepted"] as? Bool == true {
                self.addLog("MANUAL adapter routed \(requested) / awaiting page confirmation")
            } else {
                self.state = "Для выбранной модели нет зарегистрированного адаптера."
                self.addLog("MANUAL no matching adapter")
                self.manualSelectionPending = ""
                self.consumerPhase = .adapterNeeded
            }
        }
    }

    private func startProbe(hosts: [String]) {
        stop()
        discoveryTimeout?.cancel()
        candidateGeneration += 1
        candidateHosts = hosts
        candidateIndex = 0
        deviceVerified = false
        verifiedHost = ""
        verifiedDevice = ""
        firmwareVerified = false
        genericIdentifiedOnly = false
        genericPanelReady = false
        genericStockManual = false
        genericProfileId = ""
        discoveryVendorHint = ""
        manualModelSelected = false
        manualSelectionPending = ""
        lastReachableHost = ""
        passivePageSeen = false
        passiveHost = ""
        passiveVendor = ""
        passiveModelHint = ""
        passiveEvidence = "NONE"
        passiveFamily = "UNKNOWN_WEB"
        passiveUI = "STATE_UNKNOWN"
        passiveConfidence = "UNKNOWN"
        passiveRank = 0
        isDiscovering = true
        loadNextCandidate()
    }

    private func loadNextCandidate() {
        discoveryTimeout?.cancel()
        guard candidateIndex < candidateHosts.count else {
            isDiscovering = false
            deviceVerified = false
            let pageFound = passivePageSeen || !lastReachableHost.isEmpty
            if pageFound {
                let maker = passiveVendor.isEmpty ? "неизвестного производителя" : passiveVendor
                let model = passiveModelHint.isEmpty ? "модель не установлена" : "возможно \(passiveModelHint)"
                discoveryProgress = "Найдена локальная веб-страница: \(maker), \(model)"
                state = "Страница доступна, но RouterLab не подтвердил модель. Доступен пассивный отчёт и ручной выбор."
                addLog("DISCOVERY web page seen; model unverified / no writes")
            } else {
                discoveryProgress = "Веб-интерфейс на проверенных адресах не ответил"
                state = "Нет ответа на проверенных адресах. Проверьте Wi-Fi, шлюз или укажите IP вручную."
                addLog("DISCOVERY no reachable web page on candidate hosts")
            }
            return
        }
        let host = candidateHosts[candidateIndex]
        candidateIndex += 1
        activeHost = host
        address = "http://\(host)"
        discoveryProgress = "Проверяем \(host) (\(candidateIndex)/\(candidateHosts.count))"
        state = discoveryProgress
        addLog("DISCOVERY probe \(host)")
        guard let url = URL(string: address) else { advanceProbe(); return }
        webView?.stopLoading()
        expectedNavigation = webView?.load(URLRequest(url: url,
            cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10))
        let generation = candidateGeneration
        let timeout = DispatchWorkItem { [weak self] in
            guard let self = self, self.candidateGeneration == generation,
                  self.isDiscovering else { return }
            self.addLog("DISCOVERY timeout \(self.activeHost)")
            self.advanceProbe()
        }
        discoveryTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 14, execute: timeout)
    }

    private func advanceProbe() {
        guard isDiscovering else { return }
        candidateGeneration += 1
        loadNextCandidate()
    }

    // A single entrypoint for the nontechnical customer workflow.
    // Does not perform destructive writes until a verified model-specific adapter exists.
    func beginConsumerSetup() {
        if genericIdentifiedOnly {
            consumerPhase = .adapterNeeded
            consumerMessage = "Модель определена, но для неё пока отсутствует проверенный адаптер авторизации и сохранения. Доступна диагностика."
            return
        }
        consumerPhase = .connecting
        consumerMessage = "Проверяем подключение к роутеру…"
        detectedDevice = ""
        detectedBuild = ""
        guard let url = webView?.url, url.host == activeHost else {
            open(address)
            return
        }
        consumerPhase = .identifying
        evaluate("window.__RouterLabMobile?.probe()")
    }

    func startRecording() {
        guard webView?.url != nil else { state = "Сначала откройте страницу роутера"; return }
        stop()
        steps = []
        persistSteps()
        recording = true
        state = "Запись: выполните процедуру в штатном интерфейсе"
        addLog("REC started")
        evaluate("window.__RouterLabMobile?.setMode('record')")
    }

    func stop() {
        recording = false
        replaying = false
        evaluate("window.__RouterLabMobile?.stop()")
    }

    func stopAndReport() {
        stop()
        state = "Остановлено. Шагов: \(steps.count)"
        addLog("STOP / steps=\(steps.count)")
    }

    func startReplay() {
        guard !steps.isEmpty else { state = "Нет записанного сценария"; return }
        stop()
        cursor = 0
        replaying = true
        state = "Воспроизведение: 0/\(steps.count)"
        addLog("REPLAY started / steps=\(steps.count)")
        lastPlaybackSerial = -1
        resumeReplay()
    }

    private func resumeReplay() {
        guard replaying, let webView = webView else { return }
        guard lastPlaybackSerial != documentSerial else { return }
        lastPlaybackSerial = documentSerial
        let secrets: [String: String] = [
            "adminPassword": adminPassword,
            "wifiSSID": wifiSSID,
            "wifiPassword": wifiPassword,
            "wanUsername": wanUsername,
            "wanPassword": wanPassword
        ]
        // This payload is passed directly to the stock page's injected runner.
        // It is not logged, saved, or sent to a server by the native app.
        let payload = ReplayPayload(steps: steps, start: cursor, secrets: secrets)
        guard let encoded = try? JSONEncoder().encode(payload),
              let json = String(data: encoded, encoding: .utf8) else {
            replaying = false
            state = "Ошибка сериализации сценария"
            return
        }
        webView.evaluateJavaScript("window.__RouterLabMobile.play(\(json))") { [weak self] _, error in
            if let error = error {
                self?.replaying = false
                self?.state = "Не удалось запустить JS: \(error.localizedDescription)"
            }
        }
    }

    private struct ReplayPayload: Encodable {
        let steps: [RouterStep]
        let start: Int
        let secrets: [String: String]
    }

    func exportScenario() -> URL? {
        guard let data = try? JSONEncoder().encode(steps) else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("routerlab-mobile-steps.json")
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch { return nil }
    }

    private func persistSteps() {
        if let data = try? JSONEncoder().encode(steps) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    private func evaluate(_ javascript: String) {
        webView?.evaluateJavaScript(javascript, completionHandler: nil)
    }

    private func addLog(_ text: String) {
        let date = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        logs.append("\(date)  \(text)")
        if logs.count > 100 { logs.removeFirst(logs.count - 100) }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        documentSerial += 1
        if genericIdentifiedOnly {
            genericPanelReady = false
            // Preserve an explicit manual stock-UI choice across vendor navigation.
            // A fresh router discovery resets this flag.
        }
        if verifiedDevice == "TP-Link Archer C20" {
            c20PanelReady = false
            c20Event("NATIVE_NAV_START")
        }
        state = "Загрузка \(webView.url?.host ?? activeHost)…"
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView.url?.host == activeHost {
            lastReachableHost = activeHost
        }
        if !manualSelectionPending.isEmpty && webView.url?.host == activeHost {
            applyManualSelectionOnLoadedPage()
            return
        }
        // TP-Link's stock RSA/AES login can navigate to a new main-frame
        // document. Earlier builds ignored these navigations completely
        // because they were not the initial RouterLab discovery request.
        if navigation !== expectedNavigation {
            if verifiedDevice == "TP-Link Archer C20",
               webView.url?.host == verifiedHost {
                c20Event("NATIVE_STOCK_NAV_FINISHED")
            }
            return
        }
        if isDiscovering { state = discoveryProgress; return }
        state = recording ? "Идёт запись (\(steps.count) шагов)" :
            replaying ? "Воспроизведение: \(cursor)/\(steps.count)" : "Страница загружена"
        if !recording && !replaying {
            let pageSerial = documentSerial
            let probe = genericIdentifiedOnly
                ? "Boolean(window.__RouterLabUniversalPanel?.ready)"
                : verifiedDevice == "TP-Link Archer C20"
                    ? "Boolean(window.__RouterLabC20Pilot)"
                    : "Boolean(window.__RouterLabNetisPilot)"
            webView.evaluateJavaScript(probe) { [weak self] result, error in
                guard let self = self, self.webView === webView,
                      self.documentSerial == pageSerial else { return }
                if let error = error {
                    self.state = "Страница открыта, но проверка панели не удалась: \(error.localizedDescription)"
                    self.addLog("PANEL check failed: \(error.localizedDescription)")
                } else if result as? Bool == true {
                    self.state = "Страница роутера и панель RouterLab загружены"
                    self.addLog("PANEL ready")
                } else {
                    self.state = "Страница открыта, но панель RouterLab не запустилась"
                    self.addLog("PANEL missing after navigation")
                }
            }
        }
        if recording { evaluate("window.__RouterLabMobile?.setMode('record')") }
        if consumerPhase == .connecting || consumerPhase == .identifying {
            consumerPhase = .identifying
            consumerMessage = "Определяем модель и прошивку…"
            evaluate("window.__RouterLabMobile?.probe()")
        }
        if replaying { resumeReplay() }
        addLog("PAGE \(webView.url?.path ?? "/")")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if navigation !== expectedNavigation {
            if verifiedDevice == "TP-Link Archer C20" {
                c20Event("NATIVE_STOCK_NAV_FAILED")
            }
            return
        }
        if isDiscovering { advanceProbe(); return }
        if !manualSelectionPending.isEmpty {
            manualSelectionPending = ""
            consumerPhase = .connectWiFi
            state = "Адрес роутера недоступен для ручного выбора модели."
            addLog("MANUAL router page failed to load")
            return
        }
        state = "Ошибка загрузки: \(error.localizedDescription)"
        consumerPhase = .connectWiFi
        consumerMessage = "Страница роутера недоступна. Проверьте подключение к его Wi-Fi."
        addLog("LOAD failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if navigation !== expectedNavigation {
            if verifiedDevice == "TP-Link Archer C20" {
                c20Event("NATIVE_STOCK_NAV_FAILED")
            }
            return
        }
        if isDiscovering {
            if (error as NSError).code != NSURLErrorCancelled { advanceProbe() }
            return
        }
        if !manualSelectionPending.isEmpty {
            manualSelectionPending = ""
            consumerPhase = .connectWiFi
            state = "Не удалось открыть выбранный локальный IP. Проверьте адрес и Wi-Fi."
            addLog("MANUAL router address unreachable")
            return
        }
        state = "Нет соединения: \(error.localizedDescription)"
        consumerPhase = .connectWiFi
        consumerMessage = "Подключитесь к Wi-Fi вашего роутера и повторите проверку."
        addLog("CONNECT failed: \(error.localizedDescription)")
    }

    // Coarse navigation class; never record a full URL or query/fragment.
    private func c20NavigationCode(_ url: URL) -> String {
        guard url.host == activeHost else { return "OTHER_HOST" }
        let path = url.path.lowercased()
        if path == "/" || path.isEmpty { return "ROOT" }
        if path.contains("login") { return "LOGIN_PAGE" }
        if path.hasPrefix("/cgi") { return "CGI" }
        return "ROUTER_PAGE"
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.targetFrame != nil, let url = action.request.url else {
            if verifiedDevice == "TP-Link Archer C20" {
                c20Event("NATIVE_POPUP_BLOCKED")
            }
            decisionHandler(.cancel) // Pop-up windows are disabled.
            return
        }
        if url.scheme == "about" { decisionHandler(.allow); return }
        if (url.scheme == "http" || url.scheme == "https") && url.host == activeHost {
            if verifiedDevice == "TP-Link Archer C20", action.targetFrame?.isMainFrame == true {
                c20Event("NATIVE_ROUTE_" + c20NavigationCode(url))
            }
            decisionHandler(.allow)
        } else {
            state = "Заблокирован переход за пределы роутера"
            if verifiedDevice == "TP-Link Archer C20" {
                c20Event("NATIVE_OUT_OF_ORIGIN_BLOCKED")
            }
            addLog("Blocked out-of-origin navigation")
            decisionHandler(.cancel)
        }
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "routerPassiveObservation":
            // Passive reports never authorize an adapter, auth or SET. Accept
            // only fixed enums and narrowly validated identity candidate text.
            guard isDiscovering,
                  message.frameInfo.securityOrigin.host == activeHost,
                  webView?.url?.host == activeHost,
                  body["status"] as? String == "WEB_PAGE_REACHABLE",
                  body["verified"] as? Bool == false,
                  body["canWrite"] as? Bool == false,
                  let vendor = body["vendor"] as? String,
                  let model = body["modelHint"] as? String,
                  let confidence = body["confidence"] as? String,
                  let evidence = body["evidence"] as? String,
                  let family = body["family"] as? String,
                  let ui = body["ui"] as? String,
                  let ambiguous = body["ambiguous"] as? Bool,
                  ["", "TP-Link", "Cudy", "Netis", "ASUS", "D-Link",
                   "Keenetic", "Xiaomi", "Huawei", "Zyxel", "Tenda",
                   "Mercusys", "Netgear"].contains(vendor),
                  model.count <= 48,
                  model.range(of: "^[A-Za-z0-9 -]*$", options: .regularExpression) != nil,
                  ["MODEL_HINT", "VENDOR_HINT", "UNKNOWN"].contains(confidence),
                  ["TITLE", "META", "HEADING", "ASSET", "AMBIGUOUS", "NONE"].contains(evidence),
                  ["TPLINK_SU_CANDIDATE", "TPLINK_LEGACY_CANDIDATE",
                   "LUCI_CANDIDATE", "NETIS_CGI_CANDIDATE", "UNKNOWN_WEB"].contains(family),
                  ["MULTIPLE_PASSWORD_FIELDS", "PASSWORD_FORM",
                   "SETUP_TEXT_CANDIDATE", "STATE_UNKNOWN"].contains(ui),
                  !ambiguous || model.isEmpty else { return }
            let rank = confidence == "MODEL_HINT" ? 3 : confidence == "VENDOR_HINT" ? 2 : 1
            // Keep the most informative observation, even when later probing
            // a different local address. Never store credentials or raw HTML.
            if rank >= passiveRank {
                passivePageSeen = true
                passiveHost = activeHost
                passiveVendor = vendor
                passiveModelHint = model
                passiveEvidence = evidence
                passiveFamily = family
                passiveUI = ui
                passiveConfidence = confidence
                passiveRank = rank
                addLog("DISCOVERY passive page / \(confidence) / \(family) / no writes")
            }
        case "routerModelCatalog":
            // The list is generated from the bundled model registry.
            // It is display metadata, not authorization to send protocol commands.
            guard message.frameInfo.securityOrigin.host == activeHost,
                  webView?.url?.host == activeHost,
                  let list = body["models"] as? [[String: String]],
                  list.count > 0 && list.count <= 30 else { return }
            var proposed = [RouterModelChoice]()
            for item in list {
                guard let id = item["id"], let name = item["name"],
                      id.range(of: "^[a-z0-9-]{5,60}$", options: .regularExpression) != nil,
                      name.count <= 60,
                      name.range(of: "^(TP-Link Archer [A-Z0-9-]+|Cudy WR[0-9]+|Netis N[0-9]+)$",
                                 options: .regularExpression) != nil,
                      !proposed.contains(where: { $0.id == id }) else { return }
                proposed.append(RouterModelChoice(id: id, name: name))
            }
            manualModels = proposed
        case "routerFingerprintHint":
            guard isDiscovering,
                  message.frameInfo.securityOrigin.host == activeHost,
                  webView?.url?.host == activeHost,
                  let vendor = body["vendor"] as? String,
                  ["TP-Link", "Cudy", "Netis"].contains(vendor) else { return }
            discoveryVendorHint = vendor
            addLog("DISCOVERY vendor-only hint \(vendor) / model unverified")
        case "routerFingerprint":
            // Model identity is NOT proof of firmware, authentication, or safe SET.
            guard message.frameInfo.securityOrigin.host == activeHost,
                  webView?.url?.host == activeHost,
                  body["panelMounted"] as? Bool == true,
                  let id = body["id"] as? String,
                  let vendor = body["vendor"] as? String,
                  let model = body["model"] as? String,
                  let evidence = body["evidence"] as? String,
                  ["TITLE", "HEADING", "META", "BODY", "MANUAL"].contains(evidence),
                  (isDiscovering && evidence != "MANUAL" ||
                    evidence == "MANUAL" && manualSelectionPending == id &&
                    lastReachableHost == activeHost) else { return }
            let known: [String: (String, String)] = [
                "tplink-archer-c54": ("TP-Link", "Archer C54"),
                "cudy-wr1200": ("Cudy", "WR1200"),
                "cudy-wr1300": ("Cudy", "WR1300"),
                "cudy-wr3000": ("Cudy", "WR3000")
            ]
            let knownMatch = known[id].map { $0.0 == vendor && $0.1 == model } ?? false
            // The generic profiles never get write privileges. Strict format only.
            let genericMatch =
                (id == "generic-tplink" && vendor == "TP-Link" &&
                 model.range(of: "^Archer (?:AX|BE|C|VR|A)[0-9]{1,4}[A-Z0-9-]{0,7}$",
                             options: .regularExpression) != nil) ||
                (id == "generic-cudy" && vendor == "Cudy" &&
                 model.range(of: "^WR[0-9]{3,5}$", options: .regularExpression) != nil) ||
                (id == "generic-netis" && vendor == "Netis" &&
                 model.range(of: "^N[0-9]{1,3}$", options: .regularExpression) != nil)
            let explicitMatch = evidence == "MANUAL" &&
                manualModels.contains(where: { $0.id == id && $0.name == vendor + " " + model })
            guard knownMatch || genericMatch || explicitMatch else { return }
            discoveryTimeout?.cancel()
            isDiscovering = false
            deviceVerified = true // UI recognition only; write gate is independent.
            genericIdentifiedOnly = true
            genericPanelReady = true
            genericStockManual = false
            genericProfileId = id
            manualModelSelected = evidence == "MANUAL"
            manualSelectionPending = ""
            verifiedHost = activeHost
            verifiedDevice = vendor + " " + model
            firmwareVerified = false
            let revision = body["revision"] as? String ?? ""
            let build = body["build"] as? String ?? ""
            detectedDevice = verifiedDevice + (revision.isEmpty ? "" : " " + String(revision.prefix(16)))
            detectedBuild = String(build.prefix(12))
            consumerPhase = .adapterNeeded
            state = manualModelSelected
                ? "Выбрана \(verifiedDevice). Модель устройства ещё не подтверждена."
                : "Модель \(verifiedDevice) распознана; протокол управления ещё проверяется"
            discoveryProgress = "\(verifiedDevice) · \(activeHost)"
            consumerMessage = manualModelSelected
                ? "Ручной выбор направил RouterLab к адаптеру модели. До подтверждения прошивки и сессии запись заблокирована."
                : "Модель найдена по странице роутера. Авторизация и изменение настроек будут доступны после проверки API и прошивки."
            UserDefaults.standard.set("http://\(activeHost)", forKey: Self.addressKey)
            addLog("DISCOVERY candidate \(id) / \(evidence) / no writes")
        case "genericPanelReady":
            guard genericIdentifiedOnly,
                  message.frameInfo.securityOrigin.host == verifiedHost,
                  webView?.url?.host == verifiedHost,
                  body["id"] as? String == genericProfileId else { return }
            genericPanelReady = true
            genericStockManual = false
            addLog("GENERIC panel mounted")
        case "genericStockShown":
            guard genericIdentifiedOnly,
                  message.frameInfo.securityOrigin.host == verifiedHost,
                  webView?.url?.host == verifiedHost,
                  body["id"] as? String == genericProfileId else { return }
            genericPanelReady = false
            genericStockManual = true
            addLog("GENERIC manual stock UI fallback")
        case "netisProbe":
            // A web page is not authoritative merely because it can message WKWebView.
            // The protocol adapter independently fingerprints Netis before this message.
            guard isDiscovering,
                  message.frameInfo.securityOrigin.host == activeHost,
                  webView?.url?.host == activeHost,
                  let supported = body["supported"] as? Bool else { return }
            if supported,
               body["model"] as? String == "N2",
               body["version"] as? String == "N2-V4.0.1.4317" {
                discoveryTimeout?.cancel()
                isDiscovering = false
                deviceVerified = true
                verifiedHost = activeHost
                verifiedDevice = "Netis N2"
                firmwareVerified = true
                state = "Обнаружен Netis N2"
                discoveryProgress = "Netis N2 · \(activeHost)"
                UserDefaults.standard.set("http://\(activeHost)", forKey: Self.addressKey)
                addLog("DISCOVERY verified Netis N2 on \(activeHost)")
            } else {
                // Another supported adapter may still be probing this same
                // address. Let it finish before the bounded host timeout.
                addLog("DISCOVERY not Netis on \(activeHost)")
            }
        case "tplinkDiagnostic":
            // Fixed diagnostic event IDs only. Do not accept arbitrary
            // strings from the router document into a shareable log.
            guard message.frameInfo.securityOrigin.host == activeHost,
                  webView?.url?.host == activeHost,
                  let code = body["code"] as? String,
                  code.count >= 3, code.count <= 60,
                  code.range(of: "^[A-Z0-9_]+$", options: .regularExpression) != nil
            else { return }
            c20Event("JS_" + code, sourceTime: body["time"] as? String)
            addLog("C20_JS_" + code)
            if code == "LOGIN_FORM_READY" ||
               code == "STOCK_FLOW_RESTORED_AFTER_NAV" ||
               code == "WLAN_READ_STARTED" ||
               code == "NATIVE_LOGIN_SKIN_PLACED" ||
               code == "LOGIN_LAYOUT_UNSTABLE" ||
               code == "SESSION_READBACK_VERIFIED" ||
               code.hasPrefix("STATE_") {
                c20PanelReady = true
            }
            if code == "NATIVE_LOGIN_TAP_OVERLAY" ||
               code == "NATIVE_LOGIN_TAP_STOCK_FALLBACK" ||
               code == "STOCK_LOGIN_UI_SHOWN" {
                captureC20CookieState("BEFORE")
            } else if code == "STOCK_FLOW_RESTORED_AFTER_NAV" ||
                      code == "USER_REQUESTED_POSTLOGIN_CHECK" {
                captureC20CookieState("AFTER")
            }
        case "tplinkProbe":
            guard isDiscovering,
                  message.frameInfo.securityOrigin.host == activeHost,
                  webView?.url?.host == activeHost,
                  body["supported"] as? Bool == true,
                  body["model"] as? String == "Archer C20" else { return }
            discoveryTimeout?.cancel()
            isDiscovering = false
            deviceVerified = true
            verifiedHost = activeHost
            verifiedDevice = "TP-Link Archer C20"
            c20PanelReady = false
            firmwareVerified = false
            state = "Обнаружен Archer C20; версия прошивки требует проверки"
            discoveryProgress = "TP-Link Archer C20 · \(activeHost)"
            UserDefaults.standard.set("http://\(activeHost)", forKey: Self.addressKey)
            c20Event("NATIVE_C20_DISCOVERY_CONFIRMED")
            captureC20CookieState("BEFORE")
            addLog("DISCOVERY TP-Link C20 candidate at \(activeHost)")
        case "deviceInfo":
            guard let model = body["model"] as? String,
                  let revision = body["revision"] as? String,
                  let build = body["build"] as? String,
                  model.count < 60, revision.count < 20, build.count < 20,
                  !model.isEmpty, !genericIdentifiedOnly else { return }
            detectedDevice = [model, revision].filter { !$0.isEmpty }.joined(separator: " ")
            detectedBuild = build
            if model == "Archer C20" && revision == "v5" && build == "200821" {
                consumerPhase = .adapterNeeded
                consumerMessage = "Archer C20 v5 распознан. Автоматическая первичная настройка ещё не подтверждена на устройстве. Можно открыть штатный интерфейс."
                addLog("DETECT Archer C20 v5 / build 200821 / consumer adapter pending")
            } else if model == "Archer C20" {
                consumerPhase = .adapterNeeded
                consumerMessage = "Обнаружен Archer C20, но версия прошивки требует проверки. Автозапись отключена."
                addLog("DETECT Archer C20 / unsupported revision or build")
            } else {
                consumerPhase = .unsupported
                consumerMessage = "Не удалось надёжно определить поддерживаемую модель. Автоматическая настройка не запускается."
                addLog("DETECT no supported model")
            }
        case "step":
            guard recording, steps.count < 250,
                  let raw = body["step"] as? [String: Any],
                  let kind = raw["kind"] as? String,
                  let selector = raw["selector"] as? String,
                  let path = raw["path"] as? String,
                  ["set", "check", "click", "submit"].contains(kind),
                  selector.count < 600, path.count < 500 else { return }
            let step = RouterStep(kind: kind, selector: selector,
                value: raw["value"] as? String,
                placeholder: raw["placeholder"] as? String,
                path: path, label: raw["label"] as? String)
            steps.append(step)
            persistSteps()
            state = "Идёт запись (\(steps.count) шагов)"
            addLog("STEP \(steps.count) \(kind): \(step.label ?? selector)")
        case "advance":
            guard replaying, let next = body["next"] as? Int,
                  next >= cursor && next <= steps.count else { return }
            cursor = next
            state = "Воспроизведение: \(cursor)/\(steps.count)"
        case "replayError":
            guard replaying else { return }
            replaying = false
            let index = body["index"] as? Int ?? cursor
            let message = body["message"] as? String ?? "Неизвестная ошибка"
            state = "Стоп на шаге \(index + 1): \(message)"
            addLog("REPLAY FAILED step \(index + 1): \(message)")
        case "replayComplete":
            guard replaying else { return }
            replaying = false
            state = "Сценарий завершён. Проверяйте настройки роутера."
            addLog("REPLAY completed; device verification required")
        case "ready":
            addLog("Overlay ready: \(body["path"] as? String ?? "/")")
        default: break
        }
    }
}
