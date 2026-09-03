// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "focusreels-ax",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "focusreels-ax",
            path: "Sources/focusreels-ax"
        )
    ]
)
