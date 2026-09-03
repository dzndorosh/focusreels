import Foundation

/// What to watch, and which control labels mean "the agent is working".
struct Profile {
    /// the `source` reported to the broker
    let source: String
    let name: String
    let bundlePrefixes: [String]
    /// a control that only exists while a turn is running
    let stopPatterns: [String]
    /// a control that only becomes available again once the turn is over
    let sendPatterns: [String]

    static let jetbrains = Profile(
        source: "jetbrains",
        name: "JetBrains AI Assistant",
        bundlePrefixes: [
            "com.jetbrains.",
            "com.google.android.studio",
        ],
        stopPatterns: ["stop", "cancel", "interrupt"],
        sendPatterns: ["send", "submit"]
    )

    /// Fallback for VS Code when Agent Hooks are unavailable (org policy, or
    /// the Preview feature switched off).
    static let vscode = Profile(
        source: "vscode-copilot",
        name: "VS Code / Copilot Chat",
        bundlePrefixes: [
            "com.microsoft.VSCode",
            "com.microsoft.VSCodeInsiders",
            "com.visualstudio.code.oss",
            "com.vscodium",
        ],
        stopPatterns: ["stop", "cancel"],
        sendPatterns: ["send", "submit"]
    )

    static func named(_ id: String) -> Profile? {
        switch id.lowercased() {
        case "jetbrains": return .jetbrains
        case "vscode", "vscode-copilot", "code": return .vscode
        default: return nil
        }
    }
}
