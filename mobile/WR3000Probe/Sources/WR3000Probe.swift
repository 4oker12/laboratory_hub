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
        ProbeReport(schema: "routerlab.wr3000.probe.v1", target: "Cudy WR3000 V1.0",
                    firmwareTarget: "R31-2.4.19", host: currentHost,
                    createdAt: now(), status: status, records: records)
    }

    private func persist() {
        guard let url = savedReportURL,
              let data = try? JSONEncoder().encode(report())
        else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    private static let readRoutes = [
        "/cgi-bin/luci/admin/system/system",
        "/cgi-bin/luci/admin/system/status",
        "/cgi-bin/luci/admin/network/wan/status",
        "/cgi-bin/luci/admin/network/wireless/status?iface=wlan00",
        "/cgi-bin/luci/admin/network/wireless/status?iface=wlan10"
    ]

    private func now() -> String { ISO8601DateFormatter().string(from: Date()) }
    private func sha(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func hashPrefix(_ data: Data) -> String {
        String(SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined().prefix(16))
    }
    private func log(_ phase: String, _ path: String, _ outcome: String, _ code: Int?, _ ms: Int, _ data: Data?) {
        records.append(ProbeRecord(id: UUID(), timestamp: now(), phase: phase, path: path,
            outcome: outcome, httpStatus: code, durationMs: ms, bytes: data?.count ?? 0,
            responseSHA256Prefix: data.map(hashPrefix)))
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
            log(phase, path, "received", code, ms, data)
            return (code, data)
        } catch {
            let ms = Int(Date().timeIntervalSince(start) * 1000)
            log(phase, path, "network_error:\((error as? URLError)?.code.rawValue ?? -1)", nil, ms, nil)
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
            // No SSID, BSSID, Wi-Fi key or JSON result value enters diagnostics.
            log("rpc_result", "wifi.getstatus/\(radio)", "fields:\(present)", code, 0, nil)
        } catch {
            log("rpc_result", "wifi.getstatus/\(radio)", "transport_failure", nil, 0, nil)
        }
    }

    func run(host: String, username: String, password: String) async {
        // Keep the previous diagnostic session in case a new test fails mid-flight.
        if let last = savedReportURL, FileManager.default.fileExists(atPath: last.path) {
            let previous = last.deletingLastPathComponent().appendingPathComponent("routerlab-wr3000-previous-session.json")
            try? FileManager.default.removeItem(at: previous)
            try? FileManager.default.copyItem(at: last, to: previous)
        }
        records = []
        status = "Начало проверки..."
        defer { persist() }
        currentHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard validHost(currentHost) else {
            status = "Разрешён только локальный IPv4-адрес (LAN)."
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
        status = "Проверка входа..."
        defer { session?.finishTasksAndInvalidate(); session = nil }
        do {
            let (code, data) = try await request("GET", "/cgi-bin/luci", phase: "discovery")
            guard [200, 403].contains(code), let html = String(data: data, encoding: .utf8),
                  html.contains("luci_password") || html.contains("admin/wizard") else {
                status = "Не удалось распознать форму LuCI: HTTP \(code)"
                log("discovery", "/cgi-bin/luci", "form_not_detected", code, 0, nil)
                return
            }
            let fields = formValues(html)
            log("form", "/cgi-bin/luci", "fields:csrf=\(fields["_csrf"] != nil),salt=\(fields["salt"] != nil),token=\(fields["token"] != nil)", nil, 0, nil)
            // V1/R31 stock sysauth.htm: defpasswd=1 + wizard=1 posts to /admin/wizard.
            // Never submit this form automatically: it changes the administrator password.
            let factoryWizard = html.range(
                of: #"action\s*=\s*['"]/cgi-bin/luci/admin/wizard['"]"#,
                options: .regularExpression
            ) != nil
            if factoryWizard {
                log("factory", "/cgi-bin/luci/admin/wizard",
                    "stock_first_run_password_form_detected; write_skipped", code, 0, nil)
                status = "Заводской WR3000: требуется создать пароль администратора. Запись отключена; экспортируйте лог."
                return
            }
            if !password.isEmpty {
                var digest = password
                if let salt = fields["salt"], !salt.isEmpty { digest = sha(password + salt) }
                if let token = fields["token"], !token.isEmpty, fields["salt"]?.isEmpty == false {
                    digest = sha(digest + token)
                }
                let tz = TimeZone.current.identifier
                var args = ["luci_username": username, "luci_password": digest,
                            "zonename": tz, "timeclock": String(Int(Date().timeIntervalSince1970)),
                            "luci_language": "en"]
                for name in ["_csrf", "salt", "token"] {
                    if let value = fields[name], !value.isEmpty { args[name] = value }
                }
                let (loginCode, _) = try await request("POST", "/cgi-bin/luci", body: encode(args), phase: "login")
                if loginCode < 200 || loginCode > 399 {
                    status = "Сервер отклонил попытку входа: HTTP \(loginCode)."
                    return
                }
            } else {
                log("login", "/cgi-bin/luci", "skipped_no_password", nil, 0, nil)
            }
            let (identityCode, system) = try await request("GET", "/cgi-bin/luci/admin/system/system", phase: "identity")
            let text = String(data: system, encoding: .utf8) ?? ""
            let hardwareIdentified = text.range(of: "WR3000", options: .caseInsensitive) != nil
            let hasLoginForm = text.contains("luci_password") || text.contains("name=\"luci_username\"")
            let cookieExists = config.httpCookieStorage?.cookies?.contains(where: { $0.name == "sysauth" }) ?? false
            log("identity", "/cgi-bin/luci/admin/system/system", "wr3000_hint=\(hardwareIdentified),sysauth_cookie=\(cookieExists),login_form=\(hasLoginForm)", nil, 0, nil)
            guard identityCode == 200 && cookieExists && !hasLoginForm && !system.isEmpty else {
                status = "Авторизация не подтверждена; выполнен только безопасный сбор диагностики."
                return
            }
            for route in Self.readRoutes.dropFirst() {
                _ = try? await request("GET", route, phase: "read_only")
            }
            await rpcReadOnly("wlan00", requestId: 101)
            await rpcReadOnly("wlan10", requestId: 102)
            status = hardwareIdentified ? "Сессия получена; WR3000 обнаружен (проверить HW-ревизию)." :
                "Сессия получена, но идентичность WR3000 не подтверждена."
        } catch {
            status = "Сбой соединения/авторизации: код \((error as? URLError)?.code.rawValue ?? -1)."
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
