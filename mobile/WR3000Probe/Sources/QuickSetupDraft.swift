import Foundation

/// Offline UI draft. Nothing in this file performs network I/O.
enum DraftWANMode: String, CaseIterable, Identifiable {
    case dhcp = "DHCP (IPoE)"
    case pppoe = "PPPoE"
    case staticIP = "Static IPv4"

    var id: String { rawValue }
}

struct QuickSetupDraft {
    let wanMode: DraftWANMode
    let pppoeUsername: String
    let pppoePassword: String
    let staticIP: String
    let staticMask: String
    let staticGateway: String
    let ssid24: String
    let key24: String
    let ssid5: String
    let key5: String

    private func validIPv4(_ input: String) -> Bool {
        let parts = input.split(separator: ".", omittingEmptySubsequences: false)
        return parts.count == 4 &&
            parts.allSatisfy { !($0.isEmpty) && UInt8($0) != nil }
    }

    func validationErrors() -> [String] {
        var errors: [String] = []
        switch wanMode {
        case .dhcp:
            break
        case .pppoe:
            if pppoeUsername.isEmpty || pppoePassword.isEmpty {
                errors.append("PPPoE: требуются логин и пароль.")
            }
        case .staticIP:
            if !validIPv4(staticIP) || !validIPv4(staticMask) || !validIPv4(staticGateway) {
                errors.append("Static IP: проверьте IPv4, маску и шлюз.")
            }
        }
        for (label, ssid, password) in [
            ("2,4 ГГц", ssid24, key24),
            ("5 ГГц", ssid5, key5)
        ] {
            if !(1...32).contains(ssid.utf8.count) {
                errors.append("\(label): SSID должен содержать 1–32 байта UTF-8.")
            }
            if !(8...63).contains(password.utf8.count) {
                errors.append("\(label): пароль WPA2 должен содержать 8–63 байта.")
            }
        }
        return errors
    }

    /// Does not include SSIDs, PPPoE credentials, IPv4 values or Wi-Fi keys.
    func redactedSummary() -> String {
        let errors = validationErrors()
        if !errors.isEmpty {
            return errors.joined(separator: "\n")
        }
        return "Локальная проверка пройдена: WAN \(wanMode.rawValue), Wi-Fi 2,4/5 ГГц. Это только предварительный проект. Ничего не отправлено на роутер."
    }
}
