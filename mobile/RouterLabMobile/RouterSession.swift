import Foundation
import SwiftUI
import WebKit

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

final class RouterSession: NSObject, ObservableObject, WKNavigationDelegate, WKScriptMessageHandler {
    @Published var state = "Ожидание подключения"
    @Published var consumerPhase: ConsumerPhase = .idle
    @Published var detectedDevice = ""
    @Published var detectedBuild = ""
    @Published var consumerMessage = "Подключитесь к Wi-Fi роутера и нажмите «Проверить роутер»."
    @Published var address = "http://192.168.0.1"
    @Published var recording = false
    @Published var replaying = false
    @Published var cursor = 0
    @Published var steps: [RouterStep] = []
    @Published var logs: [String] = []

    // Keep these credentials only in memory, never in the exported scenario.
    var adminPassword = ""
    var wifiSSID = ""
    var wifiPassword = ""
    var wanUsername = ""
    var wanPassword = ""

    private weak var webView: WKWebView?
    private var activeHost = "192.168.0.1"
    private var documentSerial = 0
    private var lastPlaybackSerial = -1
    private let storageKey = "RouterLabMobileRecordedSteps_v1"

    override init() {
        super.init()
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let previous = try? JSONDecoder().decode([RouterStep].self, from: data) {
            steps = previous
        }
    }

    func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let bridge = WKUserContentController()
        bridge.add(self, name: "routerlab")
        if let path = Bundle.main.path(forResource: "RouterLabRuntime", ofType: "js"),
           let script = try? String(contentsOfFile: path, encoding: .utf8) {
            bridge.addUserScript(WKUserScript(source: script,
                injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .page))
        } else {
            addLog("ОШИБКА: RouterLabRuntime.js отсутствует в сборке")
        }
        configuration.userContentController = bridge
        configuration.websiteDataStore = .default() // Router's stock cookies and session.
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.scrollView.contentInsetAdjustmentBehavior = .never
        webView = view
        open(address)
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

    func open(_ input: String) {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text),
              (url.scheme == "http" || url.scheme == "https"),
              let host = url.host, Self.isPrivateIPv4(host),
              url.user == nil, url.password == nil else {
            state = "Адрес отклонён: нужен локальный IPv4, например http://192.168.0.1"
            return
        }
        stop()
        activeHost = host
        address = text
        state = "Подключение к \(host)…"
        if consumerPhase != .idle { consumerPhase = .connecting }
        addLog("OPEN \(host)")
        webView?.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 15))
    }

    // A single entrypoint for the nontechnical customer workflow.
    // Does not perform destructive writes until a verified model-specific adapter exists.
    func beginConsumerSetup() {
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
        state = "Загрузка \(webView.url?.host ?? activeHost)…"
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        state = recording ? "Идёт запись (\(steps.count) шагов)" :
            replaying ? "Воспроизведение: \(cursor)/\(steps.count)" : "Страница загружена"
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
        state = "Ошибка загрузки: \(error.localizedDescription)"
        consumerPhase = .connectWiFi
        consumerMessage = "Страница роутера недоступна. Проверьте подключение к его Wi-Fi."
        addLog("LOAD failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        state = "Нет соединения: \(error.localizedDescription)"
        consumerPhase = .connectWiFi
        consumerMessage = "Подключитесь к Wi-Fi вашего роутера и повторите проверку."
        addLog("CONNECT failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.targetFrame != nil, let url = action.request.url else {
            decisionHandler(.cancel) // Pop-up windows are disabled.
            return
        }
        if url.scheme == "about" { decisionHandler(.allow); return }
        if (url.scheme == "http" || url.scheme == "https") && url.host == activeHost {
            decisionHandler(.allow)
        } else {
            state = "Заблокирован переход за пределы роутера"
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
        case "deviceInfo":
            guard let model = body["model"] as? String,
                  let revision = body["revision"] as? String,
                  let build = body["build"] as? String,
                  model.count < 60, revision.count < 20, build.count < 20 else { return }
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