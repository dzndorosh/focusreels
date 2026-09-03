import ApplicationServices
import Foundation

/// One poll's worth of evidence about an app's chat UI.
struct UISignals {
    var stopControl = false
    var sendControl = false
    var busyIndicator = false

    /// Two independent signals agreeing is what keeps a redraw from being read
    /// as a turn. A Stop control alone is enough to suspect work; Stop present
    /// *and* Send gone is what we act on.
    var busyScore: Int {
        var score = 0
        if stopControl { score += 2 }
        if busyIndicator { score += 1 }
        if stopControl && !sendControl { score += 1 }
        return score
    }
}

/// Reads the Accessibility tree of one app.
///
/// PRIVACY: only `AXRole` is read for every node, plus the label attributes
/// (`AXTitle` / `AXDescription` / `AXHelp`) of buttons and progress indicators.
/// Text areas, static text and web content values are never read, so no part of
/// a conversation can enter this process.
enum AXScanner {
    private static let maxNodes = 3000
    private static let maxDepth = 16

    static func signals(pid: pid_t, profile: Profile) -> UISignals {
        var signals = UISignals()
        let app = AXUIElementCreateApplication(pid)

        var roots: [AXUIElement] = []
        if let focused = copyElement(app, kAXFocusedWindowAttribute) {
            roots.append(focused)
        }
        if roots.isEmpty, let windows = copyElements(app, kAXWindowsAttribute) {
            roots.append(contentsOf: windows.prefix(4))
        }
        if roots.isEmpty { return signals }

        var queue = roots.map { (element: $0, depth: 0) }
        var visited = 0

        while !queue.isEmpty, visited < maxNodes {
            let (element, depth) = queue.removeFirst()
            visited += 1

            guard let role = copyString(element, kAXRoleAttribute) else { continue }

            switch role {
            case "AXButton", "AXRadioButton", "AXMenuButton", "AXPopUpButton":
                let label = labelOf(element)
                if matches(label, profile.stopPatterns) { signals.stopControl = true }
                if matches(label, profile.sendPatterns) { signals.sendControl = true }
            case "AXProgressIndicator", "AXBusyIndicator":
                signals.busyIndicator = true
            default:
                break
            }

            // Enough evidence collected — stop walking the tree.
            if signals.stopControl && signals.busyIndicator { break }

            if depth < maxDepth, let children = copyElements(element, kAXChildrenAttribute) {
                for child in children { queue.append((child, depth + 1)) }
            }
        }

        return signals
    }

    /// Button labels only — never a value attribute.
    private static func labelOf(_ element: AXUIElement) -> String {
        var parts: [String] = []
        for attribute in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute] {
            if let s = copyString(element, attribute) { parts.append(s) }
        }
        return parts.joined(separator: " ").lowercased()
    }

    private static func matches(_ label: String, _ patterns: [String]) -> Bool {
        guard !label.isEmpty else { return false }
        return patterns.contains { label.contains($0) }
    }

    private static func copyString(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
              let string = value as? String, !string.isEmpty else { return nil }
        // A label this long is not a button label — refuse to look at it.
        return string.count <= 120 ? string : nil
    }

    private static func copyElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success
        else { return nil }
        guard let raw = value, CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
        return (raw as! AXUIElement)
    }

    private static func copyElements(_ element: AXUIElement, _ attribute: String) -> [AXUIElement]? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
              let array = value as? [AXUIElement], !array.isEmpty else { return nil }
        return array
    }
}
