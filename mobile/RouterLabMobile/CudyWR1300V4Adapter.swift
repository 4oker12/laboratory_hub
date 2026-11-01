import Foundation

/// Fingerprint fields come only from visible, non-secret stock UI text.
/// No guessed login, RPC, WAN or Wi-Fi calls are implemented here.
struct CudyWR1300V4Identity: Equatable {
    let revision: String
    let board: String
    let firmware: String
}

enum CudyWR1300V4Adapter {
    static let targetRevision = "V4"
    static let targetBoard = "R98"
    static let targetFirmware = "2.5.41"

    static func isExactTarget(_ identity: CudyWR1300V4Identity) -> Bool {
        identity.revision == targetRevision &&
        identity.board == targetBoard &&
        identity.firmware == targetFirmware
    }

    static func displayName(for identity: CudyWR1300V4Identity) -> String {
        let revision = identity.revision.isEmpty ? "" : " " + identity.revision
        return "Cudy WR1300" + revision
    }

    static let evidenceStatus = "static_firmware_research_only"
    static let authenticationVerified = false
    static let wanReadVerified = false
    static let wanWriteVerified = false
    static let wifiReadVerified = false
    static let wifiWriteVerified = false
    static let persistenceVerified = false
}
