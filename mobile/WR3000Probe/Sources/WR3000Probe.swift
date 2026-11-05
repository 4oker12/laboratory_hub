import Foundation
import Combine
import CryptoKit

private final class BlockRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Factory setup and successful LuCI login can redirect on the
        // SAME router. Follow only exact same-origin HTTP redirects.
        // Never follow to a cloud hostname, internet service or other LAN host.
        guard let origin = task.originalRequest?.url,
              let destination = request.url,
              origin.scheme == "http", destination.scheme == "http",
              origin.host == destination.host,
              (origin.port ?? 80) == (destination.port ?? 80) else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }
}

enum RouterEntryState: String {
    case idle, checking, createPassword, signIn, connected, unknown, unreachable
}

struct ProbeRecord: Codable, Identifiable {
    let id: UUID
    let timestamp: String
    let phase: String
    let path: String
    let outcome: String
    let httpStatus: Int?
    let durationMs: Int
    let bytes: Int
    let responseSHA256Prefix: String?
    let requestMethod: String?
    let responseMimeType: String?
    let redirectCategory: String?
}

struct ProbeReport: Codable {
    let schema: String
    let target: String
    let firmwareTarget: String
    let host: String
    let createdAt: String
    let status: String
    let records: [ProbeRecord]
}

@MainActor
final class WR3000Probe: ObservableObject {
    @Published private(set) var status: String = "Проверка не запускалась"
    @Published private(set) var records: [ProbeRecord] = []
    @Published private(set) var factoryPasswordFormDetected = false
    @Published private(set) var entryState: RouterEntryState = .idle
    private var currentHost = ""
    private var session: URLSession?
    private var savedReportURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
            .first?.appendingPathComponent("routerlab-wr3000-last-session.json")
    }

    init() {
        guard let file = savedReportURL,
              let data = try? Data(contentsOf: file),
              let previous = try? JSONDecoder().decode(ProbeReport.self, from: data)
        else { return }
        records = Array(previous.records.suffix(200))
        currentHost = previous.host
        status = "Прошлая проверка: " + previous.status
    }

    private func report() -> ProbeReport {
        ProbeReport(schema: "routerlab.wr3000.probe.v2", target: "Cudy WR3000 (hardware revision unverified)",
                    firmwareTarget: "R31-2.4.19 (research image only)", host: currentHost,
                    createdAt: now(), status: status, records: records)
    }

    private func persist() {
        guard let url = savedReportURL,
              let data = try? JSONEncoder().encode(report())
        else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    private static let readRoutes = [
        "/cgi-bin/luci/admin/system/status",
        "/cgi-bin/luci/admin/network/wan/status",
        "/cgi-bin/luci/admin/network/lan/status",
        "/cgi-bin/luci/admin/network/wireless/status?iface=wlan00",
        "/cgi-bin/luci/admin/network/wireless/status?iface=wlan10",
        "/cgi-bin/luci/admin/network/mesh/clients",
        "/cgi-bin/luci/admin/network/devices/status"
    ]

    private func now() -> String { ISO8601DateFormatter().string(from: Date()) }
    private func sha(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func hashPrefix(_ data: Data) -> String {
        String(SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined().prefix(16))
    }
    private func log(_ phase: String, _ path: String, _ outcome: String, _ code: Int?, _ ms: Int, _ data: Data?,
                     method: String? = nil, mimeType: String? = nil, redirectCategory: String? = nil) {
        records.append(ProbeRecord(id: UUID(), timestamp: now(), phase: phase, path: path,
            outcome: outcome, httpStatus: code, durationMs: ms, bytes: data?.count ?? 0,
            responseSHA256Prefix: data.map(hashPrefix), requestMethod: method,
            responseMimeType: mimeType, redirectCategory: redirectCategory))
        if records.count > 200 { records.removeFirst(records.count - 200) }
        persist()
    }
    private func validHost(_ candidate: String) -> Bool {
        let parts = candidate.split(separator: ".")
        guard parts.count == 4 else { return false }
        let n = parts.compactMap { UInt8($0) }
        guard n.count == 4 else { return false }
        return n[0] == 10 || (n[0] == 192 && n[1] == 168) ||
            (n[0] == 172 && (16...31).contains(Int(n[1]))) ||
            (n[0] == 169 && n[1] == 254)
    }
    private func url(_ path: String) -> URL? { URL(string: "http://\(currentHost)\(path)") }

    private func request(_ method: String, _ path: String, body: String? = nil, contentType: String = "application/x-www-form-urlencoded", phase: String) async throws -> (Int, Data) {
        guard let url = url(path), let session = session else { throw URLError(.badURL) }
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        req.httpMethod = method
        req.setValue("RouterLab-WR3000-Probe/0.1", forHTTPHeaderField: "User-Agent")
        if let body {
            req.setValue(contentType, forHTTPHeaderField: "Content-Type")
            req.httpBody = Data(body.utf8)
        }
        let start = Date()
        do {
            let (data, response) = try await session.data(for: req)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let ms = Int(Date().timeIntervalSince(start) * 1000)
            var outcome = "received"
            var redirectedTo: String? = nil
            if let finalURL = response.url, finalURL.path != url.path {
                // Only log a route *category*, not full URLs or query tokens.
                let kind: String
                if finalURL.path.contains("/admin/wizard") {
                    kind = "factory_wizard"
                } else if finalURL.path.contains("/admin/system") {
                    kind = "admin_system"
                } else if finalURL.path == "/cgi-bin/luci" {
                    kind = "login"
                } else {
                    kind = "other_local_page"
                }
                redirectedTo = kind
                outcome = "same_origin_redirect_" + kind
            }
            let mime = (response as? HTTPURLResponse)?.mimeType
            log(phase, path, outcome, code, ms, data, method: method,
                mimeType: mime, redirectCategory: redirectedTo)
            return (code, data)
        } catch {
            let ms = Int(Date().timeIntervalSince(start) * 1000)
            log(phase, path, "network_error:\((error as? URLError)?.code.rawValue ?? -1)", nil, ms, nil, method: method)
            throw error
        }
    }

    private func formValues(_ html: String) -> [String: String] {
        var values: [String: String] = [:]
        guard let tagRegex = try? NSRegularExpression(pattern: "<input\\b[^>]*>", options: .caseInsensitive),
              let attrRegex = try? NSRegularExpression(pattern: "([A-Za-z_][A-Za-z_0-9:-]*)\\s*=\\s*['\"]([^'\"]*)['\"]", options: .caseInsensitive)
        else { return values }
        let full = NSRange(html.startIndex..<html.endIndex, in: html)
        for tag in tagRegex.matches(in: html, range: full) {
            guard let range = Range(tag.range, in: html) else { continue }
            let input = String(html[range])
            var attrs: [String: String] = [:]
            for item in attrRegex.matches(in: input, range: NSRange(input.startIndex..<input.endIndex, in: input)) {
                if let k = Range(item.range(at: 1), in: input), let v = Range(item.range(at: 2), in: input) {
                    attrs[String(input[k]).lowercased()] = String(input[v])
                }
            }
            if let name = attrs["name"], ["_csrf", "token", "salt"].contains(name) {
                values[name] = attrs["value"] ?? ""
            }
        }
        return values
    }
    // Fingerprint actual stock input elements, never their values.
    private func inputNames(_ html: String) -> [String] {
        guard let inputs = try? NSRegularExpression(pattern: "<input\\b[^>]*>", options: .caseInsensitive),
              let field = try? NSRegularExpression(
                pattern: "(?:name|id)\\s*=\\s*['\\\"]([A-Za-z][A-Za-z0-9_.-]{0,79})['\\\"]",
                options: .caseInsensitive) else { return [] }
        var names = Set<String>()
        for tag in inputs.matches(in: html, range: NSRange(html.startIndex..<html.endIndex, in: html)) {
            guard let range = Range(tag.range, in: html) else { continue }
            let text = String(html[range])
            for match in field.matches(in: text, range: NSRange(text.startIndex..<text.endIndex, in: text)) {
                if let value = Range(match.range(at: 1), in: text) {
                    names.insert(String(text[value]))
                }
            }
        }
        return names.sorted()
    }

    // Categorize form destinations instead of logging arbitrary action URLs,
    // which could contain session credentials.
    private func formActionKind(_ html: String) -> String {
        guard let tag = try? NSRegularExpression(pattern: "<form\\b[^>]*>", options: .caseInsensitive),
              let match = tag.firstMatch(in: html, range: NSRange(html.startIndex..<html.endIndex, in: html)),
              let tagRange = Range(match.range, in: html),
              let action = try? NSRegularExpression(pattern: "action\\s*=\\s*['\\\"]([^'\\\"]*)['\\\"]", options: .caseInsensitive)
        else { return "not_detected" }
        let form = String(html[tagRange])
        guard let found = action.firstMatch(in: form, range: NSRange(form.startIndex..<form.endIndex, in: form)),
              let range = Range(found.range(at: 1), in: form) else { return "current_page" }
        let path = String(form[range])
        if path.contains("/admin/wizard") { return "admin_wizard" }
        if path.contains("/cgi-bin/luci") { return "luci_entry" }
        return path.isEmpty ? "current_page" : "other"
    }

    func prepareFactoryPassword(_ password: String, confirmation: String) {
        guard entryState == .createPassword else {
            log("factory_draft", "/cgi-bin/luci/", "not_in_factory_state", nil, 0, nil)
            return
        }
        guard !password.isEmpty, password == confirmation else {
            status = "Новый пароль и подтверждение должны совпадать."
            log("factory_draft", "/cgi-bin/luci/", "input_validation_failed_no_secrets", nil, 0, nil)
            return
        }
        // Do not guess or replay an uncaptured POST on a live router.
        status = "Поля заполнены. Отправка первого пароля ещё не включена: необходимо подтвердить штатный POST."
        log("factory_draft", "/cgi-bin/luci/", "validated_offline_write_blocked", nil, 0, nil)
    }

    private func encode(_ params: [String: String]) -> String {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return params.sorted(by: { $0.key < $1.key }).map { k, v in
            "\(k.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")=\(v.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
        }.joined(separator: "&")
    }

    private func rpcReadOnly(_ radio: String, requestId: Int) async {
        // Only a statically discovered, read-only vendor function is invoked.
        // Exact WR3000 response/schema remains subject to physical validation.
        let payload: [String: Any] = [
            "jsonrpc": "2.0", "id": requestId,
            "method": "wifi.getstatus", "params": [radio]
        ]
        guard let json = try? JSONSerialization.data(withJSONObject: payload),
              let body = String(data: json, encoding: .utf8) else {
            log("rpc", "/cgi-bin/luci/rpc/app", "encode_failure", nil, 0, nil)
            return
        }
        do {
            let (code, data) = try await request(
                "POST", "/cgi-bin/luci/rpc/app", body: body,
                contentType: "application/json", phase: "rpc_wifi_\(radio)"
            )
            guard code == 200,
                  let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                log("rpc_result", "wifi.getstatus/\(radio)", "http_or_json_error", code, 0, nil)
                return
            }
            if let error = message["error"] as? [String: Any] {
                let number = error["code"] as? Int ?? -1
                log("rpc_result", "wifi.getstatus/\(radio)", "rpc_error_code:\(number)", code, 0, nil)
                return
            }
            guard let result = message["result"] as? [String: Any] else {
                log("rpc_result", "wifi.getstatus/\(radio)", "missing_object_result", code, 0, nil)
                return
            }
            let expected = ["ssid", "up", "channel", "htbw", "txpower", "encryption", "bssid"]
            let present = expected.filter { result[$0] != nil }.joined(separator: ",")
            var safeMeasurements: [String] = []
            if let up = result["up"] as? Bool {
                safeMeasurements.append("up=\(up)")
            }
            if let channel = result["channel"] as? Int, (1...196).contains(channel) {
                safeMeasurements.append("channel=\(channel)")
            }
            if let width = result["htbw"] as? String,
               ["ht20", "ht40", "ht80", "ht160", "ht320"].contains(width.lowercased()) {
                safeMeasurements.append("width=\(width.lowercased())")
            }
            if let power = result["txpower"] as? Int, (0...100).contains(power) {
                safeMeasurements.append("power_pct=\(power)")
            }
            if let encryption = result["encryption"] as? String,
               ["none", "psk", "psk2", "psk-mixed", "sae", "sae-mixed"].contains(encryption.lowercased()) {
                safeMeasurements.append("encryption=\(encryption.lowercased())")
            }
            // Only whitelisted runtime state is captured. Never SSID,
            // BSSID, Wi-Fi key, personal identifiers or raw JSON.
            let statusLine = "fields:\(present); " + safeMeasurements.joined(separator: ",")
            log("rpc_result", "wifi.getstatus/\(radio)", statusLine, code, 0, nil)
        } catch {
            log("rpc_result", "wifi.getstatus/\(radio)", "transport_failure", nil, 0, nil)
        }
    }

    func discover(host: String) async {
        await run(host: host, username: "admin", password: "", resetJournal: true)
    }

    func signIn(host: String, username: String, password: String) async {
        guard !password.isEmpty else {
            status = "Введите пароль администратора."
            log("login", "/cgi-bin/luci", "missing_password_not_sent", nil, 0, nil)
            return
        }
        await run(host: host, username: username, password: password, resetJournal: false)
    }

    private func run(host: String, username: String, password: String,
                     resetJournal: Bool) async {
        if resetJournal {
            // Keep both the previous attempt and the diagnostics that
            // determine the login vs factory state.
            if let last = savedReportURL, FileManager.default.fileExists(atPath: last.path) {
                let previous = last.deletingLastPathComponent()
                    .appendingPathComponent("routerlab-wr3000-previous-session.json")
                try? FileManager.default.removeItem(at: previous)
                try? FileManager.default.copyItem(at: last, to: previous)
            }
            records = []
        }
        entryState = .checking
        factoryPasswordFormDetected = false
        status = "Определяем состояние Cudy..."
        defer { persist() }
        currentHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard validHost(currentHost) else {
            entryState = .unknown
            status = "Укажите локальный IPv4-адрес роутера."
            log("guard", "", "invalid_lan_host", nil, 0, nil)
            return
        }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 15
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        session?.invalidateAndCancel()
        session = URLSession(configuration: config, delegate: BlockRedirects(), delegateQueue: nil)
        defer { session?.finishTasksAndInvalidate(); session = nil }
        do {
            let (code, data) = try await request("GET", "/cgi-bin/luci", phase: "discovery")
            guard [200, 403].contains(code), let html = String(data: data, encoding: .utf8) else {
                entryState = .unknown
                status = "Веб-интерфейс LuCI не распознан: HTTP \(code)."
                log("decision", "/cgi-bin/luci", "unrecognized_http_response", code, 0, nil)
                return
            }
            let names = inputNames(html)
            let fields = formValues(html)
            let actionKind = formActionKind(html)
            log("form_profile", "/cgi-bin/luci",
                "input_names=\(names.joined(separator: ","));csrf_present=\(fields["_csrf"] != nil);salt_present=\(fields["salt"] != nil);token_present=\(fields["token"] != nil);action=\(actionKind)",
                code, 0, nil)
            // Two password inputs are a first-run hint from the physical
            // recorder. cbi-commit-btn on its own is NOT sufficient.
            let factoryWizard = names.contains("luci_password2")
            if factoryWizard {
                factoryPasswordFormDetected = true
                entryState = .createPassword
                status = "Первая настройка: создайте пароль администратора."
                log("decision", "/cgi-bin/luci/",
                    "factory_input_luci_password2_detected;stock_POST_not_captured;write_blocked",
                    code, 0, nil)
                return
            }
            let loginForm = names.contains("luci_password") ||
                names.contains("luci_username") ||
                names.contains("luci_password")
            guard loginForm else {
                entryState = .unknown
                status = "Состояние роутера не определено. Сохраните диагностический журнал."
                log("decision", "/cgi-bin/luci",
                    "neither_factory_nor_login_inputs", code, 0, nil)
                return
            }
            if password.isEmpty {
                entryState = .signIn
                status = "Роутер настроен: введите пароль администратора."
                log("decision", "/cgi-bin/luci", "existing_admin_login_form_detected", code, 0, nil)
                return
            }
            guard let salt = fields["salt"], !salt.isEmpty,
                  let token = fields["token"], !token.isEmpty else {
                entryState = .signIn
                status = "Параметры штатного входа не распознаны. Пароль не отправлялся; экспортируйте журнал."
                log("auth_guard", "/cgi-bin/luci", "required_salt_or_token_missing_no_POST", code, 0, nil)
                return
            }
            let digest = sha(sha(password + salt) + token)
            let tz = TimeZone.current.identifier
            var args = ["luci_username": username, "luci_password": digest,
                        "zonename": tz, "timeclock": String(Int(Date().timeIntervalSince1970)),
                        "luci_language": "en"]
            for name in ["_csrf", "salt", "token"] {
                if let value = fields[name], !value.isEmpty { args[name] = value }
            }
            log("auth_attempt", "/cgi-bin/luci",
                "stock_login_candidate;token_present=\(fields["token"] != nil);salt_present=\(fields["salt"] != nil)",
                nil, 0, nil)
            let (loginCode, _) = try await request("POST", "/cgi-bin/luci",
                                                   body: encode(args), phase: "login")
            if loginCode < 200 || loginCode > 399 {
                entryState = .signIn
                status = "Сервер отклонил вход: HTTP \(loginCode)."
                log("decision", "/cgi-bin/luci", "login_http_failure", loginCode, 0, nil)
                return
            }
            let (identityCode, system) = try await request(
                "GET", "/cgi-bin/luci/admin/system/status", phase: "identity")
            let identityText = String(data: system, encoding: .utf8) ?? ""
            let hardwareIdentified = identityText.range(of: "WR3000", options: .caseInsensitive) != nil
            let protectedFields = inputNames(identityText)
            let hasLoginForm = protectedFields.contains("luci_username") ||
                protectedFields.contains("luci_password")
            let cookieExists = config.httpCookieStorage?.cookies?.contains(where: {
                $0.name.hasPrefix("sysauth")
            }) ?? false
            log("auth_evidence", "/cgi-bin/luci/admin/system/status",
                "wr3000_hint=\(hardwareIdentified);sysauth_cookie_present=\(cookieExists);login_form_returned=\(hasLoginForm)",
                identityCode, 0, nil)
            guard identityCode == 200 && cookieExists && !hasLoginForm && !system.isEmpty else {
                entryState = .signIn
                status = "Вход не подтверждён. Проверьте журнал и повторите попытку."
                log("decision", "/cgi-bin/luci", "login_not_verified", identityCode, 0, nil)
                return
            }
            entryState = .connected
            for route in Self.readRoutes.dropFirst() {
                _ = try? await request("GET", route, phase: "read_only")
            }
            await rpcReadOnly("wlan00", requestId: 101)
            await rpcReadOnly("wlan10", requestId: 102)
            status = hardwareIdentified
                ? "Авторизация подтверждена. WR3000 обнаружен (ревизия требует проверки)."
                : "Авторизация подтверждена, но модель WR3000 не подтверждена."
            log("decision", "/cgi-bin/luci", "authenticated_read_only", identityCode, 0, nil)
        } catch {
            let code = (error as? URLError)?.code.rawValue ?? -1
            entryState = .unreachable
            status = "Нет ответа роутера или ошибка соединения (\(code))."
            log("decision", "/cgi-bin/luci", "connection_failure:\(code)", nil, 0, nil)
        }
    }

    func exportPreviousFile() -> URL? {
        guard let savedReportURL = savedReportURL else { return nil }
        let previous = savedReportURL.deletingLastPathComponent()
            .appendingPathComponent("routerlab-wr3000-previous-session.json")
        return FileManager.default.fileExists(atPath: previous.path) ? previous : nil
    }

    func exportFile() -> URL? {
        guard let data = try? JSONEncoder().encode(report()) else { return nil }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("routerlab-wr3000-\(Int(Date().timeIntervalSince1970)).json")
        do { try data.write(to: file, options: .atomic); return file } catch { return nil }
    }
}
