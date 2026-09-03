import AppKit
import ApplicationServices
import Foundation

/// focusreels-ax — macOS Accessibility adapter.
///
/// Used where an IDE has no hook API (JetBrains AI Assistant) or where hooks are
/// unavailable (VS Code Agent Hooks disabled by policy). It watches the chat's
/// Stop / Send controls and reports turn boundaries as metadata.
///
/// It never reads chat text: see the privacy note in AXScanner.swift.

struct Options {
    var profile: Profile = .jetbrains
    var pollInterval: TimeInterval = 0.4
    var verbose = false
    var socketPath: String = SocketClient.defaultPath()
}

func parseOptions() -> Options {
    var options = Options()
    var args = Array(CommandLine.arguments.dropFirst())

    while let arg = args.first {
        args.removeFirst()
        switch arg {
        case "--profile":
            guard let value = args.first, let profile = Profile.named(value) else {
                FileHandle.standardError.write(Data("unknown --profile\n".utf8))
                exit(2)
            }
            args.removeFirst()
            options.profile = profile
        case "--interval":
            if let value = args.first, let seconds = Double(value) {
                args.removeFirst()
                options.pollInterval = max(0.15, min(2.0, seconds))
            }
        case "--socket":
            if let value = args.first { args.removeFirst(); options.socketPath = value }
        case "--verbose", "-v":
            options.verbose = true
        case "--help", "-h":
            print("""
            focusreels-ax [--profile jetbrains|vscode] [--interval 0.4]
                          [--socket <path>] [--verbose]

            Watches the IDE chat's Stop/Send controls and reports turn
            boundaries to FocusReels. Reads control labels only — never text.
            Requires Accessibility permission for the terminal or app that runs it.
            """)
            exit(0)
        default:
            break
        }
    }
    return options
}

let options = parseOptions()

// Accessibility is off by default; prompt once, then explain and exit.
let trustOptions = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
if !AXIsProcessTrustedWithOptions(trustOptions as CFDictionary) {
    FileHandle.standardError.write(Data("""
    FocusReels needs Accessibility permission.
    Grant it to the app running this binary (Terminal, iTerm, …) in
    System Settings → Privacy & Security → Accessibility, then run it again.

    """.utf8))
    exit(1)
}

func log(_ message: String) {
    guard options.verbose else { return }
    FileHandle.standardError.write(Data("[focusreels-ax] \(message)\n".utf8))
}

func emit(_ event: String, turnId: String, outcome: String? = nil) {
    var payload: [String: Any] = [
        "source": options.profile.source,
        "turn_id": turnId,
        "event": event,
        "timestamp": Int(Date().timeIntervalSince1970 * 1000),
    ]
    if let outcome { payload["outcome"] = outcome }
    let ok = SocketClient.send(payload, to: options.socketPath)
    log("\(event) \(turnId) \(outcome ?? "") -> \(ok ? "sent" : "app not running")")
}

func apply(_ transition: TurnDetector.Transition) {
    switch transition {
    case .none:
        break
    case let .started(turnId):
        emit("turn_started", turnId: turnId)
    case let .ended(turnId, outcome):
        emit("turn_ended", turnId: turnId, outcome: outcome)
    }
}

var detectors: [pid_t: TurnDetector] = [:]

func targetApps() -> [NSRunningApplication] {
    NSWorkspace.shared.runningApplications.filter { app in
        guard let bundleId = app.bundleIdentifier else { return false }
        return options.profile.bundlePrefixes.contains { bundleId.hasPrefix($0) }
    }
}

func tick() {
    let apps = targetApps()
    let livePids = Set(apps.map(\.processIdentifier))

    // An IDE that vanished mid-turn must not strand the overlay.
    for (pid, detector) in detectors where !livePids.contains(pid) {
        apply(detector.closeIfOpen(outcome: "aborted"))
        detectors.removeValue(forKey: pid)
        log("app \(pid) went away")
    }

    for app in apps {
        let pid = app.processIdentifier
        let detector = detectors[pid] ?? {
            let fresh = TurnDetector(pid: pid)
            detectors[pid] = fresh
            log("watching \(app.localizedName ?? "?") (pid \(pid))")
            return fresh
        }()
        apply(detector.observe(AXScanner.signals(pid: pid, profile: options.profile)))
    }
}

func shutdown() -> Never {
    for detector in detectors.values {
        apply(detector.closeIfOpen(outcome: "aborted"))
    }
    exit(0)
}

for signalNumber in [SIGINT, SIGTERM] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    source.setEventHandler { shutdown() }
    source.resume()
    // keep the source alive for the process lifetime
    withExtendedLifetime(source) {}
}

log("profile=\(options.profile.name) interval=\(options.pollInterval)s socket=\(options.socketPath)")
let timer = Timer.scheduledTimer(withTimeInterval: options.pollInterval, repeats: true) { _ in
    tick()
}
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
