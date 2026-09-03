import Foundation

/// Writes one NDJSON line to the FocusReels Unix socket and closes.
/// Best-effort by design: if the app is not running we stay silent rather than
/// bother the user about an overlay they did not ask for right now.
enum SocketClient {
    static func defaultPath() -> String {
        if let override = ProcessInfo.processInfo.environment["FOCUSREELS_SOCKET"],
           !override.isEmpty {
            return override
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/Library/Application Support/FocusReels/broker.sock"
    }

    @discardableResult
    static func send(_ event: [String: Any], to path: String = defaultPath()) -> Bool {
        guard let data = try? JSONSerialization.data(withJSONObject: event),
              var line = String(data: data, encoding: .utf8) else { return false }
        line.append("\n")

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(path.utf8)
        // sun_path is 104 bytes on Darwin; a longer path simply cannot be used.
        guard pathBytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { return false }
        withUnsafeMutableBytes(of: &addr.sun_path) { raw in
            raw.copyBytes(from: pathBytes)
        }

        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let connected = withUnsafePointer(to: &addr) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                Darwin.connect(fd, sa, size)
            }
        }
        guard connected == 0 else { return false }

        return line.withCString { cstr -> Bool in
            let len = strlen(cstr)
            return write(fd, cstr, len) == len
        }
    }
}
